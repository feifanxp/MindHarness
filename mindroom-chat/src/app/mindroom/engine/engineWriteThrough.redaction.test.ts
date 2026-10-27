/**
 * CINNY-207 P3 gate fix (round 2): cache-derived redaction thread
 * attribution — the guaranteed layer.
 *
 * The docker gate on the P3.3 tip caught this: after the strip, the
 * engine no longer had a viewer's "open thread" hint. The first fix
 * attempt (SDK thread-set derivation inside planRedactionCacheCleanup)
 * modelled the wrong reality — by the time `RoomEvent.Redaction` fires,
 * matrix-js-sdk has already called `moveAllRelatedToMainTimeline` on
 * the target, which removes it from the thread's timelineSet AND clears
 * its `thread` reference. So `thread.getUnfilteredTimelineSet()
 * .findEventById($reaction)` returns undefined at fire time — the scan
 * never matches.
 *
 * The reliable attribution for a redacted THREAD REACTION lives in the
 * unified cache: the reaction record was written under scope=threadId.
 * `deleteThreadEventFromCacheByEventId` walks every thread-scoped
 * record and deletes matches — it already knows the scope(s) it hit.
 * We surface that as its return value: `string[]` (thread scopes it
 * deleted from, usually exactly one). The engine handler then persists
 * the redaction record to each returned scope. This is self-consistent
 * by construction — the tombstone lands precisely where the reaction
 * record existed.
 *
 * Layer 2 (secondary hint, kept because it's free): matrix-js-sdk emits
 * `RoomEvent.Redaction` with a third `threadId?: string` arg captured
 * BEFORE `makeRedacted` prunes the target. mindroomSyncEngine plumbs
 * that arg into the plan as `sdkThreadIdHint`. This covers redacted
 * thread MESSAGES too (they don't hit layer 1 because there is no
 * reaction record to delete; the tombstone still needs a scope).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room, Thread } from 'matrix-js-sdk';

const persistThreadEventCacheSnapshot = vi.fn();
const persistRoomEventCacheSnapshot = vi.fn();
const deleteRoomEventsFromCache = vi.fn().mockResolvedValue(undefined);
const deleteThreadEventsFromCache = vi.fn().mockResolvedValue(undefined);
// Default: return no scopes (nothing in cache). Individual tests override.
const deleteThreadEventFromCacheByEventId = vi.fn().mockResolvedValue([] as string[]);

vi.mock('../threads/eventRepository', () => ({
  persistThreadEventCacheSnapshot: (...args: unknown[]) =>
    persistThreadEventCacheSnapshot(...args),
  persistRoomEventCacheSnapshot: (...args: unknown[]) => persistRoomEventCacheSnapshot(...args),
  deleteRoomEventsFromCache: (...args: unknown[]) => deleteRoomEventsFromCache(...args),
  deleteThreadEventsFromCache: (...args: unknown[]) => deleteThreadEventsFromCache(...args),
  deleteThreadEventFromCacheByEventId: (...args: unknown[]) =>
    deleteThreadEventFromCacheByEventId(...args),
  // The pruned redacted target has neither m.relates_to nor threadRootId
  // by the time we see the redaction, so the plan's hint chain returns
  // undefined. Mock returns undefined for every input.
  getThreadCacheTargetId: () => undefined,
}));

import { createEngineWriteThrough } from './engineWriteThrough';
import type { EngineLiveEventMeta } from './types';

type FakeEvent = {
  __id: string;
  getId: () => string;
  getType: () => string;
  getRelation: () => undefined;
  getSender: () => string;
  getTs: () => number;
  getAssociatedId: () => string | undefined;
  isRedaction: () => boolean;
  threadRootId?: string;
  isThreadRoot: boolean;
};

const makeEvent = (
  id: string,
  {
    type = 'm.room.message',
    associatedId,
    threadRootId,
    isRedaction = false,
    sender = '@alice:example.org',
  }: {
    type?: string;
    associatedId?: string;
    threadRootId?: string;
    isRedaction?: boolean;
    sender?: string;
  } = {}
): FakeEvent => ({
  __id: id,
  getId: () => id,
  getType: () => type,
  getRelation: () => undefined,
  getSender: () => sender,
  getTs: () => 0,
  getAssociatedId: () => associatedId,
  isRedaction: () => isRedaction,
  threadRootId,
  isThreadRoot: false,
});

/**
 * Fake thread. Reality at RoomEvent.Redaction fire time: the SDK has
 * already called moveAllRelatedToMainTimeline on the reaction, which
 * removes it from this thread's timelineSet — so the reaction is NOT
 * in `timelineEvents` here. Tests deliberately omit it to model
 * production behavior.
 */
