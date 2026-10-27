import { useCallback, useEffect, useRef } from 'react';
import { type Room, RoomEvent, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { isLocalEchoEventId } from './threadRouteUtils';

const useLiveTimelineRefresh = (room: Room, onRefresh: () => void): void => {
  useEffect(() => {
    const handleTimelineRefresh: RoomEventHandlerMap[RoomEvent.TimelineRefresh] = (r) => {
      if (r.roomId !== room.roomId) return;
      onRefresh();
    };

    room.on(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    return () => {
      room.removeListener(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    };
  }, [room, onRefresh]);
};

type UseThreadAwareTimelineRefresh = {
  liveTimelineLinked: boolean;
  onRoomRefresh: () => void;
  refreshLatestThreadSlice: (threadId: string) => Promise<boolean>;
  room: Room;
  threadId?: string;
};

export const useThreadAwareTimelineRefresh = ({
  room,
  threadId,
  liveTimelineLinked,
  refreshLatestThreadSlice,
  onRoomRefresh,
}: UseThreadAwareTimelineRefresh): void => {
  const threadRefreshInFlightRef = useRef<string>();
  const pendingRefreshRef = useRef(false);
  const activeThreadIdRef = useRef(threadId);

  if (activeThreadIdRef.current !== threadId) {
    activeThreadIdRef.current = threadId;
    pendingRefreshRef.current = false;
  }

  useLiveTimelineRefresh(
    room,
    useCallback(() => {
      if (isLocalEchoEventId(threadId)) return;
      if (threadId) {
        if (threadRefreshInFlightRef.current === threadId) {
          pendingRefreshRef.current = true;
          return;
        }
        const runRefresh = (tid: string) => {
          threadRefreshInFlightRef.current = tid;
          pendingRefreshRef.current = false;
          void refreshLatestThreadSlice(tid).finally(() => {
            if (threadRefreshInFlightRef.current !== tid) return;
            if (pendingRefreshRef.current && activeThreadIdRef.current === tid) {
              runRefresh(tid);
            } else {
              pendingRefreshRef.current = false;
              threadRefreshInFlightRef.current = undefined;
            }
          });
        };
        runRefresh(threadId);
      } else if (liveTimelineLinked) {
        onRoomRefresh();
      }
    }, [liveTimelineLinked, onRoomRefresh, refreshLatestThreadSlice, threadId])
  );
};
