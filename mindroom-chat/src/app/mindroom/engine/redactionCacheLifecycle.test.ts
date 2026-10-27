import { describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import {
  planRedactionCacheCleanup,
  removeAggregatedReactionByEventId,
} from './redactionCacheLifecycle';

const makeEvent = ({
  eventId,
  type = 'm.room.message',
  isRedaction = false,
  associatedId,
  threadRootId,
}: {
  eventId: string;
  type?: string;
  isRedaction?: boolean;
  associatedId?: string;
  threadRootId?: string;
}): MatrixEvent =>
  ({
    getId: () => eventId,
    getType: () => type,
    isRedaction: () => isRedaction,
    getAssociatedId: () => associatedId,
    getRelation: () => undefined,
    threadRootId,
    isThreadRoot: false,
  } as unknown as MatrixEvent);

const makeRoom = (
  eventsById: Record<string, MatrixEvent>,
  threads: Array<{ id: string; eventIds: string[] }> = []
): Room => {
  const threadObjects = threads.map((thread) => ({
    id: thread.id,
    getUnfilteredTimelineSet: () => ({
      findEventById: (eventId: string) =>
        thread.eventIds.includes(eventId) ? eventsById[eventId] : undefined,
    }),
  }));
  return {
    roomId: '!room:example.org',
    findEventById: (eventId: string) => eventsById[eventId],
    getThread: () => undefined,
    getThreads: () => threadObjects,
  } as unknown as Room;
};

describe('planRedactionCacheCleanup', () => {
  it('returns undefined for non-redaction events', () => {
    const room = makeRoom({});
    const notRedaction = makeEvent({ eventId: '$msg' });
    expect(planRedactionCacheCleanup({ room, redactionEvent: notRedaction })).toBeUndefined();
  });

  it('returns undefined when the redaction has no target id', () => {
    const room = makeRoom({});
    const redaction = makeEvent({ eventId: '$redaction', isRedaction: true });
    expect(planRedactionCacheCleanup({ room, redactionEvent: redaction })).toBeUndefined();
  });

  it('plans no action for an unknown target (left to the reconcile pass)', () => {
    const room = makeRoom({});
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$gone',
    });
    expect(planRedactionCacheCleanup({ room, redactionEvent: redaction })).toEqual({
      redactedEventId: '$gone',
      threadTargetFromFallback: false,
      deleteRecords: false,
    });
  });

  it('plans record deletion for a redacted reaction on a thread reply', () => {
    const reply = makeEvent({ eventId: '$reply', threadRootId: '$root' });
    const reaction = makeEvent({
      eventId: '$reaction',
      type: 'm.reaction',
      threadRootId: '$root',
    });
    const room = makeRoom({ $reply: reply, $reaction: reaction });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: '$root',
      threadTargetFromFallback: false,
      deleteRecords: true,
    });
  });

  it('plans a re-persist (tombstone), not deletion, for a redacted thread message', () => {
    const reply = makeEvent({ eventId: '$reply', threadRootId: '$root' });
    const room = makeRoom({ $reply: reply });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reply',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$reply',
      threadCacheTargetId: '$root',
      deleteRecords: false,
    });
  });

  it('honors the SDK-supplied pre-prune threadId hint over every other signal', () => {
    // CINNY-207 P3 gate (layer 2 — secondary hint): matrix-js-sdk's
    // `applyEventAsRedaction` captures `redactedEvent.threadRootId` BEFORE
    // calling `makeRedacted` and passes it as the third arg to
    // `RoomEvent.Redaction`. That capture happens pre-prune, so it is
    // reliable even for reactions whose relation has since been stripped.
    // The plan must honor it as an authoritative attribution — not treat
    // it as a viewer-side guess.
    const prunedReaction = makeEvent({ eventId: '$reaction', type: 'm.reaction' });
    const room = makeRoom({ $reaction: prunedReaction });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({
      room,
      redactionEvent: redaction,
      sdkThreadIdHint: '$thread-root',
    });
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: '$thread-root',
      threadTargetFromFallback: false,
      deleteRecords: true,
    });
  });

  it('falls back to the open thread id when the pruned reaction lost its thread hints', () => {
    const prunedReaction = makeEvent({ eventId: '$reaction', type: 'm.reaction' });
    const room = makeRoom({ $reaction: prunedReaction });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({
      room,
      redactionEvent: redaction,
      fallbackThreadId: '$open-thread',
    });
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: '$open-thread',
      threadTargetFromFallback: true,
      deleteRecords: true,
    });
  });

  it('leaves the thread target undefined when no hint exists (scan fallback)', () => {
    const prunedReaction = makeEvent({ eventId: '$reaction', type: 'm.reaction' });
    const room = makeRoom({ $reaction: prunedReaction });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: undefined,
      threadTargetFromFallback: false,
      deleteRecords: true,
    });
  });

  it('derives thread attribution from SDK thread membership when the pruned reaction lost its hints and exactly one thread contains it (CINNY-207 P3 gate)', () => {
    // Reaction is pruned before RoomEvent.Redaction fires: no threadRootId,
    // no relation, so getThreadCacheTargetId / targetEvent.threadRootId /
    // redactionEvent.threadRootId all return undefined. The SDK still has
    // the (pruned) event in the thread's unfiltered timelineSet — that's
    // the only remaining attribution signal, and it MUST be honored so the
    // redaction record persists to thread scope (invariant I2).
    const prunedReaction = makeEvent({ eventId: '$reaction', type: 'm.reaction' });
    const room = makeRoom({ $reaction: prunedReaction }, [
      { id: '$other-thread', eventIds: ['$unrelated'] },
      { id: '$thread-root', eventIds: ['$reaction'] },
    ]);
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: '$thread-root',
      // SDK membership IS the event's attribution, not a viewer-side guess,
      // so this must NOT be treated as fallback (would trigger a
      // duplicate room-scope persist).
      threadTargetFromFallback: false,
      deleteRecords: true,
    });
  });

  it('leaves the thread target undefined when the pruned target appears in multiple SDK threads (ambiguous)', () => {
    const prunedReaction = makeEvent({ eventId: '$reaction', type: 'm.reaction' });
    const room = makeRoom({ $reaction: prunedReaction }, [
      { id: '$thread-a', eventIds: ['$reaction'] },
      { id: '$thread-b', eventIds: ['$reaction'] },
    ]);
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    // Ambiguous → keep the by-event-id scan + room-scope persist behavior.
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: undefined,
      threadTargetFromFallback: false,
      deleteRecords: true,
    });
  });

  it('leaves the thread target undefined when the pruned target is in zero SDK threads', () => {
    const prunedReaction = makeEvent({ eventId: '$reaction', type: 'm.reaction' });
    const room = makeRoom({ $reaction: prunedReaction }, [
      { id: '$thread-a', eventIds: ['$other'] },
    ]);
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: undefined,
      threadTargetFromFallback: false,
      deleteRecords: true,
    });
  });

  it('plans a room-level re-persist for a redacted room message', () => {
    const message = makeEvent({ eventId: '$msg' });
    const room = makeRoom({ $msg: message });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$msg',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$msg',
      threadCacheTargetId: undefined,
      deleteRecords: false,
    });
  });
});

