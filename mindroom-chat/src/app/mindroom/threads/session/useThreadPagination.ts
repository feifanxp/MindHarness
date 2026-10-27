import { useEffect, useState } from 'react';
import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import to from 'await-to-js';
import { THREAD_BATCH_SIZE } from '../preloadSettings';
import { getLinkedTimelines, getThreadTimelineEvents } from '../linkedTimelines';
import {
  findEarliestLoadedThreadReplyByCacheOrder,
  reconcileThreadBackwardPagination,
} from '../threadPaginationUtils';
import {
  createPreferLiveEventMapper,
  getThreadCursorAnchor,
  loadThreadCachedPaginationSnapshot,
} from '../eventRepository';
import { countCacheProbe } from '../cacheProbe';
import { compareCachedPaginationAnchors } from '../eventCacheTokenUtils';
import type { PersistThreadEventCache } from '../../engine/enginePersistFacade';
import type {
  ThreadPagination,
  ThreadPaginationRequest,
  ThreadPrependViewportPort,
  ThreadRoute,
  ThreadSessionCommands,
} from './threadSessionTypes';

export type ThreadPaginationRuntime = {
  mx: MatrixClient;
  room: Room;
  sessionId: string;
  beginThreadCacheWrite: () => PersistThreadEventCache;
  thread: Thread | null | undefined;
  threadEvents: MatrixEvent[];
  threadHasMoreCachedBack: boolean;
  viewport: ThreadPrependViewportPort;
};

