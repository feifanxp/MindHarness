import { MatrixEvent, Room } from 'matrix-js-sdk';

let threadOpenSeedSnapshots = new WeakMap<Room, Map<string, MatrixEvent[]>>();
export const clearRoomThreadOpenSeedSnapshots = (room: Room): void => {
  threadOpenSeedSnapshots.delete(room);
};

const getRoomThreadOpenSeedStore = (room: Room): Map<string, MatrixEvent[]> => {
  let roomStore = threadOpenSeedSnapshots.get(room);
  if (!roomStore) {
    roomStore = new Map<string, MatrixEvent[]>();
    threadOpenSeedSnapshots.set(room, roomStore);
  }
  return roomStore;
};

export const getThreadOpenSeedSnapshot = (room: Room, threadId: string): MatrixEvent[] =>
  getRoomThreadOpenSeedStore(room).get(threadId)?.slice() ?? [];

export const saveThreadOpenSeedSnapshot = (
  room: Room,
  threadId: string,
  events: MatrixEvent[]
): void => {
  if (events.length === 0) return;
  getRoomThreadOpenSeedStore(room).set(threadId, events.slice());
};

export const clearThreadOpenSeedSnapshotsForTests = (): void => {
  threadOpenSeedSnapshots = new WeakMap<Room, Map<string, MatrixEvent[]>>();
};
