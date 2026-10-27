import { MatrixEvent, type IRoomEvent, type Room } from 'matrix-js-sdk';
import { getEditedEvent } from '../../../utils/room';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';

export const shouldRenderNotificationLoadingPlaceholders = (
  timelineStatus: AsyncStatus,
  groupCount: number
): boolean => timelineStatus === AsyncStatus.Loading && groupCount === 0;

/** Content and attachment identity must come from the same event revision. */
export const resolveNotificationEvent = (room: Room, event: IRoomEvent): MatrixEvent => {
  const source =
    room.findEventById(event.event_id) ?? new MatrixEvent({ ...event, room_id: room.roomId });
  if (source.isRedacted()) return source;
  const timeline =
    room.getTimelineForEvent(event.event_id)?.getTimelineSet() ?? room.getUnfilteredTimelineSet();
  const edit = getEditedEvent(event.event_id, source, timeline);
  if (edit === (source.replacingEvent() ?? undefined)) return source;
  // A rendering snapshot keeps current content/owner together without replacing the SDK event.
  const snapshot = new MatrixEvent({
    ...source.event,
    type: source.getType(),
    content: source.getOriginalContent(),
  });
  snapshot.status = source.status;
  snapshot.makeReplaced(edit);
  return snapshot;
};
