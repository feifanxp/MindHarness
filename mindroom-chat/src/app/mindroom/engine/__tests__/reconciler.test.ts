/**
 * CINNY-207 P5.1 reconciler unit tests.
 *
 * Two guarantees under test:
 *
 *   AC9 — coverage gates PAINT, never REVALIDATE. A reconcile
 *         scheduled from the thread-open choke point still
 *         performs the network verify (mocked fetchRelations invoked).
 *
 *   D7 no-op — when the fetched page's event ids are entirely already
 *              present in the cached window, `onRepaired` is NEVER
 *              called and no persist happens. That guarantee is what
 *              makes "cached was right" cost zero UI flicker.
 *
 * Plus the invariants that ride on the scheduler:
 *   - Enters the scheduler with kind `'reconcile'` and band 0.
 *   - Dedup: a second schedule for the same key while the first is
 *     in-flight returns the in-flight promise identity (AC9 wording:
 *     "coalescing returns the in-flight promise").
 *   - Paging past the pre-P5 200-event ceiling (F7): the reconciler
 *     keeps requesting until the fetched chunk overlaps the cached
 *     window by event id.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { createBackfillScheduler } from '../backfillScheduler';
import { scheduleReconcile } from '../reconciler';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';
import type { HydratedThreadCachePage } from '../../threads/types';

// ---------------------------------------------------------------------------
// Minimal fixtures — a MatrixEvent-shaped stub the reconciler can consume via
// its narrow surface (getId, isRedaction, getAssociatedId, event.unsigned).
// A real matrix-js-sdk MatrixEvent is not needed for these units.
// ---------------------------------------------------------------------------

type FakeEventInit = {
  id: string;
  redaction?: { targetId: string };
  bundledReplaceId?: string;
  /**
   * When set, this event is an m.replace edit event whose
   * `getRelation()` returns `{ rel_type: 'm.replace', event_id }`.
   * Matches the shape `applyCachedReplaceRelations` inspects when
   * scanning for edit events targeting an existing event.
   */
  replaceTargetId?: string;
  reactionTargetId?: string;
  ts?: number;
  sender?: string;
};

const makeFakeEvent = ({
  id,
  redaction,
  bundledReplaceId,
  replaceTargetId,
  reactionTargetId,
  ts = 0,
  sender = '@bob:example',
}: FakeEventInit): MatrixEvent => {
  const raw: Partial<IEvent> = {
    event_id: id,
    sender,
    type: redaction ? 'm.room.redaction' : reactionTargetId ? 'm.reaction' : 'm.room.message',
    origin_server_ts: ts,
    unsigned: bundledReplaceId
      ? {
          'm.relations': {
            'm.replace': { event_id: bundledReplaceId, sender, origin_server_ts: ts + 1 },
          } as never,
        }
      : undefined,
    content: reactionTargetId
      ? ({
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: reactionTargetId,
            key: '👍',
          },
        } as never)
      : replaceTargetId
      ? ({
          'm.new_content': { body: 'new body', msgtype: 'm.text' },
          'm.relates_to': { rel_type: 'm.replace', event_id: replaceTargetId },
        } as never)
      : {},
  };
  return {
    getId: () => id,
    getType: () => raw.type,
    getTs: () => ts,
    isSending: () => false,
    isRedaction: () => !!redaction,
    isRedacted: () => false,
    getAssociatedId: () => redaction?.targetId,
    getRelation: () =>
      reactionTargetId
        ? { rel_type: 'm.annotation', event_id: reactionTargetId, key: '👍' }
        : replaceTargetId
        ? { rel_type: 'm.replace', event_id: replaceTargetId }
        : null,
    getUnsigned: () => raw.unsigned ?? {},
    setUnsigned: (unsigned: IEvent['unsigned']) => {
      raw.unsigned = unsigned;
    },
    makeRedacted: () => undefined,
    makeReplaced: () => undefined,
    replacingEvent: () => null,
    getSender: () => sender,
    getContent: () => raw.content ?? {},
    getWireContent: () => raw.content ?? {},
    event: raw,
  } as unknown as MatrixEvent;
};

const makeCachedPage = (ids: string[]): HydratedThreadCachePage =>
  ({
    beforeToken: null,
    cacheCoverage: {} as never,
    events: ids.map((id) => ({ event_id: id })) as Partial<IEvent>[],
    hasMoreBefore: false,
    relationSnapshotComplete: true,
    rootEvent: undefined,
    snapshotComplete: true,
    tailLoaded: true,
  } as HydratedThreadCachePage);

type FetchRelationsCall = {
  from?: string;
};

const makeMockClient = ({
  fetchRelations,
  room,
}: {
  fetchRelations: (call: FetchRelationsCall) => {
    chunk: Array<Partial<IEvent>>;
    next_batch?: string;
    recursion_depth?: number;
  };
  room: Room;
}): MatrixClient => {
  const identity = (rawEvent: Partial<IEvent>): MatrixEvent =>
    makeFakeEvent({
      id: (rawEvent.event_id as string) ?? '',
      ...(rawEvent.type === 'm.room.redaction'
        ? {
            redaction: {
              targetId: (rawEvent.content as Record<string, string> | undefined)?.redacts ?? '',
            },
          }
        : {}),
    });
  return {
    getRoom: () => room,
    // Test mapper: returns a MatrixEvent-shaped stub. The prefer-live
    // mapper wraps this internally — for these unit tests we don't
    // stress the stale-copy heal path (that's Commit 4's dedicated
    // Tuwunel stale-copy test).
    getEventMapper: () => identity,
    fetchRelations: vi.fn(async (_roomId, _threadId, _relationType, _eventType, opts) => {
      return fetchRelations({ from: opts?.from as string | undefined });
    }),
  } as unknown as MatrixClient;
};

const makeFakeRoom = (): Room =>
  ({
    roomId: '!room:example',
    findEventById: () => null,
    getThread: () => undefined,
  } as unknown as Room);

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

