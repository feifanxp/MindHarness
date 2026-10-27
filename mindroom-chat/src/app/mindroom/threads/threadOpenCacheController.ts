import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import to from 'await-to-js';
import { THREAD_BATCH_SIZE } from './preloadSettings';
import { logTimelineDebug } from './timelineDebug';
import { getLinkedTimelines, getThreadTimelineEvents } from './linkedTimelines';
import { reconcileThreadBackwardPagination } from './threadPaginationUtils';
import { createPreferLiveEventMapper, loadThreadCachedSnapshot } from './eventRepository';
import { MAX_THREAD_FETCH_ITERATIONS } from './threadBootstrap';
import {
  getAuthoritativeCachedThreadReplyCount,
  isCompleteCachedThreadSnapshot,
} from './threadCacheSnapshot';
import { buildThreadCacheCoverage } from './threadCacheCoverage';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { getKnownThreadReplyCount } from './threadRecord';
import type { HydratedThreadCachePage } from './types';

import type { PersistThreadEventCache } from '../engine/enginePersistFacade';

export type ThreadCacheRuntime = {
  mx: MatrixClient;
  room: Room;
  sessionId: string;
  debugTraceId?: string;
  isCurrentThread: (threadId: string) => boolean;
};
export const hydrateThreadFromCache = async (
  { mx, room, sessionId, debugTraceId, isCurrentThread }: ThreadCacheRuntime,
  expectedThreadId: string
): Promise<HydratedThreadCachePage | undefined> => {
  logTimelineDebug(debugTraceId, 'thread-cache-hydrate-start', {
    limit: THREAD_BATCH_SIZE,
    threadId: expectedThreadId,
  });
  const mapper = mx.getEventMapper();
  const cachedSnapshot = await loadThreadCachedSnapshot({
    sessionId,
    roomId: room.roomId,
    threadId: expectedThreadId,
    // CINNY-207 PR #72 review (greptile P2): paint-time cache reads
    // use the interactive batch bound. `prefetchDepth` (default
    // 10_000) governs only the BACKGROUND deep-history job — using
    // it here paged thousands of IDB records into memory before
    // first paint on deep threads.
    limit: THREAD_BATCH_SIZE,
    maxPages: MAX_THREAD_FETCH_ITERATIONS,
    mapEvent: createPreferLiveEventMapper(room, mapper),
    shouldContinue: () => isCurrentThread(expectedThreadId),
    onPage: (page, pageIndex, snapshot) => {
      logTimelineDebug(debugTraceId, 'thread-cache-hydrate-page', {
        beforeToken: page.beforeToken ?? null,
        cachedCount: page.events.length,
        expectedReplyCount: snapshot.expectedReplyCount ?? null,
        hasMoreBefore: page.hasMoreBefore,
        pageIndex,
        relationSnapshotComplete: snapshot.relationSnapshotComplete === true,
        rootPresent: !!page.rootEvent,
        snapshotComplete: snapshot.snapshotComplete === true,
        tailLoaded: snapshot.tailLoaded === true,
        threadId: expectedThreadId,
      });
    },
  });
  if (!cachedSnapshot) return undefined;
  const cachedPage = cachedSnapshot.cachedPage;
  const cachedSnapshotComplete = cachedPage.snapshotComplete === true;
  const cachedRelationSnapshotComplete = cachedPage.relationSnapshotComplete === true;
  const tailLoaded = cachedPage.tailLoaded === true;

  if (!isCurrentThread(expectedThreadId)) return undefined;

  const cachedEvents = cachedSnapshot.events;
  const liveRootMatrixEvent =
    room.getThread(expectedThreadId)?.rootEvent ??
    room.findEventById(expectedThreadId) ??
    undefined;
  const cachedRootMatrixEvent =
    cachedEvents.find((mEvent) => mEvent.getId() === expectedThreadId) ?? undefined;
  const authoritativeExpectedReplyCount = getAuthoritativeCachedThreadReplyCount({
    rootEvent: liveRootMatrixEvent,
    cachedRootEvent: cachedRootMatrixEvent,
    expectedReplyCount: cachedPage.expectedReplyCount,
  });
  const snapshotComplete = isCompleteCachedThreadSnapshot({
    room,
    threadId: expectedThreadId,
    rootEvent: liveRootMatrixEvent,
    cachedRootEvent: cachedRootMatrixEvent,
    cachedEvents,
    beforeToken: cachedPage.beforeToken,
    hasMoreBefore: cachedPage.hasMoreBefore,
    expectedReplyCount: authoritativeExpectedReplyCount,
    snapshotComplete: cachedSnapshotComplete,
    tailLoaded,
  });
  const cacheCoverage = buildThreadCacheCoverage({
    eventCount: cachedEvents.length + (cachedRootMatrixEvent ? 1 : 0),
    backwardToken: cachedPage.beforeToken,
    hasMoreBackward: cachedPage.hasMoreBefore || typeof cachedPage.beforeToken === 'string',
    expectedReplyCount: authoritativeExpectedReplyCount,
    relationSnapshotComplete: cachedRelationSnapshotComplete,
    snapshotComplete,
    tailLoaded,
  });
  if (cachedEvents.length === 0) {
    logTimelineDebug(debugTraceId, 'thread-cache-hydrate-empty', {
      tailLoaded,
      threadId: expectedThreadId,
    });
    return {
      ...cachedPage,
      cacheCoverage,
      expectedReplyCount: authoritativeExpectedReplyCount,
      relationSnapshotComplete: cachedRelationSnapshotComplete,
      snapshotComplete,
      tailLoaded,
    };
  }

  saveThreadOpenSeedSnapshot(room, expectedThreadId, cachedEvents);
  logTimelineDebug(debugTraceId, 'thread-cache-hydrate-applied', {
    appliedCount: cachedEvents.length,
    expectedReplyCount: authoritativeExpectedReplyCount ?? null,
    hasMoreBefore: cachedPage.hasMoreBefore,
    relationSnapshotComplete: cachedRelationSnapshotComplete,
    snapshotComplete,
    tailLoaded,
    threadId: expectedThreadId,
  });
  // CINNY-207 P5-GATE-FIX v2 (AC2 instance-race): expose the exact
  // MatrixEvent instances the render layer just received via
  // `setSupplementalThreadEvents`. These cached clones can render
  // before SDK bootstrap finishes, so the reconciler must apply
  // `makeReplaced`/`makeRedacted` against them (not fresh remaps)
  // for the repair to become visible. See engine/reconciler.ts.
  return {
    ...cachedPage,
    cacheCoverage,
    expectedReplyCount: authoritativeExpectedReplyCount,
    hydratedEvents: cachedEvents,
    hydratedRootEvent: cachedRootMatrixEvent,
    relationSnapshotComplete: cachedRelationSnapshotComplete,
    snapshotComplete,
    tailLoaded,
  };
};
export type ThreadLatestSlice = { events: MatrixEvent[]; hasMoreCachedBack?: boolean };
export const refreshLatestThreadSlice = async (
  {
    mx,
    room,
    debugTraceId,
    persistThreadEventCache,
    shouldAbortRefresh,
  }: {
    mx: MatrixClient;
    room: Room;
    debugTraceId?: string;
    persistThreadEventCache: PersistThreadEventCache;
    shouldAbortRefresh: () => boolean;
  },
  expectedThreadId: string,
  opts?: { allowWhenThreadClosed?: boolean }
): Promise<ThreadLatestSlice | undefined> => {
  logTimelineDebug(debugTraceId, 'thread-refresh-latest-start');
  const allowWhenThreadClosed = opts?.allowWhenThreadClosed === true;
  let currentThread = room.getThread(expectedThreadId);
  if (!currentThread && allowWhenThreadClosed) {
    const [threadErr] = await to(
      mx.getThreadTimeline(room.getUnfilteredTimelineSet(), expectedThreadId)
    );
    if (threadErr) return undefined;
    currentThread = room.getThread(expectedThreadId);
  }
  if (!currentThread) return undefined;
  const threadTimelineSet = currentThread.getUnfilteredTimelineSet();
  for (let iteration = 0; iteration < MAX_THREAD_FETCH_ITERATIONS; iteration += 1) {
    if (shouldAbortRefresh()) return undefined;

    const linkedTimelines = getLinkedTimelines(threadTimelineSet.getLiveTimeline());
    const firstTimeline = linkedTimelines[0];
    if (!firstTimeline?.getPaginationToken(Direction.Backward)) break;

    const [err, didPaginate] = await to(
      mx.paginateEventTimeline(firstTimeline, {
        backwards: true,
        limit: THREAD_BATCH_SIZE,
      })
    );
    if (err || didPaginate === false) break;
  }

  if (shouldAbortRefresh()) return undefined;

  const allEvents = getThreadTimelineEvents(currentThread);
  const rootEvent = currentThread.rootEvent ?? room.findEventById(expectedThreadId);
  const firstThreadTimeline = getLinkedTimelines(threadTimelineSet.getLiveTimeline())[0];
  const backwardToken = firstThreadTimeline?.getPaginationToken(Direction.Backward) ?? null;
  const snapshotComplete = isCompleteCachedThreadSnapshot({
    room,
    threadId: expectedThreadId,
    rootEvent: rootEvent ?? undefined,
    cachedRootEvent: rootEvent ?? undefined,
    cachedEvents: rootEvent ? [rootEvent, ...allEvents] : allEvents,
    beforeToken: backwardToken,
    hasMoreBefore: typeof backwardToken === 'string',
    expectedReplyCount: rootEvent ? getKnownThreadReplyCount(rootEvent) : undefined,
    snapshotComplete: typeof backwardToken !== 'string',
    tailLoaded: true,
  });

  if (allEvents.length > 0) {
    saveThreadOpenSeedSnapshot(room, expectedThreadId, allEvents);
    persistThreadEventCache(
      expectedThreadId,
      allEvents,
      rootEvent,
      backwardToken,
      true,
      snapshotComplete
    );
  }

  let hasMoreCachedBack: boolean | undefined;
  if (firstThreadTimeline) {
    reconcileThreadBackwardPagination(firstThreadTimeline, backwardToken, (value) => {
      hasMoreCachedBack = value;
    });
  }

  logTimelineDebug(debugTraceId, 'thread-refresh-latest-complete', {
    snapshotComplete,
    persistedCount: allEvents.length,
    tailLoaded: true,
    threadId: expectedThreadId,
    backwardTokenPresent: typeof backwardToken === 'string',
  });
  return { events: allEvents, hasMoreCachedBack };
};
