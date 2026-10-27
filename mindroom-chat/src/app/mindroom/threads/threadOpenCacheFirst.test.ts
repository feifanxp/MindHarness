import { type MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { makeEvent, makeRoom, makeTimeline } from './test-utils/RoomTimeline.test.shared';
import { buildThreadCacheCoverage } from './threadCacheCoverage';
import { runThreadOpenCacheFirst } from './threadOpenCacheFirst';
import * as timelineDebug from './timelineDebug';

const makeDefaultOptions = () => {
  const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
  const reply = makeEvent('$reply', { threadRootId: '$root', ts: 2 });
  const threadTimeline = makeTimeline([], { backwardToken: 'stale', forwardToken: null });
  const thread = {
    id: '$root',
    rootEvent: root,
    events: [reply],
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => threadTimeline,
    }),
  };
  const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
  const threadOpenSeedSession = {
    applyInitialUntargetedThreadSeed: vi.fn(),
  };

  return {
    debugTraceId: 'test',
    notifyEventsChanged: vi.fn(),
    hydrateThreadFromCache: vi.fn(),
    isCurrentThreadOpen: vi.fn(() => true),
    pinThreadToBottomOnOpen: vi.fn(),
    // CINNY-207 AC2 revision (2026-07-04): single choke-point schedule
    // at the top of `runThreadOpenCacheFirst`. Every open that survives
    // the hydrate + post-hydrate guards schedules exactly one reconcile
    // from the single thread-open choke point.
    scheduleReconcile: vi.fn(async () => ({
      repaired: false,
      fetchedCount: 0,
      iterations: 1,
      aborted: false,
    })),
    room,
    // CINNY-207 P5-GATE-FIX v3 (AC2 dual-injection): component-side
    // supplemental-events sink. The reconciler's widened `onRepaired`
    // callback flows repaired events here so the render's fallback
    // event state converges even on the complete-coverage path where
    // SDK bootstrap is skipped by design.
    setSupplementalThreadEvents: vi.fn(),
    onCacheHydrated: vi.fn(),
    shouldScrollToLatestOnOpen: true,
    threadId: '$root',
    threadOpenSeedSession,
    threadTimeline,
  };
};