const makeThread = (rootId: string, timelineEvents: FakeEvent[]): Thread =>
  ({
    id: rootId,
    getUnfilteredTimelineSet: () => ({
      findEventById: (eventId: string) =>
        timelineEvents.find((mEvent) => mEvent.getId() === eventId) as
          | MatrixEvent
          | undefined,
      getLiveTimeline: () => ({
        getEvents: () => timelineEvents as unknown as MatrixEvent[],
      }),
      relations: {
        getChildEventsForEvent: () => undefined,
      },
    }),
  } as unknown as Thread);

const makeRoom = ({
  events,
  threads = [],
}: {
  events: Record<string, FakeEvent>;
  threads?: Thread[];
}): Room =>
  ({
    roomId: '!room:example.org',
    findEventById: (id: string) => events[id] as unknown as MatrixEvent | undefined,
    getThread: (id: string) => threads.find((t) => (t as unknown as { id: string }).id === id),
    getThreads: () => threads,
    getLiveTimeline: () => ({ getEvents: () => [] }) as never,
    getUnfilteredTimelineSet: () =>
      ({
        relations: {
          getChildEventsForEvent: () => undefined,
        },
      } as never),
  } as unknown as Room);

const redactionMeta = (
  sdkThreadId?: string
): EngineLiveEventMeta => ({
  kind: 'redaction',
  roomId: '!room:example.org',
  liveEvent: true,
  toStartOfTimeline: false,
  sdkThreadId,
});

