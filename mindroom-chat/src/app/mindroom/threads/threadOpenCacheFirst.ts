import { type MatrixEvent, type Room } from 'matrix-js-sdk';
import { logTimelineDebug } from './timelineDebug';
import { countCacheProbe } from './cacheProbe';
import { hasUsableThreadCacheSnapshot, isCompleteThreadCacheCoverage } from './threadCacheCoverage';
import type { HydratedThreadCachePage } from './types';
import type { hydrateThreadFromCache } from './threadOpenCacheController';
import type { ReconcileResult, ScheduleReconcileArgs } from '../engine/reconciler';

type ThreadOpenSeedSession = {
  applyInitialUntargetedThreadSeed: () => void;
};

/**
 * Injected scheduler entry point. Component-side callers pre-bind the
 * engine's mx / sessionId / scheduler so this file does not need to
 * reach into the engine directly (keeps arch-guard boundaries clean).
 */
export type ScheduleReconcileFn = (
  args: Pick<ScheduleReconcileArgs, 'roomId' | 'room' | 'threadId' | 'cachedPage' | 'onRepaired'>
) => Promise<ReconcileResult>;

type RunThreadOpenCacheFirstOptions = {
  debugTraceId: string | undefined;
  notifyEventsChanged: () => void;
  onCacheHydrated: (complete: boolean) => void;
  hydrateThreadFromCache: (threadId: string) => ReturnType<typeof hydrateThreadFromCache>;
  isCurrentThreadOpen: () => boolean;
  pinThreadToBottomOnOpen: () => void;
  /**
   * CINNY-207 P5.1 (D7): replaces the deleted
   * `refreshLatestThreadRelationsTail`. The complete-coverage path
   * still schedules a reconcile so a stale cache converges after open
   * without reload — coverage decides PAINT, never REVALIDATE.
   */
  scheduleReconcile: ScheduleReconcileFn;
  room: Room;
  /**
   * CINNY-207 P5-GATE-FIX v3 (AC2 dual-injection, render leg): the
   * reconciler's widened `onRepaired` callback hands us the
   * fully-mapped batch of fetched events; we route them into the
   * render's supplemental-events sink so the complete-coverage
   * cache path converges alongside SDK bootstrap. The
   * sink itself lives in `useThreadRenderState.setSupplementalThreadEvents`
   * and dedups by event id, so re-passing an already-known live event
   * is a no-op there. Kept as a separate injected function so this
   * module does not import from `useThreadRenderState` and so the
   * engine boundary stays clean (engine has no knowledge of
   * `setSupplementalThreadEvents`).
   */
  setSupplementalThreadEvents: (expectedThreadId: string, events: MatrixEvent[]) => void;
  shouldScrollToLatestOnOpen: boolean;
  threadId: string;
  threadOpenSeedSession: ThreadOpenSeedSession;
};

type RunThreadOpenCacheFirstResult = {
  hydratedCachedPage?: HydratedThreadCachePage;
  shouldContinue: boolean;
};

