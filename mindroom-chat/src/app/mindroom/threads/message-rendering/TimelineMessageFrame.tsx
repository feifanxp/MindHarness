import React, { type ReactNode } from 'react';
import { config } from 'folds';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Message, type MessageProps } from '../../messages/MindroomMessage';
import { Reply } from '../../../components/message';
import { Reactions } from '../../../features/room/message/Reactions';
import { getEventReactions } from '../../../utils/room';
import { getRenderableAnnotationsByKey } from '../../messages/stopReaction';
import type { useGetMemberPowerTag } from '../../../hooks/useMemberPowerTag';
import { isThreadFallbackReply } from '../threadRenderUtils';
import { renderMindroomRoomTimelineThreadBadge } from '../roomTimelineMessageExtensions';
import type { TimelineMessageData, TimelineMessageKind, TimelineMessageRow } from './types';

export type TimelineMessageFramePolicy = Pick<
  MessageProps,
  | 'messageSpacing'
  | 'messageLayout'
  | 'canSendReaction'
  | 'canPinEvent'
  | 'imagePackRooms'
  | 'onUserClick'
  | 'onUsernameClick'
  | 'onReplyClick'
  | 'onReactionToggle'
  | 'onEditId'
  | 'hideReadReceipts'
  | 'showDeveloperTools'
  | 'accessibleTagColors'
  | 'legacyUsernameColor'
  | 'hour24Clock'
  | 'dateFormatString'
> & {
  mx: MatrixClient;
  room: Room;
  threadId?: string;
  showThreadRepliesInRoom: boolean;
  editingEventId?: string;
  canRedact: boolean;
  canDeleteOwn: boolean;
  getMemberPowerTag: ReturnType<typeof useGetMemberPowerTag>;
};

type TimelineMessageFrameProps = {
  row: TimelineMessageRow;
  kind: TimelineMessageKind;
  policy: TimelineMessageFramePolicy;
  data: TimelineMessageData;
  resolvedContent?: Record<string, unknown>;
  children: ReactNode;
};

export function TimelineMessageFrame({
  row,
  kind,
  policy,
  data,
  resolvedContent,
  children,
}: TimelineMessageFrameProps) {
  const { eventId, event, index, timelineSet, collapse, highlighted, previousEventId } = row;
  const {
    mx,
    room,
    threadId,
    showThreadRepliesInRoom,
    editingEventId,
    canRedact,
    canDeleteOwn,
    getMemberPowerTag,
    onEditId,
    ...messageProps
  } = policy;
  const reactionRelations = getEventReactions(timelineSet, eventId);
  const hasReactions = getRenderableAnnotationsByKey(reactionRelations, event).length > 0;
  const { replyEventId, threadRootId } = event;
  const supportsEditing = kind === 'message' || kind === 'encrypted';
  const supportsReplies = kind !== 'sticker';
  const threadSummary =
    supportsReplies && !showThreadRepliesInRoom
      ? renderMindroomRoomTimelineThreadBadge({
          eventId,
          event,
          threadRecordMap: data.threadRecordMap,
          activeThreadId: threadId,
          room,
          onClick: data.handleOpenReply,
          includeRecentSummaryData: true,
        })
      : null;
  const reactions = reactionRelations && (
    <Reactions
      style={{ marginTop: config.space.S200 }}
      room={room}
      relations={reactionRelations}
      mEventId={eventId}
      targetEvent={event}
      canSendReaction={policy.canSendReaction ?? false}
      onReactionToggle={policy.onReactionToggle}
    />
  );
  return (
    <Message
      {...messageProps}
      data-message-item={index}
      data-message-id={eventId}
      room={room}
      mEvent={event}
      resolvedMessageContent={resolvedContent}
      collapse={collapse}
      highlight={highlighted}
      edit={supportsEditing ? editingEventId === eventId : undefined}
      canDelete={canRedact || (canDeleteOwn && event.getSender() === mx.getUserId())}
      relations={hasReactions ? reactionRelations : undefined}
      onEditId={supportsEditing ? onEditId : undefined}
      reply={
        supportsReplies &&
        !(
          threadId &&
          replyEventId &&
          (isThreadFallbackReply(event) ||
            replyEventId === previousEventId ||
            replyEventId === threadId)
        ) &&
        replyEventId && (
          <Reply
            room={room}
            timelineSet={timelineSet}
            replyEventId={replyEventId}
            threadRootId={threadRootId}
            getLocally={threadId ? () => data.threadEventMap.get(replyEventId) : undefined}
            hideThreadIndicator={!!threadId || showThreadRepliesInRoom}
            onClick={data.handleOpenReply}
            getMemberPowerTag={getMemberPowerTag}
            accessibleTagColors={policy.accessibleTagColors}
            legacyUsernameColor={policy.legacyUsernameColor}
          />
        )
      }
      reactions={
        supportsReplies
          ? (threadSummary || reactionRelations) && (
              <>
                {threadSummary}
                {reactions}
              </>
            )
          : reactions
      }
      memberPowerTag={getMemberPowerTag(event.getSender() ?? '')}
    >
      {children}
    </Message>
  );
}
