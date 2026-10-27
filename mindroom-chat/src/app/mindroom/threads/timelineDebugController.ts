import { useEffect, useRef } from 'react';
import type { Room } from 'matrix-js-sdk';
import type { ItemRange } from '../../hooks/useVirtualPaginator';
import type { ThreadInitialRenderMode } from './threadRenderUtils';
import { createTimelineDebugTrace, logTimelineDebug } from './timelineDebug';

type TimelineDebugTraceIds = {
  roomDebugTraceId: string;
  threadDebugTraceId: string | undefined;
};

export const useTimelineDebugTraceIds = ({
  eventId,
  room,
  threadId,
}: {
  eventId: string | undefined;
  room: Room;
  threadId: string | undefined;
}): TimelineDebugTraceIds => {
  const roomDebugTraceRef = useRef({
    roomId: room.roomId,
    traceId: createTimelineDebugTrace('room-open', room.roomId),
  });
  const currentThreadTraceKey = threadId ? `${room.roomId}|${threadId}` : undefined;
  const threadDebugTraceRef = useRef<{ traceId?: string; traceKey?: string }>({
    traceId: currentThreadTraceKey
      ? createTimelineDebugTrace('thread-open', room.roomId, threadId)
      : undefined,
    traceKey: currentThreadTraceKey,
  });

  if (roomDebugTraceRef.current.roomId !== room.roomId) {
    roomDebugTraceRef.current = {
      roomId: room.roomId,
      traceId: createTimelineDebugTrace('room-open', room.roomId),
    };
  }
  if (threadDebugTraceRef.current.traceKey !== currentThreadTraceKey) {
    threadDebugTraceRef.current = {
      traceId: currentThreadTraceKey
        ? createTimelineDebugTrace('thread-open', room.roomId, threadId)
        : undefined,
      traceKey: currentThreadTraceKey,
    };
  }

  const roomDebugTraceId = roomDebugTraceRef.current.traceId;
  const threadDebugTraceId = threadDebugTraceRef.current.traceId;

  useEffect(() => {
    logTimelineDebug(roomDebugTraceId, 'init', {
      eventId,
      roomId: room.roomId,
      threadId,
    });
  }, [eventId, room.roomId, roomDebugTraceId, threadId]);

  useEffect(() => {
    if (!threadId) return;
    logTimelineDebug(threadDebugTraceId, 'init', {
      eventId,
      roomId: room.roomId,
      threadId,
    });
  }, [eventId, room.roomId, threadDebugTraceId, threadId]);

  return { roomDebugTraceId, threadDebugTraceId };
};

export const useTimelineDebugRangeController = ({
  activeTimelineRange,
  canPaginateThreadBack,
  canPaginateThreadFront,
  eventsLength,
  filteredLength,
  renderableEventCount,
  roomDebugTraceId,
  roomSurfaceEventCount,
  threadEventCount,
  threadId,
  threadDebugTraceId,
  threadInitialCacheHydrated,
  threadInitialRenderMode,
  threadOverviewCount,
  threadTailLoaded,
  threadTimelineTick,
  useSurfacePreloadTarget,
}: {
  activeTimelineRange: ItemRange;
  canPaginateThreadBack: boolean;
  canPaginateThreadFront: boolean;
  eventsLength: number;
  filteredLength: number;
  renderableEventCount: number;
  roomDebugTraceId: string;
  roomSurfaceEventCount: number;
  threadDebugTraceId: string | undefined;
  threadEventCount: number;
  threadId: string | undefined;
  threadInitialCacheHydrated: boolean;
  threadInitialRenderMode: ThreadInitialRenderMode;
  threadOverviewCount: number;
  threadTailLoaded: boolean;
  threadTimelineTick: number;
  useSurfacePreloadTarget: boolean;
}) => {
  useEffect(() => {
    if (threadId) return;
    // CINNY-207 P4.3: `eagerPreloading` was a render-loop signal from
    // the deleted `useRoomEagerPreload` hook. Deep history is now a
    // scheduler job; there is no render-time preload state to log.
    logTimelineDebug(roomDebugTraceId, 'room-surface', {
      activeRangeEnd: activeTimelineRange.end,
      activeRangeStart: activeTimelineRange.start,
      cacheCount: eventsLength,
      preloadTarget: useSurfacePreloadTarget ? 'surface' : 'renderable',
      renderableCount: renderableEventCount,
      surfaceCount: roomSurfaceEventCount,
      threadOverviewCount,
      visibleCount: activeTimelineRange.end - activeTimelineRange.start,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    eventsLength,
    renderableEventCount,
    roomDebugTraceId,
    roomSurfaceEventCount,
    threadId,
    threadOverviewCount,
    useSurfacePreloadTarget,
  ]);

  useEffect(() => {
    if (!threadId) return;
    logTimelineDebug(threadDebugTraceId, 'thread-range', {
      activeRangeEnd: activeTimelineRange.end,
      activeRangeStart: activeTimelineRange.start,
      canPaginateThreadBack,
      canPaginateThreadFront,
      filteredLength,
      initialCacheHydrated: threadInitialCacheHydrated,
      initialRenderMode: threadInitialRenderMode,
      renderedCount: activeTimelineRange.end - activeTimelineRange.start,
      threadEventCount,
      threadTailLoaded,
      threadTimelineTick,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    canPaginateThreadBack,
    canPaginateThreadFront,
    filteredLength,
    threadDebugTraceId,
    threadEventCount,
    threadId,
    threadInitialCacheHydrated,
    threadInitialRenderMode,
    threadTailLoaded,
    threadTimelineTick,
  ]);
};
