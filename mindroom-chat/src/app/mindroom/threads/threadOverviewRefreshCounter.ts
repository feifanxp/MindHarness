import { useEffect, useState } from 'react';
import {
  RoomEvent,
  type Room,
  type RoomEventHandlerMap,
  ThreadEvent,
} from 'matrix-js-sdk';
import { shouldRefreshOverviewForTimelineEvent } from './threadBootstrap';

export const useThreadOverviewRefreshCounter = (room: Room, threadId: string | undefined) => {
  const [overviewRefreshCounter, setOverviewRefreshCounter] = useState(0);

  useEffect(() => {
    if (threadId) return undefined;
    const bumpRefresh = () => setOverviewRefreshCounter((counter) => counter + 1);
    const handleTimelineRefresh: RoomEventHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      _toStartOfTimeline,
      removed
    ) => {
      if (eventRoom?.roomId !== room.roomId || removed) return;
      if (!shouldRefreshOverviewForTimelineEvent(room, mEvent)) return;
      bumpRefresh();
    };
    const handleReceiptRefresh: RoomEventHandlerMap[RoomEvent.Receipt] = (_receipt, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      bumpRefresh();
    };
    room.on(RoomEvent.Timeline, handleTimelineRefresh);
    room.on(RoomEvent.Receipt, handleReceiptRefresh);
    room.on(ThreadEvent.New, bumpRefresh);
    room.on(ThreadEvent.Update, bumpRefresh);
    room.on(ThreadEvent.NewReply, bumpRefresh);
    room.on(ThreadEvent.Delete, bumpRefresh);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineRefresh);
      room.removeListener(RoomEvent.Receipt, handleReceiptRefresh);
      room.removeListener(ThreadEvent.New, bumpRefresh);
      room.removeListener(ThreadEvent.Update, bumpRefresh);
      room.removeListener(ThreadEvent.NewReply, bumpRefresh);
      room.removeListener(ThreadEvent.Delete, bumpRefresh);
    };
  }, [room, threadId]);

  return {
    overviewRefreshCounter,
    setOverviewRefreshCounter,
  };
};
