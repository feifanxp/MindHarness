import { Room } from 'matrix-js-sdk';
import { Membership } from '../../../types/matrix/room';

type RoutedRoom = Pick<Room, 'roomId' | 'getMyMembership' | 'isSpaceRoom'>;

type SpaceRouteRoomAccess = {
  canRender: boolean;
  shouldBackfillParent: boolean;
};

type StartupFallbackState = {
  hasCompletedInitialSync: boolean;
  isResolvingAlias: boolean;
};

export const isJoinedRoom = (room: RoutedRoom | null | undefined): boolean =>
  room?.getMyMembership() === Membership.Join;

export const canRenderRoutedRoom = (
  room: RoutedRoom | null | undefined,
  routedRoomIds: string[]
): boolean => !!room && (routedRoomIds.includes(room.roomId) || isJoinedRoom(room));

export const shouldDeferRoomRouteFallback = ({
  hasCompletedInitialSync,
  isResolvingAlias,
  room,
  routedRoomIds,
}: StartupFallbackState & {
  room: RoutedRoom | null | undefined;
  routedRoomIds: string[];
}): boolean =>
  isResolvingAlias || (!hasCompletedInitialSync && !canRenderRoutedRoom(room, routedRoomIds));

export const shouldDeferSpaceRoomRouteFallback = ({
  hasCompletedInitialSync,
  isResolvingAlias,
  access,
}: StartupFallbackState & {
  access: SpaceRouteRoomAccess;
}): boolean => isResolvingAlias || (!hasCompletedInitialSync && !access.canRender);

export const resolveSpaceRouteRoomAccess = ({
  room,
  routedRoomIds,
  developerTools,
  selectedSpaceId,
  hasMappedParent,
  isListedChild,
}: {
  room: RoutedRoom | null | undefined;
  routedRoomIds: string[];
  developerTools: boolean;
  selectedSpaceId: string;
  hasMappedParent: boolean;
  isListedChild: boolean;
}): SpaceRouteRoomAccess => {
  if (!canRenderRoutedRoom(room, routedRoomIds)) {
    return {
      canRender: false,
      shouldBackfillParent: false,
    };
  }

  if (developerTools && room?.isSpaceRoom() && room.roomId === selectedSpaceId) {
    return {
      canRender: true,
      shouldBackfillParent: false,
    };
  }

  if (hasMappedParent || isListedChild) {
    return {
      canRender: true,
      shouldBackfillParent: isListedChild && !hasMappedParent,
    };
  }

  return {
    canRender: false,
    shouldBackfillParent: false,
  };
};
