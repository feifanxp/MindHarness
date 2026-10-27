import { atom, useAtomValue, useSetAtom } from 'jotai';
import { ClientEvent, MatrixClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { useEffect, useMemo } from 'react';
import { allRoomsAtom } from '../../state/room-list/roomList';

const ARCHIVED_ROOM_EVENT = 'io.mindroom.archived';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isRoomArchived = (content: unknown): boolean =>
  isRecord(content) && content.archived === true;

export const archivedRoomsAtom = atom<Set<string>>(new Set<string>());

export const isRoomVisible = (roomId: string, archived: ReadonlySet<string>): boolean =>
  !archived.has(roomId);

export const useVisibleRooms = (rooms: string[]): string[] => {
  const archived = useAtomValue(archivedRoomsAtom);
  return useMemo(() => rooms.filter((id) => isRoomVisible(id, archived)), [rooms, archived]);
};

// Keep membership and routing on allRoomsAtom; only navigation hides archives.
export const navigationRoomsAtom = atom((get) => {
  const archived = get(archivedRoomsAtom);
  return get(allRoomsAtom).filter((id) => isRoomVisible(id, archived));
});

export const joinedArchivedRoomsAtom = atom((get) => {
  const archived = get(archivedRoomsAtom);
  return get(allRoomsAtom).filter((id) => archived.has(id));
});

export const useBindArchivedRoomsAtom = (mx: MatrixClient) => {
  const setArchived = useSetAtom(archivedRoomsAtom);
  useEffect(() => {
    const updateRoom = (roomId: string, archived: boolean) => {
      setArchived((current) => {
        if (current.has(roomId) === archived) return current;
        const next = new Set(current);
        if (archived) next.add(roomId);
        else next.delete(roomId);
        return next;
      });
    };
    const handleRoom = (room: Room) => {
      updateRoom(
        room.roomId,
        isRoomArchived(room.getAccountData(ARCHIVED_ROOM_EVENT)?.getContent())
      );
    };
    const handleAccountData = (event: MatrixEvent, room: Room) => {
      if (event.getType() === ARCHIVED_ROOM_EVENT) {
        updateRoom(room.roomId, isRoomArchived(event.getContent()));
      }
    };
    const handleDeleteRoom = (roomId: string) => updateRoom(roomId, false);
    mx.on(RoomEvent.AccountData, handleAccountData);
    mx.on(ClientEvent.Room, handleRoom);
    mx.on(ClientEvent.DeleteRoom, handleDeleteRoom);
    setArchived(
      new Set(
        mx
          .getRooms()
          .filter((room) => isRoomArchived(room.getAccountData(ARCHIVED_ROOM_EVENT)?.getContent()))
          .map((room) => room.roomId)
      )
    );
    return () => {
      mx.removeListener(RoomEvent.AccountData, handleAccountData);
      mx.removeListener(ClientEvent.Room, handleRoom);
      mx.removeListener(ClientEvent.DeleteRoom, handleDeleteRoom);
    };
  }, [mx, setArchived]);
};

const writeTails = new WeakMap<MatrixClient, Promise<void>>();

export const setRoomArchived = (
  mx: MatrixClient,
  roomId: string,
  archived: boolean
): Promise<void> => {
  const task = (writeTails.get(mx) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const content: unknown = mx
        .getRoom(roomId)
        ?.getAccountData(ARCHIVED_ROOM_EVENT)
        ?.getContent();
      if (isRoomArchived(content) === archived) return;
      // Room-scoped writes cannot overwrite another room's choice on another device.
      // Wait for sync before accepting a second toggle, just like setAccountData.
      let synced!: () => void;
      const echo = new Promise<void>((resolve) => {
        synced = resolve;
      });
      const handleAccountData = (event: MatrixEvent, room: Room) => {
        if (room.roomId === roomId && event.getType() === ARCHIVED_ROOM_EVENT) synced();
      };
      mx.on(RoomEvent.AccountData, handleAccountData);
      try {
        await mx.setRoomAccountData(
          roomId,
          ARCHIVED_ROOM_EVENT as any,
          {
            ...(isRecord(content) ? content : {}),
            archived,
          } as any
        );
        await echo;
      } finally {
        mx.removeListener(RoomEvent.AccountData, handleAccountData);
      }
    });
  writeTails.set(mx, task);
  return task;
};
