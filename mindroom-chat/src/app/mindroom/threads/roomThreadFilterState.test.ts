import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StorageListener = (event: StorageEvent) => void;

describe('roomThreadFilterState', () => {
  const storageState = new Map<string, string>();
  const storageListeners = new Set<StorageListener>();
  let localStorageMock: Storage;

  const emitStorageEvent = (key: string) => {
    storageListeners.forEach((listener) => listener({ key } as StorageEvent));
  };

  beforeEach(() => {
    vi.resetModules();
    storageState.clear();
    storageListeners.clear();

    localStorageMock = {
      get length() {
        return storageState.size;
      },
      clear: vi.fn(() => {
        storageState.clear();
      }),
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(storageState.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
    } as unknown as Storage;

    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') {
          storageListeners.add(listener);
        }
      }),
      removeEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') {
          storageListeners.delete(listener);
        }
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storageState.clear();
    storageListeners.clear();
  });

  it('stores state under a user-and-room-scoped key', async () => {
    const { createDefaultThreadFilterState, serializeThreadFilterState } = await import(
      './roomThreadOverviewModel'
    );
    const { getRoomThreadFilterStorageKey, roomThreadFilterAtomFamily } = await import(
      './roomThreadFilterState'
    );

    const userId = '@alice:example.org';
    const roomId = '!room-a:example.org';
    const atom = roomThreadFilterAtomFamily(userId, roomId);
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    store.set(atom, {
      ...createDefaultThreadFilterState(),
      resolved: 'include',
    });

    const storageKey = getRoomThreadFilterStorageKey(userId, roomId);
    expect(storageState.get(storageKey)).toBe(
      JSON.stringify(
        serializeThreadFilterState({
          ...createDefaultThreadFilterState(),
          resolved: 'include',
        })
      )
    );

    unmount();
  });

  it('removes the localStorage key when the filter resets to default', async () => {
    const { createDefaultThreadFilterState } = await import('./roomThreadOverviewModel');
    const { getRoomThreadFilterStorageKey, roomThreadFilterAtomFamily } = await import(
      './roomThreadFilterState'
    );

    const userId = '@alice:example.org';
    const roomId = '!room-a:example.org';
    const atom = roomThreadFilterAtomFamily(userId, roomId);
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    store.set(atom, {
      ...createDefaultThreadFilterState(),
      resolved: 'include',
    });
    store.set(atom, createDefaultThreadFilterState());

    expect(storageState.has(getRoomThreadFilterStorageKey(userId, roomId))).toBe(false);

    unmount();
  });

  it('clears only the selected users stored thread filters', async () => {
    const { clearRoomThreadFiltersStore, getRoomThreadFilterStorageKey } = await import(
      './roomThreadFilterState'
    );

    const aliceRoomA = getRoomThreadFilterStorageKey('@alice:example.org', '!room-a:example.org');
    const aliceRoomB = getRoomThreadFilterStorageKey('@alice:example.org', '!room-b:example.org');
    const bobRoomA = getRoomThreadFilterStorageKey('@bob:example.org', '!room-a:example.org');

    localStorageMock.setItem(aliceRoomA, '{"v":1}');
    localStorageMock.setItem(aliceRoomB, '{"v":1}');
    localStorageMock.setItem(bobRoomA, '{"v":1}');
    localStorageMock.setItem('unrelated', 'keep');

    clearRoomThreadFiltersStore('@alice:example.org');

    expect(storageState.has(aliceRoomA)).toBe(false);
    expect(storageState.has(aliceRoomB)).toBe(false);
    expect(storageState.get(bobRoomA)).toBe('{"v":1}');
    expect(storageState.get('unrelated')).toBe('keep');
  });

  it('evicts cached atom-family entries so a removed account re-added in the same tab loads defaults', async () => {
    const { createDefaultThreadFilterState } = await import('./roomThreadOverviewModel');
    const {
      clearRoomThreadFiltersStore,
      getRoomThreadFilterStorageKey,
      roomThreadFilterAtomFamily,
    } = await import('./roomThreadFilterState');

    const userId = '@alice:example.org';
    const roomId = '!room-a:example.org';
    const persistedState = {
      ...createDefaultThreadFilterState(),
      resolved: 'include' as const,
    };
    const storageKey = getRoomThreadFilterStorageKey(userId, roomId);

    const originalAtom = roomThreadFilterAtomFamily(userId, roomId);
    const originalStore = createStore();
    const unmountOriginal = originalStore.sub(originalAtom, () => undefined);

    originalStore.set(originalAtom, persistedState);
    expect(originalStore.get(originalAtom).resolved).toBe('include');
    expect(storageState.has(storageKey)).toBe(true);

    unmountOriginal();

    clearRoomThreadFiltersStore(userId);

    expect(storageState.has(storageKey)).toBe(false);

    const readdedAtom = roomThreadFilterAtomFamily(userId, roomId);
    const readdedStore = createStore();
    const unmountReadded = readdedStore.sub(readdedAtom, () => undefined);

    expect(readdedAtom).not.toBe(originalAtom);
    expect(readdedStore.get(readdedAtom)).toEqual(createDefaultThreadFilterState());

    unmountReadded();
  });

  it('isolates the same roomId across different users', async () => {
    const { createDefaultThreadFilterState } = await import('./roomThreadOverviewModel');
    const { roomThreadFilterAtomFamily } = await import('./roomThreadFilterState');

    const roomId = '!shared-room:example.org';
    const aliceAtom = roomThreadFilterAtomFamily('@alice:example.org', roomId);
    const bobAtom = roomThreadFilterAtomFamily('@bob:example.org', roomId);
    const aliceStore = createStore();
    const bobStore = createStore();
    const unmountAlice = aliceStore.sub(aliceAtom, () => undefined);
    const unmountBob = bobStore.sub(bobAtom, () => undefined);

    aliceStore.set(aliceAtom, {
      ...createDefaultThreadFilterState(),
      resolved: 'include',
    });
    bobStore.set(bobAtom, {
      ...createDefaultThreadFilterState(),
      resolved: 'exclude',
    });

    expect(aliceStore.get(aliceAtom).resolved).toBe('include');
    expect(bobStore.get(bobAtom).resolved).toBe('exclude');

    unmountAlice();
    unmountBob();
  });

  it('updates mounted consumers when a storage event changes the same key', async () => {
    const { createDefaultThreadFilterState } = await import('./roomThreadOverviewModel');
    const { getRoomThreadFilterStorageKey, roomThreadFilterAtomFamily } = await import(
      './roomThreadFilterState'
    );

    const userId = '@alice:example.org';
    const roomId = '!room-a:example.org';
    const storageKey = getRoomThreadFilterStorageKey(userId, roomId);
    const atom = roomThreadFilterAtomFamily(userId, roomId);
    const storeA = createStore();
    const storeB = createStore();
    const unmountA = storeA.sub(atom, () => undefined);
    const unmountB = storeB.sub(atom, () => undefined);

    storeA.set(atom, {
      ...createDefaultThreadFilterState(),
      resolved: 'include',
    });

    expect(storeB.get(atom).resolved).toBe('any');

    emitStorageEvent(storageKey);

    expect(storeB.get(atom).resolved).toBe('include');

    unmountA();
    unmountB();
  });

  it('loads a localStorage update that happens after atom creation but before mount', async () => {
    const { createDefaultThreadFilterState, serializeThreadFilterState } = await import(
      './roomThreadOverviewModel'
    );
    const { getRoomThreadFilterStorageKey, roomThreadFilterAtomFamily } = await import(
      './roomThreadFilterState'
    );

    const userId = '@alice:example.org';
    const roomId = '!room-a:example.org';
    const storageKey = getRoomThreadFilterStorageKey(userId, roomId);
    const atom = roomThreadFilterAtomFamily(userId, roomId);

    localStorageMock.setItem(
      storageKey,
      JSON.stringify(
        serializeThreadFilterState({
          ...createDefaultThreadFilterState(),
          resolved: 'include',
        })
      )
    );

    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom).resolved).toBe('include');

    unmount();
  });

  it('migrates older stored payloads by defaulting missing query and status mode', async () => {
    const { createDefaultThreadFilterState } = await import('./roomThreadOverviewModel');
    const { getRoomThreadFilterStorageKey, roomThreadFilterAtomFamily } = await import(
      './roomThreadFilterState'
    );

    const userId = '@alice:example.org';
    const roomId = '!room-a:example.org';
    const storageKey = getRoomThreadFilterStorageKey(userId, roomId);
    localStorageMock.setItem(
      storageKey,
      JSON.stringify({
        v: 1,
        resolved: 'include',
        streaming: 'exclude',
        scheduled: 'any',
        unread: 'include',
        idle: 'any',
        sortBy: 'lastReply',
        sortDirection: 'asc',
        tags: {
          blocked: 'exclude',
        },
      })
    );

    const atom = roomThreadFilterAtomFamily(userId, roomId);
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom)).toEqual({
      ...createDefaultThreadFilterState(),
      resolved: 'include',
      streaming: 'exclude',
      unread: 'include',
      sortBy: 'lastReply',
      sortDirection: 'asc',
      tags: new Map([['blocked', 'exclude']]),
    });

    unmount();
  });

  it('migrates the authoritative v1 DSL into canonical structured fields and free text', async () => {
    const { createDefaultThreadFilterState } = await import('./roomThreadOverviewModel');
    const { getRoomThreadFilterStorageKey, roomThreadFilterAtomFamily } = await import(
      './roomThreadFilterState'
    );

    const userId = '@alice:example.org';
    const roomId = '!room-a:example.org';
    localStorageMock.setItem(
      getRoomThreadFilterStorageKey(userId, roomId),
      JSON.stringify({
        v: 1,
        resolved: 'include',
        streaming: 'any',
        scheduled: 'any',
        unread: 'any',
        idle: 'any',
        sortBy: 'lastReply',
        sortDirection: 'desc',
        tags: {},
        searchQuery: '-is:resolved tag:priority hello is:unknown',
        statusMode: 'and',
      })
    );

    const atom = roomThreadFilterAtomFamily(userId, roomId);
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom)).toEqual({
      ...createDefaultThreadFilterState(),
      resolved: 'exclude',
      tags: new Map([['priority', 'include']]),
      freeText: 'hello',
      unsupportedQuery: 'is:unknown',
    });

    unmount();
  });
});
