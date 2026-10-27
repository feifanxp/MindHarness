import { type IContent, type Room } from 'matrix-js-sdk';
import type { IReplyDraft } from '../../state/room/roomInputDrafts';
import { getEditedEvent } from '../../utils/room';
import { readCanvasNoticeTitle } from '../ui-actions/chatUiProtocol';

export type MindroomRoomTimelineReplyDraft = {
  draft: IReplyDraft;
  threadRootId: string;
};

export const buildMindroomRoomTimelineReplyDraft = (
  room: Room,
  eventId: string,
  startThread: boolean
): MindroomRoomTimelineReplyDraft | undefined => {
  const replyEvent = room.findEventById(eventId);
  if (!replyEvent) return undefined;

  const threadRootId = replyEvent.threadRootId ?? eventId;
  const editedReply = getEditedEvent(eventId, replyEvent, room.getUnfilteredTimelineSet());
  const content: IContent = editedReply?.getContent()['m.new_content'] ?? replyEvent.getContent();
  const { body, formatted_body: formattedBody } = content;
  // The reply bar names a canvas by its title, not the fallback body for other clients.
  const canvasTitle = readCanvasNoticeTitle(content);
  const { 'm.relates_to': relation } = startThread
    ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId } }
    : replyEvent.getWireContent();
  const senderId = replyEvent.getSender();

  if (!senderId || typeof body !== 'string') return undefined;

  return {
    draft: {
      userId: senderId,
      eventId,
      body,
      formattedBody,
      relation,
      ...(canvasTitle ? { previewText: canvasTitle } : {}),
    },
    threadRootId,
  };
};