/** Pending state initializes before virtualizer reads; runtime binds after viewport setup. */
export const useThreadPagination = (session: ThreadSessionCommands, route: ThreadRoute) => {
  const [, publish] = useState(0);
  const [owner] = useState(() => {
    let runtime: ThreadPaginationRuntime | undefined;
    let identity = route;
    let alive = true;
    let nextRequestId = 0;
    const active: Partial<Record<ThreadPaginationRequest['direction'], ThreadPaginationRequest>> =
      {};
    const viewports = new Map<ThreadPaginationRequest, ThreadPrependViewportPort>();
    const wake = () => {
      if (alive) publish((revision) => revision + 1);
    };
    const isCurrent = (request: ThreadPaginationRequest) =>
      alive && active[request.direction] === request && session.isCurrent(request.lease);
    const reset = (notify = true) => {
      for (const request of Object.values(active)) {
        if (request) viewports.get(request)?.finish(request);
      }
      delete active.backward;
      delete active.forward;
      viewports.clear();
      if (notify) wake();
    };
    const finish = (request: ThreadPaginationRequest) => {
      if (active[request.direction] !== request) return;
      delete active[request.direction];
      wake();
      viewports.get(request)?.finish(request);
      viewports.delete(request);
    };
    const paginateBack = async () => {
      const lease = session.captureLease();
      if (!runtime || !lease || active.backward) return;
      const current = runtime;
      const { mx, room, sessionId, thread, threadEvents, viewport, beginThreadCacheWrite } =
        current;
      const persistThreadEventCache = beginThreadCacheWrite();
      const request: ThreadPaginationRequest = {
        lease,
        direction: 'backward',
        requestId: ++nextRequestId,
      };
      if (!viewport.begin(request)) return;
      active.backward = request;
      viewports.set(request, viewport);
      wake();
      session.beginManualHistoryRead();
      const stillCurrent = () => {
        if (isCurrent(request)) return true;
        countCacheProbe('threadPaginateBackStaleThreadBails');
        return false;
      };
      try {
        let first = thread
          ? getLinkedTimelines(thread.getUnfilteredTimelineSet().getLiveTimeline())[0]
          : undefined;
        const serverCursor = first?.getPaginationToken(Direction.Backward);
        // A server cursor is executable without storage. Failed/offline requests
        // and cache-only history still use the persisted page below.
        let networkError: Error | null = null;
        if (thread && first && serverCursor) {
          const renderedAnchor = getThreadCursorAnchor(
            findEarliestLoadedThreadReplyByCacheOrder(threadEvents, lease.threadId)?.event
          );
          const visitedCursors = new Set<string>();
          let cursor: string | null = serverCursor;
          while (cursor && !visitedCursors.has(cursor)) {
            visitedCursors.add(cursor);
            // eslint-disable-next-line no-await-in-loop
            [networkError] = await to(
              mx.paginateEventTimeline(first, { backwards: true, limit: THREAD_BATCH_SIZE })
            );
            if (networkError) break;
            first = getLinkedTimelines(thread.getUnfilteredTimelineSet().getLiveTimeline())[0];
            // Accepted SDK work remains durable even if navigation changed ownership.
            persistThreadEventCache(
              lease.threadId,
              getThreadTimelineEvents(thread),
              thread.rootEvent,
              first.getPaginationToken(Direction.Backward)
            );
            if (!stillCurrent()) return;
            const serverAnchor = getThreadCursorAnchor(
              findEarliestLoadedThreadReplyByCacheOrder(
                getThreadTimelineEvents(thread),
                lease.threadId
              )?.event
            );
            if (
              !renderedAnchor ||
              (serverAnchor && compareCachedPaginationAnchors(serverAnchor, renderedAnchor) < 0)
            )
              break;
            // Room/cache seeds may extend beyond the SDK window. Cross their
            // overlap in this request so one click reaches unseen older history.
            cursor = first.getPaginationToken(Direction.Backward);
          }
        }
        if (networkError) countCacheProbe('threadPaginateBackNetworkErrors');
        if (!thread || !first || !serverCursor || networkError) {
          if (!stillCurrent()) return;
          const cached = await loadThreadCachedPaginationSnapshot({
            sessionId,
            roomId: room.roomId,
            threadId: lease.threadId,
            earliestLoadedReply: findEarliestLoadedThreadReplyByCacheOrder(
              threadEvents,
              lease.threadId
            ),
            limit: THREAD_BATCH_SIZE,
            mapEvent: createPreferLiveEventMapper(room, mx.getEventMapper()),
          }).catch(() => undefined);
          if (!stillCurrent() || !cached) return;
          if (cached.status === 'cache-hit') {
            const timelineSet = thread?.getUnfilteredTimelineSet();
            const cachedTimeline = timelineSet
              ? getLinkedTimelines(timelineSet.getLiveTimeline())[0]
              : undefined;
            if (cachedTimeline && cached.cachedPage.beforeToken !== undefined) {
              cachedTimeline.setPaginationToken(
                cached.cachedPage.beforeToken ?? null,
                Direction.Backward
              );
            }
            await viewport.waitForQuiescence(request);
            if (!stillCurrent()) return;
            const committed = session.commitPage(lease, {
              kind: 'back-cache',
              events: cached.events,
              hasMoreCachedBack: cached.hasMoreCachedBack,
            });
            if (committed) countCacheProbe('threadPaginateBackCacheCommits');
            return;
          }

          countCacheProbe('threadPaginateBackCacheMisses');
          if (!thread) countCacheProbe('threadPaginateBackNoThread');
          else if (!serverCursor) {
            countCacheProbe('threadPaginateBackNoToken');
            session.markBackwardExhausted(lease);
          }
          return;
        }
        if (!stillCurrent()) return;
        await viewport.waitForQuiescence(request);
        if (!stillCurrent()) return;
        let hasMoreCachedBack = current.threadHasMoreCachedBack;
        reconcileThreadBackwardPagination(
          first,
          first.getPaginationToken(Direction.Backward),
          (value) => {
            hasMoreCachedBack = value;
          }
        );
        if (session.commitPage(lease, { kind: 'back-network', hasMoreCachedBack })) {
          countCacheProbe('threadPaginateBackNetworkCommits');
        }
      } finally {
        finish(request);
      }
    };
    const paginateFront = async () => {
      const lease = session.captureLease();
      if (!runtime?.thread || !lease || active.forward) return;
      const { mx, thread, beginThreadCacheWrite } = runtime;
      const persistThreadEventCache = beginThreadCacheWrite();
      const linked = getLinkedTimelines(thread.getUnfilteredTimelineSet().getLiveTimeline());
      const last = linked[linked.length - 1];
      if (!last?.getPaginationToken(Direction.Forward)) return;
      const request: ThreadPaginationRequest = {
        lease,
        direction: 'forward',
        requestId: ++nextRequestId,
      };
      active.forward = request;
      wake();
      try {
        const [error] = await to(
          mx.paginateEventTimeline(last, { backwards: false, limit: THREAD_BATCH_SIZE })
        );
        if (error) return;
        const tailLoaded = !last.getPaginationToken(Direction.Forward);
        persistThreadEventCache(
          lease.threadId,
          getThreadTimelineEvents(thread),
          thread.rootEvent,
          undefined,
          tailLoaded
        );
        if (!isCurrent(request)) return;
        session.commitPage(lease, { kind: 'front-network', tailLoaded });
      } finally {
        finish(request);
      }
    };
    return {
      observeRoute: (next: ThreadRoute) => {
        if (identity.roomId !== next.roomId || identity.threadId !== next.threadId) {
          reset(false);
          runtime = undefined;
        }
        identity = next;
      },
      mount: () => {
        alive = true;
      },
      cleanup: () => {
        alive = false;
        reset(false);
      },
      bindRuntime: (next: ThreadPaginationRuntime) => {
        runtime = next;
      },
      paginateBack,
      paginateFront,
      isPending: (direction: ThreadPaginationRequest['direction']) => !!active[direction],
      reset: () => reset(),
    };
  });
  owner.observeRoute(route);
  useEffect(() => {
    owner.mount();
    return owner.cleanup;
  }, [owner]);
  const pagination: ThreadPagination = {
    snapshot: {
      backward: owner.isPending('backward') ? 'pending' : 'idle',
      forward: owner.isPending('forward') ? 'pending' : 'idle',
    },
    paginateBack: owner.paginateBack,
    paginateFront: owner.paginateFront,
    isPending: owner.isPending,
    reset: owner.reset,
  };
  return { pagination, bindRuntime: owner.bindRuntime };
};
