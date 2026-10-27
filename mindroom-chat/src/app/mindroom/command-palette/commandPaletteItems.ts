import type { Room } from 'matrix-js-sdk';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { StateEvent } from '../../../types/matrix/room';
import { useAllJoinedRoomsSet, useGetRoom } from '../../hooks/useGetRoom';
import { useDirectUsers } from '../../hooks/useDirectUsers';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useActiveTheme, DarkTheme, LightTheme } from '../../hooks/useTheme';
import { getRoomSearchParams } from '../../pages/pathSearchParam';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useSelectedSpace } from '../../hooks/router/useSelectedSpace';
import { copyToClipboard } from '../../utils/dom';
import { getCanonicalAliasOrRoomId, getMxIdLocalPart, isRoomAlias } from '../../utils/matrix';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { factoryRoomIdByActivity } from '../../utils/sort';
import { getAllParents, getStateEvent } from '../../utils/room';
import { createRoomModalAtom } from '../../state/createRoomModal';
import { createSpaceModalAtom } from '../../state/createSpaceModal';
import { mDirectAtom } from '../../state/mDirectList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { settingsAtom } from '../../state/settings';
import { settingsModalAtom } from '../../state/settingsModal';
import { useSetting } from '../../state/hooks/settings';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { useDirects, useRooms, useSpaces } from '../../state/hooks/roomList';
import { markRoomAndThreadsAsRead } from '../notifications/readReceipts';
import { useMindroomCommandPaletteThreadItems } from '../threads/commandPaletteThreadItems';
import {
  commandPaletteStaticActionPaths,
  getCommandPaletteMessageTargets,
  getCommandPaletteQuickActions,
  resolveCommandPaletteUserTarget,
  type CommandPaletteQuickActionId,
} from './commandPaletteActions';
import { getCommandPaletteRoomRanking } from './commandPaletteRoomRanking';
import type {
  CommandPaletteActionItem,
  CommandPaletteItem,
  CommandPaletteMessageItem,
  CommandPaletteRoomItem,
  CommandPaletteThreadItem,
  CommandPaletteUserItem,
} from './commandPaletteTypes';
import {
  buildCommandPaletteDmRoomMap,
  collectCommandPaletteUserCandidates,
  getCommandPaletteDmUserDetails,
} from './commandPaletteUserCandidates';

export type ExecutableCommandPaletteItem = CommandPaletteItem & {
  onSelect?: () => void;
};

export type CommandPaletteSource = {
  actions: readonly (CommandPaletteActionItem & { onSelect?: () => void })[];
  threads: readonly (CommandPaletteThreadItem & { onSelect?: () => void })[];
  rooms: readonly (CommandPaletteRoomItem & { onSelect?: () => void })[];
  getUsers: (options: {
    exhaustive: boolean;
    includeRelatedRooms: boolean;
  }) => readonly (CommandPaletteUserItem & { onSelect?: () => void })[];
  getMessages: (query: string) => (CommandPaletteMessageItem & { onSelect?: () => void })[];
};

type UseCommandPaletteSourceOptions = {
  onLogout?: () => void;
};

const getRoomTopic = (room: Room): string | undefined => {
  const content = getStateEvent(room, StateEvent.RoomTopic)?.getContent();
  return typeof content?.topic === 'string' ? content.topic : undefined;
};

const fireAndForget = <T>(promise: Promise<T>) => {
  promise.catch(() => undefined);
};

