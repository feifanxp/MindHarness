import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { RoomEvent, RoomStateEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { getStateEvent } from '../../utils/room';
import {
  canPinRoomEvents,
  getPinnedEventIds,
  setRoomEventPinned,
  subscribePendingPins,
  getPendingPinsVersion,
  getPendingPinnedEventIds,
} from './threadPinning';

export const usePinnedEventIds = (room: Room): string[] => {
  const [stateVersion, refresh] = useForceUpdate();
  useEffect(() => {
    const handleState = (event: MatrixEvent) => {
      if (event.getType() === StateEvent.RoomPinnedEvents && event.getStateKey() === '') refresh();
    };
    room.on(RoomStateEvent.Events, handleState);
    room.on(RoomEvent.CurrentStateUpdated, refresh);
    return () => {
      room.removeListener(RoomStateEvent.Events, handleState);
      room.removeListener(RoomEvent.CurrentStateUpdated, refresh);
    };
  }, [room, refresh]);
  const version = useSyncExternalStore(
    subscribePendingPins,
    getPendingPinsVersion,
    getPendingPinsVersion
  );
  return useMemo(() => {
    void version;
    void stateVersion;
    return (
      getPendingPinnedEventIds(room) ??
      getPinnedEventIds(getStateEvent(room, StateEvent.RoomPinnedEvents)?.getContent())
    );
  }, [room, version, stateVersion]);
};

export const useThreadPinning = (room: Room) => {
  const mx = useMatrixClient();
  const powers = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const pinnedEventIds = usePinnedEventIds(room);
  const [state, updatePin] = useAsyncCallback(
    useCallback(
      (eventId: string, pinned: boolean) => setRoomEventPinned(mx, room, eventId, pinned),
      [mx, room]
    )
  );
  const setPinned = useCallback(
    (eventId: string, pinned: boolean) => {
      return updatePin(eventId, pinned).then(
        () => true,
        () => false
      );
    },
    [updatePin]
  );
  return {
    pinnedEventIds,
    canPin: canPinRoomEvents(creators, powers, mx.getSafeUserId()),
    setPinned,
    updating: state.status === AsyncStatus.Loading,
    error: state.status === AsyncStatus.Error ? state.error : undefined,
  };
};
