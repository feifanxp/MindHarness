import { useCallback } from 'react';
import { type NavigateOptions, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { getCanonicalAliasOrRoomId } from '../utils/matrix';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpacePath,
  getSpaceRoomPath,
  withSearchParam,
} from '../pages/pathUtils';
import { useMatrixClient } from './useMatrixClient';
import { getAllParents, getOrphanParents, guessPerfectParent } from '../utils/room';
import { roomToParentsAtom } from '../state/room/roomToParents';
import { mDirectAtom } from '../state/mDirectList';
import { useSelectedSpace } from './router/useSelectedSpace';
import { settingsAtom } from '../state/settings';
import { useSetting } from '../state/hooks/settings';
import { _RoomSearchParams } from '../pages/paths';
import { navigateMindroomRoomThread } from '../mindroom/threads/threadNavigation';
import { useSimpleMode } from '../mindroom/settings/useMindroomAccountSettings';

export const useRoomNavigate = () => {
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const roomToParents = useAtomValue(roomToParentsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const spaceSelectedId = useSelectedSpace();
  const [developerTools] = useSetting(settingsAtom, 'developerTools');
  const simpleMode = useSimpleMode();

  const navigateSpace = useCallback(
    (roomId: string) => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
      navigate(getSpacePath(roomIdOrAlias));
    },
    [mx, navigate]
  );

  const getRoomPath = useCallback(
    (roomId: string, eventId?: string) => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
      const openSpaceTimeline = developerTools && spaceSelectedId === roomId;

      if (
        spaceSelectedId &&
        (openSpaceTimeline || getAllParents(roomToParents, roomId).has(spaceSelectedId))
      ) {
        return getSpaceRoomPath(
          getCanonicalAliasOrRoomId(mx, spaceSelectedId),
          openSpaceTimeline ? roomId : roomIdOrAlias,
          eventId
        );
      }

      if (simpleMode) {
        return mDirects.has(roomId)
          ? getDirectRoomPath(roomIdOrAlias, eventId)
          : getHomeRoomPath(roomIdOrAlias, eventId);
      }

      const orphanParents = getOrphanParents(roomToParents, roomId);
      if (orphanParents.length > 0) {
        const parentSpace = guessPerfectParent(mx, roomId, orphanParents) ?? orphanParents[0];
        const pSpaceIdOrAlias = getCanonicalAliasOrRoomId(mx, parentSpace);

        return getSpaceRoomPath(pSpaceIdOrAlias, roomIdOrAlias, eventId);
      }

      if (mDirects.has(roomId)) {
        return getDirectRoomPath(roomIdOrAlias, eventId);
      }

      return getHomeRoomPath(roomIdOrAlias, eventId);
    },
    [mx, spaceSelectedId, roomToParents, mDirects, developerTools, simpleMode]
  );

  const navigateRoom = useCallback(
    (roomId: string, eventId?: string, opts?: NavigateOptions) => {
      navigate(getRoomPath(roomId, eventId), opts);
    },
    [navigate, getRoomPath]
  );

  const navigateRoomFocusEvent = useCallback(
    (roomId: string, eventId: string, opts?: NavigateOptions) => {
      const roomPath = getRoomPath(roomId, eventId);
      navigate(withSearchParam<_RoomSearchParams>(roomPath, { focusEvent: '1' }), opts);
    },
    [navigate, getRoomPath]
  );

  const navigateRoomThreadDirect = useCallback(
    (roomId: string, threadId: string, eventId?: string, opts?: NavigateOptions) => {
      const roomPath = getRoomPath(roomId, eventId);
      navigate(withSearchParam<_RoomSearchParams>(roomPath, { threadId }), opts);
    },
    [navigate, getRoomPath]
  );

  const navigatePath = useCallback(
    (path: string, opts?: NavigateOptions) => {
      navigate(path, opts);
    },
    [navigate]
  );

  const navigateRoomThread = useCallback(
    (roomId: string, threadId: string, eventId?: string, opts?: NavigateOptions) => {
      navigateMindroomRoomThread({
        roomId,
        threadId,
        eventId,
        opts,
        navigateRoomThreadDirect,
      });
    },
    [navigateRoomThreadDirect]
  );

  return {
    navigateSpace,
    navigateRoom,
    navigateRoomFocusEvent,
    navigatePath,
    navigateRoomThreadDirect,
    navigateRoomThread,
  };
};