describe('removeAggregatedReactionByEventId', () => {
  const makeAggregatedReaction = (eventId: string): MatrixEvent =>
    ({ getId: () => eventId } as unknown as MatrixEvent);

  const makeTimelineSet = (relationsByParent: Record<string, MatrixEvent[]>) => {
    const removeEvent = vi.fn();
    const timelineSet = {
      relations: {
        getChildEventsForEvent: (parentId: string) => {
          const relationEvents = relationsByParent[parentId];
          if (!relationEvents) return undefined;
          return {
            getRelations: () => relationEvents,
            removeEvent,
          };
        },
      },
    };
    return { timelineSet, removeEvent };
  };

  it('removes a clone-aggregated reaction by event id and reports the parent', () => {
    const staleReaction = makeAggregatedReaction('$reaction');
    const { timelineSet, removeEvent } = makeTimelineSet({ $reply: [staleReaction] });

    const parentId = removeAggregatedReactionByEventId({
      timelineSets: [timelineSet as never],
      candidateParentIds: ['$other', '$reply'],
      redactedEventId: '$reaction',
    });

    expect(parentId).toBe('$reply');
    expect(removeEvent).toHaveBeenCalledWith(staleReaction);
  });

  it('leaves unrelated reactions alone and returns undefined when nothing matches', () => {
    const otherReaction = makeAggregatedReaction('$other-reaction');
    const { timelineSet, removeEvent } = makeTimelineSet({ $reply: [otherReaction] });

    const parentId = removeAggregatedReactionByEventId({
      timelineSets: [timelineSet as never, undefined],
      candidateParentIds: ['$reply'],
      redactedEventId: '$reaction',
    });

    expect(parentId).toBeUndefined();
    expect(removeEvent).not.toHaveBeenCalled();
  });

  it('handles empty timeline sets', () => {
    expect(
      removeAggregatedReactionByEventId({
        timelineSets: [undefined],
        candidateParentIds: ['$reply'],
        redactedEventId: '$reaction',
      })
    ).toBeUndefined();
  });
});
