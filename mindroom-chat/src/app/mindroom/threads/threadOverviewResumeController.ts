import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { type MatrixClient, type Room } from 'matrix-js-sdk';
import { usePageResume } from './usePageResume';
import { loadRoomThreads } from './roomThreadList';
import { logTimelineDebug } from './timelineDebug';
import { type MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { fetchAndPersistThreadContent } from './threadContentPrefetch';
import { resolveThreadOverviewRefreshTargets } from './threadOverviewRefreshTargets';
import type { TimelineEventEntry } from './roomTimelineEvents';
import type { Timeline } from './timelinePagination';
import type { FetchedRelationOverviewUpdateOptions } from './threadOverviewCacheHydration';
import { useMindroomSyncEngine } from '../engine';
import { getThreadSummaryStateSnapshot } from './threadSummaryState';

import type { PersistThreadEventCache } from '../engine/enginePersistFacade';

export const useThreadOverviewResumeController = ({
  alive,
  activeTimelineRange,
  compactFilteredThreadRootIds,
  compactViewRequested,
  debugTraceId,
  filteredThreadRootIds,
  limit,
  mx,
  onStoreThreadSummary,
  onApplyThreadRelations,
  beginThreadCacheWrite,
  refreshCompactThreadList,
  room,
  sessionId,
  setOverviewRefreshCounter,
  showCompactRoomView,
  threadFilteredEventEntries,
  threadId,
  threadIdRef,
  threadReplyCountMap,
  threadResolutionMap,
}: {
  alive: () => boolean;
  activeTimelineRange: Timeline['range'];
  compactFilteredThreadRootIds: string[];
  compactViewRequested: boolean;
  debugTraceId: string;
  filteredThreadRootIds: string[];
  limit: number;
  mx: MatrixClient;
  onStoreThreadSummary: (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => void;
  onApplyThreadRelations: (options: FetchedRelationOverviewUpdateOptions) => void;
  beginThreadCacheWrite: () => PersistThreadEventCache;
  refreshCompactThreadList: () => Promise<void>;
  room: Room;
  sessionId: string;
  setOverviewRefreshCounter: Dispatch<SetStateAction<number>>;
  showCompactRoomView: boolean;
  threadFilteredEventEntries: TimelineEventEntry[];
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
}): void => {
  const syncEngine = useMindroomSyncEngine();
  // CINNY-207 P4.4: the `overviewResumeRefreshInFlightRef` and
  // `pendingOverviewResumeRefreshRef` in-flight-guards are gone —
  // per-thread fetch dedup is now the engine scheduler's job
  // (kind: 'thread-backfill'), and the resume trigger is naturally
  // rate-limited by the 1s window below plus the scheduler's dedup.
  const lastOverviewResumeRefreshTsRef = useRef(0);
  const overviewRefreshAbortControllerRef = useRef<AbortController>();
  const { overviewResumeRefreshIds: targetThreadIds } = useMemo(
    () =>
      resolveThreadOverviewRefreshTargets({
        activeTimelineRange,
        compactFilteredThreadRootIds,
        filteredThreadRootIds,
        limit,
        room,
        showCompactRoomView,
        threadFilteredEventEntries,
        threadId,
        threadReplyCountMap,
        threadResolutionMap,
      }),
    [
      activeTimelineRange,
      compactFilteredThreadRootIds,
      filteredThreadRootIds,
      limit,
      room,
      showCompactRoomView,
      threadFilteredEventEntries,
      threadId,
      threadReplyCountMap,
      threadResolutionMap,
    ]
  );

  useEffect(() => {
    lastOverviewResumeRefreshTsRef.current = 0;
  }, [room.roomId]);

  useEffect(() => {
    if (threadId) {
      overviewRefreshAbortControllerRef.current = undefined;
      return undefined;
    }

    const abortController = new AbortController();
    overviewRefreshAbortControllerRef.current = abortController;
    return () => {
      abortController.abort();
      if (overviewRefreshAbortControllerRef.current === abortController) {
        overviewRefreshAbortControllerRef.current = undefined;
      }
    };
  }, [compactViewRequested, room, threadId]);

  // CINNY-207 P4.4: route each per-thread refresh through the engine
  // scheduler as a `thread-backfill` job. AC8 dedup means a resume
  // that triggers during an in-flight overview refresh — or two
  // resume-driven refreshes for the same thread from different code
  // paths — reuses the same promise instead of firing two /relations
  // requests. The rest of the callback (parse response, persist,
  // notify onApplyThreadRelations) stays exactly the same shape it
  // had before; only the fetch is deduped.
  // CINNY-207 P5 review (greptile P1: dedup returns void):
  // both this overview-resume producer AND `enqueueThreadBackfillJob`
  // (the thread-open path in `threadOpenCacheController.ts`) share
  // scheduler key `(roomId, threadId, 'thread-backfill')`. Before this
  // refactor they enqueued executors with DIFFERENT return types —
  // this one `Promise<void>`, the other `Promise<ThreadBackfillResult>`.
  // If the two callers hit the scheduler in the wrong order, the open
  // path would receive our void promise, resolve as `undefined`, and
  // its `!relationPageResult` guard would silently skip applying the
  // relation page fetched by us.
  //
  // Fix: both producers now enqueue through `enqueueThreadBackfillJob`
  // (single source of truth for the shared kind) so the dedup contract
  // is: the promise ALWAYS resolves to `ThreadBackfillResult`. Any
  // caller that needs to do more with the page (persist / notify /
  // seed) does it in a `.then()` on that promise, using the shared
  // result. That keeps the dedup benefit — a user-triggered thread
  // open coalescing with a background overview resume still fires a
  // single `/relations` round-trip — without the type mismatch.
  // 2026-07-06 eager-cache fix: the fetch→persist→seed pipeline moved
  // to the shared `fetchAndPersistThreadContent` so this resume path
  // and the thread-seed prewarm band (cold-start content prefetch)
  // stay one implementation. Behavior here is unchanged.
  const refreshOverviewThreadCacheFromRelations = useCallback(
    async (expectedThreadId: string, shouldApply: () => boolean): Promise<void> => {
      await fetchAndPersistThreadContent({
        mx,
        scheduler: syncEngine.scheduler,
        room,
        threadId: expectedThreadId,
        // Priority 2 = "recently-active my-server tails" band. Overview
        // resume is user-triggered (page focus / online / visibility)
        // so it beats prewarm (band 3) but yields to the current
        // room's own gap-fill (band 0-1).
        priority: 2,
        // This scheduler job may be shared with another consumer. Let the
        // engine own its cancellation and release only this view's apply path.
        shouldApply,
        getCurrentThreadSummary: (threadRootId) =>
          getThreadSummaryStateSnapshot(sessionId, room.roomId).get(threadRootId),
        beginThreadCacheWrite,
        onApplyThreadRelations,
        onStoreThreadSummary,
      });
    },
    [
      mx,
      onApplyThreadRelations,
      onStoreThreadSummary,
      beginThreadCacheWrite,
      room,
      sessionId,
      syncEngine,
    ]
  );

  const refreshOverviewThreadsOnResume = useCallback(
    (reason: 'focus' | 'online' | 'pageshow' | 'visibility') => {
      if (threadId) return;
      if (!compactViewRequested && targetThreadIds.length === 0) return;

      const now = Date.now();
      if (now - lastOverviewResumeRefreshTsRef.current < 1_000) return;
      lastOverviewResumeRefreshTsRef.current = now;

      // CINNY-207 P4.4: no more in-flight/pending refs. The scheduler
      // dedupes per (roomId, threadId, 'thread-backfill'), so
      // launching a new resume while a previous one is still draining
      // is safe — each per-thread job returns the existing in-flight
      // promise. The 1s rate-limit above still guards against
      // burst-fire from stacked resume signals (visibility + focus
      // firing in quick succession).
      const runRefresh = async () => {
        const signal = overviewRefreshAbortControllerRef.current?.signal;
        if (!signal || signal.aborted) return;
        const shouldContinueRefresh = () => !signal.aborted && alive() && !threadIdRef.current;
        logTimelineDebug(debugTraceId, 'overview-thread-resume-refresh-start', {
          compactViewRequested,
          reason,
          targetCount: targetThreadIds.length,
        });

        try {
          if (compactViewRequested) {
            await refreshCompactThreadList();
          } else {
            await loadRoomThreads(room, undefined, signal);
          }

          if (!shouldContinueRefresh()) return;

          for (const expectedThreadId of targetThreadIds) {
            if (!shouldContinueRefresh()) return;
            // eslint-disable-next-line no-await-in-loop
            await refreshOverviewThreadCacheFromRelations(expectedThreadId, shouldContinueRefresh);
            if (!shouldContinueRefresh()) return;
          }

          if (!shouldContinueRefresh()) return;
          setOverviewRefreshCounter((value) => value + 1);
          logTimelineDebug(debugTraceId, 'overview-thread-resume-refresh-complete', {
            compactViewRequested,
            reason,
            targetCount: targetThreadIds.length,
          });
        } catch (error) {
          logTimelineDebug(debugTraceId, 'overview-thread-resume-refresh-error', {
            compactViewRequested,
            error: error instanceof Error ? error.message : String(error),
            reason,
            targetCount: targetThreadIds.length,
          });
        }
      };

      void runRefresh();
    },
    [
      alive,
      compactViewRequested,
      debugTraceId,
      refreshCompactThreadList,
      refreshOverviewThreadCacheFromRelations,
      room,
      setOverviewRefreshCounter,
      targetThreadIds,
      threadId,
      threadIdRef,
    ]
  );

  usePageResume(refreshOverviewThreadsOnResume);
};
