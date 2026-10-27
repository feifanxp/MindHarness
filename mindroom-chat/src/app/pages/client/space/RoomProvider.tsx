import React, { ReactNode, useLayoutEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAtom, useAtomValue } from 'jotai';
import { useSelectedRoomResolution } from '../../../hooks/router/useSelectedRoom';
import { IsDirectRoomProvider, RoomProvider } from '../../../hooks/useRoom';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { JoinBeforeNavigate } from '../../../features/join-before-navigate';
import { useSpace } from '../../../hooks/useSpace';
import { getAllParents, getSpaceChildren } from '../../../utils/room';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useSearchParamsViaServers } from '../../../hooks/router/useSearchParamsViaServers';
import { mDirectAtom } from '../../../state/mDirectList';
import { settingsAtom } from '../../../state/settings';
import { useSetting } from '../../../state/hooks/settings';
import { resolveSpaceRouteRoomAccess, shouldDeferSpaceRoomRouteFallback } from '../routeVisibility';
import { useClientStartupContext } from '../ClientStartupContext';

export function SpaceRouteRoomProvider({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const space = useSpace();
  const [developerTools] = useSetting(settingsAtom, 'developerTools');
  const [roomToParents, setRoomToParents] = useAtom(roomToParentsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const allRooms = useAtomValue(allRoomsAtom);

  const { roomIdOrAlias, eventId } = useParams();
  const viaServers = useSearchParamsViaServers();
  const { roomId, isResolvingAlias } = useSelectedRoomResolution();
  const room = mx.getRoom(roomId);
  const { hasCompletedInitialSync } = useClientStartupContext();
  const hasMappedParent = !!room && getAllParents(roomToParents, room.roomId).has(space.roomId);
  const isListedChild = !!room && getSpaceChildren(space).includes(room.roomId);
  const access = resolveSpaceRouteRoomAccess({
    room,
    routedRoomIds: allRooms,
    developerTools,
    selectedSpaceId: space.roomId,
    hasMappedParent,
    isListedChild,
  });

  useLayoutEffect(() => {
    if (!room || !access.shouldBackfillParent) return;

    setRoomToParents({
      type: 'PUT',
      parent: space.roomId,
      children: [room.roomId],
    });
  }, [access.shouldBackfillParent, room, setRoomToParents, space.roomId]);

  if (
    shouldDeferSpaceRoomRouteFallback({
      hasCompletedInitialSync,
      isResolvingAlias,
      access,
    })
  ) {
    return null;
  }

  if (!room || !access.canRender) {
    return (
      <JoinBeforeNavigate
        roomIdOrAlias={roomIdOrAlias!}
        eventId={eventId}
        viaServers={viaServers}
      />
    );
  }

  return (
    <RoomProvider key={room.roomId} value={room}>
      <IsDirectRoomProvider value={mDirects.has(room.roomId)}>{children}</IsDirectRoomProvider>
    </RoomProvider>
  );
}
