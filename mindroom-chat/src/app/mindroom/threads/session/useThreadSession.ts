import { useEffect, useRef, useState } from 'react';
import { Direction } from 'matrix-js-sdk';
import { countCacheProbe } from '../cacheProbe';
import { logTimelineDebug } from '../timelineDebug';
import { isLocalEchoEventId } from '../threadRouteUtils';
import { hydrateThreadFromCache, refreshLatestThreadSlice } from '../threadOpenCacheController';
import { getLinkedTimelines, getThreadTimelineEvents } from '../linkedTimelines';
import { hasThreadCacheBackwardGap } from '../threadCacheCoverage';
import { createThreadOpenSeedSession } from '../threadOpenSeedController';
import { runThreadOpenCacheFirst } from '../threadOpenCacheFirst';
import {
  reconcileCachedThreadBackwardToken,
  runThreadOpenSdkBootstrap,
} from '../threadOpenSdkBootstrap';
import { runThreadOpenTargetEvent } from '../threadOpenTargetEvent';
import type {
  PendingThreadTarget,
  ThreadOpenRuntime,
  ThreadRoute,
  ThreadSession,
  ThreadSessionSnapshot,
  ThreadTargetCommands,
  ThreadSessionCommands,
} from './threadSessionTypes';

const initialState = {
  open: {
    loadError: false,
    initialCacheHydrated: false,
    sdkReady: false,
    latestPending: false,
    editResetEpoch: 0,
  },
  history: { hasMoreCachedBack: false, tailLoaded: false },
  timelineRevision: 0,
  targetRevision: 0,
};