export const runThreadOpenCacheFirst = async ({
  debugTraceId,
  notifyEventsChanged,
  onCacheHydrated,
  hydrateThreadFromCache,
  isCurrentThreadOpen,
  pinThreadToBottomOnOpen,
  scheduleReconcile,
  room,
  setSupplementalThreadEvents,
  shouldScrollToLatestOnOpen,
  threadId,
  threadOpenSeedSession,
}: RunThreadOpenCacheFirstOptions): Promise<RunThreadOpenCacheFirstResult> => {
  let hydratedCachedPage;
  let cacheHydrationFinished = false;
  try {
    // Cache paints independently of concurrent SDK bootstrap. Pagination tokens
    // are joined by the session only if this read finishes before the network.
    hydratedCachedPage = await hydrateThreadFromCache(threadId);
    cacheHydrationFinished = true;
    logTimelineDebug(debugTraceId, 'thread-cache-hydrate-finished', {
      cacheHit: !!hydratedCachedPage,
    });
    if (!isCurrentThreadOpen()) {
      countCacheProbe('threadOpenSkipCacheFirstPostHydrateGuard');
      return { shouldContinue: false };
    }
  } catch {
    if (!cacheHydrationFinished) logTimelineDebug(debugTraceId, 'thread-cache-hydrate-error');
    if (!isCurrentThreadOpen()) {
      // AC2 STEP 4 iter 2 (2026-07-04): hydrate threw and the guard
      // says the thread has been closed/re-navigated in the meantime.
      // No scheduleReconcile fires — count this skip.
      countCacheProbe('threadOpenSkipCacheFirstHydrateGuard');
      return { shouldContinue: false };
    }
    hydratedCachedPage = undefined;
  }
  if (!isCurrentThreadOpen()) {
    // AC2 STEP 4 iter 2 (2026-07-04): guard flipped between hydrate
    // returning and this check — the open aborted before we reached
    // the choke-point schedule. This is one of the two legitimate
    // "no reconcile fires" paths: the thread is closed, there is no
    // convergence work to do.
    countCacheProbe('threadOpenSkipCacheFirstPostHydrateGuard');
    return { shouldContinue: false };
  }

  // CINNY-207 AC2 revision (2026-07-04): SINGLE UNSKIPPABLE CHOKE-POINT
  // SCHEDULE. Product-owner directive replaces the earlier bandage shape
  // (bolt a `scheduleReconcile` onto each branch that could bail without
  // scheduling). D7 SWR rule: coverage decides PAINT, never REVALIDATE
  // — so the reconcile schedule belongs ABOVE every coverage/bootstrap
  // conditional, structurally impossible for any early return to skip.
  //
  // Every thread open that survives the hydrate + post-hydrate guards
  // schedules exactly one reconcile here. The scheduler's
  // (roomId|threadId|kind=reconcile) dedup key coalesces this call
  // against any in-flight reconcile from a prior tab/focus event.
  //
  // The reconciler runs to completion regardless of navigation (the
  // paired R1/R2 revert removed `shouldContinue` from the engine); the
  // component-mount check lives inside `onRepaired` so a moved-away
  // component no-ops on render while the persist leg still teaches the
  // cache.
  //
  // The `cachedPage` argument is the hydrated snapshot (may be
  // undefined). The reconciler uses it to short-circuit its fetch loop
  // when the fetched chunk overlaps the cached window by event id — so
  // the "cached was right" case still costs at most one /relations page.
  // 2026-07-10 missing-middle fix: one exception — when the union of
  // known reply ids falls short of the authoritative reply count, the
  // reconciler pages past the overlap (bounded) to heal a hole behind
  // the cached tail; see the shortfall guard in reconciler.ts.
  countCacheProbe('threadOpenScheduledCacheFirst');
  void scheduleReconcile({
    roomId: room.roomId,
    room,
    threadId,
    cachedPage: hydratedCachedPage,
    onRepaired: (repairedEvents) => {
      logTimelineDebug(debugTraceId, 'thread-reconcile-observer', {
        current: isCurrentThreadOpen(),
        mappedCount: repairedEvents.length,
      });
      // CINNY-207 AC2 render-gap RG1 (2026-07-04): sink counters.
      // These three counters partition the outcomes of the
      // component-side onRepaired callback so a docker probe snapshot
      // can name which seam the render-gap lives at without another
      // blind cycle. Invariant asserted by the render-gap
      // instrumentation:
      //   reconcilesOnRepairedFired ==
      //     onRepairedGuardBailed +
      //     supplementalEventsExecuted +
      //     supplementalEventsSkippedEmpty
      // (reconcilesOnRepairedFired is bumped in reconciler.ts AFTER
      // this callback returns normally.)
      if (!isCurrentThreadOpen()) {
        countCacheProbe('onRepairedGuardBailed');
        return;
      }
      if (repairedEvents.length > 0) {
        setSupplementalThreadEvents(threadId, [...repairedEvents]);
        countCacheProbe('supplementalEventsExecuted');
      } else {
        countCacheProbe('supplementalEventsSkippedEmpty');
      }
      notifyEventsChanged();
    },
  })
    .then((result) => {
      logTimelineDebug(debugTraceId, 'thread-reconcile-settled', {
        current: isCurrentThreadOpen(),
        fetchedCount: result.fetchedCount,
        repaired: result.repaired,
        durable: result.durable,
        aborted: result.aborted,
      });
    })
    .catch((err) => {
      logTimelineDebug(debugTraceId, 'thread-reconcile-error');
      // CINNY-207 AC2 review F6 (2026-07-04): the scheduler's own
      // rejection paths already bump `schedulerFailed` /
      // `schedulerAborted`, so this catch used to silently return
      // undefined to avoid an unhandled promise rejection. That left a
      // triage ambiguity: from a browser log you couldn't tell WHICH
      // rejection this was, only that one had happened. A single warn
      // line here names the site without changing behavior — the
      // counters remain the source of truth for aggregate counts.
      // eslint-disable-next-line no-console
      console.warn('[thread-open-choke-point] scheduleReconcile rejected', err);
    });

  const cachedThreadHasLocalSnapshot =
    !!hydratedCachedPage &&
    hasUsableThreadCacheSnapshot({
      eventCount: hydratedCachedPage.events.length,
      rootPresent: !!hydratedCachedPage.rootEvent,
    });

  if (shouldScrollToLatestOnOpen && !cachedThreadHasLocalSnapshot) {
    threadOpenSeedSession.applyInitialUntargetedThreadSeed();
  }

  const hasCompleteCachedThreadSnapshot =
    shouldScrollToLatestOnOpen &&
    !!hydratedCachedPage &&
    isCompleteThreadCacheCoverage({
      coverage: hydratedCachedPage.cacheCoverage,
      hasLocalSnapshot: cachedThreadHasLocalSnapshot,
    });

  onCacheHydrated(hasCompleteCachedThreadSnapshot);

  if (hasCompleteCachedThreadSnapshot && hydratedCachedPage) {
    notifyEventsChanged();
    logTimelineDebug(debugTraceId, 'thread-open-complete-cache-hit', {
      cachedCount: hydratedCachedPage.events.length,
      threadId,
    });
    logTimelineDebug(debugTraceId, 'thread-open-complete', {
      shouldScrollToLatestOnOpen,
      threadId,
    });
    // CINNY-207 AC2 revision (2026-07-04): the branch-local reconcile
    // schedule that used to live here has been relocated to the
    // choke-point call above (after the post-hydrate guard). D7 says
    // coverage decides PAINT, never REVALIDATE — the schedule sits
    // above the coverage branching now, so this branch only PAINTS
    // and returns.
    pinThreadToBottomOnOpen();
    return {
      hydratedCachedPage,
      shouldContinue: false,
    };
  }

  // 2026-07-06 consolidation: the open-time relations-backfill leg that
  // used to sit here (a second FULL /relations drain for genuinely
  // partial snapshots, racing the SDK-bootstrap drain below when it
  // did not complete) was deleted. Post-#84 the background prefetch
  // (deep-history sweep + prewarm band) and the choke-point reconcile
  // above own convergence; a partial snapshot simply paints what it
  // has and falls through to SDK bootstrap + refreshLatestThreadSlice
  // — the single fallback drain channel.
  return {
    hydratedCachedPage,
    shouldContinue: true,
  };
};
