import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  aggregateCachedRelationEvents,
  applyCachedRedactions,
  applyCachedReplaceRelations,
  collectRedactedRelationTargetsFromLookup,
  hydrateCachedEvents,
  serializeEventsForCache,
} from './eventCacheEditUtils';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = 'original'
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org',
  body = eventId
) =>
  new MatrixEvent({
    content: {
      body: `* ${body}`,
      'm.new_content': {
        body,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeRedactionEvent = (eventId: string, ts: number, targetEventId: string) =>
  new MatrixEvent({
    content: {},
    event_id: eventId,
    origin_server_ts: ts,
    redacts: targetEventId,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.redaction',
  });

const makeReactionEvent = (eventId: string, ts: number, targetEventId: string, key = '👍') =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: targetEventId,
        key,
        rel_type: 'm.annotation',
      },
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.reaction',
  });

const room = { roomId: '!room:example.org', findEventById: () => undefined } as any;

describe('applyCachedReplaceRelations', () => {
  it('applies the latest cached replacement event to the target message', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const olderEdit = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'older');
    const newerEdit = makeEditEvent('$edit-2', 3000, '$target', '@alice:example.org', 'newer');

    applyCachedReplaceRelations([targetEvent, olderEdit, newerEdit]);

    expect(targetEvent.replacingEvent()?.getId()).toBe('$edit-2');
  });

  it('does not override a newer replacement with an older cached edit', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk', 4000, '$target');
    const olderCachedEdit = makeEditEvent('$cached', 3000, '$target');

    targetEvent.makeReplaced(sdkReplacement);
    applyCachedReplaceRelations([targetEvent, olderCachedEdit]);

    expect(targetEvent.replacingEvent()?.getId()).toBe('$sdk');
  });
});

describe('serializeEventsForCache', () => {
  it('stores the latest replacement under unsigned relations for the target event', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const firstEdit = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'first');
    const secondEdit = makeEditEvent('$edit-2', 2000, '$target', '@alice:example.org', 'second');

    const serializedTarget = serializeEventsForCache(room, [
      targetEvent,
      firstEdit,
      secondEdit,
    ]).find((event) => event.event_id === '$target');

    expect(serializedTarget?.unsigned?.['m.relations']?.['m.replace']).toMatchObject({
      event_id: '$edit-2',
      content: {
        'm.new_content': {
          body: 'second',
        },
      },
    });
  });

  it('persists an existing sdk replacement even when the edit event is not in the batch', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk', 3000, '$target', '@alice:example.org', 'latest');

    targetEvent.makeReplaced(sdkReplacement);

    const serializedTarget = serializeEventsForCache(room, [targetEvent]).find(
      (event) => event.event_id === '$target'
    );

    expect(serializedTarget?.unsigned?.['m.relations']?.['m.replace']).toMatchObject({
      event_id: '$sdk',
      content: {
        'm.new_content': {
          body: 'latest',
        },
      },
    });
  });

  it('persists cached redactions onto the target event payload', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'visible');
    const redactionEvent = makeRedactionEvent('$redact', 2000, '$target');

    const serializedTarget = serializeEventsForCache(room, [targetEvent, redactionEvent]).find(
      (event) => event.event_id === '$target'
    );

    expect(serializedTarget?.unsigned?.redacted_because).toMatchObject({
      event_id: '$redact',
    });
    expect(serializedTarget?.content).toEqual({});
  });

  // CINNY-207 P1.4 (finding F5, decision D5): standalone same-sender
  // m.replace events are dropped — their content is bundled onto the target.
  it('excludes standalone same-sender m.replace events (bundled onto target)', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const firstEdit = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'first');
    const secondEdit = makeEditEvent('$edit-2', 3000, '$target', '@alice:example.org', 'second');

    const serialized = serializeEventsForCache(room, [targetEvent, firstEdit, secondEdit]);

    expect(serialized.map((event) => event.event_id)).toEqual(['$target']);
    const serializedTarget = serialized[0];
    expect(serializedTarget?.unsigned?.['m.relations']?.['m.replace']).toMatchObject({
      event_id: '$edit-2',
      content: { 'm.new_content': { body: 'second' } },
    });
  });

  it('does not exclude cross-sender m.replace events', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org');
    const mallory = '@mallory:example.org';
    const crossEdit = makeEditEvent('$cross', 2000, '$target', mallory, 'malicious');

    const serialized = serializeEventsForCache(room, [targetEvent, crossEdit]);

    expect(new Set(serialized.map((event) => event.event_id))).toEqual(
      new Set(['$target', '$cross'])
    );
  });

  it('keeps a same-sender m.replace record when its target is not in the batch', () => {
    // Without the target in the batch the bundled representation cannot be
    // emitted, so the replace record must still be persisted to preserve the
    // information (this is the pre-compaction fallback shape).
    const edit = makeEditEvent('$edit-1', 2000, '$missing-target');
    const serialized = serializeEventsForCache(room, [edit]);
    expect(serialized.map((event) => event.event_id)).toEqual(['$edit-1']);
  });
});

