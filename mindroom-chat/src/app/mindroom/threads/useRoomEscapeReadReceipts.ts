import { useCallback } from 'react';
import { isKeyHotkey } from 'is-hotkey';
import { useKeyDown } from '../../hooks/useKeyDown';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { markRoomAndThreadsAsRead, markThreadAsRead } from '../notifications/readReceipts';

type UseRoomEscapeReadReceiptsOptions = {
  hideActivity: boolean;
  roomId: string;
  threadId?: string;
};

export const useRoomEscapeReadReceipts = ({
  hideActivity,
  roomId,
  threadId,
}: UseRoomEscapeReadReceiptsOptions): void => {
  const mx = useMatrixClient();

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (!isKeyHotkey('escape', evt)) return;
        if (threadId) {
          markThreadAsRead(mx, roomId, threadId, hideActivity);
          return;
        }
        markRoomAndThreadsAsRead(mx, roomId, hideActivity);
      },
      [hideActivity, mx, roomId, threadId]
    )
  );
};
