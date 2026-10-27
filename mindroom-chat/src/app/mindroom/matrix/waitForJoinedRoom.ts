import { ClientEvent, MatrixClient, Room } from 'matrix-js-sdk';

/** Resolves once a room the client just created or joined arrives through sync. */
export const waitForJoinedRoom = (
  mx: MatrixClient,
  roomId: string,
  timeoutMs = 15_000
): Promise<Room> => {
  const currentRoom = mx.getRoom(roomId);
  if (currentRoom) return Promise.resolve(currentRoom);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      mx.removeListener(ClientEvent.Room, handleRoom);
    };
    const handleRoom = (room: Room) => {
      if (room.roomId !== roomId) return;
      cleanup();
      resolve(room);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('The room did not become available in time.'));
    }, timeoutMs);

    mx.on(ClientEvent.Room, handleRoom);

    // Avoid missing the room if sync completed between the first lookup and listener setup.
    const roomAfterSubscribe = mx.getRoom(roomId);
    if (roomAfterSubscribe) handleRoom(roomAfterSubscribe);
  });
};