describe('hydrateCachedEvents', () => {
  it('rehydrates a serialized replacement stored under unsigned relations', () => {
    const targetEvent = new MatrixEvent({
      content: {
        body: 'Thinking...  ⋯',
        msgtype: 'm.text',
      },
      event_id: '$target',
      origin_server_ts: 1000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: {
        'm.relations': {
          'm.replace': {
            content: {
              body: '* Final answer',
              'm.new_content': {
                body: 'Final answer',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$target',
                rel_type: 'm.replace',
              },
              msgtype: 'm.text',
            },
            event_id: '$edit-1',
            origin_server_ts: 2000,
            room_id: '!room:example.org',
            sender: '@alice:example.org',
            type: 'm.room.message',
          },
        },
      },
    });

    hydrateCachedEvents({
      room,
      events: [targetEvent],
    });

    expect(targetEvent.replacingEvent()?.getId()).toBe('$edit-1');
  });

  it('ignores serialized replacements that are missing origin_server_ts', () => {
    const targetEvent = new MatrixEvent({
      content: {
        body: 'Thinking...  ⋯',
        msgtype: 'm.text',
      },
      event_id: '$target',
      origin_server_ts: 1000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: {
        'm.relations': {
          'm.replace': {
            content: {
              body: '* Final answer',
              'm.new_content': {
                body: 'Final answer',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$target',
                rel_type: 'm.replace',
              },
              msgtype: 'm.text',
            },
            event_id: '$edit-1',
            room_id: '!room:example.org',
            sender: '@alice:example.org',
            type: 'm.room.message',
          },
        },
      },
    });

    hydrateCachedEvents({
      room,
      events: [targetEvent],
    });

    expect(targetEvent.replacingEvent()).toBeNull();
  });

  it('removes a bundled replacement when its edit has been redacted', () => {
    const editEvent = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'secret');
    const targetEvent = makeMessageEvent('$target', 1000);
    targetEvent.setUnsigned({
      'm.relations': {
        'm.replace': editEvent.event,
      },
    });
    targetEvent.makeReplaced(editEvent);
    const redactionEvent = makeRedactionEvent('$redact', 3000, '$edit-1');

    hydrateCachedEvents({ room, events: [targetEvent, redactionEvent] });

    expect(targetEvent.replacingEvent()).toBeNull();
    expect(targetEvent.getUnsigned()['m.relations']?.['m.replace']).toBeUndefined();
    expect(JSON.stringify(targetEvent.event)).not.toContain('secret');
  });

  it('removes redaction state embedded inside a serialized replacement', () => {
    const editEvent = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'secret');
    editEvent.setUnsigned({ redacted_because: { event_id: '$redact' } as IEvent });
    const targetEvent = makeMessageEvent('$target', 1000);
    targetEvent.setUnsigned({ 'm.relations': { 'm.replace': editEvent.event } });
    targetEvent.makeReplaced(editEvent);

    hydrateCachedEvents({ room, events: [targetEvent] });

    expect(targetEvent.replacingEvent()).toBeNull();
    expect(targetEvent.getUnsigned()['m.relations']?.['m.replace']).toBeUndefined();
    expect(JSON.stringify(targetEvent.event)).not.toContain('secret');
  });
});

