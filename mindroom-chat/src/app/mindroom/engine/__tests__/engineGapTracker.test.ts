/**
 * CINNY-207 P3.2: engineGapTracker + inMemoryGapFillScheduler.
 *
 * Covers: TimelineReset on the room's UNFILTERED timelineSet →
 * mark + dispatch limited-sync job; TimelineReset on a thread
 * timelineSet → ignored (not a gap event); Sync→PREPARED → startup
 * jobs only for rooms with durable markers; left rooms excluded;
 * probe counter increments. The scheduler is a dispatch seam — jobs
 * never queue in it; per-room coalescing lives in the executor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Direction, type EventTimelineSet, type MatrixClient, type Room } from 'matrix-js-sdk';
import {
  createEngineGapTracker,
  createInMemoryGapFillScheduler,
  type GapFillJob,
  type GapFillScheduler,
} from '../engineGapTracker';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';

const captureEnqueues = (scheduler: GapFillScheduler): GapFillJob[] => {
  const jobs: GapFillJob[] = [];
  scheduler.onEnqueue((job) => jobs.push(job));
  return jobs;
};

const makeRoom = ({
  roomId,
  membership = 'join',
  paginationToken = null,
  unfiltered,
}: {
  roomId: string;
  membership?: string;
  paginationToken?: string | null;
  unfiltered?: EventTimelineSet;
}): Room => {
  const timelineSet =
    unfiltered ?? ({ __id: `${roomId}:unfiltered` } as unknown as EventTimelineSet);
  return {
    roomId,
    getMyMembership: () => membership,
    getLiveTimeline: () =>
      ({
        getPaginationToken: (dir: Direction) =>
          dir === Direction.Backward ? paginationToken : null,
      } as never),
    getUnfilteredTimelineSet: () => timelineSet,
  } as unknown as Room;
};

describe('createInMemoryGapFillScheduler (CINNY-207 P3.2)', () => {
  beforeEach(() => resetCacheProbe());
  afterEach(() => resetCacheProbe());

  it('dispatches every enqueued job to subscribers and counts the probe', () => {
    const scheduler = createInMemoryGapFillScheduler();
    const jobs = captureEnqueues(scheduler);
    scheduler.enqueueGapFill({ roomId: '!a', reason: 'startup', markedAt: 1 });
    scheduler.enqueueGapFill({ roomId: '!a', reason: 'limited-sync', markedAt: 2 });
    expect(jobs.map((job) => job.reason)).toEqual(['startup', 'limited-sync']);
    expect(getCacheProbeSnapshot().gapFillsEnqueued).toBe(2);
  });

  it('a throwing subscriber does not break other subscribers', () => {
    const scheduler = createInMemoryGapFillScheduler();
    scheduler.onEnqueue(() => {
      throw new Error('bad subscriber');
    });
    const jobs = captureEnqueues(scheduler);
    scheduler.enqueueGapFill({ roomId: '!a', reason: 'startup', markedAt: 1 });
    expect(jobs).toHaveLength(1);
  });
});

describe('createEngineGapTracker (CINNY-207 P3.2)', () => {
  const defaultMarkDiscontinuity = async (
    _sessionId: string,
    _roomId: string,
    marker: { markedAt: number; prevBatch?: string | null; generation?: string }
  ) => marker;
  const markDiscontinuity = vi.fn(defaultMarkDiscontinuity);
  const loadCachedTail = vi.fn(async () => ({ events: [], hasMoreBefore: false }));

  beforeEach(() => {
    resetCacheProbe();
    markDiscontinuity.mockReset();
    markDiscontinuity.mockImplementation(defaultMarkDiscontinuity);
    loadCachedTail.mockReset();
    loadCachedTail.mockResolvedValue({ events: [], hasMoreBefore: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetCacheProbe();
  });

  it('marks the room and enqueues a limited-sync job on TimelineReset for the unfiltered timelineSet', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    loadCachedTail.mockResolvedValueOnce({
      events: [{ event_id: '$pre-gap-tail', origin_server_ts: 1 }],
      hasMoreBefore: false,
    });
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      now: () => 1000,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet(), false);
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));
    await markDiscontinuity.mock.results[0].value;
    await Promise.resolve();

    expect(markDiscontinuity).toHaveBeenCalledWith('session', '!a', {
      markedAt: 1000,
      prevBatch: 'batch-1',
      generation: '1000:batch-1',
      nextToken: 'batch-1',
      overlapEventIds: ['$pre-gap-tail'],
    });
    expect(enqueued).toEqual([
      {
        roomId: '!a',
        reason: 'limited-sync',
        markedAt: 1000,
        prevBatch: 'batch-1',
        generation: '1000:batch-1',
      },
    ]);
    expect(getCacheProbeSnapshot().gapFillsEnqueued).toBe(1);
  });

  it('does not commit a failed pre-gap tail read as an empty boundary', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    loadCachedTail.mockRejectedValueOnce(new Error('read failed'));
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      now: () => 1000,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet(), false);
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));

    // [] durably means "no cached boundary existed"; a failed read must leave
    // the boundary unset so the executor takes its own guarded snapshot.
    expect(markDiscontinuity).toHaveBeenCalledWith('session', '!a', {
      markedAt: 1000,
      prevBatch: 'batch-1',
      generation: '1000:batch-1',
      nextToken: 'batch-1',
      overlapEventIds: undefined,
    });
  });

  it('ignores TimelineReset on non-unfiltered timelineSets (thread resets are not gap events)', () => {
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const room = makeRoom({ roomId: '!a' });
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      onPersistenceError: vi.fn(),
    });

    const differentSet = { __id: 'thread-set' } as unknown as EventTimelineSet;
    tracker.handleTimelineReset(room, differentSet, false);

    expect(markDiscontinuity).not.toHaveBeenCalled();
    expect(enqueued).toHaveLength(0);
  });

  it('ignores TimelineReset with a missing room or timelineSet (defensive)', () => {
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const tracker = createEngineGapTracker({
      mx: {} as unknown as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
    });

    tracker.handleTimelineReset(undefined, undefined, false);
    tracker.handleTimelineReset(makeRoom({ roomId: '!a' }), undefined, false);
    tracker.handleTimelineReset(
      undefined,
      { __id: 'anything' } as unknown as EventTimelineSet,
      false
    );

    expect(enqueued).toHaveLength(0);
  });

  it('enqueues startup jobs only for joined rooms with durable markers', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const joinedA = makeRoom({ roomId: '!join-a', paginationToken: 'ta' });
    const joinedB = makeRoom({ roomId: '!join-b', paginationToken: null });
    const leftC = makeRoom({ roomId: '!left-c', membership: 'leave', paginationToken: 'tc' });
    const invitedD = makeRoom({ roomId: '!invited-d', membership: 'invite' });

    const mx = {
      getRooms: () => [joinedA, joinedB, leftC, invitedD],
    } as unknown as MatrixClient;

    const tracker = createEngineGapTracker({
      mx,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadDiscontinuity: async (_sessionId, roomId) => {
        if (roomId === '!join-a') {
          return {
            markedAt: 1000,
            prevBatch: 'ta',
            nextToken: 'ta-checkpoint',
            generation: 'gap-a',
          };
        }
        return undefined;
      },
    });

    await tracker.handleSyncPrepared();

    expect(enqueued).toEqual([
      {
        roomId: '!join-a',
        reason: 'startup',
        markedAt: 1000,
        prevBatch: 'ta-checkpoint',
        generation: 'gap-a',
      },
    ]);
    expect(getCacheProbeSnapshot().gapFillsEnqueued).toBe(1);
  });

  it('a limited-sync reset after a startup resume dispatches a newer job for the executor to coalesce', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const mx = { getRooms: () => [room] } as unknown as MatrixClient;
    const tracker = createEngineGapTracker({
      mx,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      loadDiscontinuity: async () => ({
        markedAt: 2000,
        prevBatch: 'old-batch',
      }),
      now: () => 3000,
    });

    await tracker.handleSyncPrepared();
    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet(), false);
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));
    await markDiscontinuity.mock.results[0].value;
    await Promise.resolve();

    // Both jobs dispatch; the executor keeps the one with the newest
    // markedAt, so the later reset supersedes the startup resume.
    expect(enqueued.map((job) => job.reason)).toEqual(['startup', 'limited-sync']);
    expect(enqueued[1].prevBatch).toBe('batch-1');
    expect(enqueued[1].markedAt).toBeGreaterThan(enqueued[0].markedAt);
  });

  it('handleSyncPrepared is a no-op when no MatrixClient is present (safety valve)', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const tracker = createEngineGapTracker({
      // @ts-expect-error deliberately omit for the safety test
      mx: undefined,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
    });
    await tracker.handleSyncPrepared();
    expect(enqueued).toHaveLength(0);
  });

  it('retains and retries a limited-sync job until its marker is durable', async () => {
    vi.useFakeTimers();
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const onPersistenceError = vi.fn();
    markDiscontinuity
      .mockRejectedValueOnce(new Error('blocked cache'))
      .mockImplementationOnce(async (_sessionId, _roomId, marker) => marker);
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      onPersistenceError,
      now: () => 1000,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    await vi.waitFor(() => expect(onPersistenceError).toHaveBeenCalledTimes(1));
    expect(enqueued).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(enqueued).toEqual([
      {
        roomId: '!a',
        reason: 'limited-sync',
        markedAt: 1000,
        prevBatch: 'batch-1',
        generation: '1000:batch-1',
      },
    ]);
    tracker.stop();
  });

  it('cancels an undurable marker retry when the tracker stops', async () => {
    vi.useFakeTimers();
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const room = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const onPersistenceError = vi.fn();
    markDiscontinuity.mockRejectedValue(new Error('blocked cache'));
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      onPersistenceError,
    });

    tracker.handleTimelineReset(room, room.getUnfilteredTimelineSet());
    await vi.waitFor(() => expect(onPersistenceError).toHaveBeenCalledTimes(1));
    tracker.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(markDiscontinuity).toHaveBeenCalledTimes(1);
    expect(enqueued).toEqual([]);
  });

  it('does not enqueue a stale marker after a newer reset supersedes it', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const firstRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const secondRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-2' });
    let resolveFirst:
      | ((marker: { markedAt: number; prevBatch?: string | null }) => void)
      | undefined;
    markDiscontinuity
      .mockImplementationOnce(
        async () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(defaultMarkDiscontinuity);
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      now,
    });

    tracker.handleTimelineReset(firstRoom, firstRoom.getUnfilteredTimelineSet());
    await vi.waitFor(() => expect(markDiscontinuity).toHaveBeenCalledTimes(1));
    tracker.handleTimelineReset(secondRoom, secondRoom.getUnfilteredTimelineSet());
    resolveFirst?.({ markedAt: 1000, prevBatch: 'batch-1' });
    await vi.waitFor(() => {
      expect(enqueued).toEqual([
        {
          roomId: '!a',
          reason: 'limited-sync',
          markedAt: 2000,
          prevBatch: 'batch-2',
          generation: '2000:batch-2',
        },
      ]);
    });
    tracker.stop();
  });

  it('shares the pre-gap boundary when a newer reset supersedes a pending mark', async () => {
    const scheduler = createInMemoryGapFillScheduler();
    const enqueued = captureEnqueues(scheduler);
    const firstRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-1' });
    const secondRoom = makeRoom({ roomId: '!a', paginationToken: 'batch-2' });
    let resolveBoundary:
      | ((page: {
          events: { event_id: string; origin_server_ts: number }[];
          hasMoreBefore: boolean;
        }) => void)
      | undefined;
    loadCachedTail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBoundary = resolve;
        })
    );
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const tracker = createEngineGapTracker({
      mx: {} as MatrixClient,
      sessionId: 'session',
      scheduler,
      markDiscontinuity,
      loadCachedTail,
      now,
    });

    tracker.handleTimelineReset(firstRoom, firstRoom.getUnfilteredTimelineSet());
    tracker.handleTimelineReset(secondRoom, secondRoom.getUnfilteredTimelineSet());

    expect(loadCachedTail).toHaveBeenCalledTimes(1);
    resolveBoundary?.({
      events: [{ event_id: '$pre-gap-tail', origin_server_ts: 1 }],
      hasMoreBefore: false,
    });

    await vi.waitFor(() => {
      expect(markDiscontinuity).toHaveBeenCalledTimes(1);
      expect(markDiscontinuity).toHaveBeenCalledWith('session', '!a', {
        markedAt: 2000,
        prevBatch: 'batch-2',
        generation: '2000:batch-2',
        nextToken: 'batch-2',
        overlapEventIds: ['$pre-gap-tail'],
      });
    });
    expect(enqueued).toEqual([
      {
        roomId: '!a',
        reason: 'limited-sync',
        markedAt: 2000,
        prevBatch: 'batch-2',
        generation: '2000:batch-2',
      },
    ]);
    tracker.stop();
  });
});
