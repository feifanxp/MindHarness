import React, { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useSelectedRoomResolution } from '../../../hooks/router/useSelectedRoom';
import { IsDirectRoomProvider, RoomProvider } from '../../../hooks/useRoom';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { JoinBeforeNavigate } from '../../../features/join-before-navigate';
import { useDirectRooms } from './useDirectRooms';
import { shouldDeferRoomRouteFallback, canRenderRoutedRoom } from '../routeVisibility';
import { useClientStartupContext } from '../ClientStartupContext';

export function DirectRouteRoomProvider({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const rooms = useDirectRooms();

  const { roomIdOrAlias, eventId } = useParams();
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
    return <JoinBeforeNavigate roomIdOrAlias={roomIdOrAlias!} eventId={eventId} />;
  }

  return (
    <RoomProvider key={room.roomId} value={room}>
      <IsDirectRoomProvider value>{children}</IsDirectRoomProvider>
    </RoomProvider>
  );
}