describe('runThreadOpenCacheFirst', () => {
  it.each([true, false])(
    'ignores cache completion after navigation (still open=%s)',
    async (stillOpen) => {
      const opts = makeDefaultOptions();
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      opts.hydrateThreadFromCache.mockReturnValue(pending);
      const opening = runThreadOpenCacheFirst(opts as never);
      await Promise.resolve();
      expect(opts.hydrateThreadFromCache).toHaveBeenCalledOnce();
      opts.isCurrentThreadOpen.mockReturnValue(stillOpen);
      finish();
      await opening;
      expect(opts.hydrateThreadFromCache).toHaveBeenCalledOnce();
      expect(opts.scheduleReconcile).toHaveBeenCalledTimes(stillOpen ? 1 : 0);
    }
  );

  it('reports complete cache coverage without mutating the SDK timeline', async () => {
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: null,
        hasMoreBackward: false,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: false,
      relationSnapshotComplete: true,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: true,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    const result = await runThreadOpenCacheFirst(opts as never);

    expect(result).toEqual({ hydratedCachedPage: cachedPage, shouldContinue: false });
    expect(opts.threadOpenSeedSession.applyInitialUntargetedThreadSeed).not.toHaveBeenCalled();
    expect(opts.onCacheHydrated).toHaveBeenCalled();
    expect(opts.threadTimeline.setPaginationToken).not.toHaveBeenCalled();
    expect(opts.onCacheHydrated).toHaveBeenCalledWith(true);
    expect(opts.notifyEventsChanged).toHaveBeenCalledTimes(1);
    // CINNY-207 AC2 revision (2026-07-04): the SINGLE choke-point
    // reconcile schedule at the top of `runThreadOpenCacheFirst` fires
    // on every open that survives the hydrate + post-hydrate guards.
    // On the complete-coverage path this is the only reconcile —
    // structurally impossible for a coverage branch to skip. Reason
    // is the single thread-open choke point (the three earlier branch-local
    // reason variants — open-complete-coverage, open-partial-coverage,
    // open-backfill-completed — were consolidated when the branch
    // schedule sites were deleted).
    expect(opts.scheduleReconcile).toHaveBeenCalledTimes(1);
    expect(opts.scheduleReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: opts.room.roomId,
        threadId: '$root',
        cachedPage,
      })
    );
    expect(opts.pinThreadToBottomOnOpen).toHaveBeenCalledTimes(1);
  });

  it('paints a partial cached snapshot and falls through to the SDK bootstrap drain', async () => {
    // 2026-07-06 consolidation: the open-time relations-backfill leg
    // is gone. A genuinely partial snapshot no longer fires a second
    // full /relations drain from the open — it paints what the cache
    // has, schedules the one choke-point reconcile, and returns
    // shouldContinue=true so the lifecycle controller runs SDK
    // bootstrap + refreshLatestThreadSlice (the single drain channel).
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: 'next',
        hasMoreBackward: true,
        relationSnapshotComplete: false,
        snapshotComplete: false,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      expectedReplyCount: 1,
      hasMoreBefore: true,
      relationSnapshotComplete: false,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: false,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    const result = await runThreadOpenCacheFirst(opts as never);

    expect(result).toEqual({ hydratedCachedPage: cachedPage, shouldContinue: true });
    // The partial path does not pin to bottom here — that happens in
    // the lifecycle controller after the SDK drain completes.
    expect(opts.pinThreadToBottomOnOpen).not.toHaveBeenCalled();
    // No usable-cache seed replay either: the snapshot is usable, so
    // the untargeted seed is skipped and paint comes from hydration.
    expect(opts.threadOpenSeedSession.applyInitialUntargetedThreadSeed).not.toHaveBeenCalled();
    // The choke-point reconcile is the ONLY network-side work the
    // cache-first path triggers for a partial snapshot.
    expect(opts.scheduleReconcile).toHaveBeenCalledTimes(1);
    const [reconcileArgs] = opts.scheduleReconcile.mock.calls[0];
    expect(reconcileArgs.threadId).toBe('$root');
    expect(reconcileArgs.cachedPage).toBe(cachedPage);
  });

  it('routes the reconciler onRepaired batch through setSupplementalThreadEvents + tick (CINNY-207 P5-GATE-FIX v3 AC2 dual-injection)', async () => {
    // Team-lead directive: the engine widens `onRepaired` to carry the
    // repaired MatrixEvent batch; component-side callback wires it into
    // `setSupplementalThreadEvents(threadId, repairedEvents)` + a tick.
    // That closes the "SDK model still empty, render leans on
    // fallback events" gap on the complete-coverage cache-first path
    // (SDK bootstrap is skipped by design when the cache is complete —
    // see `useThreadRenderState.buildThreadEvents`).
    //
    // Under the pre-v3 wiring the callback was `() => {}` shape and
    // only fired a tick — the render still held its stale supplemental
    // instances. Under v3 the callback receives the repaired batch and
    // merges it into the supplemental state, which
    // `useThreadRenderState.setSupplementalThreadEvents` also
    // hydrates via `hydrateCachedEvents` (P1.2 pipeline) — the edit
    // now lands on whichever instance ends up in the merged list.
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: null,
        hasMoreBackward: false,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: false,
      relationSnapshotComplete: true,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: true,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    // Capture the onRepaired callback that the caller wires into
    // scheduleReconcile so we can simulate the reconciler's repair path
    // firing it with a repaired-events batch.
    let capturedOnRepaired: ((repairedEvents: readonly MatrixEvent[]) => void) | undefined;
    opts.scheduleReconcile.mockImplementation(
      async (args: { onRepaired?: (repairedEvents: readonly MatrixEvent[]) => void }) => {
        capturedOnRepaired = args.onRepaired;
        return {
          repaired: true,
          fetchedCount: 1,
          iterations: 1,
          aborted: false,
        };
      }
    );

    await runThreadOpenCacheFirst(opts as never);

    expect(opts.scheduleReconcile).toHaveBeenCalledTimes(1);
    expect(capturedOnRepaired).toBeDefined();

    // Baseline: setSupplementalThreadEvents has not been called yet
    // during the cache-first path itself — the hydration path lives in
    // hydrateThreadFromCache, which is mocked here. All the following
    // calls must therefore come from the onRepaired wiring.
    const supplementalMock = opts.setSupplementalThreadEvents as ReturnType<typeof vi.fn>;
    const preRepairCalls = supplementalMock.mock.calls.length;

    // Simulate the reconciler firing the tick with a repaired batch.
    const repairedEvent = makeEvent('$edit-v2', { threadRootId: '$root', ts: 3 });
    capturedOnRepaired?.([repairedEvent]);

    // The load-bearing assertion: the repaired batch flows into
    // setSupplementalThreadEvents. Under pre-v3 code this call count
    // stays at preRepairCalls (the callback only re-ran the tick).
    expect(supplementalMock.mock.calls.length).toBe(preRepairCalls + 1);
    expect(supplementalMock).toHaveBeenLastCalledWith('$root', [repairedEvent]);

    // Tick still fires so the render re-reads the now-merged
    // supplemental state (setSupplementalThreadEvents itself updates
    // state, but the additional tick preserves parity with the pre-v3
    // callback and keeps the "one tick per repair" invariant).
    expect(opts.notifyEventsChanged).toHaveBeenCalled();
  });

  it('does not call setSupplementalThreadEvents for an empty repaired batch (CINNY-207 P5-GATE-FIX v3 cost guarantee)', async () => {
    // Defense-in-depth: the reconciler only fires onRepaired when it
    // actually applied a repair, but even a paranoid "call with empty
    // array" should be a no-op on the component side — the merge
    // machinery in `setSupplementalThreadEvents` allocates a new
    // fallback state on every call, and a zero-event batch would
    // still churn the render.
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: null,
        hasMoreBackward: false,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: false,
      relationSnapshotComplete: true,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: true,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    let capturedOnRepaired: ((repairedEvents: readonly MatrixEvent[]) => void) | undefined;
    opts.scheduleReconcile.mockImplementation(
      async (args: { onRepaired?: (repairedEvents: readonly MatrixEvent[]) => void }) => {
        capturedOnRepaired = args.onRepaired;
        return {
          repaired: false,
          fetchedCount: 0,
          iterations: 1,
          aborted: false,
        };
      }
    );

    await runThreadOpenCacheFirst(opts as never);

    const supplementalMock = opts.setSupplementalThreadEvents as ReturnType<typeof vi.fn>;
    const preCalls = supplementalMock.mock.calls.length;

    // Fire with an empty batch (contract-defensive test — the engine
    // guards against this itself by not calling onRepaired at all
    // when there is nothing to repair, but the component-side wiring
    // must also skip cleanly if the callback is ever invoked empty).
    capturedOnRepaired?.([]);

    expect(supplementalMock.mock.calls.length).toBe(preCalls);
  });

  it('applies the initial seed and continues when no usable cache exists', async () => {
    const opts = makeDefaultOptions();
    opts.hydrateThreadFromCache.mockResolvedValue(undefined);

    const result = await runThreadOpenCacheFirst(opts as never);

    expect(result).toEqual({ hydratedCachedPage: undefined, shouldContinue: true });
    expect(opts.threadOpenSeedSession.applyInitialUntargetedThreadSeed).toHaveBeenCalledTimes(1);
    expect(opts.onCacheHydrated).toHaveBeenCalled();
    // CINNY-207 AC2 revision (2026-07-04): STRONGER invariant. The
    // pre-revision code let the no-cache path fall through to the
    // lifecycle controller's partial-coverage schedule site. The
    // revision moved the schedule to the choke-point at the top of
    // `runThreadOpenCacheFirst`, above every coverage/bootstrap
    // conditional — so even the no-cache path (which returns
    // shouldContinue=true and will hand off to SDK bootstrap
    // downstream) still schedules exactly one reconcile here with
    // `cachedPage: undefined`. The reconciler treats an undefined
    // cached page as "compare fetched chunk against empty cache" —
    // divergence is any non-empty tail, which converges the cache.
    expect(opts.scheduleReconcile).toHaveBeenCalledTimes(1);
    expect(opts.scheduleReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: opts.room.roomId,
        threadId: '$root',
        cachedPage: undefined,
      })
    );
  });
  it('paints a complete cache independently of SDK reset conversion', async () => {
    const opts = makeDefaultOptions();
    const error = new Error('token conversion unavailable');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const trace = vi.spyOn(timelineDebug, 'logTimelineDebug');
    Object.assign(opts.room.getThread('$root')!, {
      flushPendingTimelineReset: vi.fn().mockRejectedValueOnce(error),
    });
    opts.hydrateThreadFromCache.mockResolvedValue({
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: null,
        hasMoreBackward: false,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: false,
      beforeToken: null,
      relationSnapshotComplete: true,
    });
    try {
      const result = await runThreadOpenCacheFirst(opts as never);
      expect(result.shouldContinue).toBe(false);
      expect(opts.hydrateThreadFromCache).toHaveBeenCalledOnce();
      expect(opts.onCacheHydrated).toHaveBeenCalledWith(true);
      expect(opts.scheduleReconcile).toHaveBeenCalledOnce();
      expect(warning).not.toHaveBeenCalled();
      expect(trace).toHaveBeenCalledWith(opts.debugTraceId, 'thread-cache-hydrate-finished', {
        cacheHit: true,
      });
      expect(trace).not.toHaveBeenCalledWith(opts.debugTraceId, 'thread-cache-hydrate-error');
    } finally {
      warning.mockRestore();
      trace.mockRestore();
    }
  });
});
