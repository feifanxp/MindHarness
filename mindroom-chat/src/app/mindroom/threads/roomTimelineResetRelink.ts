import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { RoomEvent, type Room, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { getLiveTimeline, type Timeline } from './timelinePagination';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

/** Re-link the room render chain after a limited sync replaces its live timeline. */
export const useRoomTimelineResetRelink = ({
  room,
  threadId,
  eventId,
  timeline,
  rebuildTimeline,
  setTimeline,
  isViewportAtBottomNow,
  scrollToBottomRef,
}: {
  room: Room;
  threadId: string | undefined;
  eventId: string | undefined;
  timeline: Timeline;
  rebuildTimeline: () => Timeline;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  isViewportAtBottomNow: () => boolean;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
}): void => {
  const viewRef = useRef({ threadId, eventId, timeline });
  viewRef.current = { threadId, eventId, timeline };

  useEffect(() => {
    const relinkIfOrphaned = () => {
      const view = viewRef.current;
      if (view.threadId || view.eventId) return;
      if (view.timeline.linkedTimelines.includes(getLiveTimeline(room))) return;

      const rebuiltTimeline = rebuildTimeline();
      // Close the duplicate-reset window before React commits the state update.
      viewRef.current = { ...view, timeline: rebuiltTimeline };
      if (isViewportAtBottomNow()) {
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
      }
      setTimeline(rebuiltTimeline);
    };

    const handleTimelineReset: RoomEventHandlerMap[RoomEvent.TimelineReset] = (
      eventRoom,
      timelineSet
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      if (timelineSet !== room.getUnfilteredTimelineSet()) return;
      relinkIfOrphaned();
    };

    room.on(RoomEvent.TimelineReset, handleTimelineReset);
    // Recover a reset between render and passive-effect subscription.
    relinkIfOrphaned();
    return () => {
      room.removeListener(RoomEvent.TimelineReset, handleTimelineReset);
    };
  }, [room, rebuildTimeline, setTimeline, isViewportAtBottomNow, scrollToBottomRef]);
};
