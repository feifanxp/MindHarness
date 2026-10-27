/**
 * CINNY-207 AC2 revision (2026-07-04): post-choke-point thread-open
 * accounting invariant.
 *
 * The pre-revision shape had a schedule counter per branch and eight
 * SDK-bootstrap-skip counters. The revision relocated the thread-scope
 * reconcile schedule to a SINGLE choke point at the top of
 * `runThreadOpenCacheFirst`, right after the two hydrate guards. Every
 * open that survives those guards schedules exactly one reconcile — so
 * the accounting collapses to:
 *
 *   threadOpens ==
 *     threadOpenScheduledCacheFirst +
 *     threadOpenSkipCacheFirstHydrateGuard +
 *     threadOpenSkipCacheFirstPostHydrateGuard
 *
 * F4 rework (2026-07-04): the prior implementation of this file bumped
 * counters directly (`countCacheProbe(...)` from the test body) and
 * then asserted the sum of what it had just written — a tautology that
 * would have stayed green if production stopped counting entirely. This
 * rewrite drives `runThreadOpenCacheFirst` for real with vitest mocks
 * for the three legitimate outcomes and asserts the counter partition
 * after each. If production stops bumping any of the three outcome
 * counters, the corresponding test fails at the counter assertion.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEvent, makeRoom, makeTimeline } from '../test-utils/RoomTimeline.test.shared';
import { buildThreadCacheCoverage } from '../threadCacheCoverage';
import { runThreadOpenCacheFirst } from '../threadOpenCacheFirst';
import { getCacheProbeSnapshot, resetCacheProbe, type CacheProbeCounters } from '../cacheProbe';

const CHOKE_POINT_OUTCOME_KEYS = [
  'threadOpenScheduledCacheFirst',
  'threadOpenSkipCacheFirstHydrateGuard',
  'threadOpenSkipCacheFirstPostHydrateGuard',
] satisfies (keyof CacheProbeCounters)[];

const sumOutcomes = (snap: CacheProbeCounters): number =>
  CHOKE_POINT_OUTCOME_KEYS.reduce((acc, key) => acc + snap[key], 0);

const makeCachedPage = () => ({
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
});

const makeRunOptions = () => {
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
    scheduleReconcile: vi.fn(async () => ({
      repaired: false,
      fetchedCount: 0,
      iterations: 1,
      aborted: false,
    })),
    room,
    setSupplementalThreadEvents: vi.fn(),
    onCacheHydrated: vi.fn(),
    shouldScrollToLatestOnOpen: true,
    threadId: '$root',
    threadOpenSeedSession,
    threadTimeline,
  };
};

describe('AC2 revision: thread-open choke-point accounting invariant', () => {
  beforeEach(() => resetCacheProbe());

  it('bumps threadOpenScheduledCacheFirst when the open survives both hydrate guards', async () => {
    // Real drive of `runThreadOpenCacheFirst` — the schedule at the top
    // of the function is the sole path that bumps
    // `threadOpenScheduledCacheFirst`. If production removes or gates
    // that bump, this assertion goes red.
    const opts = makeRunOptions();
    opts.hydrateThreadFromCache.mockResolvedValue(makeCachedPage());

    await runThreadOpenCacheFirst(opts as never);

    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenScheduledCacheFirst).toBe(1);
    expect(snap.threadOpenSkipCacheFirstHydrateGuard).toBe(0);
    expect(snap.threadOpenSkipCacheFirstPostHydrateGuard).toBe(0);
    // scheduleReconcile fired exactly once (choke point) — proves the
    // counter bump we asserted above was in the same code path as the
    // real schedule call, not some other bump site.
    expect(opts.scheduleReconcile).toHaveBeenCalledTimes(1);
  });

  it('bumps threadOpenSkipCacheFirstHydrateGuard when hydrate throws and the thread has closed', async () => {
    // Simulate the hydrate-guard path: hydrate rejects AND the guard
    // reports the thread is no longer open. The function must return
    // early without scheduling and bump exactly the hydrate-guard
    // counter.
    const opts = makeRunOptions();
    opts.hydrateThreadFromCache.mockRejectedValue(new Error('hydrate failed'));
    opts.isCurrentThreadOpen.mockReturnValue(false);

    await runThreadOpenCacheFirst(opts as never);

    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenScheduledCacheFirst).toBe(0);
    expect(snap.threadOpenSkipCacheFirstHydrateGuard).toBe(1);
    expect(snap.threadOpenSkipCacheFirstPostHydrateGuard).toBe(0);
    expect(opts.scheduleReconcile).not.toHaveBeenCalled();
  });

  it('bumps threadOpenSkipCacheFirstPostHydrateGuard when the guard reports the thread closed after hydrate returns', async () => {
    // Post-hydrate guard path: hydrate returns cleanly, then the guard
    // reports the thread is no longer open (closed / navigated away
    // while hydration was in flight). Only reached when hydrate does
    // NOT throw — otherwise the hydrate-guard branch catches it.
    // Function must return early without scheduling and bump exactly
    // the post-hydrate guard counter.
    const opts = makeRunOptions();
    opts.hydrateThreadFromCache.mockResolvedValue(makeCachedPage());
    opts.isCurrentThreadOpen.mockReturnValue(false);

    await runThreadOpenCacheFirst(opts as never);

    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenScheduledCacheFirst).toBe(0);
    expect(snap.threadOpenSkipCacheFirstHydrateGuard).toBe(0);
    expect(snap.threadOpenSkipCacheFirstPostHydrateGuard).toBe(1);
    expect(opts.scheduleReconcile).not.toHaveBeenCalled();
  });

  it('partitions a mixed batch: three schedules, one hydrate-guard skip, one post-hydrate-guard skip', async () => {
    // Drive three schedules + one hydrate-guard skip + one
    // post-hydrate-guard skip via real invocations. The invariant sum
    // must equal 5 and each bucket must show its expected count.
    const scheduled = 3;
    const hydrateSkip = 1;
    const postHydrateSkip = 1;

    for (let i = 0; i < scheduled; i += 1) {
      const opts = makeRunOptions();
      opts.hydrateThreadFromCache.mockResolvedValue(makeCachedPage());
      // eslint-disable-next-line no-await-in-loop
      await runThreadOpenCacheFirst(opts as never);
    }
    for (let i = 0; i < hydrateSkip; i += 1) {
      const opts = makeRunOptions();
      opts.hydrateThreadFromCache.mockRejectedValue(new Error('hydrate failed'));
      opts.isCurrentThreadOpen.mockReturnValue(false);
      // eslint-disable-next-line no-await-in-loop
      await runThreadOpenCacheFirst(opts as never);
    }
    for (let i = 0; i < postHydrateSkip; i += 1) {
      const opts = makeRunOptions();
      opts.hydrateThreadFromCache.mockResolvedValue(makeCachedPage());
      opts.isCurrentThreadOpen.mockReturnValue(false);
      // eslint-disable-next-line no-await-in-loop
      await runThreadOpenCacheFirst(opts as never);
    }

    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenScheduledCacheFirst).toBe(scheduled);
    expect(snap.threadOpenSkipCacheFirstHydrateGuard).toBe(hydrateSkip);
    expect(snap.threadOpenSkipCacheFirstPostHydrateGuard).toBe(postHydrateSkip);
    // The sum matches the total open attempts across shapes. The
    // outer `threadOpens` bump lives in the lifecycle controller
    // (not in `runThreadOpenCacheFirst`); its coverage is in the
    // sibling `threadOpenCacheFirst.test.ts` and the render-shell
    // integration tests. Here we assert the CHOKE-POINT-level
    // partition, which is what makes the outer invariant provable.
    expect(sumOutcomes(snap)).toBe(scheduled + hydrateSkip + postHydrateSkip);
  });
});
