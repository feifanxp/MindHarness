import { Dispatch, MouseEventHandler, SetStateAction, useCallback } from 'react';
import { MatrixClient, Room } from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';
import { Editor } from 'slate';
import { ReactEditor } from 'slate-react';
import { createMentionElement, moveCursor } from '../../components/editor';
import type { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import type { useRoomNavigate } from '../../hooks/useRoomNavigate';
import type { IReplyDraft } from '../../state/room/roomInputDrafts';
import { eventWithShortcode, factoryEventSentBy, getMxIdLocalPart } from '../../utils/matrix';
import { getActiveEventsForAnnotationKey } from '../../utils/reactionAnnotations';
import { getEventReactions, getMemberDisplayName, getReactionContent } from '../../utils/room';
import { MessageEvent } from '../../../types/matrix/room';
import { buildMindroomRoomTimelineReplyDraft } from './roomTimelineReplyDraft';

type RoomTimelineMessageActionsOptions = {
  mx: MatrixClient;
  room: Room;
  space: Room | null;
  editor: Editor;
  openUserRoomProfile: ReturnType<typeof useOpenUserRoomProfile>;
  showThreadRepliesInRoom: boolean;
  setReplyDraft: (draft: IReplyDraft) => void;
  navigateRoomThread: ReturnType<typeof useRoomNavigate>['navigateRoomThread'];
  setEditId: Dispatch<SetStateAction<string | undefined>>;
};

export const useRoomTimelineMessageActions = ({
  mx,
  room,
  space,
  editor,
  openUserRoomProfile,
  showThreadRepliesInRoom,
  setReplyDraft,
  navigateRoomThread,
  setEditId,
}: RoomTimelineMessageActionsOptions) => {
  const handleUserClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        return;
      }
      openUserRoomProfile(
        room.roomId,
        space?.roomId,
        userId,
        evt.currentTarget.getBoundingClientRect()
      );
    },
    [room, space, openUserRoomProfile]
  );
  const handleUsernameClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        return;
      }
      const name = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
      editor.insertNode(
        createMentionElement(
          userId,
          name.startsWith('@') ? name : `@${name}`,
          userId === mx.getUserId()
        )
      );
      ReactEditor.focus(editor);
      moveCursor(editor);
    },
    [mx, room, editor]
  );

  const handleReplyClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt, startThread = false) => {
      const replyId = evt.currentTarget.getAttribute('data-event-id');
      if (!replyId) {
        return;
      }
      const shouldStartThread = startThread && !showThreadRepliesInRoom;
      const replyDraft = buildMindroomRoomTimelineReplyDraft(room, replyId, shouldStartThread);
      if (replyDraft) {
        setReplyDraft(replyDraft.draft);
        if (shouldStartThread) {
          navigateRoomThread(room.roomId, replyDraft.threadRootId);
        }
        setTimeout(() => ReactEditor.focus(editor), 100);
      }
    },
    [room, showThreadRepliesInRoom, setReplyDraft, editor, navigateRoomThread]
  );

  const handleReactionToggle = useCallback(
    (targetEventId: string, key: string, shortcode?: string, currentRelations?: Relations) => {
      const reactionRelations =
        currentRelations ?? getEventReactions(room.getUnfilteredTimelineSet(), targetEventId);
      const reactions = getActiveEventsForAnnotationKey(reactionRelations, key);
      const myReaction = reactions.find(factoryEventSentBy(mx.getUserId()!));

      if (myReaction && !!myReaction?.isRelation()) {
        mx.redactEvent(room.roomId, myReaction.getId()!);
        return;
      }
      const rShortcode =
        shortcode ||
        (reactions.find(eventWithShortcode)?.getContent().shortcode as string | undefined);
      mx.sendEvent(
        room.roomId,
        MessageEvent.Reaction as any,
        getReactionContent(targetEventId, key, rShortcode)
      );
    },
    [mx, room]
  );
  const handleEdit = useCallback(
    (editEvtId?: string) => {
      if (editEvtId) {
        setEditId(editEvtId);
        return;
      }
      setEditId(undefined);
      ReactEditor.focus(editor);
    },
    [editor, setEditId]
  );

  return {
    handleUserClick,
    handleUsernameClick,
    handleReplyClick,
    handleReactionToggle,
    handleEdit,
  };
};