/**
 * Let queued microtasks (the layer-1 `.then(...)` chain hanging off the
 * cache-derived delete) run before assertions. Kept as a helper so the
 * lint rule against reading promise-executor return values doesn't flag
 * every await.
 */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('engineWriteThrough redaction thread attribution (CINNY-207 P3 gate re-fix)', () => {
  beforeEach(() => {
    persistThreadEventCacheSnapshot.mockReset();
    persistRoomEventCacheSnapshot.mockReset();
    deleteRoomEventsFromCache.mockReset().mockResolvedValue(undefined);
    deleteThreadEventsFromCache.mockReset().mockResolvedValue(undefined);
    deleteThreadEventFromCacheByEventId.mockReset().mockResolvedValue([] as string[]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persists the redaction to the thread scope returned by the by-event-id delete (stop-emoji, cache-derived)', async () => {
    // Reality at fire time: the reaction has been moved out of the
    // thread's timelineSet by moveAllRelatedToMainTimeline. No pre-prune
    // threadId hint from the SDK either (simulating a bridged event or
    // any code path where the third-arg hint is absent). All the plan's
    // event-side hints return undefined. The GUARANTEED signal is the
    // reaction record already sitting in the cache under scope=$thread-root.
    const prunedReaction = makeEvent('$reaction', { type: 'm.reaction' });
    // Empty thread timelineSet — reaction was already moved to main.
    const thread = makeThread('$thread-root', []);
    const redaction = makeEvent('$redaction', {
      type: 'm.room.redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });
    const room = makeRoom({
      events: { $reaction: prunedReaction, $redaction: redaction },
      threads: [thread],
    });
    // Cache holds the reaction under this thread scope; the delete
    // walker returns that scope.
    deleteThreadEventFromCacheByEventId.mockResolvedValueOnce(['$thread-root']);
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(redaction as unknown as MatrixEvent, room, redactionMeta());
    // Engine dispatch schedules the persist after the delete resolves.
    // Give microtasks a chance to run.
    await flushMicrotasks();

    // The redaction record lands on the thread scope the cache walker
    // reported — self-consistent by construction.
    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].threadId).toBe('$thread-root');
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([redaction]);
    // No belt-and-braces room persist — the derived scope is authoritative.
    expect(persistRoomEventCacheSnapshot).not.toHaveBeenCalled();
    // We routed through the by-event-id walker (that's how we learned
    // the scope), not the keyed thread delete.
    expect(deleteThreadEventFromCacheByEventId).toHaveBeenCalledTimes(1);
    expect(deleteThreadEventFromCacheByEventId.mock.calls[0][2]).toBe('$reaction');
    expect(deleteThreadEventsFromCache).not.toHaveBeenCalled();
    // Room-scoped reaction record (if any) still cleared.
    expect(deleteRoomEventsFromCache).toHaveBeenCalledTimes(1);
  });

  it('honors the SDK pre-prune threadId hint from the RoomEvent.Redaction emission (thread MESSAGE redaction)', async () => {
    // A thread MESSAGE is redacted. deleteRecords=false (we keep the
    // tombstone), so layer 1 (cache-derived from the delete walker) does
    // not fire. Layer 2 — the pre-prune sdkThreadId — is what gets the
    // redaction tombstone into the correct thread scope.
    const message = makeEvent('$msg', { type: 'm.room.message' });
    const thread = makeThread('$thread-root', []);
    const redaction = makeEvent('$redaction', {
      type: 'm.room.redaction',
      isRedaction: true,
      associatedId: '$msg',
    });
    const room = makeRoom({
      events: { $msg: message, $redaction: redaction },
      threads: [thread],
    });
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(
      redaction as unknown as MatrixEvent,
      room,
      redactionMeta('$thread-root')
    );
    await flushMicrotasks();

    // Tombstone persists to the pre-prune thread scope.
    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].threadId).toBe('$thread-root');
    expect(persistRoomEventCacheSnapshot).not.toHaveBeenCalled();
    // No deletion (message target, not reaction).
    expect(deleteThreadEventFromCacheByEventId).not.toHaveBeenCalled();
    expect(deleteThreadEventsFromCache).not.toHaveBeenCalled();
    expect(deleteRoomEventsFromCache).not.toHaveBeenCalled();
  });

  it('falls back to room-scope persist when the cache walker returns no scopes and there is no SDK hint (genuine room-level redaction)', async () => {
    const prunedTarget = makeEvent('$msg', { type: 'm.room.message' });
    const redaction = makeEvent('$redaction', {
      type: 'm.room.redaction',
      isRedaction: true,
      associatedId: '$msg',
    });
    const room = makeRoom({
      events: { $msg: prunedTarget, $redaction: redaction },
      threads: [],
    });
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(redaction as unknown as MatrixEvent, room, redactionMeta());
    await flushMicrotasks();

    // Target is a message (deleteRecords=false), no thread attribution,
    // no SDK hint → tombstone persists to room scope only.
    expect(deleteThreadEventsFromCache).not.toHaveBeenCalled();
    expect(deleteThreadEventFromCacheByEventId).not.toHaveBeenCalled();
    expect(deleteRoomEventsFromCache).not.toHaveBeenCalled();
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();
    expect(persistRoomEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistRoomEventCacheSnapshot.mock.calls[0][0].events).toEqual([redaction]);
  });

  it('persists the redaction to every scope the cache walker returns (ambiguous cross-thread reaction)', async () => {
    // Defensive: a stale reaction record may have been written under
    // more than one thread scope through legacy migrations. Persist the
    // tombstone to each returned scope so hydration of either thread
    // sees the redaction.
    const prunedReaction = makeEvent('$reaction', { type: 'm.reaction' });
    const redaction = makeEvent('$redaction', {
      type: 'm.room.redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });
    const room = makeRoom({
      events: { $reaction: prunedReaction, $redaction: redaction },
      threads: [],
    });
    deleteThreadEventFromCacheByEventId.mockResolvedValueOnce([
      '$thread-a',
      '$thread-b',
    ]);
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(redaction as unknown as MatrixEvent, room, redactionMeta());
    await flushMicrotasks();

    expect(deleteThreadEventFromCacheByEventId).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(2);
    const persistedScopes = persistThreadEventCacheSnapshot.mock.calls
      .map((call) => call[0].threadId as string)
      .sort();
    expect(persistedScopes).toEqual(['$thread-a', '$thread-b']);
    // Ambiguous cache attribution → no room persist (the reaction was
    // clearly a thread record).
    expect(persistRoomEventCacheSnapshot).not.toHaveBeenCalled();
    expect(deleteRoomEventsFromCache).toHaveBeenCalledTimes(1);
  });

  it('persists the redaction to the plan-derived thread scope when hints resolve directly (no walker needed)', async () => {
    // When the plan already has an authoritative attribution (e.g. the
    // sdkThreadId hint), we use the keyed thread delete (not the walker)
    // and persist the tombstone to that scope. This is the happy path.
    const prunedReaction = makeEvent('$reaction', { type: 'm.reaction' });
    const redaction = makeEvent('$redaction', {
      type: 'm.room.redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });
    const room = makeRoom({
      events: { $reaction: prunedReaction, $redaction: redaction },
      threads: [],
    });
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(
      redaction as unknown as MatrixEvent,
      room,
      redactionMeta('$thread-root')
    );
    await flushMicrotasks();

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].threadId).toBe('$thread-root');
    expect(persistRoomEventCacheSnapshot).not.toHaveBeenCalled();
    expect(deleteThreadEventsFromCache).toHaveBeenCalledTimes(1);
    expect(deleteThreadEventsFromCache.mock.calls[0][2]).toBe('$thread-root');
    expect(deleteThreadEventsFromCache.mock.calls[0][3]).toEqual(['$reaction']);
    expect(deleteThreadEventFromCacheByEventId).not.toHaveBeenCalled();
    expect(deleteRoomEventsFromCache).toHaveBeenCalledTimes(1);
  });
});
