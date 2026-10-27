import React, { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSpaces } from '../../../state/hooks/roomList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useSelectedSpaceResolution } from '../../../hooks/router/useSelectedSpace';
import { SpaceProvider } from '../../../hooks/useSpace';
import { JoinBeforeNavigate } from '../../../features/join-before-navigate';
import { useSearchParamsViaServers } from '../../../hooks/router/useSearchParamsViaServers';
import { shouldDeferRoomRouteFallback, canRenderRoutedRoom } from '../routeVisibility';
import { useClientStartupContext } from '../ClientStartupContext';

type RouteSpaceProviderProps = {
  children: ReactNode;
};
export function RouteSpaceProvider({ children }: RouteSpaceProviderProps) {
  const mx = useMatrixClient();
  const joinedSpaces = useSpaces(mx, allRoomsAtom);

  const { spaceIdOrAlias } = useParams();
  const viaServers = useSearchParamsViaServers();

  const { roomId: selectedSpaceId, isResolvingAlias } = useSelectedSpaceResolution();
  const space = mx.getRoom(selectedSpaceId);
  const { hasCompletedInitialSync } = useClientStartupContext();

  if (
    shouldDeferRoomRouteFallback({
      hasCompletedInitialSync,
      isResolvingAlias,
      room: space,
      routedRoomIds: joinedSpaces,
    })
  ) {
    return null;
  }

  if (!space?.isSpaceRoom() || !canRenderRoutedRoom(space, joinedSpaces)) {
    return <JoinBeforeNavigate roomIdOrAlias={spaceIdOrAlias ?? ''} viaServers={viaServers} />;
  }

  return (
    <SpaceProvider key={space.roomId} value={space}>
      {children}
    </SpaceProvider>
  );
}
