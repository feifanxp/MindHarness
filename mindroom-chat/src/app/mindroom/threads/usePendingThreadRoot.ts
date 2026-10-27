import { useEffect, useReducer, useRef } from 'react';
import {
  EventStatus,
  RoomEvent,
  type MatrixEvent,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';

/**
 * Follow the local echo behind a thread opened before the server confirmed its root.
 * Rerenders when its send status changes, and calls onDeleted when the echo is
 * cancelled, because the thread route then points at nothing.
 */
export const usePendingThreadRoot = (
  room: Room,
  rootId: string | undefined,
  onDeleted: () => void
): MatrixEvent | undefined => {
  const [, refresh] = useReducer((version: number) => version + 1, 0);
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  useEffect(() => {
    if (!rootId) return undefined;

    const handleLocalEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event) => {
      if (event.getId() !== rootId) return;
      if (event.status === EventStatus.CANCELLED) onDeletedRef.current();
      else refresh();
    };
    room.on(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    return () => {
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    };
  }, [room, rootId]);

  return rootId ? room.findEventById(rootId) : undefined;
};
