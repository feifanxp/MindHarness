import {
  useCallback,
  type Dispatch,
  type MouseEventHandler,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { NavigateOptions } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { bumpRecentThread } from '../recent-threads/recentThreads';
import type { OpenRoomEventHandler } from './roomEventOpenController';
import type { ScrollToBottomState } from './roomFocusScrollController';
import { getInitialTimeline, type Timeline } from './timelinePagination';

type NavigateRoom = (roomId: string, eventId?: string, opts?: NavigateOptions) => void;

type NavigateRoomThread = (
  roomId: string,
  threadId: string,
  eventId?: string,
  opts?: NavigateOptions
) => void;

type RoomUnreadInfoLike = {
  readUptoEventId: string;
};

export type RoomTimelineNavigationControllerOptions = {
  eventId?: string;
  classicRoomTimeline?: boolean;
  handleOpenEvent: OpenRoomEventHandler;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  ignoredUsersSet: Set<string>;
  navigateRoom: NavigateRoom;
  navigateRoomThread: NavigateRoomThread;
  room: Room;
  prefetchDepth: number;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  showHiddenEvents: boolean;
  showThreadRepliesInRoom?: boolean;
  threadId?: string;
  unreadInfo?: RoomUnreadInfoLike;
};

export const useRoomTimelineNavigationController = ({
  eventId,
  classicRoomTimeline,
  handleOpenEvent,
  hideMembershipEvents,
  hideNickAvatarEvents,
  ignoredUsersSet,
  navigateRoom,
  navigateRoomThread,
  room,
  prefetchDepth,
  scrollToBottomRef,
  setAtBottom,
  setTimeline,
  showHiddenEvents,
  showThreadRepliesInRoom,
  threadId,
  unreadInfo,
}: RoomTimelineNavigationControllerOptions) => {
  const handleJumpToLatest = useCallback(() => {
    if (threadId) {
      if (eventId) {
        navigateRoomThread(room.roomId, threadId, undefined, { replace: true });
      }

      // The live timeline already ends at the newest reply; only older
      // history can still be loading. Never wait for it: on a slow network
      // the jump would stay dead while each page shifts the viewport up.
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
      setAtBottom(true);
      return;
    }

    if (eventId) {
      navigateRoom(room.roomId, undefined, { replace: true });
    }
    setTimeline(
      getInitialTimeline(room, prefetchDepth, {
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        showThreadRepliesInRoom,
      })
    );
    scrollToBottomRef.current.count += 1;
    scrollToBottomRef.current.smooth = false;
  }, [
    eventId,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    navigateRoom,
    navigateRoomThread,
    room,
    prefetchDepth,
    scrollToBottomRef,
    setAtBottom,
    setTimeline,
    showHiddenEvents,
    showThreadRepliesInRoom,
    threadId,
  ]);

  const handleJumpToUnread = useCallback(() => {
    if (unreadInfo?.readUptoEventId) {
      void handleOpenEvent(unreadInfo.readUptoEventId, false);
    }
  }, [handleOpenEvent, unreadInfo]);

  const handleOpenReply: MouseEventHandler = useCallback(
    (evt) => {
      const threadRootId = evt.currentTarget.getAttribute('data-thread-root-id');
      const recentThreadSummaryText =
        evt.currentTarget.getAttribute('data-thread-summary')?.trim() || undefined;
      if (threadRootId) {
        if (classicRoomTimeline) {
          void handleOpenEvent(threadRootId);
          return;
        }
        bumpRecentThread(room.roomId, threadRootId, undefined, recentThreadSummaryText);
        navigateRoomThread(room.roomId, threadRootId);
        return;
      }
      const targetId = evt.currentTarget.getAttribute('data-event-id');
      if (!targetId) return;
      void handleOpenEvent(targetId);
    },
    [classicRoomTimeline, handleOpenEvent, navigateRoomThread, room.roomId]
  );

  const handleOpenCompactThread = useCallback(
    (threadRootId: string, recentThreadSummaryText?: string) => {
      if (classicRoomTimeline) {
        void handleOpenEvent(threadRootId);
        return;
      }
      bumpRecentThread(room.roomId, threadRootId, undefined, recentThreadSummaryText);
      navigateRoomThread(room.roomId, threadRootId);
    },
    [classicRoomTimeline, handleOpenEvent, navigateRoomThread, room.roomId]
  );

  return {
    handleJumpToLatest,
    handleJumpToUnread,
    handleOpenCompactThread,
    handleOpenReply,
  };
};