/** State initializes before indexes and viewport consumers; opening installs separately. */
export const useThreadSession = (route: ThreadRoute): ThreadSession => {
  const [state, publish] = useState<Omit<ThreadSessionSnapshot, 'route'>>(initialState);
  const routeRef = useRef(route);
  const lifetime = useRef({ generation: 0, alive: true });
  const runtimeRef = useRef<ThreadOpenRuntime>();
  if (routeRef.current.roomId !== route.roomId || routeRef.current.threadId !== route.threadId) {
    lifetime.current.generation += 1;
    runtimeRef.current = undefined;
  }
  routeRef.current = route;
  useEffect(() => {
    const currentLifetime = lifetime.current;
    currentLifetime.alive = true;
    return () => {
      currentLifetime.alive = false;
      currentLifetime.generation += 1;
      runtimeRef.current = undefined;
    };
  }, []);

  const [operations] = useState(() => {
    let pending: PendingThreadTarget | undefined;
    let pendingCallback: ((success: boolean) => void) | undefined;
    let nextRequestId = 0;
    let editResetEpoch = 0;
    const targets: ThreadTargetCommands = {
      getPending: () => pending,
      queue: ({ onScroll, ...input }) => {
        pending = { ...input, requestId: ++nextRequestId, attempts: 0 };
        pendingCallback = onScroll;
        publish((current) => ({ ...current, targetRevision: current.targetRevision + 1 }));
      },
      complete: (requestId, success) => {
        if (pending?.requestId !== requestId) return;
        const callback = pendingCallback;
        pending = undefined;
        pendingCallback = undefined;
        callback?.(success);
      },
      discard: (requestId) => {
        if (pending?.requestId !== requestId) return;
        pending = undefined;
        pendingCallback = undefined;
      },
      advanceAttempt: (requestId) => {
        if (pending?.requestId !== requestId) return;
        pending = { ...pending, attempts: pending.attempts + 1 };
      },
      wakeRetry: (requestId) => {
        if (pending?.requestId !== requestId) return;
        publish((current) => ({ ...current, targetRevision: current.targetRevision + 1 }));
      },
    };
    const reset = () => {
      editResetEpoch += 1;
      pending = undefined;
      pendingCallback = undefined;
      publish({
        ...initialState,
        open: { ...initialState.open, editResetEpoch },
      });
    };
    const notifyEventsChanged = () => {
      publish((current) => ({ ...current, timelineRevision: current.timelineRevision + 1 }));
    };
    const refreshLatest: ThreadSessionCommands['refreshLatest'] = async (
      threadId,
      runtime,
      options
    ) => {
      const shouldAbortRefresh = () => {
        const current = routeRef.current;
        if (!lifetime.current.alive || current.roomId !== runtime.room.roomId) return true;
        return options?.allowWhenThreadClosed
          ? !!current.threadId && current.threadId !== threadId
          : current.threadId !== threadId;
      };
      const result = await refreshLatestThreadSlice(
        {
          ...runtime,
          persistThreadEventCache: runtime.beginCacheWrite(),
          shouldAbortRefresh,
        },
        threadId,
        options
      );
      if (!result || shouldAbortRefresh()) return false;
      if (result.events.length > 0) runtime.render.append(threadId, result.events);
      publish((current) => ({
        ...current,
        history: {
          hasMoreCachedBack: result.hasMoreCachedBack ?? current.history.hasMoreCachedBack,
          tailLoaded: true,
        },
      }));
      runtime.render.invalidateTimeline();
      notifyEventsChanged();
      return true;
    };
    const commands: ThreadSessionCommands = {
      captureLease: () => {
        const current = routeRef.current;
        if (!lifetime.current.alive || !runtimeRef.current || !current.threadId) return undefined;
        return {
          roomId: current.roomId,
          threadId: current.threadId,
          generation: lifetime.current.generation,
        };
      },
      isCurrent: (lease) =>
        lifetime.current.alive &&
        !!runtimeRef.current &&
        lease.roomId === routeRef.current.roomId &&
        lease.threadId === routeRef.current.threadId &&
        lease.generation === lifetime.current.generation,
      notifyEventsChanged,
      readEditResetEpoch: () => editResetEpoch,
      refreshLatest,
      beginManualHistoryRead: () => {
        publish((current) => ({ ...current, open: { ...current.open, latestPending: false } }));
      },
      commitPage: (lease, page) => {
        if (!commands.isCurrent(lease)) return false;
        const runtime = runtimeRef.current!;
        if (page.kind === 'back-cache') runtime.render.append(lease.threadId, page.events);
        publish((current) => ({
          ...current,
          history:
            page.kind === 'front-network'
              ? { ...current.history, tailLoaded: page.tailLoaded }
              : { ...current.history, hasMoreCachedBack: page.hasMoreCachedBack },
        }));
        runtime.render.invalidateTimeline();
        notifyEventsChanged();
        return true;
      },
      markBackwardExhausted: (lease) => {
        if (!commands.isCurrent(lease)) return;
        publish((current) => ({
          ...current,
          history: { ...current.history, hasMoreCachedBack: false },
        }));
      },
      observeLiveTail: (threadId) => {
        if (routeRef.current.threadId !== threadId) return;
        publish((current) => ({ ...current, history: { ...current.history, tailLoaded: true } }));
      },
      leaveThread: (runtime) => {
        runtimeRef.current = undefined;
        reset();
        runtime.viewport.resetAfterLeave();
        runtime.render.reset(undefined);
      },
      startOpen: (runtime) => {
        const { threadId, eventId } = routeRef.current;
        if (!threadId) return () => undefined;
        runtimeRef.current = runtime;
        const { room, mx, render, viewport, debugTraceId } = runtime;
        logTimelineDebug(debugTraceId, 'thread-open-start', {
          shouldScrollToLatestOnOpen: !eventId,
        });
        if (isLocalEchoEventId(threadId)) {
          const localRoot = room.findEventById(threadId);
          if (localRoot) render.append(threadId, [localRoot]);
          logTimelineDebug(debugTraceId, 'thread-open-complete', { skipNetworkBootstrap: true });
          logTimelineDebug(debugTraceId, 'thread-open-settled', { current: true });
          return () => logTimelineDebug(debugTraceId, 'thread-open-close');
        }
        countCacheProbe('threadOpens');
        viewport.resetForOpen();
        reset();
        render.reset(threadId);
        const shouldScrollToLatestOnOpen = !eventId;
        const threadOpenSeedSession = createThreadOpenSeedSession({
          debugTraceId,
          seed: runtime.seed,
          room,
          roomTimelineSet: room.getUnfilteredTimelineSet(),
          setSupplementalThreadEvents: render.append,
          shouldScrollToLatestOnOpen,
          threadId,
        });
        let mounted = true;
        const isCurrentThreadOpen = () =>
          mounted &&
          lifetime.current.alive &&
          routeRef.current.roomId === room.roomId &&
          routeRef.current.threadId === threadId;
        const pinThreadToBottomOnOpen = () => {
          if (isCurrentThreadOpen()) viewport.requestLatestPin();
        };
        const invalidateEvents = () => {
          render.invalidateTimeline();
          notifyEventsChanged();
        };
        threadOpenSeedSession.startUntargetedSeedPrewarmWait(isCurrentThreadOpen);
        if (!shouldScrollToLatestOnOpen) threadOpenSeedSession.applyInitialRoomThreadSeed();
        publish((current) => ({
          ...current,
          open: { ...current.open, latestPending: shouldScrollToLatestOnOpen },
        }));
        const persistThreadEventCache = runtime.beginCacheWrite();
        let cacheResult: Awaited<ReturnType<typeof runThreadOpenCacheFirst>> | undefined;
        let liveProgressed = false;
        let networkLoadError = false;
        let cacheComplete: boolean | undefined;
        const cacheWork = runThreadOpenCacheFirst({
          debugTraceId,
          room,
          threadId,
          shouldScrollToLatestOnOpen,
          threadOpenSeedSession,
          isCurrentThreadOpen,
          pinThreadToBottomOnOpen,
          scheduleReconcile: runtime.reconcile,
          setSupplementalThreadEvents: render.append,
          notifyEventsChanged: invalidateEvents,
          hydrateThreadFromCache: async (expectedThreadId) => {
            const page = await hydrateThreadFromCache(
              {
                ...runtime,
                isCurrentThread: (id) => isCurrentThreadOpen() && id === threadId,
              },
              expectedThreadId
            );
            if (!page || !isCurrentThreadOpen()) return undefined;
            if (!liveProgressed) {
              publish((current) => ({
                ...current,
                history: {
                  ...current.history,
                  hasMoreCachedBack: hasThreadCacheBackwardGap(page.cacheCoverage),
                },
              }));
            }
            if (page.hydratedEvents?.length) {
              render.append(expectedThreadId, page.hydratedEvents);
              invalidateEvents();
            }
            return page;
          },
          onCacheHydrated: (complete) => {
            cacheComplete = complete;
            publish((current) => ({
              ...current,
              open: {
                ...current.open,
                initialCacheHydrated: true,
                loadError: networkLoadError && !complete,
                latestPending: complete ? false : current.open.latestPending,
              },
              history:
                complete && !liveProgressed
                  ? { hasMoreCachedBack: false, tailLoaded: true }
                  : current.history,
            }));
          },
        }).then((result) => {
          cacheResult = result;
        });
        void cacheWork.catch(() => logTimelineDebug(debugTraceId, 'thread-cache-hydrate-error'));

        // Storage can stall independently of the homeserver. Start server loading now;
        // only a cache result already available at the join may guide pagination.
        const load = async () => {
          try {
            const shouldContinue = await runThreadOpenSdkBootstrap({
              debugTraceId,
              room,
              mx,
              threadId,
              shouldScrollToLatestOnOpen,
              isMounted: isCurrentThreadOpen,
              pinThreadToBottomOnOpen,
              onThreadLoadError: runtime.onThreadLoadError,
              persistThreadEventCache,
              setSupplementalThreadEvents: render.append,
              onBootstrap: (observation) => {
                if (!isCurrentThreadOpen()) return;
                if (observation.kind === 'load-error') {
                  networkLoadError = true;
                  publish((current) => ({
                    ...current,
                    open: { ...current.open, loadError: cacheComplete !== true },
                  }));
                } else if (observation.kind === 'root-ready') {
                  publish((current) => ({ ...current, open: { ...current.open, sdkReady: true } }));
                  commands.observeLiveTail(threadId);
                  invalidateEvents();
                } else {
                  publish((current) => ({
                    ...current,
                    history: {
                      ...current.history,
                      hasMoreCachedBack: observation.hasMoreCachedBack,
                    },
                  }));
                }
              },
            });
            if (!isCurrentThreadOpen()) return;
            if (!shouldContinue) return;
            liveProgressed = true;
            publish((current) => ({ ...current, open: { ...current.open, sdkReady: true } }));
            const cachedPage = cacheResult?.hydratedCachedPage;
            const thread = room.getThread(threadId);
            const firstTimeline = thread
              ? getLinkedTimelines(thread.getUnfilteredTimelineSet().getLiveTimeline())[0]
              : undefined;
            const threadEvents = thread ? getThreadTimelineEvents(thread) : [];
            if (cacheResult?.shouldContinue === false) {
              if (cachedPage?.relationSnapshotComplete) {
                firstTimeline?.setPaginationToken(null, Direction.Backward);
              } else if (cachedPage) {
                // A complete page starts at the root. Where it reaches back past the SDK's loaded
                // replies, the SDK cursor only says older relation events may exist, and Tuwunel
                // returns one with every non-empty relations page.
                reconcileCachedThreadBackwardToken({
                  cachedPage: { ...cachedPage, beforeToken: null },
                  firstThreadTimeline: firstTimeline,
                  threadEvents,
                  threadId,
                });
              }
              if (
                cachedPage?.relationSnapshotComplete ||
                firstTimeline?.getPaginationToken(Direction.Backward) === null
              ) {
                publish((current) => ({
                  ...current,
                  history: { ...current.history, hasMoreCachedBack: false },
                }));
                invalidateEvents();
              }
              return;
            }
            reconcileCachedThreadBackwardToken({
              cachedPage,
              firstThreadTimeline: firstTimeline,
              threadEvents,
              threadId,
            });
            if (shouldScrollToLatestOnOpen) {
              await refreshLatest(threadId, {
                ...runtime,
                beginCacheWrite: () => persistThreadEventCache,
              });
              if (!isCurrentThreadOpen()) return;
            } else {
              const hasForwardGap = !!room
                .getThread(threadId)
                ?.getUnfilteredTimelineSet()
                .getLiveTimeline()
                .getPaginationToken(Direction.Forward);
              if (!hasForwardGap) commands.observeLiveTail(threadId);
              logTimelineDebug(debugTraceId, 'thread-open-forward-gap-check', {
                hasForwardGap,
                threadId,
              });
            }
            invalidateEvents();
            logTimelineDebug(debugTraceId, 'thread-open-complete', {
              shouldScrollToLatestOnOpen,
              threadId,
            });
            if (shouldScrollToLatestOnOpen) pinThreadToBottomOnOpen();
            await runThreadOpenTargetEvent({
              eventId,
              notifyEventsChanged: invalidateEvents,
              isCurrentThreadOpen,
              mx,
              room,
              targets,
              shouldScrollToLatestOnOpen,
              threadId,
            });
          } finally {
            logTimelineDebug(debugTraceId, 'thread-open-settled', {
              current: isCurrentThreadOpen(),
            });
            if (isCurrentThreadOpen()) {
              publish((current) => ({
                ...current,
                open: { ...current.open, latestPending: false },
              }));
            }
          }
        };
        void load().catch(() => logTimelineDebug(debugTraceId, 'thread-open-error'));
        return () => {
          logTimelineDebug(debugTraceId, 'thread-open-close');
          mounted = false;
          threadOpenSeedSession.cleanup();
        };
      },
    };
    return { commands, targets };
  });
  return { snapshot: { ...state, route }, ...operations };
};
