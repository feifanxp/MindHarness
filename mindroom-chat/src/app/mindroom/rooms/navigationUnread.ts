import { atom } from 'jotai';
import { RoomToUnread } from '../../../types/matrix/room';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { archivedRoomsAtom, isRoomVisible } from './archivedRooms';

// Space aggregates track the leaf rooms contributing their counts. Exclude
// archives only for navigation; notification state and read receipts stay intact.
export const navigationRoomToUnreadAtom = atom((get): RoomToUnread => {
  const source = get(roomToUnreadAtom);
  const archived = get(archivedRoomsAtom);
  if (archived.size === 0) return source;
  const visible: RoomToUnread = new Map();
  source.forEach((unread, roomId) => {
    if (!isRoomVisible(roomId, archived)) return;
    if (!unread.from) {
      visible.set(roomId, unread);
      return;
    }
    const from = new Set(unread.from);
    let { total, highlight } = unread;
    unread.from.forEach((childId) => {
      if (isRoomVisible(childId, archived)) return;
      from.delete(childId);
      const child = source.get(childId);
      total -= child?.total ?? 0;
      highlight -= child?.highlight ?? 0;
    });
    if (from.size > 0) visible.set(roomId, { from, total, highlight });
  });
  return visible;
});
