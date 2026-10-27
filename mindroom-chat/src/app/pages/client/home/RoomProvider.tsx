import React, { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useSelectedRoomResolution } from '../../../hooks/router/useSelectedRoom';
import { IsDirectRoomProvider, RoomProvider } from '../../../hooks/useRoom';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { JoinBeforeNavigate } from '../../../features/join-before-navigate';
import { useHomeRooms } from './useHomeRooms';
import { useSearchParamsViaServers } from '../../../hooks/router/useSearchParamsViaServers';
import { shouldDeferRoomRouteFallback, canRenderRoutedRoom } from '../routeVisibility';
import { useClientStartupContext } from '../ClientStartupContext';

export function HomeRouteRoomProvider({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const rooms = useHomeRooms();

  const { roomIdOrAlias, eventId } = useParams();
  const viaServers = useSearchParamsViaServers();
  const { roomId, isResolvingAlias } = useSelectedRoomResolution();
  const room = mx.getRoom(roomId);
  const { hasCompletedInitialSync } = useClientStartupContext();

  if (
    shouldDeferRoomRouteFallback({
      hasCompletedInitialSync,
      isResolvingAlias,
      room,
      routedRoomIds: rooms,
    })
  ) {
    return null;
  }

  if (!room || !canRenderRoutedRoom(room, rooms)) {
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
      <IsDirectRoomProvider value={false}>{children}</IsDirectRoomProvider>
    </RoomProvider>
  );
}
