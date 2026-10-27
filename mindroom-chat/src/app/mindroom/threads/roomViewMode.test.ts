import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StorageListener = (event: StorageEvent) => void;

describe('roomViewMode', () => {
  const sessionA = 'https%3A%2F%2Fexample.org::%40alice%3Aexample.org';
  const sessionB = 'https%3A%2F%2Fexample.org::%40bob%3Aexample.org';
  const storageState = new Map<string, string>();
  const storageListeners = new Set<StorageListener>();

  const emitStorageEvent = (key: string) => {
    storageListeners.forEach((listener) => listener({ key } as StorageEvent));
  };

  beforeEach(() => {
    vi.resetModules();
    storageState.clear();
    storageListeners.clear();

    vi.stubGlobal('localStorage', {
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
    } as unknown as Storage);

    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.delete(listener);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storageState.clear();
    storageListeners.clear();
  });

  it('defaults rooms to compact view', async () => {
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const atom = roomViewModeAtomFamily(sessionA, '!room-a:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom)).toBe('compact');

    unmount();
  });

  it('limits Simple Mode to compact and threaded views', async () => {
    const { getAvailableRoomViewModes, isRoomViewModeAvailable } = await import('./roomViewMode');

    expect(getAvailableRoomViewModes(true, false)).toEqual(['compact', 'threaded']);
    expect(getAvailableRoomViewModes(false, false)).toEqual(['compact', 'threaded', 'classic']);
    expect(isRoomViewModeAvailable('threaded', true)).toBe(true);
    expect(isRoomViewModeAvailable('classic', true)).toBe(false);
    expect(isRoomViewModeAvailable('classic', false)).toBe(true);
  });

  it('offers no view modes in a direct message between people', async () => {
    const { getAvailableRoomViewModes } = await import('./roomViewMode');

    expect(getAvailableRoomViewModes(true, true)).toEqual([]);
    expect(getAvailableRoomViewModes(false, true)).toEqual([]);
  });

  it('persists room view mode per account and room', async () => {
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const roomAAtom = roomViewModeAtomFamily(sessionA, '!room-a:example.org');
    const roomBAtom = roomViewModeAtomFamily(sessionA, '!room-b:example.org');
    const otherAccountAtom = roomViewModeAtomFamily(sessionB, '!room-a:example.org');
    const store = createStore();
    const unmountRoomA = store.sub(roomAAtom, () => undefined);
    const unmountRoomB = store.sub(roomBAtom, () => undefined);
    const unmountOtherAccount = store.sub(otherAccountAtom, () => undefined);

    store.set(roomAAtom, 'threaded');

    expect(storageState.get(`roomViewMode:${sessionA}:!room-a:example.org`)).toBe('"threaded"');
    expect(store.get(roomAAtom)).toBe('threaded');
    expect(store.get(roomBAtom)).toBe('compact');
    expect(store.get(otherAccountAtom)).toBe('compact');

    unmountRoomA();
    unmountRoomB();
    unmountOtherAccount();
  });

  it('updates mounted consumers when storage changes', async () => {
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const atom = roomViewModeAtomFamily(sessionA, '!room-a:example.org');
    const storeA = createStore();
    const storeB = createStore();
    const unmountA = storeA.sub(atom, () => undefined);
    const unmountB = storeB.sub(atom, () => undefined);

    storeA.set(atom, 'threaded');
    expect(storeB.get(atom)).toBe('compact');

    emitStorageEvent(`roomViewMode:${sessionA}:!room-a:example.org`);

    expect(storeB.get(atom)).toBe('threaded');

    unmountA();
    unmountB();
  });

  it('migrates the old unscoped key to the first active account only', async () => {
    storageState.set('roomViewMode:!room-a:example.org', '"threaded"');
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const firstAccountAtom = roomViewModeAtomFamily(sessionA, '!room-a:example.org');
    const secondAccountAtom = roomViewModeAtomFamily(sessionB, '!room-a:example.org');
    const store = createStore();
    const unmountFirst = store.sub(firstAccountAtom, () => undefined);
    const unmountSecond = store.sub(secondAccountAtom, () => undefined);

    expect(store.get(firstAccountAtom)).toBe('threaded');
    expect(store.get(secondAccountAtom)).toBe('compact');
    expect(storageState.has('roomViewMode:!room-a:example.org')).toBe(false);
    expect(storageState.get(`roomViewMode:${sessionA}:!room-a:example.org`)).toBe('"threaded"');

    unmountFirst();
    unmountSecond();
  });

  it('uses a legacy value in memory when its scoped migration cannot be saved', async () => {
    const legacyKey = 'roomViewMode:!room-a:example.org';
    const scopedKey = `roomViewMode:${sessionA}:!room-a:example.org`;
    storageState.set(legacyKey, '"threaded"');
    vi.mocked(globalThis.localStorage.setItem).mockImplementation(() => {
      throw new Error('blocked write');
    });
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const atom = roomViewModeAtomFamily(sessionA, '!room-a:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom)).toBe('threaded');
    expect(storageState.get(legacyKey)).toBe('"threaded"');
    expect(storageState.has(scopedKey)).toBe(false);

    unmount();
  });

  it('treats stored legacy normal mode as unset and resolves the compact default', async () => {
    storageState.set('roomViewMode:!room-a:example.org', '"normal"');
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const atom = roomViewModeAtomFamily(sessionA, '!room-a:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom)).toBe('compact');

    unmount();
  });

  it('preserves an explicitly stored threaded mode', async () => {
    storageState.set(`roomViewMode:${sessionA}:!room-a:example.org`, '"threaded"');
    const { roomViewModeAtomFamily } = await import('./roomViewMode');
    const atom = roomViewModeAtomFamily(sessionA, '!room-a:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom)).toBe('threaded');

    unmount();
  });

  it('clears only one session and evicts its cached room atoms', async () => {
    const { clearRoomViewModeStore, roomViewModeAtomFamily } = await import('./roomViewMode');
    const roomA = roomViewModeAtomFamily(sessionA, '!room-a:example.org');
    const roomB = roomViewModeAtomFamily(sessionA, '!room-b:example.org');
    const otherAccount = roomViewModeAtomFamily(sessionB, '!room-a:example.org');
    const store = createStore();
    store.set(roomA, 'threaded');
    store.set(roomB, 'classic');
    store.set(otherAccount, 'threaded');
    storageState.set('unrelated', 'keep');

    clearRoomViewModeStore(sessionA);

    expect(storageState.has(`roomViewMode:${sessionA}:!room-a:example.org`)).toBe(false);
    expect(storageState.has(`roomViewMode:${sessionA}:!room-b:example.org`)).toBe(false);
    expect(storageState.get(`roomViewMode:${sessionB}:!room-a:example.org`)).toBe('"threaded"');
    expect(storageState.get('unrelated')).toBe('keep');
    const recreatedRoomA = roomViewModeAtomFamily(sessionA, '!room-a:example.org');
    expect(recreatedRoomA).not.toBe(roomA);
    expect(store.get(recreatedRoomA)).toBe('compact');
    expect(roomViewModeAtomFamily(sessionB, '!room-a:example.org')).toBe(otherAccount);
  });
});
