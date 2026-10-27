import React from 'react';
import { EventEmitter } from 'events';
import { Provider, createStore } from 'jotai';
import { ClientEvent, MatrixClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { useRoomArchiveAction } from './useRoomArchiveAction';
import { allRoomsAtom } from '../../state/room-list/roomList';
import {
  archivedRoomsAtom,
  navigationRoomsAtom,
  joinedArchivedRoomsAtom,
  isRoomArchived,
  setRoomArchived,
  useBindArchivedRoomsAtom,
  useVisibleRooms,
} from './archivedRooms';

const eventType = 'io.mindroom.archived';
const makeClient = (initial: Record<string, Record<string, unknown>> = {}) => {
  const emitter = new EventEmitter();
  const contents = new Map(Object.entries(initial));
  const getRoom = (roomId: string) =>
    ({
      roomId,
      getAccountData: (type: string) =>
        type === eventType
          ? new MatrixEvent({ type, content: contents.get(roomId) ?? {} })
          : undefined,
    } as Room);
  const sync = (roomId: string, next: Record<string, unknown>, type = eventType) => {
    if (type === eventType) contents.set(roomId, next);
    emitter.emit(RoomEvent.AccountData, new MatrixEvent({ type, content: next }), getRoom(roomId));
  };
  const setRoomAccountData = vi.fn(
    async (roomId: string, type: string, next: Record<string, unknown>) => {
      sync(roomId, next, type);
      return {};
    }
  );
  const mx = Object.assign(emitter, {
    getRooms: () => [...contents.keys()].map(getRoom),
    getRoom,
    setRoomAccountData,
  }) as unknown as MatrixClient;
  return { mx, setRoomAccountData, sync };
};

function Bind({ mx }: { mx: MatrixClient }) {
  useBindArchivedRoomsAtom(mx);
  return null;
}

describe('archived rooms', () => {
  it('keeps another room’s remote update when the local write completes', async () => {
    const { mx, setRoomAccountData, sync } = makeClient();
    setRoomAccountData.mockImplementationOnce(async (roomId, type, next) => {
      sync('!b:test', { archived: true, future: 'remote' });
      sync(roomId, next, type);
      return {};
    });
    await setRoomArchived(mx, '!a:test', true);
    expect(mx.getRoom('!a:test')?.getAccountData(eventType)?.getContent()).toEqual({
      archived: true,
    });
    expect(mx.getRoom('!b:test')?.getAccountData(eventType)?.getContent()).toEqual({
      archived: true,
      future: 'remote',
    });
  });
  it('updates an existing navigation list when rooms are archived or restored', () => {
    const store = createStore();
    const rooms = ['!a:test', '!b:test'];
    let visible: string[] = [];
    function Navigation() {
      visible = useVisibleRooms(rooms);
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Navigation />
        </Provider>
      );
    });
    expect(visible).toEqual(['!a:test', '!b:test']);
    act(() => {
      store.set(archivedRoomsAtom, new Set(['!a:test']));
    });
    expect(visible).toEqual(['!b:test']);
    act(() => {
      store.set(archivedRoomsAtom, new Set());
    });
    expect(visible).toEqual(['!a:test', '!b:test']);
    expect(rooms).toEqual(['!a:test', '!b:test']);
    act(() => renderer.unmount());
  });
  it('ignores malformed room account data', () => {
    for (const content of [null, [], {}, { archived: 'true' }, { archived: false }]) {
      expect(isRoomArchived(content)).toBe(false);
    }
    expect(isRoomArchived({ archived: true, future: 'keep' })).toBe(true);
  });

  it('hides archived rooms from navigation without removing joined membership', () => {
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: ['!a:test', '!b:test'] });
    store.set(archivedRoomsAtom, new Set(['!a:test', '!left:test']));
    expect(store.get(navigationRoomsAtom)).toEqual(['!b:test']);
    expect(store.get(joinedArchivedRoomsAtom)).toEqual(['!a:test']);
    expect(store.get(allRoomsAtom)).toEqual(['!a:test', '!b:test']);
    store.set(allRoomsAtom, { type: 'DELETE', roomId: '!a:test' });
    expect(store.get(joinedArchivedRoomsAtom)).toEqual([]);
    store.set(allRoomsAtom, { type: 'PUT', roomId: '!a:test' });
    expect(store.get(joinedArchivedRoomsAtom)).toEqual(['!a:test']);
    expect(store.get(navigationRoomsAtom)).toEqual(['!b:test']);
    store.set(archivedRoomsAtom, new Set());
    expect(store.get(navigationRoomsAtom)).toEqual(['!b:test', '!a:test']);
  });

  it('serializes toggles and preserves unknown fields within the room', async () => {
    const { mx, setRoomAccountData, sync } = makeClient({
      '!a:test': { archived: false, future: 'keep' },
    });
    let completeHttp!: () => void;
    setRoomAccountData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeHttp = () => resolve({});
        })
    );
    const first = setRoomArchived(mx, '!a:test', true);
    const second = setRoomArchived(mx, '!a:test', false);
    await vi.waitFor(() => expect(setRoomAccountData).toHaveBeenCalledTimes(1));
    sync('!a:test', { archived: true, future: 'keep' });
    await Promise.resolve();
    expect(setRoomAccountData).toHaveBeenCalledTimes(1);
    completeHttp();
    await Promise.all([first, second]);
    expect(mx.getRoom('!a:test')?.getAccountData(eventType)?.getContent()).toEqual({
      archived: false,
      future: 'keep',
    });
    expect(mx.listenerCount(RoomEvent.AccountData)).toBe(0);
  });

  it('waits for the room sync echo before completing the action', async () => {
    const { mx, setRoomAccountData, sync } = makeClient();
    setRoomAccountData.mockResolvedValueOnce({});
    let completed = false;
    const pending = setRoomArchived(mx, '!a:test', true).then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(setRoomAccountData).toHaveBeenCalledTimes(1));
    sync('!b:test', { archived: true });
    sync('!a:test', {}, 'unrelated');
    await Promise.resolve();
    expect(completed).toBe(false);
    sync('!a:test', { archived: true });
    await pending;
    expect(completed).toBe(true);
    expect(mx.listenerCount(RoomEvent.AccountData)).toBe(0);
  });

  it('keeps failed writes out of state and permits retry', async () => {
    const { mx, setRoomAccountData } = makeClient();
    setRoomAccountData.mockRejectedValueOnce(new Error('offline'));
    await expect(setRoomArchived(mx, '!a:test', true)).rejects.toThrow('offline');
    expect(isRoomArchived(mx.getRoom('!a:test')?.getAccountData(eventType)?.getContent())).toBe(
      false
    );
    expect(mx.listenerCount(RoomEvent.AccountData)).toBe(0);
    await setRoomArchived(mx, '!a:test', true);
    expect(mx.getRoom('!a:test')?.getAccountData(eventType)?.getContent()).toEqual({
      archived: true,
    });
  });

  it('hydrates saved archives, reacts to remote updates, and resets on account switch', async () => {
    const store = createStore();
    const { mx, sync } = makeClient({ '!saved:test': { archived: true } });
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Bind mx={mx} />
        </Provider>
      );
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual(['!saved:test']);
    act(() => {
      sync('!saved:test', { archived: false }, 'unrelated');
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual(['!saved:test']);
    await act(async () => {
      await setRoomArchived(mx, '!new:test', true);
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual(['!saved:test', '!new:test']);
    act(() => {
      sync('!saved:test', { archived: false });
      const newRoom = {
        roomId: '!joined:test',
        getAccountData: () => new MatrixEvent({ type: eventType, content: { archived: true } }),
      } as Room;
      mx.emit(ClientEvent.Room, newRoom);
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual(['!new:test', '!joined:test']);
    act(() => {
      mx.emit(ClientEvent.DeleteRoom, '!joined:test');
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual(['!new:test']);
    const other = makeClient().mx;
    act(() => {
      renderer.update(
        <Provider store={store}>
          <Bind mx={other} />
        </Provider>
      );
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual([]);
    expect(mx.listenerCount(RoomEvent.AccountData)).toBe(0);
    act(() => renderer.unmount());
    expect(other.listenerCount(RoomEvent.AccountData)).toBe(0);
  });
});

describe('archive action feedback', () => {
  it('blocks duplicate clicks, reports failure, and permits a successful retry', async () => {
    const { mx, setRoomAccountData } = makeClient();
    const done = vi.fn();
    let rejectWrite!: (error: Error) => void;
    setRoomAccountData.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject;
        })
    );
    let action!: ReturnType<typeof useRoomArchiveAction>;
    function Action() {
      useBindArchivedRoomsAtom(mx);
      action = useRoomArchiveAction('!a:test', done);
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Provider>
          <MatrixClientProvider value={mx}>
            <Action />
          </MatrixClientProvider>
        </Provider>
      );
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = action.toggle();
      await action.toggle();
    });
    expect(action.busy).toBe(true);
    expect(setRoomAccountData).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectWrite(new Error('offline'));
      await pending;
    });
    expect(action.failed).toBe(true);
    expect(action.busy).toBe(false);
    expect(action.archived).toBe(false);
    expect(done).not.toHaveBeenCalled();
    await act(async () => {
      await action.toggle();
    });
    expect(action.failed).toBe(false);
    expect(action.archived).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);
    await act(async () => {
      await action.toggle();
    });
    expect(action.archived).toBe(false);
    expect(setRoomAccountData).toHaveBeenLastCalledWith('!a:test', eventType, { archived: false });
    act(() => renderer.unmount());
  });
});
