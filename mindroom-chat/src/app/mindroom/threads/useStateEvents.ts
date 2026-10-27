import { MatrixEvent, Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { StateEvent } from '../../../types/matrix/room';
import { useRoomState } from '../../hooks/useRoomState';

export const useStateEvents = (room: Room, eventType: StateEvent | string): MatrixEvent[] => {
  const roomState = useRoomState(room);

  return useMemo(() => {
    const stateKeyToEvents = roomState.get(eventType);
    if (!stateKeyToEvents) return [];

    return Array.from(stateKeyToEvents.values());
  }, [eventType, roomState]);
};
