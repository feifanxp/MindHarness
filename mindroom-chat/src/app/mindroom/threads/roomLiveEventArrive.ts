import { useEffect } from 'react';
import {
  type EventTimelineSetHandlerMap,
  type MatrixEvent,
  type Room,
  RoomEvent,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';

export type TimelineArriveMeta = {
  liveEvent: boolean;
  toStartOfTimeline: boolean;
};

export const useLiveEventArrive = (
  room: Room,
  onArrive: (mEvent: MatrixEvent, meta: TimelineArriveMeta) => void
) => {
  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (eventRoom?.roomId !== room.roomId || removed) return;
      onArrive(mEvent, {
        liveEvent: data?.liveEvent === true,
        toStartOfTimeline: toStartOfTimeline === true,
      });
    };
    const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (mEvent, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      onArrive(mEvent, {
        liveEvent: true,
        toStartOfTimeline: false,
      });
    };

    room.on(RoomEvent.Timeline, handleTimelineEvent);
    room.on(RoomEvent.Redaction, handleRedaction);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
    };
  }, [room, onArrive]);
};
