export type RoomMessageSentNotificationInput = {
  eventId?: string;
  relation?: unknown;
  replyDraft?: unknown;
  threadId?: string;
};

export const getRoomMessageSentNotificationEventId = ({
  eventId,
  relation,
  replyDraft,
  threadId,
}: RoomMessageSentNotificationInput): string | undefined => {
  if (!eventId || relation || threadId || replyDraft) return undefined;

  return eventId;
};
