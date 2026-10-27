import { useEffect, useMemo, useReducer } from 'react';
import { Direction, MatrixEvent, Room } from 'matrix-js-sdk';
import { observeActiveThreadSyncGaps } from './activeThreadSyncGaps';
import { getLinkedTimelines } from './timelinePagination';
import { useThreadRenderState } from './useThreadRenderState';

export type UseThreadTimelineStateOptions = {
  room: Room;
  threadId?: string;
  threadInitialCacheHydrated: boolean;
  threadInitialSdkLoaded?: boolean;
  timelineRevision?: number;
  debugTraceId?: string;
};

export const useThreadTimelineState = ({
  room,
  threadId,
  threadInitialCacheHydrated,
  threadInitialSdkLoaded,
  timelineRevision,
  debugTraceId,
}: UseThreadTimelineStateOptions) => {
  const thread = threadId ? room.getThread(threadId) : null;
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  useEffect(() => {
    if (!thread) return undefined;
    return observeActiveThreadSyncGaps(room, thread, refresh);
  }, [room, thread]);
  const roomTimelineSet = room.getUnfilteredTimelineSet();
  const threadTimelineSet = thread?.getUnfilteredTimelineSet();
  const threadLinkedTimelines = threadTimelineSet
    ? getLinkedTimelines(threadTimelineSet.getLiveTimeline())
    : [];
  const lastThreadTimeline = threadLinkedTimelines[threadLinkedTimelines.length - 1];
  const threadRenderState = useThreadRenderState({
    room,
    roomTimelineSet,
    threadTimelineSet,
    threadId,
    thread,
    threadInitialCacheHydrated,
    threadInitialSdkLoaded,
    timelineRevision,
    debugTraceId,
  });

  const threadEventMap = useMemo(() => {
    const eventMap = new Map<string, MatrixEvent>();
    threadRenderState.threadEvents.forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (eventId) eventMap.set(eventId, mEvent);
    });
    return eventMap;
  }, [threadRenderState.threadEvents]);

  const threadBackwardPaginationToken =
    threadLinkedTimelines[0]?.getPaginationToken(Direction.Backward) ?? null;
  const canPaginateThreadBack = typeof threadBackwardPaginationToken === 'string';
  const canPaginateThreadFront =
    typeof lastThreadTimeline?.getPaginationToken(Direction.Forward) === 'string';

  return {
    ...threadRenderState,
    canPaginateThreadBack,
    canPaginateThreadFront,
    roomTimelineSet,
    thread,
    threadBackwardPaginationToken,
    threadEventMap,
    threadTimelineSet,
  };
};