export const useCommandPaletteSource = (
  options: UseCommandPaletteSourceOptions = {}
): CommandPaletteSource => {
  const { onLogout } = options;
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const settings = useAtomValue(settingsAtom);
  const setSettings = useSetAtom(settingsAtom);
  const activeTheme = useActiveTheme();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const setCreateRoomModal = useSetAtom(createRoomModalAtom);
  const setCreateSpaceModal = useSetAtom(createSpaceModalAtom);
  const selectedRoomId = useSelectedRoom();
  const selectedSpaceId = useSelectedSpace();
  const openRoomSettings = useOpenRoomSettings();
  const { navigateRoom, navigateSpace, navigateRoomThread } = useRoomNavigate();
  const myUserId = mx.getSafeUserId();

  const currentThreadId = useMemo(
    () => getRoomSearchParams(new URLSearchParams(location.search)).threadId,
    [location.search]
  );

  const allJoinedRooms = useAllJoinedRoomsSet();
  const allJoinedRoomIds = useMemo(() => Array.from(allJoinedRooms), [allJoinedRooms]);
  const getRoom = useGetRoom(allJoinedRooms);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const directUsers = useDirectUsers();
  const rooms = useRooms(mx, allRoomsAtom, mDirects);
  const spaces = useSpaces(mx, allRoomsAtom);
  const directs = useDirects(mx, allRoomsAtom, mDirects);

  const selectedRoom = selectedRoomId ? getRoom(selectedRoomId) : undefined;
  const selectedSpace = selectedSpaceId ? getRoom(selectedSpaceId) : undefined;

  const orderedRoomIds = useMemo(
    () => [...rooms, ...spaces].sort(factoryRoomIdByActivity(mx)),
    [mx, rooms, spaces]
  );
  const roomActivityRank = useMemo(() => {
    const rank = new Map<string, number>();
    const size = orderedRoomIds.length;
    orderedRoomIds.forEach((roomId, index) => {
      rank.set(roomId, size - index);
    });
    return rank;
  }, [orderedRoomIds]);

  const orderedDirectIds = useMemo(
    () => [...directs].sort(factoryRoomIdByActivity(mx)),
    [directs, mx]
  );
  const orderedUserRoomIds = useMemo(
    () => [...rooms, ...directs].sort(factoryRoomIdByActivity(mx)),
    [directs, mx, rooms]
  );
  const knownDmRoomByUserId = useMemo(
    () =>
      buildCommandPaletteDmRoomMap({
        directRoomIds: orderedDirectIds,
        getRoom,
        joinedRoomIds: allJoinedRoomIds,
        myUserId,
      }),
    [allJoinedRoomIds, getRoom, myUserId, orderedDirectIds]
  );
  const directActivityRank = useMemo(() => {
    const rank = new Map<string, number>();
    const size = orderedDirectIds.length;

    orderedDirectIds.forEach((roomId, index) => {
      rank.set(roomId, size - index);
    });

    return rank;
  }, [orderedDirectIds]);

  const roomItems = useMemo(
    () =>
      orderedRoomIds.reduce<(CommandPaletteRoomItem & { onSelect: () => void })[]>(
        (items, roomId) => {
          const room = getRoom(roomId);
          if (!room) return items;

          const parentNames = Array.from(getAllParents(roomToParents, room.roomId))
            .map((parentId) => getRoom(parentId)?.name ?? parentId)
            .sort((left, right) => left.localeCompare(right));
          const unread = roomToUnread.get(room.roomId);

          items.push({
            id: room.roomId,
            kind: room.isSpaceRoom() ? 'space' : 'room',
            name: room.name,
            canonicalAlias: room.getCanonicalAlias() ?? undefined,
            topic: getRoomTopic(room),
            parentNames,
            unreadCount: unread?.total,
            unreadHighlight: unread ? unread.highlight > 0 : undefined,
            ...getCommandPaletteRoomRanking({
              roomId: room.roomId,
              selectedRoomId,
              selectedSpaceId,
              activityRank: roomActivityRank.get(room.roomId) ?? 0,
              unreadTotal: unread?.total ?? 0,
              unreadHighlights: unread?.highlight ?? 0,
            }),
            onSelect: () => {
              if (room.isSpaceRoom()) {
                navigateSpace(room.roomId);
                return;
              }

              navigateRoom(room.roomId);
            },
          });

          return items;
        },
        []
      ),
    [
      getRoom,
      navigateRoom,
      navigateSpace,
      orderedRoomIds,
      roomActivityRank,
      roomToParents,
      roomToUnread,
      selectedRoomId,
      selectedSpaceId,
    ]
  );

  const getUserItems = useMemo(() => {
    const cache = new Map<string, readonly (CommandPaletteUserItem & { onSelect: () => void })[]>();
    return ({
      exhaustive,
      includeRelatedRooms,
    }: {
      exhaustive: boolean;
      includeRelatedRooms: boolean;
    }) => {
      const cacheKey = `${includeRelatedRooms}:${exhaustive}`;
      const cachedItems = cache.get(cacheKey);
      if (cachedItems) return cachedItems;

      const items: (CommandPaletteUserItem & { onSelect: () => void })[] = [];
      const { candidates, currentRoomMemberIds } = collectCommandPaletteUserCandidates({
        directUsers,
        exhaustive,
        getRoom,
        includeRelatedRooms,
        myUserId,
        orderedRoomIds: orderedUserRoomIds,
        selectedRoomId,
      });

      // collectCommandPaletteUserCandidates dedupes by userId, so each candidate
      // maps to a unique item; no merge with an existing entry is needed. The
      // collector's addCandidate already rejects empty/self userIds, so no
      // extra guard is required here.
      candidates.forEach(({ userId, displayName, sourceRoomId }) => {
        const existingDmRoomId = knownDmRoomByUserId.get(userId);
        const dmRoom = existingDmRoomId ? getRoom(existingDmRoomId) : undefined;
        const { roomName: dmRoomName, displayName: dmDisplayName } = getCommandPaletteDmUserDetails(
          dmRoom,
          userId
        );
        const localpart = getMxIdLocalPart(userId) ?? userId;
        const target = resolveCommandPaletteUserTarget(userId, existingDmRoomId);
        const baseSortRank = sourceRoomId ? roomActivityRank.get(sourceRoomId) ?? 0 : 0;
        const dmSortRank = existingDmRoomId ? directActivityRank.get(existingDmRoomId) ?? 0 : 0;
        const boost = (existingDmRoomId ? 25 : 0) + (currentRoomMemberIds.has(userId) ? 15 : 0);
        items.push({
          id: userId,
          kind: 'user',
          displayName: displayName ?? dmDisplayName ?? localpart,
          userId,
          localpart,
          dmRoomName,
          existingDmRoomId,
          sortRank: Math.max(baseSortRank, dmSortRank),
          boost,
          onSelect: () => {
            if (target.kind === 'room') {
              navigateRoom(target.roomId);
              return;
            }

            navigate(target.path);
          },
        });
      });

      cache.set(cacheKey, items);
      return items;
    };
  }, [
    directActivityRank,
    directUsers,
    getRoom,
    myUserId,
    navigate,
    navigateRoom,
    knownDmRoomByUserId,
    orderedUserRoomIds,
    roomActivityRank,
    selectedRoomId,
  ]);

  const {
    currentThreadRootId,
    currentThreadResolved,
    currentThreadPinned,
    setCurrentThreadResolved,
    threadItems,
  } = useMindroomCommandPaletteThreadItems({
    mx,
    myUserId,
    allJoinedRoomIds,
    getRoom,
    selectedRoom,
    selectedRoomId,
    currentThreadId,
    navigateRoomThread,
  });

  const actionCallbacks = useMemo<Record<CommandPaletteQuickActionId, () => void>>(
    () => ({
      'open-settings': () => setSettingsModal({}),
      'go-home': () => navigate(commandPaletteStaticActionPaths.goHome),
      'go-direct': () => navigate(commandPaletteStaticActionPaths.goDirect),
      'go-inbox': () => navigate(commandPaletteStaticActionPaths.goInbox),
      'create-room': () => setCreateRoomModal({ spaceId: selectedSpace?.roomId }),
      'create-space': () => setCreateSpaceModal({ spaceId: selectedSpace?.roomId }),
      'mark-current-room-read': () => {
        if (!selectedRoom) return;
        fireAndForget(markRoomAndThreadsAsRead(mx, selectedRoom.roomId, hideActivity));
      },
      'copy-current-room-link': () => {
        if (!selectedRoom) return;
        const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, selectedRoom.roomId);
        const viaServers = isRoomAlias(roomIdOrAlias) ? undefined : getViaServers(selectedRoom);
        copyToClipboard(getMatrixToRoom(roomIdOrAlias, viaServers));
      },
      'open-current-room-settings': () => {
        if (!selectedRoom) return;
        openRoomSettings(selectedRoom.roomId, selectedSpace?.roomId);
      },
      'resolve-current-thread': () => setCurrentThreadResolved(true),
      'unresolve-current-thread': () => setCurrentThreadResolved(false),
      'toggle-theme': () => {
        const nextThemeId = activeTheme.kind === 'dark' ? LightTheme.id : DarkTheme.id;
        setSettings({
          ...settings,
          useSystemTheme: false,
          themeId: nextThemeId,
        });
      },
      logout: () => {
        onLogout?.();
      },
    }),
    [
      activeTheme.kind,
      hideActivity,
      mx,
      navigate,
      onLogout,
      openRoomSettings,
      selectedRoom,
      selectedSpace,
      setSettings,
      setCreateRoomModal,
      setCreateSpaceModal,
      setCurrentThreadResolved,
      setSettingsModal,
      settings,
    ]
  );

  const actions = useMemo(
    () =>
      getCommandPaletteQuickActions(
        {
          currentRoomName: selectedRoom?.name ?? selectedRoom?.roomId,
          currentThreadId: currentThreadRootId,
          isCurrentThreadResolved: currentThreadResolved,
          isCurrentThreadPinned: currentThreadPinned,
        },
        t
      ).map((item) => ({
        ...item,
        onSelect: actionCallbacks[item.id as CommandPaletteQuickActionId],
      })),
    [
      actionCallbacks,
      currentThreadRootId,
      currentThreadResolved,
      currentThreadPinned,
      selectedRoom?.name,
      selectedRoom?.roomId,
      t,
    ]
  );

  const getMessages = useCallback(
    (query: string) =>
      getCommandPaletteMessageTargets(
        {
          query,
          currentRoomId: selectedRoom?.roomId,
          currentRoomName: selectedRoom?.name,
          currentSpaceId: selectedSpace
            ? getCanonicalAliasOrRoomId(mx, selectedSpace.roomId)
            : undefined,
          currentSpaceName: selectedSpace?.name,
        },
        t
      ).map((item) => ({
        ...item,
        onSelect: () => navigate(item.path),
      })),
    [mx, navigate, selectedRoom, selectedSpace, t]
  );

  return {
    actions,
    threads: threadItems,
    rooms: roomItems,
    getUsers: getUserItems,
    getMessages,
  };
};