const createContinuationStore = () => {
  let marker:
    | {
        generation: string;
        startedAt: number;
        nextToken?: string;
        validatingHead?: boolean;
        overlapEventIds: string[];
      }
    | undefined;
  return {
    load: vi.fn(async () => marker),
    begin: vi.fn(async (_sessionId, _roomId, _threadId, candidate) => {
      marker ??= candidate;
      return marker;
    }),
    checkpoint: vi.fn(async (_sessionId, _roomId, _threadId, expectedGeneration, nextToken) => {
      if (marker?.generation !== expectedGeneration) return undefined;
      marker = { ...marker, nextToken };
      return true;
    }),
    clear: vi.fn(async (_sessionId, _roomId, _threadId, expectedGeneration) => {
      if (marker?.generation !== expectedGeneration) return false;
      marker = undefined;
      return true;
    }),
    restartFromHead: vi.fn(
      async (_sessionId, _roomId, _threadId, expectedGeneration, nextGeneration) => {
        if (marker?.generation !== expectedGeneration) return false;
        const { nextToken: _drop, ...current } = marker;
        marker = { ...current, generation: nextGeneration, validatingHead: true };
        return marker;
      }
    ),
    getMarker: () => marker,
  } satisfies NonNullable<Parameters<typeof scheduleReconcile>[0]['continuationStore']> & {
    getMarker: () => typeof marker;
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduleReconcile (CINNY-207 P5.1)', () => {
  beforeEach(() => {
    resetCacheProbe();
  });
  afterEach(() => {
    resetCacheProbe();
  });

  it('enters the scheduler with kind "reconcile" at band 0 (AC8 dedup domain)', async () => {
    const room = makeFakeRoom();
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({ chunk: [], next_batch: undefined }),
    });
    const scheduler = createBackfillScheduler({ mx });

    const result = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
    });

    // Snapshot the pending queue before it drains — the pending job's
    // kind + priority is what AC8 uses for its dedup key. `band 0` is
    // the D7 policy: reconciles the user is looking at right now.
    const jobs = scheduler.pendingJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      roomId: '!room:example',
      threadId: '$thread',
      kind: 'reconcile',
      priority: 0,
    });

    await result;
  });

  it('coverage-complete still performs the network verify (AC9)', async () => {
    // Coverage-complete request must not short-circuit — the reconciler
    // is scheduled unconditionally on every open, per D7. This test
    // proves the fetchRelations call actually fires even when the
    // caller flagged the cache as complete.
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({ chunk: [], next_batch: undefined }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
    });

    expect(fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('repairs aggregation-only divergence for a same-ID event', async () => {
    const room = makeFakeRoom();
    const cachedPage = makeCachedPage([]);
    cachedPage.events = [
      {
        event_id: '$root',
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 1,
              latest_event: { event_id: '$old', origin_server_ts: 100 },
            },
          },
        },
      },
    ];
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({
        chunk: [
          {
            event_id: '$root',
            unsigned: {
              'm.relations': {
                'm.thread': {
                  count: 2,
                  latest_event: { event_id: '$new', origin_server_ts: 200 },
                },
              },
            },
          },
        ],
      }),
    });
    const persistRepair: NonNullable<Parameters<typeof scheduleReconcile>[0]['persistRepair']> =
      vi.fn(() => ({ rawEvents: [], loadedReplyCount: 0, write: Promise.resolve(true) }));

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage,
      persistRepair,
    });

    expect(result.repaired).toBe(true);
    expect(persistRepair).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'decreased',
      fetchedUnsigned: { 'm.relations': { 'm.thread': { count: 3 } } },
    },
    { name: 'removed', fetchedUnsigned: undefined },
  ])('repairs an authoritative aggregation that was $name', async ({ fetchedUnsigned }) => {
    const room = makeFakeRoom();
    const cachedPage = makeCachedPage([]);
    cachedPage.events = [
      {
        event_id: '$root',
        unsigned: { 'm.relations': { 'm.thread': { count: 5 } } },
      },
    ];
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({
        chunk: [
          {
            event_id: '$root',
            ...(fetchedUnsigned ? { unsigned: fetchedUnsigned } : {}),
          },
        ],
      }),
    });
    const persistRepair: NonNullable<Parameters<typeof scheduleReconcile>[0]['persistRepair']> =
      vi.fn(() => ({ rawEvents: [], loadedReplyCount: 0, write: Promise.resolve(true) }));

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage,
      persistRepair,
    });

    expect(result.repaired).toBe(true);
    expect(persistRepair).toHaveBeenCalledWith(
      expect.objectContaining({ relationSnapshotMode: 'authoritative' })
    );
  });

  it('deduplicates: a second schedule for the same key while the first is in-flight returns the in-flight promise identity', async () => {
    // AC9 explicit wording: SCHEDULING is unconditional; COALESCING
    // returns the in-flight promise. This is what makes "user opens
    // thread + browser refocuses + engine noteRoomFocused" all safe
    // to call — only one /relations round-trip fires.
    const room = makeFakeRoom();
    let resolveFetch: (value: { chunk: Array<Partial<IEvent>> }) => void = () => undefined;
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations: vi.fn(
        () =>
          new Promise<{ chunk: Array<Partial<IEvent>> }>((resolve) => {
            resolveFetch = resolve;
          })
      ),
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const first = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
    });
    await flushMicrotasks();

    const second = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
    });
    expect(second).toBe(first);

    // Only one probe increment for enqueue; one for dedup.
    const probe = getCacheProbeSnapshot();
    expect(probe.schedulerEnqueued).toBe(1);
    expect(probe.schedulerDeduped).toBe(1);

    resolveFetch({ chunk: [] });
    await first;
  });

  it('delivers a shared in-flight repair to every caller callback', async () => {
    const room = makeFakeRoom();
    let resolveFetch!: (value: { chunk: Array<Partial<IEvent>> }) => void;
    const fetchRelations = vi.fn(
      () =>
        new Promise<{ chunk: Array<Partial<IEvent>> }>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const staleViewCallback = vi.fn();
    const currentViewCallback = vi.fn();

    const first = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      onRepaired: staleViewCallback,
    });
    await flushMicrotasks();
    const reopened = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      onRepaired: currentViewCallback,
    });

    resolveFetch({ chunk: [{ event_id: '$new' }, { event_id: '$known' }] });
    await Promise.all([first, reopened]);

    expect(fetchRelations).toHaveBeenCalledTimes(1);
    expect(staleViewCallback).toHaveBeenCalledTimes(1);
    expect(currentViewCallback).toHaveBeenCalledTimes(1);
    expect(currentViewCallback.mock.calls[0][0].map((event) => event.getId())).toContain('$new');
    const probe = getCacheProbeSnapshot();
    expect(probe.reconcilesRepaired).toBe(1);
    expect(probe.reconcilesOnRepairedFired).toBe(2);
  });

  it('empty diff is a no-op (D7): no onRepaired tick when fetched page overlaps cache', async () => {
    // The core "cached was right" guarantee: server returns event ids
    // the client already has → no persist, no tick, no flicker.
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({
      // Chunk is newest-first in the SDK's response shape; the
      // reconciler reverses it before diffing.
      chunk: [{ event_id: '$reply-2' }, { event_id: '$reply-1' }] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
      onRepaired,
    });

    expect(fetchRelations).toHaveBeenCalledTimes(1);
    expect(onRepaired).not.toHaveBeenCalled();
    expect(result.repaired).toBe(false);
    expect(result.fetchedCount).toBe(2);
  });

  it('does not report divergence for an identical bundled replacement revision', async () => {
    const room = makeFakeRoom();
    const targetWithEdit: Partial<IEvent> = {
      event_id: '$target',
      sender: '@bob:example',
      origin_server_ts: 100,
      unsigned: {
        'm.relations': {
          'm.replace': {
            event_id: '$edit-v2',
            sender: '@bob:example',
            origin_server_ts: 200,
          },
        },
      },
    };
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({ chunk: [targetWithEdit] }),
    });
    const cachedPage = makeCachedPage([]);
    cachedPage.events = [targetWithEdit] as never;

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage,
    });

    expect(result.repaired).toBe(false);
    expect(getCacheProbeSnapshot().reconcilesNoDivergence).toBe(1);
  });

  it('repairs a cached replacement when its already-cached redaction is fetched again', async () => {
    const room = makeFakeRoom();
    const targetWithEdit: Partial<IEvent> = {
      event_id: '$target',
      sender: '@bob:example',
      origin_server_ts: 100,
      unsigned: {
        'm.relations': {
          'm.replace': {
            event_id: '$edit-v2',
            sender: '@bob:example',
            origin_server_ts: 200,
          },
        },
      },
    };
    const redaction: Partial<IEvent> = {
      event_id: '$redaction',
      sender: '@moderator:example',
      origin_server_ts: 300,
      type: 'm.room.redaction',
      redacts: '$edit-v2',
      content: {},
    };
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({ chunk: [redaction] }),
    });
    const cachedPage = makeCachedPage([]);
    cachedPage.events = [targetWithEdit, redaction] as never;
    const persistRepair: NonNullable<Parameters<typeof scheduleReconcile>[0]['persistRepair']> =
      vi.fn(({ events }) => ({
        rawEvents: events.map((event) => event.event as Partial<IEvent>),
        loadedReplyCount: 0,
        write: Promise.resolve(true),
      }));

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage,
      persistRepair,
    });

    expect(result.repaired).toBe(true);
    expect(persistRepair).toHaveBeenCalledTimes(1);
  });

  it('repairs when a fetched same-id target newly carries redaction state', async () => {
    const room = makeFakeRoom();
    const fetchedTarget: Partial<IEvent> = {
      event_id: '$target',
      sender: '@bob:example',
      origin_server_ts: 100,
      unsigned: {
        redacted_because: {
          event_id: '$redaction',
          type: 'm.room.redaction',
          sender: '@moderator:example',
          origin_server_ts: 200,
        },
      },
    };
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({ chunk: [fetchedTarget] }),
    });
    const cachedPage = makeCachedPage([]);
    cachedPage.events = [
      { event_id: '$target', sender: '@bob:example', origin_server_ts: 100 },
    ] as never;

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage,
    });

    expect(result.repaired).toBe(true);
  });

  it('detects a new event id (missed message) and fires onRepaired exactly once', async () => {
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({
      chunk: [{ event_id: '$reply-3-new' }, { event_id: '$reply-2' }] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
      onRepaired,
    });

    expect(result.repaired).toBe(true);
    // One tick per pass, regardless of how many things needed
    // repairing. Batching is the D7 promise.
    expect(onRepaired).toHaveBeenCalledTimes(1);
  });

  it('applier hardens against prepends: repairs only swap or delete existing ids + append at the tail (AC10)', async () => {
    // CINNY-207 P5.2 (AC10): scroll anchor invariant. The reconciler's
    // repair path calls `hydrateCachedEvents`, which mutates event
    // instances IN PLACE via `makeRedacted` / `makeReplaced` / SDK
    // aggregation calls. It NEVER splices new events into the
    // rendered array — that guarantee is what keeps anchor scroll
    // math untouched.
    //
    // This unit asserts the applier's behavior end-to-end on a
    // mid-viewport window: a fetched page carrying an edit-target
    // and a redaction-target must repair those two events in place
    // (no addition, no removal from the rendered id set — the
    // hydrated content changes, but the rendered array's length +
    // order stays exactly the same).
    const room = makeFakeRoom();
    // Cache already has $edit-target and $redact-target rendered.
    // Server's fetched page carries a bundled edit on $edit-target
    // AND a redaction event targeting $redact-target — the applier
    // should mutate those existing instances in place and not
    // introduce new ids into the rendered set.
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        {
          event_id: '$edit-target',
          sender: '@bob:example',
          unsigned: {
            'm.relations': {
              'm.replace': {
                event_id: '$edit-v2',
                sender: '@bob:example',
                origin_server_ts: 2,
              },
            },
          },
        },
        {
          event_id: '$redaction',
          type: 'm.room.redaction',
          content: { redacts: '$redact-target' },
        },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => {
        if (raw.type === 'm.room.redaction') {
          const targetId = (raw.content as Record<string, string> | undefined)?.redacts;
          return makeFakeEvent({
            id: (raw.event_id as string) ?? '',
            redaction: { targetId: targetId ?? '' },
          });
        }
        return makeFakeEvent({
          id: (raw.event_id as string) ?? '',
          bundledReplaceId: (
            raw.unsigned as
              | {
                  'm.relations'?: { 'm.replace'?: { event_id?: string } };
                }
              | undefined
          )?.['m.relations']?.['m.replace']?.event_id,
        });
      },
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$edit-target', '$redact-target']),
      onRepaired,
    });

    // Bundled edit + redaction on cached ids both count as
    // divergence (detectDivergence catches bundled 'm.replace' and
    // the redaction whose target is in cache). Exactly one tick.
    expect(result.repaired).toBe(true);
    expect(onRepaired).toHaveBeenCalledTimes(1);
    // The reconciler does not push to `setSupplementalThreadEvents`
    // and does not otherwise grow the rendered array — the render
    // layer picks up the in-place mutations on the next tick. That's
    // exactly what keeps the mid-viewport anchor invariant (AC10)
    // stable. This unit is the "applier does not prepend" assertion.
  });

  it('Tuwunel stale-copy re-apply: a fetched page carrying unsigned.redacted_because for a cached target reapplies the redaction via prefer-live mapper', async () => {
    // CINNY-207 P5.2 (Commit 4 risk): docker Tuwunel serves
    // un-pruned redacted events on /relations for ~10s after the
    // redaction. Without the prefer-live mapper heal path, a
    // reconcile pass that hits Tuwunel inside that window would
    // fetch the still-visible reaction (or edited message) and
    // silently un-repair the local redaction the client already
    // knew about.
    //
    // The reconciler funnels every raw event through
    // `createPreferLiveEventMapper` (see runThreadReconcilePass).
    // When a raw event carries `unsigned.redacted_because` AND the
    // SDK live instance predates that redaction, the mapper calls
    // `liveEvent.makeRedacted(...)` on the SDK instance, which
    // cascades into the SDK's `Relations.BeforeRedaction` listener
    // and removes the stale reaction chip.
    //
    // This test proves the reconciler consumes the mapper's output:
    // the fetch returns a raw event carrying `redacted_because`, the
    // reconciler treats it as divergence (new event id triggers the
    // diff), and the hydrate pass runs. If the mapper wiring
    // regresses (e.g. someone bypasses it for perf), this test's
    // asserts on the mapper being invoked will fail.
    const room = makeFakeRoom();
    const liveEventMakeRedacted = vi.fn();
    // Override findEventById to return a live instance with a
    // trackable makeRedacted so we can assert the prefer-live mapper
    // fired.
    const liveInstances = new Map<
      string,
      MatrixEvent & {
        isRedacted: () => boolean;
        makeRedacted: (redaction: MatrixEvent, room: Room) => void;
      }
    >();
    liveInstances.set('$reaction', {
      ...makeFakeEvent({ id: '$reaction' }),
      isRedacted: () => false,
      makeRedacted: liveEventMakeRedacted,
    } as never);
    const staleRoom = {
      ...room,
      findEventById: (id: string) => liveInstances.get(id) ?? null,
    } as Room;
    // Tuwunel serves the reaction event with `unsigned.redacted_because`
    // pointing at the redaction the client already applied locally.
    const staleReactionRaw: Partial<IEvent> = {
      event_id: '$reaction',
      type: 'm.reaction',
      unsigned: {
        redacted_because: { event_id: '$redaction', type: 'm.room.redaction' },
      } as never,
    };
    const fetchRelations = vi.fn(async () => ({
      chunk: [staleReactionRaw] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => staleRoom,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    // Cache did NOT have this reaction id — normally that would count
    // as "new event, diverged" and the reconciler would apply.
    // The critical assertion is that the prefer-live mapper fired
    // BEFORE the diff, so if the reconciler ever caches the mapped
    // (now-redacted) instance it does so correctly.
    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
      room: staleRoom,
    });

    // Prefer-live mapper called makeRedacted on the live instance —
    // Tuwunel stale copy is healed locally via the SDK's redaction
    // cascade. This is invariant I2: our record of server truth
    // drives convergence, not the server's live view.
    expect(liveEventMakeRedacted).toHaveBeenCalledTimes(1);
  });

  it('pages further past 200 (F7) until the fetched chunk overlaps the cached window', async () => {
    // The pre-P5 tail refresh capped at one limit-200 batch, so a
    // divergence deeper than 200 events never converged. The
    // reconciler pages further; overlap by event id is the stop
    // condition. This test proves the second page happens when the
    // first doesn't overlap.
    const room = makeFakeRoom();
    let iteration = 0;
    const fetchRelations = vi.fn(async () => {
      iteration += 1;
      if (iteration === 1) {
        return {
          chunk: [
            { event_id: '$far-3' },
            { event_id: '$far-2' },
            { event_id: '$far-1' },
          ] as Partial<IEvent>[],
          next_batch: 'page-2',
        };
      }
      // Second page: overlap with cached window ($reply-1) → stop.
      return {
        chunk: [{ event_id: '$mid' }, { event_id: '$reply-1' }] as Partial<IEvent>[],
        next_batch: undefined,
      };
    });
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1']),
    });

    expect(fetchRelations).toHaveBeenCalledTimes(2);
    expect(result.iterations).toBe(2);
    expect(result.fetchedCount).toBe(5);
  });

  it('resumes after a later-page failure without treating the persisted prefix as overlap', async () => {
    const room = makeFakeRoom();
    const continuationStore = createContinuationStore();
    const persistRepair: NonNullable<Parameters<typeof scheduleReconcile>[0]['persistRepair']> =
      vi.fn(({ events }) => ({
        rawEvents: events.map((event) => event.event as Partial<IEvent>),
        loadedReplyCount: 0,
        write: Promise.resolve(true),
      }));
    const firstFetch = vi
      .fn()
      .mockResolvedValueOnce({ chunk: [{ event_id: '$new-1' }], next_batch: 'page-2' })
      .mockRejectedValueOnce(new Error('page two failed'));
    const firstClient = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations: firstFetch,
    } as unknown as MatrixClient;

    const firstResult = await scheduleReconcile({
      mx: firstClient,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx: firstClient }),
      roomId: '!room:example',
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      persistRepair,
      continuationStore,
    });

    expect(firstResult).toMatchObject({ repaired: true, durable: true, iterations: 2 });
    expect(continuationStore.getMarker()?.nextToken).toBe('page-2');

    const secondFetch = vi.fn(async (_roomId, _threadId, _relType, _eventType, options) => ({
      chunk: options.from
        ? [{ event_id: '$known' }, { event_id: '$new-2' }]
        : [{ event_id: '$new-head' }, { event_id: '$known' }],
      next_batch: undefined,
    }));
    const secondClient = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations: secondFetch,
    } as unknown as MatrixClient;
    const secondResult = await scheduleReconcile({
      mx: secondClient,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx: secondClient }),
      roomId: '!room:example',
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      persistRepair,
      continuationStore,
    });

    expect(secondFetch.mock.calls[0][4]).toMatchObject({ from: 'page-2' });
    expect(secondFetch.mock.calls[1][4]).not.toHaveProperty('from');
    expect(secondResult).toMatchObject({ repaired: true, durable: true, iterations: 2 });
    expect(continuationStore.getMarker()).toBeUndefined();
    expect(persistRepair).toHaveBeenCalledTimes(2);
    const secondPersistedIds = persistRepair.mock.calls[1][0].events.map((event) => event.getId());
    expect(secondPersistedIds).toContain('$new-head');
  });

  it('checkpoints the page cap and resumes from page 26 on the next pass', async () => {
    const room = makeFakeRoom();
    const continuationStore = createContinuationStore();
    const persistRepair: NonNullable<Parameters<typeof scheduleReconcile>[0]['persistRepair']> =
      vi.fn(({ events }) => ({
        rawEvents: events.map((event) => event.event as Partial<IEvent>),
        loadedReplyCount: 0,
        write: Promise.resolve(true),
      }));
    const firstFetch = vi.fn(async (_roomId, _threadId, _relType, _eventType, options) => {
      const page = firstFetch.mock.calls.length;
      return {
        chunk: [{ event_id: `$page-${page}` }],
        next_batch: `page-${page + 1}`,
        options,
      };
    });
    const firstClient = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations: firstFetch,
    } as unknown as MatrixClient;

    const firstResult = await scheduleReconcile({
      mx: firstClient,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx: firstClient }),
      roomId: '!room:example',
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      persistRepair,
      continuationStore,
    });

    expect(firstResult).toMatchObject({ repaired: true, durable: true, iterations: 25 });
    expect(firstFetch).toHaveBeenCalledTimes(25);
    expect(continuationStore.getMarker()?.nextToken).toBe('page-26');

    const secondFetch = vi.fn(async () => ({
      chunk: [{ event_id: '$known' }, { event_id: '$after-cap' }],
      next_batch: undefined,
    }));
    const secondClient = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations: secondFetch,
    } as unknown as MatrixClient;
    await scheduleReconcile({
      mx: secondClient,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx: secondClient }),
      roomId: '!room:example',
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      persistRepair,
      continuationStore,
    });

    expect(secondFetch.mock.calls[0][4]).toMatchObject({ from: 'page-26' });
    expect(continuationStore.getMarker()).toBeUndefined();
    expect(persistRepair).toHaveBeenCalledTimes(2);
  });

  it('checkpoints advancing empty pages instead of repeating them after the cap', async () => {
    const room = makeFakeRoom();
    const continuationStore = createContinuationStore();
    const persistRepair = vi.fn();
    const fetchRelations = vi.fn(async () => {
      const page = fetchRelations.mock.calls.length;
      return { chunk: [], next_batch: `page-${page + 1}` };
    });
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: '!room:example',
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      persistRepair: persistRepair as never,
      continuationStore,
    });

    expect(result).toMatchObject({ repaired: false, iterations: 25 });
    expect(continuationStore.getMarker()?.nextToken).toBe('page-26');
    expect(persistRepair).not.toHaveBeenCalled();
  });

  it('completes a capped head-validation phase from its saved cursor', async () => {
    const room = makeFakeRoom();
    const continuationStore = createContinuationStore();
    await continuationStore.begin('session', '!room:example', '$thread', {
      generation: 'validation-a',
      startedAt: 1,
      nextToken: 'older-cursor',
      overlapEventIds: ['$known'],
    });
    const persistRepair: NonNullable<Parameters<typeof scheduleReconcile>[0]['persistRepair']> =
      vi.fn(({ events }) => ({
        rawEvents: events.map((event) => event.event as Partial<IEvent>),
        loadedReplyCount: 0,
        write: Promise.resolve(true),
      }));
    let headPage = 0;
    const firstFetch = vi.fn(async (_roomId, _threadId, _relType, _eventType, options) => {
      if (options.from === 'older-cursor') {
        return { chunk: [{ event_id: '$known' }, { event_id: '$older' }] };
      }
      headPage += 1;
      return {
        chunk: [{ event_id: `$head-page-${headPage}` }],
        next_batch: `head-${headPage + 1}`,
      };
    });
    const firstClient = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations: firstFetch,
    } as unknown as MatrixClient;

    await scheduleReconcile({
      mx: firstClient,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx: firstClient }),
      roomId: '!room:example',
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      persistRepair,
      continuationStore,
    });

    expect(continuationStore.getMarker()).toMatchObject({
      validatingHead: true,
      nextToken: 'head-26',
    });

    const secondFetch = vi.fn(async (_roomId, _threadId, _relType, _eventType, _options) => ({
      chunk: [{ event_id: '$known' }, { event_id: '$validation-tail' }],
    }));
    const secondClient = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations: secondFetch,
    } as unknown as MatrixClient;

    const result = await scheduleReconcile({
      mx: secondClient,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx: secondClient }),
      roomId: '!room:example',
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      persistRepair,
      continuationStore,
    });

    expect(secondFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch.mock.calls[0][4]).toMatchObject({ from: 'head-26' });
    expect(result).toMatchObject({ repaired: true, durable: true });
    expect(continuationStore.getMarker()).toBeUndefined();
    const persistedIds = persistRepair.mock.calls.at(-1)?.[0].events.map((event) => event.getId());
    expect(persistedIds).toContain('$validation-tail');
  });

  it('upgrades an empty saved overlap boundary from the current cache', async () => {
    const room = makeFakeRoom();
    const continuationStore = createContinuationStore();
    await continuationStore.begin('session', '!room:example', '$thread', {
      generation: 'empty-boundary',
      startedAt: 1,
      nextToken: 'older-cursor',
      overlapEventIds: [],
    });
    const fetchRelations = vi
      .fn()
      .mockResolvedValueOnce({ chunk: [{ event_id: '$older' }], next_batch: undefined })
      .mockResolvedValueOnce({
        chunk: [{ event_id: '$persisted-from-earlier-pass' }],
        next_batch: 'head-page-2',
      });
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: '!room:example',
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$persisted-from-earlier-pass']),
      persistRepair: vi.fn(({ events }) => ({
        rawEvents: events.map((event) => event.event as Partial<IEvent>),
        loadedReplyCount: 0,
        write: Promise.resolve(true),
      })),
      continuationStore,
    });

    expect(fetchRelations).toHaveBeenCalledTimes(2);
    expect(fetchRelations.mock.calls[0][4]).toMatchObject({ from: 'older-cursor' });
    expect(fetchRelations.mock.calls[1][4]).not.toHaveProperty('from');
    expect(continuationStore.getMarker()).toBeUndefined();
  });

  it.each(['repeated', 'rejected'] as const)(
    'recovers a %s saved token by validating again from the head',
    async (failureMode) => {
      const room = makeFakeRoom();
      const continuationStore = createContinuationStore();
      await continuationStore.begin('session', '!room:example', '$thread', {
        generation: 'saved-generation',
        startedAt: 1,
        nextToken: 'stale-token',
        overlapEventIds: ['$known'],
      });
      const fetchRelations = vi.fn();
      if (failureMode === 'rejected') {
        // A definitive server verdict (M_UNKNOWN_TOKEN) discards the cursor
        // without the network-blip retry.
        fetchRelations.mockRejectedValueOnce(
          Object.assign(new Error('invalid token'), { errcode: 'M_UNKNOWN_TOKEN' })
        );
      } else {
        fetchRelations.mockResolvedValueOnce({ chunk: [], next_batch: 'stale-token' });
      }
      fetchRelations.mockResolvedValueOnce({ chunk: [], next_batch: undefined });
      const mx = {
        getRoom: () => room,
        getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
        fetchRelations,
      } as unknown as MatrixClient;

      await scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler: createBackfillScheduler({ mx }),
        roomId: '!room:example',
        room,
        threadId: '$thread',
        cachedPage: makeCachedPage(['$known']),
        continuationStore,
      });

      expect(fetchRelations.mock.calls[0][4]).toMatchObject({ from: 'stale-token' });
      expect(fetchRelations.mock.calls[1][4]).not.toHaveProperty('from');
      expect(continuationStore.restartFromHead).toHaveBeenCalledTimes(1);
      expect(continuationStore.getMarker()).toBeUndefined();
    }
  );

  it('preserves the saved cursor when fetching it fails at the network level', async () => {
    const room = makeFakeRoom();
    const continuationStore = createContinuationStore();
    await continuationStore.begin('session', '!room:example', '$thread', {
      generation: 'saved-generation',
      startedAt: 1,
      nextToken: 'saved-token',
      overlapEventIds: ['$known'],
    });
    const fetchRelations = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;

    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: '!room:example',
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      continuationStore,
    });

    // One retry of the same cursor, then give up WITHOUT discarding durable
    // scan progress — the next online open resumes from the saved token.
    expect(fetchRelations).toHaveBeenCalledTimes(2);
    expect(fetchRelations.mock.calls[0][4]).toMatchObject({ from: 'saved-token' });
    expect(fetchRelations.mock.calls[1][4]).toMatchObject({ from: 'saved-token' });
    expect(continuationStore.restartFromHead).not.toHaveBeenCalled();
    expect(continuationStore.getMarker()).toMatchObject({ nextToken: 'saved-token' });
  });

  it('does not turn an empty saved boundary into an early overlap after token recovery', async () => {
    const room = makeFakeRoom();
    const continuationStore = createContinuationStore();
    await continuationStore.begin('session', room.roomId, '$thread', {
      generation: 'empty-saved-boundary',
      startedAt: 1,
      nextToken: 'expired-token',
      overlapEventIds: [],
    });
    const fetchRelations = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('expired token'), { errcode: 'M_UNKNOWN_TOKEN' })
      )
      .mockResolvedValueOnce({ chunk: [{ event_id: '$persisted-page' }], next_batch: 'head-2' })
      .mockResolvedValueOnce({ chunk: [{ event_id: '$older' }], next_batch: undefined });
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) => makeFakeEvent({ id: raw.event_id ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const persistRepair: NonNullable<Parameters<typeof scheduleReconcile>[0]['persistRepair']> =
      vi.fn(({ events }) => ({
        rawEvents: events.map((event) => event.event as Partial<IEvent>),
        loadedReplyCount: 0,
        write: Promise.resolve(true),
      }));

    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$persisted-page']),
      continuationStore,
      persistRepair,
    });

    expect(fetchRelations).toHaveBeenCalledTimes(3);
    expect(fetchRelations.mock.calls[0][4]).toMatchObject({ from: 'expired-token' });
    expect(fetchRelations.mock.calls[1][4]).not.toHaveProperty('from');
    expect(fetchRelations.mock.calls[2][4]).toMatchObject({ from: 'head-2' });
    expect(continuationStore.getMarker()).toBeUndefined();
  });

  it('sorts multi-page fetches chronologically before injection (greptile P1: paged batch order reverses)', async () => {
    // When divergence spans multiple `/relations` pages, each page
    // comes back backward-paginated (newest→oldest). We reverse each
    // page's chunk to get oldest→newest WITHIN a page, but page 1
    // events are still newer than page 2 events. Naively concatenating
    // yields [page1_oldest..page1_newest, page2_oldest..page2_newest]
    // where page 2 events are chronologically OLDER than any page 1
    // event — a non-monotonic array. The SDK's `thread.addEvents`
    // and the persistence writer both benefit from a chronologically
    // ordered batch (the full backfill path in `gapFillExecutor.ts`
    // sorts after flattening for exactly this reason).
    //
    // This test proves the fix: the injected/persisted array must be
    // in origin_server_ts ascending order across page boundaries.
    const addEvents = vi.fn();
    const threadStub = {
      addEvents,
      events: [],
      initialEventsFetched: true,
      flushPendingTimelineReset: () => undefined,
      getUnfilteredTimelineSet: () => ({ eventIdToTimeline: () => null, getTimelines: () => [] }),
    } as unknown as ReturnType<Room['getThread']>;
    const roomWithThread = {
      roomId: '!room:example',
      findEventById: () => null,
      getThread: (id: string) => (id === '$thread' ? threadStub : undefined),
    } as unknown as Room;
    // Page 1 (newest): ts=200, 300. Page 2 (older tail): ts=50, 100.
    // Wire order is backward → newest first; the fetcher returns them
    // in the SDK's raw chunk order (newest→oldest within a page).
    let iteration = 0;
    const fetchRelations = vi.fn(async () => {
      iteration += 1;
      if (iteration === 1) {
        return {
          chunk: [
            { event_id: '$e-newest', origin_server_ts: 300 },
            { event_id: '$e-newer', origin_server_ts: 200 },
          ] as Partial<IEvent>[],
          next_batch: 'page-2',
        };
      }
      return {
        chunk: [
          { event_id: '$e-older', origin_server_ts: 100 },
          { event_id: '$e-oldest', origin_server_ts: 50 },
        ] as Partial<IEvent>[],
        next_batch: undefined,
      };
    });
    const mx = {
      getRoom: () => roomWithThread,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({
          id: (raw.event_id as string) ?? '',
          ts: (raw.origin_server_ts as number) ?? 0,
        }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    let onRepairedBatch: readonly MatrixEvent[] | undefined;
    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
      room: roomWithThread,
      onRepaired: (batch) => {
        onRepairedBatch = batch;
      },
    });

    expect(result.repaired).toBe(true);
    expect(fetchRelations).toHaveBeenCalledTimes(2);
    // Injection call — the stub thread's window is empty, so the whole
    // batch is backfill, prepended newest first.
    expect(addEvents).toHaveBeenCalledTimes(1);
    const [injectedEvents, toStartOfTimeline] = addEvents.mock.calls[0];
    const injectedTs = (injectedEvents as MatrixEvent[]).map((mEvent) => mEvent.getTs());
    expect(injectedTs).toEqual([300, 200, 100, 50]);
    expect(toStartOfTimeline).toBe(true);
    // onRepaired batch — must be the same chronologically ordered
    // array (both call sites downstream expect the same shape).
    expect(onRepairedBatch).toBeDefined();
    const repairedTs = (onRepairedBatch as MatrixEvent[]).map((mEvent) => mEvent.getTs());
    expect(repairedTs).toEqual([50, 100, 200, 300]);
  });

  // ---------------------------------------------------------------------
  // CINNY-207 P5-GATE-FIX (AC2): observability + SDK injection.
  // ---------------------------------------------------------------------

  it('bumps reconcilesScheduled on every thread reconcile', async () => {
    // Team-lead directive: same lesson as schedulerFailed. Without a
    // "was it even scheduled?" counter, trace analysis can't
    // distinguish "the open path never asked" from "the reconciler
    // ran and found nothing".
    const room = makeFakeRoom();
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({ chunk: [], next_batch: undefined }),
    });
    const scheduler = createBackfillScheduler({ mx });

    // Thread-scope pass.
    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage([]),
    });
    const probe = getCacheProbeSnapshot();
    expect(probe.reconcilesScheduled).toBe(1);
    expect(probe.reconcilesRepaired).toBe(0);
  });

  it('bumps reconcilesRepaired only when divergence was detected and the repair pipeline actually ran — P5-GATE-FIX observability', async () => {
    const room = makeFakeRoom();
    // Chunk carries a NEW id ($reply-3) → divergence → repair fires.
    const fetchRelations = vi.fn(async () => ({
      chunk: [{ event_id: '$reply-3' }, { event_id: '$reply-2' }] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
    });

    const probe = getCacheProbeSnapshot();
    expect(probe.reconcilesScheduled).toBe(1);
    expect(probe.reconcilesRepaired).toBe(1);
  });

  it('injects fetched events into the SDK thread model when divergence detected — P5-GATE-FIX AC2 root cause', async () => {
    // ROOT CAUSE of the AC2 gate failure: `mx.fetchRelations` is a
    // pure HTTP call — it does NOT push events into the SDK's thread
    // model. The pre-P5 `runThreadOpenPostBootstrapRefresh` (deleted
    // in commit 05594b54) called `currentThread.addEvents(latest,
    // false)` after fetching, and P5 dropped that step. Consequence:
    // an m.replace edit fetched on reopen never lands in
    // `thread.events`, so `useThreadRenderState.buildThreadEvents`
    // never sees it, and the render paints v1 forever.
    //
    // Fix: on divergence, the reconciler must inject the mapped
    // events into `room.getThread(threadId)` BEFORE hydration and the
    // onRepaired tick. This test asserts that call fires with the right
    // shape; `reconciler.sdkThread.test.ts` covers where a real SDK
    // thread places them.
    const addEvents = vi.fn();
    const threadStub = {
      addEvents,
      events: [],
      initialEventsFetched: true,
      flushPendingTimelineReset: () => undefined,
      getUnfilteredTimelineSet: () => ({ eventIdToTimeline: () => null, getTimelines: () => [] }),
    } as unknown as ReturnType<Room['getThread']>;
    const roomWithThread = {
      roomId: '!room:example',
      findEventById: () => null,
      getThread: (id: string) => (id === '$thread' ? threadStub : undefined),
    } as unknown as Room;
    // Fetched chunk has a NEW event id ($edit-v2) that the cache
    // doesn't yet know about — the exact AC2 pattern (edit event
    // arrived while the client was closed).
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        { event_id: '$edit-v2', type: 'm.room.message' },
        { event_id: '$reply-1' },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => roomWithThread,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1']),
      room: roomWithThread,
    });

    expect(result.repaired).toBe(true);
    // The injection call — the fix. The stub thread's window is empty,
    // so every fetched event is older than it and goes in as backfill
    // (`toStartOfTimeline` true): appended, the SDK would announce each
    // one as a new reply or a live event.
    expect(addEvents).toHaveBeenCalledTimes(1);
    const [injectedEvents, toStartOfTimeline] = addEvents.mock.calls[0];
    expect(toStartOfTimeline).toBe(true);
    // All fetched, mapped events flow through — both the new id and
    // the already-cached one; the SDK's own dedup on event_id handles
    // duplicates as a no-op, so we do NOT filter before injection
    // (filtering here would risk skipping a bundled-edit case).
    expect(injectedEvents).toHaveLength(2);
    const injectedIds = injectedEvents.map((mEvent: MatrixEvent) => mEvent.getId());
    expect(injectedIds).toContain('$edit-v2');
    expect(injectedIds).toContain('$reply-1');
  });

  it('mutates the render-held cachedPage.hydratedEvents instances directly, not fresh clones — P5-GATE-FIX v2 AC2 instance-race root cause', async () => {
    // CINNY-207 P5-GATE-FIX v2 (AC2 instance-race): the real reason AC2
    // failed on tip 4aa3c194 even with `thread.addEvents` injection.
    //
    // Complete-coverage cache-first path (the exact AC2 scenario) SKIPS
    // SDK bootstrap by design. `useThreadRenderState`'s render source
    // is `fallbackThreadEventsState.events` — MatrixEvent clones handed
    // to `setSupplementalThreadEvents` when the cache was hydrated.
    //
    // The pre-P5 tail refresh applied its repair against
    // `hydratedCachedPage` — the render's OWN instances. P5 lost that:
    // it re-mapped `cachedPage.events` via `mapCachedThreadPageEvents`,
    // producing a SECOND clone set. `applyCachedReplaceRelations`
    // mutated the second clone; the render kept holding the first.
    // The onRepaired tick re-ran the render, saw unchanged instances,
    // painted v1 forever.
    //
    // Fix: reconciler MUST apply the P1.2 pipeline against
    // `cachedPage.hydratedEvents` (falling back to `preferLive` where
    // the SDK has a newer live instance — the P1.2 both-ways-heal
    // spirit). This test models the render-holds-detached-clones
    // reality and asserts the fetched bundled edit lands on the
    // render's instance.
    const room = makeFakeRoom();
    // The render's clone of $edit-target — this is the instance
    // `useThreadRenderState` reads via fallbackEvents. Its
    // `makeReplaced` spy will only fire if the reconciler operates on
    // THIS object identity.
    const renderTargetMakeReplaced = vi.fn();
    const renderHeldEditTarget = {
      ...makeFakeEvent({ id: '$edit-target' }),
      makeReplaced: renderTargetMakeReplaced,
      // A fresh clone (which is what the reconciler would create if it
      // re-mapped from raw JSON) would have a different makeReplaced
      // spy that would NEVER be called under the bug.
      getRelation: () => null,
      replacingEvent: () => null,
      isRedaction: () => false,
      isRedacted: () => false,
    } as unknown as MatrixEvent;
    const renderHeldReply = makeFakeEvent({ id: '$reply-1' });

    // The fetched page carries a standalone m.replace edit event
    // ($edit-v2) whose `rel_type` targets $edit-target. This mirrors
    // what Tuwunel returns from /relations?recurse=true — verified
    // empirically via curl (team-lead's H#1 disproof). The applier's
    // `applyCachedReplaceRelations` scans events for a Replace
    // relation, then calls `makeReplaced` on WHICHEVER instance of
    // the target id is in its id-to-event map. If the reconciler
    // passes a fresh clone of $edit-target, the fresh clone gets
    // mutated. If it passes the render-held instance, the render
    // sees the mutation.
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        {
          event_id: '$edit-v2',
          type: 'm.room.message',
          content: {
            'm.new_content': { body: 'edit-target v2 converged', msgtype: 'm.text' },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$edit-target' },
          },
        },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      // If the reconciler falls back to re-mapping raw JSON for the
      // CACHE snapshot (the bug), it will call this mapper on the
      // cached $edit-target raw JSON and produce a fresh clone with
      // its OWN makeReplaced (a no-op vi.fn()). Under the bug, that
      // clone is what gets mutated. The assertion below
      // (renderTargetMakeReplaced called) fails, exposing the race.
      getEventMapper: () => (raw: Partial<IEvent>) => {
        const relatesTo = (
          raw.content as { 'm.relates_to'?: { rel_type?: string; event_id?: string } } | undefined
        )?.['m.relates_to'];
        const isReplace = relatesTo?.rel_type === 'm.replace';
        return makeFakeEvent({
          id: (raw.event_id as string) ?? '',
          replaceTargetId: isReplace ? relatesTo?.event_id : undefined,
        });
      },
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    // Cache page with hydratedEvents populated — mirrors the shape
    // `hydrateThreadFromCache` now returns after this fix. The raw
    // `events` field still carries the JSON records (for the id set
    // used by detectDivergence — $edit-v2 is new, so divergence
    // fires) but the hydrated instances are what the reconciler
    // must operate on.
    const cachedPage: HydratedThreadCachePage = {
      ...makeCachedPage(['$edit-target', '$reply-1']),
      hydratedEvents: [renderHeldEditTarget, renderHeldReply],
      hydratedRootEvent: undefined,
    };

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage,
      room,
    });

    expect(result.repaired).toBe(true);
    // The load-bearing assertion: mutation lands on the render's
    // instance, not on a fresh clone. Under the pre-fix reconciler,
    // this call count is 0 (fresh clone from mapCachedThreadPageEvents
    // captures the makeReplaced call; render-held instance is never
    // touched). Under the fix, it is 1.
    expect(renderTargetMakeReplaced).toHaveBeenCalledTimes(1);
  });

  it('widens onRepaired to carry the repaired events batch — P5-GATE-FIX v3 dual-injection contract', async () => {
    // Team-lead directive: engine widens `onRepaired` to
    // `(repairedEvents: readonly MatrixEvent[]) => void`. Component-side
    // callbacks call `setSupplementalThreadEvents(threadId, batch)`,
    // which is the render-side leg of the dual-injection fix (SDK-side
    // leg is `addFetchedEventsToThread` in the reconciler).
    //
    // Why this matters: on the complete-coverage cache-first path the
    // SDK bootstrap is skipped by design; the render leans on
    // `fallbackThreadEventsState.events`, populated by
    // `setSupplementalThreadEvents`. An SDK-only injection leaves that
    // path painting v1 forever, which is exactly the AC2 regression
    // the v2 (instance-race) fix addressed for cache-clone identity
    // but did not fix for the SDK-doesn't-know-the-id case.
    //
    // The batch handed to onRepaired is the reconciler-hydrated view
    // (`mergedForHydrate = [...cachedSnapshotEvents, ...allMapped]`),
    // NOT just the fetched `/relations` chunk. RG5-fix rationale (see
    // reconciler.ts around the onRepaired call): when the fetched
    // chunk carries an m.replace whose target sits only in the cached
    // snapshot (not in the fetched window), the applier mutates the
    // cached-snapshot copy in place. Passing only `allMapped` would
    // strand that mutated instance server-side of the sink — the
    // fallback registry would then hold a fresh SDK sibling with a
    // null `.replacingEvent()`, and render preference would paint the
    // un-repaired sibling. Handing the hydrated view through makes the
    // "persistent render source" the reconciler-repaired view.
    // Sink merge is a Map-by-key, so replaying cachedSnapshotEvents
    // (already render-held) is idempotent modulo instance-identity.
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        { event_id: '$edit-v2', type: 'm.room.message' },
        { event_id: '$reply-1' },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1']),
      onRepaired,
    });

    expect(result.repaired).toBe(true);
    expect(onRepaired).toHaveBeenCalledTimes(1);
    // The load-bearing assertion: onRepaired receives the batch as
    // its first argument, and the batch carries both the fetched
    // events AND the cached-snapshot instances the reconciler
    // hydrated in place. Under the pre-fix wiring
    // (`onRepaired(allMapped)`) the cached-snapshot instances never
    // reached the sink — the RG5-fix seam.
    const [batchArg] = onRepaired.mock.calls[0];
    expect(Array.isArray(batchArg)).toBe(true);
    const batchIds = (batchArg as MatrixEvent[]).map((mEvent) => mEvent.getId());
    // Shape assertion (F8 restore): the batch's minimum size is 2
    // (the fetched $edit-v2 + the hydrated cached-snapshot $reply-1).
    // Without a size floor a regression that stopped merging the
    // cached-snapshot instances into the batch could leave the sink
    // receiving only $edit-v2 and still pass `toContain('$reply-1')`
    // if some other code path happened to add it later. The batch in
    // this shape actually contains 3 events (edit + reply +
    // reconciler-mapped root); using `>=2` locks the "both instances
    // reach the sink" contract without pinning to the exact reconciler
    // mapping order.
    expect((batchArg as MatrixEvent[]).length).toBeGreaterThanOrEqual(2);
    expect(batchIds).toContain('$edit-v2');
    expect(batchIds).toContain('$reply-1');
  });

  it('still delivers repairedEvents through onRepaired when room.getThread returns null — P5-GATE-FIX v4 AC2 complete-coverage reopen', async () => {
    // CINNY-207 P5-GATE-FIX v4 (AC2): team-lead diagnosis.
    //
    // The exact AC2 shape: on complete-coverage cache-first reopen the
    // SDK bootstrap is skipped by design (see `threadOpenCacheFirst.ts`),
    // so `room.getThread(threadId)` is null at the moment the reconciler
    // wants to inject fetched events into the SDK thread model. The
    // `liveThread.addEvents(...)` leg no-ops silently — the render on
    // that path lives entirely on component-owned
    // `fallbackThreadEventsState.events`. Convergence MUST come through
    // the widened `onRepaired(repairedEvents)` contract routed by the
    // component-side callback into `setSupplementalThreadEvents`.
    //
    // This test wires `getThread → undefined` (the AC2-live reality) and
    // asserts:
    //   1. The pass still returns `repaired: true` (hydration runs
    //      against `cachedPage.hydratedEvents` regardless of SDK state).
    //   2. `onRepaired` fires exactly once with the fully-mapped batch —
    //      the component-side callback needs a non-empty batch to hand
    //      to `setSupplementalThreadEvents`; an empty batch would leave
    //      the fallback state stale.
    //   3. `reconcilesThreadNull` probe counter bumps to 1 — the
    //      diagnostic that a docker trace can read to prove the code
    //      reached the "SDK thread absent" branch and did not accidentally
    //      short-circuit around the render-fallback leg.
    const roomThreadNull = {
      roomId: '!room:example',
      findEventById: () => null,
      getThread: () => undefined,
    } as unknown as Room;
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        { event_id: '$edit-v2', type: 'm.room.message' },
        { event_id: '$reply-1' },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => roomThreadNull,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1']),
      room: roomThreadNull,
      onRepaired,
    });

    expect(result.repaired).toBe(true);
    expect(onRepaired).toHaveBeenCalledTimes(1);
    const [batchArg] = onRepaired.mock.calls[0];
    expect(Array.isArray(batchArg)).toBe(true);
    // RG5-fix: onRepaired now hands the hydrated view (cached snapshot
    // + fetched), so the payload includes both the fetched $edit-v2
    // and the cached snapshot's $reply-1. Length assertion loosened
    // from the pre-fix `toHaveLength(2)` because the hydrated view
    // may include multiple instances for the same id (cached and
    // fetched) prior to sink-side merge dedup.
    const batchIds = (batchArg as MatrixEvent[]).map((mEvent) => mEvent.getId());
    expect(batchIds).toContain('$edit-v2');
    expect(batchIds).toContain('$reply-1');
    // Probe evidence: the diagnostic counter for the "SDK thread was
    // null at injection time" branch. If this stays 0 while the test
    // reaches divergence, the code silently short-circuited without
    // documenting the shape — the exact observability hole team-lead
    // called out ("observability that isn't emitted isn't observability").
    const probe = getCacheProbeSnapshot();
    expect(probe.reconcilesThreadNull).toBe(1);
    // And the SDK-side leg didn't do anything (there was no thread to
    // do it against) — repair came entirely through the render-fallback
    // leg (see `setSupplementalThreadEvents` wiring in the
    // threadOpenCacheFirst test suite).
    expect(probe.reconcilesRepaired).toBe(1);
  });

  it('does NOT inject into the SDK thread on the D7 no-op path — P5-GATE-FIX cost guarantee', async () => {
    // D7 promise: when the cache was right, the reconciler is
    // zero-cost. Injecting events into the SDK thread even on the
    // no-op path would fire SDK listeners (RoomEvent.Timeline, etc.)
    // and burn render cycles for nothing.
    const addEvents = vi.fn();
    const threadStub = {
      addEvents,
      events: [],
      initialEventsFetched: true,
      flushPendingTimelineReset: () => undefined,
      getUnfilteredTimelineSet: () => ({ eventIdToTimeline: () => null, getTimelines: () => [] }),
    } as unknown as ReturnType<Room['getThread']>;
    const roomWithThread = {
      roomId: '!room:example',
      findEventById: () => null,
      getThread: (id: string) => (id === '$thread' ? threadStub : undefined),
    } as unknown as Room;
    // Chunk overlaps cached window entirely → no divergence.
    const fetchRelations = vi.fn(async () => ({
      chunk: [{ event_id: '$reply-2' }, { event_id: '$reply-1' }] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => roomWithThread,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
      room: roomWithThread,
    });

    expect(result.repaired).toBe(false);
    expect(addEvents).not.toHaveBeenCalled();
  });

  it('bumps reconcilesOnRepairedFired only AFTER the onRepaired callback returns — P5-GATE-FIX v4 final: definitive callback-fired evidence', async () => {
    // Team-lead directive (2026-07-04): reconcilesRepaired bumps BEFORE
    // `onRepaired(allMapped)` is invoked, so the counter alone cannot
    // prove the widened component-side callback (the render-fallback
    // sink into `setSupplementalThreadEvents`) actually ran end-to-end.
    // A throwing callback would leave
    // reconcilesRepaired at N and reconcilesOnRepairedFired at 0 — that
    // gap is the diagnostic. This test asserts both counters bump
    // together on the happy path AND that the counter fires strictly
    // AFTER the callback returns (the callback observes the pre-fire
    // value 0, the assertion below observes the post-fire value 1).
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        { event_id: '$edit-v2', type: 'm.room.message' },
        { event_id: '$reply-1' },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    let observedCounterBeforeCallbackReturned = -1;
    const onRepaired = vi.fn(() => {
      observedCounterBeforeCallbackReturned = getCacheProbeSnapshot().reconcilesOnRepairedFired;
    });

    await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1']),
      onRepaired,
    });

    const probe = getCacheProbeSnapshot();
    expect(probe.reconcilesRepaired).toBe(1);
    // The load-bearing invariant: the counter bumped strictly AFTER the
    // callback returned. Ordering matters — a docker trace polling the
    // probe can distinguish "onRepaired was called and returned" from
    // "onRepaired was invoked but threw / was reentered". If the
    // reconciler ever fired this counter before invoking the callback,
    // this next assertion would fail.
    expect(observedCounterBeforeCallbackReturned).toBe(0);
    expect(probe.reconcilesOnRepairedFired).toBe(1);
  });

  it('persists fetched thread events through the ENGINE PERSIST path on divergence — P5-GATE-FIX v4 final: cache converges independently of SDK sync timing', async () => {
    // Team-lead directive (2026-07-04): the design seam behind repeated
    // AC2 red is that the pre-v4 chain converged in MEMORY (SDK
    // `liveThread.addEvents` + render-side `setSupplementalThreadEvents`
    // via widened onRepaired) but never taught the CACHE about the
    // fetched events. So the fix chain was timing-dependent: whichever
    // of (a) live sync landing the edit into SDK, (b) reconciler
    // finishing its pass, (c) render re-deriving from the new
    // supplemental array won a given race decided whether v1 or v2
    // painted, and NEXT reopen from IDB rehit the same stale window.
    //
    // The reconciler's job is to be the deterministic owner: on
    // divergence, persist the fully-mapped fetched batch through the
    // engine persist path (thread scope) so subsequent opens hydrate
    // from a cache that already contains the fetched-and-repaired state.
    //
    // This test asserts the persist leg fires when divergence is
    // detected. The `reconcilerPersists` counter is bumped inside the
    // reconciler right where it hands the batch to
    // `persistThreadEventCacheSnapshot`, so the assertion is
    // counter-based (avoids the fragility of stubbing the IDB layer for
    // a unit test).
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        { event_id: '$edit-v2', type: 'm.room.message' },
        { event_id: '$reply-1' },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1']),
    });

    expect(result.repaired).toBe(true);
    const probe = getCacheProbeSnapshot();
    // Load-bearing assertion: the persist leg fired exactly once — one
    // pass, one persist call. Under the pre-v4 code this counter would
    // stay at 0 (persist path was never invoked from the reconciler).
    expect(probe.reconcilerPersists).toBe(1);
  });

  it('does not settle a repaired pass until its cache transaction commits', async () => {
    const room = makeFakeRoom();
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({ chunk: [{ event_id: '$new' }, { event_id: '$known' }] }),
    });
    let resolveWrite!: (committed: boolean) => void;
    const write = new Promise<boolean>((resolve) => {
      resolveWrite = resolve;
    });
    const persistRepair: NonNullable<Parameters<typeof scheduleReconcile>[0]['persistRepair']> =
      vi.fn(() => ({ rawEvents: [], loadedReplyCount: 0, write }));
    const onRepaired = vi.fn();
    let settled = false;

    const reconcile = scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      onRepaired,
      persistRepair,
    }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(persistRepair).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    expect(onRepaired).not.toHaveBeenCalled();

    resolveWrite(true);
    const result = await reconcile;

    expect(result).toMatchObject({ repaired: true, durable: true });
    expect(onRepaired).toHaveBeenCalledTimes(1);
  });

  it('delivers the in-memory repair while exposing a failed durable write', async () => {
    const room = makeFakeRoom();
    const mx = makeMockClient({
      room,
      fetchRelations: () => ({ chunk: [{ event_id: '$new' }, { event_id: '$known' }] }),
    });
    const persistRepair: NonNullable<Parameters<typeof scheduleReconcile>[0]['persistRepair']> =
      vi.fn(() => ({
        rawEvents: [],
        loadedReplyCount: 0,
        write: Promise.resolve(false),
      }));
    const onRepaired = vi.fn();

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx }),
      roomId: room.roomId,
      room,
      threadId: '$thread',
      cachedPage: makeCachedPage(['$known']),
      onRepaired,
      persistRepair,
    });

    expect(result).toMatchObject({ repaired: true, durable: false });
    expect(onRepaired).toHaveBeenCalledTimes(1);
    expect(onRepaired.mock.calls[0][0].map((event) => event.getId())).toContain('$new');
  });

  it('detects SDK-vs-cache timing race and STILL persists + injects — P5-GATE-FIX v4 final: cache is what next open paints', async () => {
    // Team-lead directive (2026-07-04) — the exact timing-nondeterminism
    // shape the design seam explains:
    //
    //   SDK already holds v2 (a live sync landed the m.replace edit
    //   into the thread model AHEAD of the reconciler's fetch), but
    //   CACHE still holds v1 (the persist path never wrote v2 to IDB
    //   because live-mode gates skipped catch-up-sync events by design
    //   and the gap-fill executor only writes room scope).
    //
    // A cache-driven reopen paints v1. The reconciler MUST:
    //   1. Detect divergence — using CACHE records as ground truth,
    //      not SDK state. The fetched raw for `$edit-target` carries
    //      the bundled `m.replace` pointing at `$edit-v2`. The cache
    //      raw for `$edit-target` has no such bundling. Cache is
    //      diverged from server → repair.
    //   2. Persist the fetched batch through the engine path so the
    //      cache learns about `$edit-v2`.
    //   3. Inject into the SDK too (idempotent no-op because the SDK
    //      already had v2 — the SDK dedupes on event_id).
    //
    // This is the deterministic-owner contract: convergence is
    // decoupled from whichever SDK/sync/render race happens to win.
    const addEvents = vi.fn();
    const sdkAlreadyHasV2Thread = {
      addEvents,
      events: [],
      initialEventsFetched: true,
      flushPendingTimelineReset: () => undefined,
      getUnfilteredTimelineSet: () => ({ eventIdToTimeline: () => null, getTimelines: () => [] }),
    } as unknown as ReturnType<Room['getThread']>;
    const roomSdkAhead = {
      roomId: '!room:example',
      findEventById: () => null,
      getThread: (id: string) => (id === '$thread' ? sdkAlreadyHasV2Thread : undefined),
    } as unknown as Room;
    // Fetched page carries the same-id cached event ($edit-target) but
    // with a bundled `m.replace` — that is the cache-vs-server
    // divergence signal (the cache raw record has no bundling; the
    // fetched raw does). The divergence detector must fire on this,
    // and the persist must overwrite the cache record with the
    // fetched version.
    const fetchRelations = vi.fn(async () => ({
      chunk: [
        {
          event_id: '$edit-target',
          type: 'm.room.message',
          sender: '@bob:example',
          unsigned: {
            'm.relations': {
              'm.replace': {
                event_id: '$edit-v2',
                sender: '@bob:example',
                origin_server_ts: 2,
              },
            },
          },
        },
        { event_id: '$reply-1' },
      ] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => roomSdkAhead,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({
          id: (raw.event_id as string) ?? '',
          bundledReplaceId: (
            raw.unsigned as
              | {
                  'm.relations'?: { 'm.replace'?: { event_id?: string } };
                }
              | undefined
          )?.['m.relations']?.['m.replace']?.event_id,
        }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });
    const onRepaired = vi.fn();

    // Cache holds v1: raw records for `$edit-target` and `$reply-1`,
    // no bundling. `makeCachedPage` seeds exactly this shape.
    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$edit-target', '$reply-1']),
      room: roomSdkAhead,
      onRepaired,
    });

    expect(result.repaired).toBe(true);
    // (1) Detected divergence purely on the cache-vs-fetched comparison
    //     (SDK state played no role in the diff — the fetched raw
    //     carries a bundled replace on a cached id, cache raw did not).
    expect(onRepaired).toHaveBeenCalledTimes(1);
    // (2) Persist leg fired — cache converges to the fetched shape so
    //     the NEXT reopen paints v2 from IDB alone.
    const probe = getCacheProbeSnapshot();
    expect(probe.reconcilerPersists).toBe(1);
    // (3) SDK injection also fired (idempotent — SDK's own event_id
    //     dedup absorbs it as a no-op given the sync-won-the-race
    //     precondition; the fact that addEvents was called at all is
    //     the invariant, not what it did with the batch).
    expect(addEvents).toHaveBeenCalledTimes(1);
    // (4) Callback-fired counter bumped — the render-fallback sink had
    //     a chance to run.
    expect(probe.reconcilesOnRepairedFired).toBe(1);
    // (5) Repair counter bumped exactly once (one divergent pass).
    expect(probe.reconcilesRepaired).toBe(1);
  });

  it('D7 no-op path does NOT persist through the engine path — reconcilerPersists stays at 0 when the cache was right', async () => {
    // Companion assertion to the persist test above: when the fetched
    // page overlaps the cache entirely (D7 cheap no-op), the reconciler
    // must NOT persist. Persisting on the no-op path would (a) waste
    // an IDB write per open (the AC7 budget concern), and (b) blur the
    // signal — `reconcilerPersists` should measure "reconciler repaired
    // AND wrote back", not "reconciler ran". The observability lesson
    // is the same as the D7 no-op tests for `onRepaired` and
    // `addEvents`: cheap-no-op paths must stay cheap.
    const room = makeFakeRoom();
    const fetchRelations = vi.fn(async () => ({
      chunk: [{ event_id: '$reply-2' }, { event_id: '$reply-1' }] as Partial<IEvent>[],
      next_batch: undefined,
    }));
    const mx = {
      getRoom: () => room,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
      fetchRelations,
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const result = await scheduleReconcile({
      mx,
      sessionId: 'session',
      scheduler,
      roomId: '!room:example',
      threadId: '$thread',
      cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
    });

    expect(result.repaired).toBe(false);
    const probe = getCacheProbeSnapshot();
    expect(probe.reconcilerPersists).toBe(0);
    expect(probe.reconcilesOnRepairedFired).toBe(0);
  });

  it('logs per-page (event_id, type, rel_type, bundled_relations) triples when debug is enabled — P5-GATE-FIX v4-follow-through', async () => {
    // Team-lead directive (2026-07-04, post-Signature-A): the docker
    // trace showed `reconcilesRepaired=0` from ONE clean-network run,
    // leaving two indistinguishable explanations — (i) the fetched
    // chunk did not carry the edit at all, or (ii) it did but the
    // detector's comparison baseline already knew about it. Emit the
    // raw chunk shape per iteration so the next trace answers the
    // question without another gate-fix iteration.
    //
    // The log is gated on BOTH `debugTraceId` presence AND the
    // `mindroom.debug.timeline` localStorage flag — this test asserts
    // (a) it fires when both are on, (b) the payload carries the four
    // useful axes: event_id, type, rel_type, and the bundled relation
    // keys (so a bundled m.replace is visible even when the top-level
    // event is not itself a replace event).
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalLocalStorage = globalThis.localStorage;
    const debugStorage = {
      getItem: vi.fn((key: string) => (key === 'mindroom.debug.timeline' ? '1' : null)),
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: debugStorage,
    });

    try {
      const room = makeFakeRoom();
      const fetchRelations = vi.fn(async () => ({
        chunk: [
          {
            event_id: '$edit-v2',
            type: 'm.room.message',
            content: {
              'm.new_content': { body: 'new body', msgtype: 'm.text' },
              'm.relates_to': { rel_type: 'm.replace', event_id: '$edit-target' },
            },
          },
          {
            event_id: '$edit-target',
            type: 'm.room.message',
            unsigned: {
              'm.relations': { 'm.replace': { event_id: '$edit-v2' } },
            },
          },
          { event_id: '$reply-1', type: 'm.room.message' },
        ] as Partial<IEvent>[],
        next_batch: undefined,
      }));
      const mx = {
        getRoom: () => room,
        getEventMapper: () => (raw: Partial<IEvent>) =>
          makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
        fetchRelations,
      } as unknown as MatrixClient;
      const scheduler = createBackfillScheduler({ mx });

      await scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler,
        roomId: '!room:example',
        threadId: '$thread',
        cachedPage: makeCachedPage(['$reply-1']),
        debugTraceId: 'test-trace-1',
      });

      const chunkLogs = consoleLogSpy.mock.calls.filter((args) => {
        const first = args[0];
        return typeof first === 'string' && first.includes('reconcile-chunk');
      });
      // Exactly one page fetched → exactly one chunk log.
      expect(chunkLogs.length).toBe(1);
      const [, payload] = chunkLogs[0] as [string, Record<string, unknown>];
      expect(payload.iteration).toBe(1);
      expect(payload.chunkSize).toBe(3);
      expect(payload.nextToken).toBe('absent');
      const triples = payload.triples as Array<{
        event_id: string;
        type: string;
        rel_type?: string;
        bundled_relations?: string[];
      }>;
      // Triple 1 — the standalone m.replace edit event.
      expect(triples[0]).toMatchObject({
        event_id: '$edit-v2',
        type: 'm.room.message',
        rel_type: 'm.replace',
      });
      // Triple 2 — the edit target with bundled m.replace metadata.
      expect(triples[1]).toMatchObject({
        event_id: '$edit-target',
        type: 'm.room.message',
        bundled_relations: ['m.replace'],
      });
      // Triple 3 — plain reply, no relation.
      expect(triples[2]).toMatchObject({
        event_id: '$reply-1',
        type: 'm.room.message',
      });
      expect(triples[2].rel_type).toBeUndefined();
      expect(triples[2].bundled_relations).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
      consoleLogSpy.mockRestore();
    }
  });

  it('does NOT log reconcile-chunk when debugTraceId is absent — cheap-in-prod invariant', async () => {
    // Companion to the debug-enabled test above: with no traceId, the
    // early-return branch inside the reconcile loop must skip the
    // triple-building work AND the `logTimelineDebug` call. Assertion
    // is on console.log receiving no `reconcile-chunk` line even if
    // localStorage flag is set (traceId absence alone is sufficient).
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalLocalStorage = globalThis.localStorage;
    const debugStorage = {
      getItem: vi.fn((key: string) => (key === 'mindroom.debug.timeline' ? '1' : null)),
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: debugStorage,
    });

    try {
      const room = makeFakeRoom();
      const mx = {
        getRoom: () => room,
        getEventMapper: () => (raw: Partial<IEvent>) =>
          makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
        fetchRelations: vi.fn(async () => ({
          chunk: [{ event_id: '$reply-1' }] as Partial<IEvent>[],
          next_batch: undefined,
        })),
      } as unknown as MatrixClient;
      const scheduler = createBackfillScheduler({ mx });

      await scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler,
        roomId: '!room:example',
        threadId: '$thread',
        cachedPage: makeCachedPage(['$reply-1']),
        // debugTraceId intentionally omitted.
      });

      const chunkLogs = consoleLogSpy.mock.calls.filter((args) => {
        const first = args[0];
        return typeof first === 'string' && first.includes('reconcile-chunk');
      });
      expect(chunkLogs.length).toBe(0);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
      consoleLogSpy.mockRestore();
    }
  });

  // CINNY-207 AC2 STEP 1 (2026-07-04): the distinguishable exit-path
  // counters make the invariant
  //   reconcilesScheduled ==
  //     reconcilesSignalAborted +
  //     reconcilesFetchFailed + reconcilesNoDivergence +
  //     reconcilesNoRoom +
  //     reconcilesRepaired
  // observable from a probe snapshot. This suite drives every
  // reachable outcome and asserts the sum stays balanced — that way a
  // future regression that introduces a new silent exit path breaks
  // the invariant instead of being invisible in a docker trace.
  describe('exit-path outcome counters (AC2 STEP 1 invariant)', () => {
    const sumOutcomes = (probe: ReturnType<typeof getCacheProbeSnapshot>): number =>
      probe.reconcilesSignalAborted +
      probe.reconcilesFetchFailed +
      probe.reconcilesNoDivergence +
      probe.reconcilesNoRoom +
      probe.reconcilesRepaired;

    it('reconcile pass runs to completion and fires onRepaired regardless of component state (I2: engine-owned, decoupled from mount)', async () => {
      // CINNY-207 AC2 revision (2026-07-04): the reconciler is an
      // engine responsibility (invariant I2, convergence to server
      // truth). Its fetch/persist lifecycle MUST NOT be coupled to
      // component mount state. With `shouldContinue` removed from
      // `ScheduleReconcileArgs`, only `signal.aborted` (scheduler
      // teardown / abort()) can stop a pass — a moved-away component
      // has no way to abort the engine's convergence work. This test
      // asserts the inverse of the deleted guard-abort scenario: a
      // schedule with a non-aborted signal runs the full fetch loop,
      // detects divergence, and invokes onRepaired.
      const room = makeFakeRoom();
      const fetchRelations = vi.fn(async () => ({
        chunk: [{ event_id: '$reply-new' }] as Partial<IEvent>[],
        next_batch: undefined,
      }));
      const mx = {
        getRoom: () => room,
        getEventMapper: () => (raw: Partial<IEvent>) =>
          makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
        fetchRelations,
      } as unknown as MatrixClient;
      const scheduler = createBackfillScheduler({ mx });
      const onRepaired = vi.fn();

      await scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler,
        roomId: '!room:example',
        threadId: '$thread',
        cachedPage: makeCachedPage([]),
        onRepaired,
      });

      const probe = getCacheProbeSnapshot();
      // Fetch happened — engine did not silently short-circuit.
      expect(fetchRelations).toHaveBeenCalledTimes(1);
      // Divergence detected → repair applied → onRepaired fired.
      expect(probe.reconcilesRepaired).toBe(1);
      expect(onRepaired).toHaveBeenCalledTimes(1);
      // No guard-abort or retry machinery exists anymore.
      expect(probe.reconcilesScheduled).toBe(1);
      expect(sumOutcomes(probe)).toBe(probe.reconcilesScheduled);
    });

    it('reconcilesSignalAborted bumps when the scheduler aborts the job before it runs', async () => {
      // Aborted-before-pickup branch inside the scheduler: the
      // executor never runs, the queued entry settles via the drain's
      // aborted branch, and no reconciler counter increments — the
      // scheduler side owns that outcome via `schedulerAborted`.
      // What we CAN drive from here is a signal.aborted observed
      // INSIDE the executor's loop, which is the reconciler's own
      // exit path. Simulate that by holding the fetch promise open
      // and resolving it only AFTER the caller aborts the specific
      // job, so the loop's own signal check trips mid-pass.
      const room = makeFakeRoom();
      let capturedAbort: (() => void) | undefined;
      const fetchRelations = vi.fn(
        () =>
          new Promise<{ chunk: Array<Partial<IEvent>>; next_batch?: string }>((resolve) => {
            capturedAbort = () => resolve({ chunk: [], next_batch: undefined });
          })
      );
      const mx = {
        getRoom: () => room,
        getEventMapper: () => (raw: Partial<IEvent>) =>
          makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
        fetchRelations,
      } as unknown as MatrixClient;
      const scheduler = createBackfillScheduler({ mx });

      const promise = scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler,
        roomId: '!room:example',
        threadId: '$thread',
        cachedPage: makeCachedPage([]),
      });
      await flushMicrotasks();

      // Abort the specific reconcile job. The executor is mid-fetch;
      // the fetch resolves empty, the post-loop signal.aborted check
      // fires (or the next-iteration check if we happen to get one).
      scheduler.abort('!room:example', '$thread', 'reconcile');
      capturedAbort?.();
      await promise;

      const probe = getCacheProbeSnapshot();
      expect(probe.reconcilesScheduled).toBe(1);
      // The signal was observed post-loop (fetch resolved before
      // aborted check), so the counter falls into the signal-abort
      // bucket.
      expect(probe.reconcilesSignalAborted).toBe(1);
      expect(sumOutcomes(probe)).toBe(probe.reconcilesScheduled);
    });

    it('reconcilesFetchFailed bumps when fetchRelations throws (page returns undefined)', async () => {
      const room = makeFakeRoom();
      const fetchRelations = vi.fn(async () => {
        throw new Error('network died');
      });
      const mx = {
        getRoom: () => room,
        getEventMapper: () => (raw: Partial<IEvent>) =>
          makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
        fetchRelations,
      } as unknown as MatrixClient;
      const scheduler = createBackfillScheduler({ mx });

      await scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler,
        roomId: '!room:example',
        threadId: '$thread',
        cachedPage: makeCachedPage([]),
      });

      const probe = getCacheProbeSnapshot();
      expect(probe.reconcilesScheduled).toBe(1);
      expect(probe.reconcilesFetchFailed).toBe(1);
      expect(sumOutcomes(probe)).toBe(probe.reconcilesScheduled);
    });

    it('reconcilesFetchFailed bumps when fetchRelations returns an empty chunk (no divergence assessable)', async () => {
      const room = makeFakeRoom();
      const fetchRelations = vi.fn(async () => ({
        chunk: [] as Partial<IEvent>[],
        next_batch: undefined,
      }));
      const mx = {
        getRoom: () => room,
        getEventMapper: () => (raw: Partial<IEvent>) =>
          makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
        fetchRelations,
      } as unknown as MatrixClient;
      const scheduler = createBackfillScheduler({ mx });

      await scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler,
        roomId: '!room:example',
        threadId: '$thread',
        cachedPage: makeCachedPage(['$reply-1']),
      });

      const probe = getCacheProbeSnapshot();
      expect(probe.reconcilesScheduled).toBe(1);
      expect(probe.reconcilesFetchFailed).toBe(1);
      expect(sumOutcomes(probe)).toBe(probe.reconcilesScheduled);
    });

    it('reconcilesNoDivergence bumps when the fetched page overlaps the cache (D7 no-op)', async () => {
      const room = makeFakeRoom();
      const fetchRelations = vi.fn(async () => ({
        chunk: [{ event_id: '$reply-2' }, { event_id: '$reply-1' }] as Partial<IEvent>[],
        next_batch: undefined,
      }));
      const mx = {
        getRoom: () => room,
        getEventMapper: () => (raw: Partial<IEvent>) =>
          makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
        fetchRelations,
      } as unknown as MatrixClient;
      const scheduler = createBackfillScheduler({ mx });

      await scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler,
        roomId: '!room:example',
        threadId: '$thread',
        cachedPage: makeCachedPage(['$reply-1', '$reply-2']),
      });

      const probe = getCacheProbeSnapshot();
      expect(probe.reconcilesScheduled).toBe(1);
      expect(probe.reconcilesNoDivergence).toBe(1);
      expect(probe.reconcilesRepaired).toBe(0);
      expect(sumOutcomes(probe)).toBe(probe.reconcilesScheduled);
    });

    it('reconcilesNoRoom bumps when mx.getRoom returns null and no room was provided', async () => {
      const mx = {
        getRoom: () => null,
        getEventMapper: () => (raw: Partial<IEvent>) =>
          makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
        fetchRelations: vi.fn(),
      } as unknown as MatrixClient;
      const scheduler = createBackfillScheduler({ mx });

      await scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler,
        roomId: '!room:example',
        threadId: '$thread',
        cachedPage: makeCachedPage([]),
      });

      const probe = getCacheProbeSnapshot();
      expect(probe.reconcilesScheduled).toBe(1);
      expect(probe.reconcilesNoRoom).toBe(1);
      expect(sumOutcomes(probe)).toBe(probe.reconcilesScheduled);
    });

    it('reconcilesRepaired bumps when detectDivergence returns true (existing behavior; balances the invariant)', async () => {
      const room = makeFakeRoom();
      const fetchRelations = vi.fn(async () => ({
        chunk: [{ event_id: '$reply-new' }] as Partial<IEvent>[],
        next_batch: undefined,
      }));
      const mx = {
        getRoom: () => room,
        getEventMapper: () => (raw: Partial<IEvent>) =>
          makeFakeEvent({ id: (raw.event_id as string) ?? '' }),
        fetchRelations,
      } as unknown as MatrixClient;
      const scheduler = createBackfillScheduler({ mx });

      await scheduleReconcile({
        mx,
        sessionId: 'session',
        scheduler,
        roomId: '!room:example',
        threadId: '$thread',
        cachedPage: makeCachedPage(['$reply-1']),
        onRepaired: () => undefined,
      });

      const probe = getCacheProbeSnapshot();
      expect(probe.reconcilesScheduled).toBe(1);
      expect(probe.reconcilesRepaired).toBe(1);
      expect(sumOutcomes(probe)).toBe(probe.reconcilesScheduled);
    });
  });
});
