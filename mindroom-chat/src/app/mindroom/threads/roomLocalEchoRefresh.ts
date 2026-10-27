import { useEffect } from 'react';
import { type MatrixEvent, Room, RoomEvent, RoomEventHandlerMap } from 'matrix-js-sdk';

export type RoomLocalEchoRefreshMeta = {
  initial: boolean;
};

export const useRoomLocalEchoRefresh = (
  room: Room,
  onRefresh: (mEvent: MatrixEvent, meta: RoomLocalEchoRefreshMeta) => void
) => {
  useEffect(() => {
    const handleLocalEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (
      mEvent,
      _eventRoom,
      oldEventId,
      oldStatus
    ) => {
      onRefresh(mEvent, {
        initial: oldEventId === undefined && oldStatus === undefined,
      });
    };

    room.on(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    return () => {
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    };
  }, [room, onRefresh]);
};
