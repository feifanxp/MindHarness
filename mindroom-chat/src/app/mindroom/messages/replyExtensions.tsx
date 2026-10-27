import React, { MouseEventHandler } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { EventTimelineSet } from 'matrix-js-sdk/lib/models/event-timeline-set';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { ThreadIndicator } from '../threads/ThreadIndicator';
import { useRoomEvent } from '../threads/useRoomEvent';

/**
 * `undefined` means still loading (placeholder), `null` means the event could
 * not be fetched — Reply renders that as an explicit failure instead of a
 * placeholder that never resolves.
 */
export const useMindroomReplyEvent = (
  room: Room,
  replyEventId: string,
  getFromLocalTimeline: () => MatrixEvent | undefined,
  threadRootId?: string
): MatrixEvent | null | undefined =>
  useRoomEvent(room, replyEventId, getFromLocalTimeline, {
    threadId: threadRootId,
  });

type MindroomReplyThreadIndicatorProps = {
  room: Room;
  timelineSet?: EventTimelineSet;
  threadRootId?: string;
  hide?: boolean;
  onClick?: MouseEventHandler;
};

export function MindroomReplyThreadIndicator({
  room,
  timelineSet,
  threadRootId,
  hide,
  onClick,
}: MindroomReplyThreadIndicatorProps) {
  if (!threadRootId || hide) return null;

  return (
    <ThreadIndicator
      as="button"
      data-thread-root-id={threadRootId}
      threadRootId={threadRootId}
      timelineSet={timelineSet}
      data-event-id={threadRootId}
      room={room}
      onClick={onClick}
    />
  );
}
