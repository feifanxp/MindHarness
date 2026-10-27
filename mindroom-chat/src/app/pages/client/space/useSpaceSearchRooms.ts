import { useAtomValue } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { RoomToParents } from '../../../../types/matrix/room';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { getAllParents, getRoomToParents, isRoom } from '../../../utils/room';

export const mergeSearchRoomSources = (
  sdkRoomIds: string[],
  allRoomIds: string[]
): string[] => Array.from(new Set([...sdkRoomIds, ...allRoomIds]));

export const mergeRoomToParentsSources = (...sources: RoomToParents[]): RoomToParents => {
  const merged: RoomToParents = new Map();

  sources.forEach((source) => {
    source.forEach((parents, childId) => {
      const mergedParents = merged.get(childId) ?? new Set<string>();
      parents.forEach((parentId) => mergedParents.add(parentId));
      merged.set(childId, mergedParents);
    });
  });

  return merged;
};

export const getSpaceSearchRooms = (
  mx: MatrixClient,
  spaceId: string,
  allRoomIds: string[],
  mDirects: Set<string>,
  roomToParents: RoomToParents
): string[] =>
  allRoomIds.filter(
    (roomId) =>
      isRoom(mx.getRoom(roomId)) &&
      !mDirects.has(roomId) &&
      roomToParents.has(roomId) &&
      getAllParents(roomToParents, roomId).has(spaceId)
  );

export const useSpaceSearchRooms = (spaceId: string) => {
  const mx = useMatrixClient();
  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const sdkRoomIdsKey = mx
    .getRooms()
    .map((room) => room.roomId)
    .join('\n');

  return useMemo(() => {
    const sdkRoomIds = sdkRoomIdsKey ? sdkRoomIdsKey.split('\n') : [];
    const mergedRoomToParents = mergeRoomToParentsSources(roomToParents, getRoomToParents(mx));

    return getSpaceSearchRooms(
      mx,
      spaceId,
      mergeSearchRoomSources(sdkRoomIds, allRooms),
      mDirects,
      mergedRoomToParents
    );
  }, [allRooms, mDirects, mx, roomToParents, sdkRoomIdsKey, spaceId]);
};
