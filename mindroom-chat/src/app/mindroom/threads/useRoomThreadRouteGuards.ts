import { useCallback, useEffect } from 'react';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { removeRecentThread } from '../recent-threads/recentThreads';
import type { RoomViewMode } from './roomViewMode';

type UseRoomThreadRouteGuardsOptions = {
  eventId?: string;
  roomId: string;
  threadId?: string;
  viewMode: RoomViewMode;
};

// Guards a room's thread routes: classic view mode never renders a thread
// route (it redirects to the room timeline), and the returned failed-thread
// handler drops a thread that failed to load from the recent-threads panel.
export const useRoomThreadRouteGuards = ({
  eventId,
  roomId,
  threadId,
  viewMode,
}: UseRoomThreadRouteGuardsOptions): ((failedThreadId: string) => void) => {
  const { navigateRoom } = useRoomNavigate();

  useEffect(() => {
    if (viewMode !== 'classic' || !threadId) return;

    navigateRoom(roomId, eventId ?? threadId, { replace: true });
  }, [eventId, navigateRoom, roomId, threadId, viewMode]);

  return useCallback(
    (failedThreadId: string) => {
      removeRecentThread(roomId, failedThreadId);
    },
    [roomId]
  );
};