describe('applyCachedRedactions', () => {
  it('redacts the cached target event when the redaction event is present', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'visible');
    const redactionEvent = makeRedactionEvent('$redact', 2000, '$target');

    applyCachedRedactions(room, [targetEvent, redactionEvent]);

    expect(targetEvent.isRedacted()).toBe(true);
    expect(targetEvent.getRedactionEvent()).toMatchObject({
      event_id: '$redact',
    });
  });

  // Greptile review (PR 5): the instance's existing redaction must win —
  // re-applying a different cached redaction would churn `redacted_because`
  // metadata away from what the live timeline attached.
  it('keeps the existing redaction on an already-redacted instance', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'visible');
    const liveRedaction = makeRedactionEvent('$redact-live', 2000, '$target');
    targetEvent.makeRedacted(liveRedaction, room);
    // Same timestamp, lexicographically larger id — would win the D12 pick
    // if the tie-break were (wrongly) allowed to override live state.
    const cachedRedaction = makeRedactionEvent('$redact-zzz', 2000, '$target');

    applyCachedRedactions(room, [targetEvent, cachedRedaction]);

    expect(targetEvent.getRedactionEvent()).toMatchObject({
      event_id: '$redact-live',
    });
  });
});

describe('aggregateCachedRelationEvents', () => {
  it('aggregates cached reaction events into timeline relations once per event id', () => {
    const aggregateChildEvent = vi.fn();
    const timelineSet = {
      relations: {
        aggregateChildEvent,
      },
    } as any;
    const seenEventIds = new Set<string>();
    const reactionEvent = makeReactionEvent('$reaction', 2000, '$target');

    aggregateCachedRelationEvents([reactionEvent], [timelineSet], seenEventIds);
    aggregateCachedRelationEvents([reactionEvent], [timelineSet], seenEventIds);

    expect(aggregateChildEvent).toHaveBeenCalledTimes(1);
    expect(aggregateChildEvent).toHaveBeenCalledWith(reactionEvent, timelineSet);
  });

  it('removes a stale aggregated reaction when a redacted shell for the same event id arrives', () => {
    const existingReaction = makeReactionEvent('$reaction', 2000, '$target');
    const staleRelations = {
      getRelations: () => [existingReaction],
      removeEvent: vi.fn(() => Promise.resolve()),
    };
    const timelineSet = {
      relations: {
        aggregateChildEvent: vi.fn(),
        getChildEventsForEvent: vi.fn(() => staleRelations),
      },
    } as any;
    const seenEventIds = new Set<string>(['$reaction']);
    const redactedReactionShell = makeReactionEvent('$reaction', 2100, '$target');
    vi.spyOn(redactedReactionShell, 'isRedacted').mockReturnValue(true);

    aggregateCachedRelationEvents([redactedReactionShell], [timelineSet], seenEventIds);

    expect(staleRelations.removeEvent).toHaveBeenCalledWith(existingReaction);
    expect(timelineSet.relations.aggregateChildEvent).not.toHaveBeenCalled();
  });
});

describe('collectRedactedRelationTargetsFromLookup', () => {
  it('recovers parent relation metadata for an already-redacted relation shell', () => {
    const staleReaction = makeReactionEvent('$reaction', 2000, '$target');
    const redactedReactionShell = new MatrixEvent({
      content: {},
      event_id: '$reaction',
      origin_server_ts: 2100,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.reaction',
      unsigned: {
        redacted_because: {
          auth_events: [],
          content: {
            redacts: '$reaction',
          },
          depth: 1,
          event_id: '$redaction',
          hashes: {
            sha256: '',
          },
          origin: 'example.org',
          origin_server_ts: 2200,
          prev_events: [],
          redacts: '$reaction',
          room_id: '!room:example.org',
          sender: '@alice:example.org',
          type: 'm.room.redaction',
        },
      },
    });

    expect(
      collectRedactedRelationTargetsFromLookup([redactedReactionShell], [staleReaction])
    ).toEqual([
      {
        eventId: '$reaction',
        eventType: 'm.reaction',
        parentEventId: '$target',
        relationType: 'm.annotation',
      },
    ]);
  });
});
