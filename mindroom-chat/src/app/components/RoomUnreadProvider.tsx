import { ReactElement } from 'react';
import { Atom } from 'jotai';
import { RoomToUnread, Unread } from '../../types/matrix/room';
import { useRoomUnread, useRoomsUnread } from '../state/hooks/unread';
import { roomToUnreadAtom } from '../state/room/roomToUnread';

type RoomUnreadProviderProps = {
  roomId: string;
  children: (unread?: Unread) => ReactElement;
  unreadAtom?: Atom<RoomToUnread>;
};
export function RoomUnreadProvider({
  roomId,
  children,
  unreadAtom = roomToUnreadAtom,
}: RoomUnreadProviderProps) {
  const unread = useRoomUnread(roomId, unreadAtom);

  return children(unread);
}

type RoomsUnreadProviderProps = {
  rooms: string[];
  children: (unread?: Unread) => ReactElement;
  unreadAtom?: Atom<RoomToUnread>;
};
export function RoomsUnreadProvider({
  rooms,
  children,
  unreadAtom = roomToUnreadAtom,
}: RoomsUnreadProviderProps) {
  const unread = useRoomsUnread(rooms, unreadAtom);

  return children(unread);
}
