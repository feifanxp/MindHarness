import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROOM_ORDER_STORAGE_KEY_PREFIX,
  SPACE_ORDER_STORAGE_KEY_PREFIX,
  makeRoomOrderBySpaceAtom,
  makeSpaceOrderAtom,
} from './sidebarOrder';

type StorageListener = (event: StorageEvent) => void;

const storageState = new Map<string, string>();
const storageListeners = new Set<StorageListener>();

const emitStorageEvent = (key: string) => {
  storageListeners.forEach((listener) => listener({ key } as StorageEvent));
};

describe('sidebarOrder', () => {
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

  it('persists reordered spaces per user', () => {
    const atom = makeSpaceOrderAtom('@alice:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    store.set(atom, { type: 'REORDER', order: ['!space-b', '!space-a', '!space-b'] });

    expect(store.get(atom)).toEqual(['!space-b', '!space-a']);
    expect(storageState.get(`${SPACE_ORDER_STORAGE_KEY_PREFIX}@alice:example.org`)).toBe(
      '["!space-b","!space-a"]'
    );

    unmount();
  });

  it('removes a space from the persisted space order', () => {
    const atom = makeSpaceOrderAtom('@alice:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    store.set(atom, { type: 'REORDER', order: ['!space-a', '!space-b', '!space-c'] });
    store.set(atom, { type: 'REMOVE', id: '!space-b' });

    expect(store.get(atom)).toEqual(['!space-a', '!space-c']);

    unmount();
  });

  it('persists reordered rooms per parent space', () => {
    const atom = makeRoomOrderBySpaceAtom('@alice:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    store.set(atom, {
      type: 'REORDER',
      parentSpaceId: '!space-a',
      order: ['!room-b', '!room-a', '!room-b'],
    });

    expect(store.get(atom)).toEqual({
      '!space-a': ['!room-b', '!room-a'],
    });
    expect(storageState.get(`${ROOM_ORDER_STORAGE_KEY_PREFIX}@alice:example.org`)).toBe(
      '{"!space-a":["!room-b","!room-a"]}'
    );

    unmount();
  });

  it('removes a room from one parent space order only', () => {
    const atom = makeRoomOrderBySpaceAtom('@alice:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    store.set(atom, { type: 'REORDER', parentSpaceId: '!space-a', order: ['!room-a', '!room-b'] });
    store.set(atom, { type: 'REORDER', parentSpaceId: '!space-b', order: ['!room-b', '!room-c'] });
    store.set(atom, { type: 'REMOVE', parentSpaceId: '!space-a', roomId: '!room-b' });

    expect(store.get(atom)).toEqual({
      '!space-a': ['!room-a'],
      '!space-b': ['!room-b', '!room-c'],
    });

    unmount();
  });

  it('removes an entire parent space room order', () => {
    const atom = makeRoomOrderBySpaceAtom('@alice:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    store.set(atom, { type: 'REORDER', parentSpaceId: '!space-a', order: ['!room-a'] });
    store.set(atom, { type: 'REMOVE_SPACE', parentSpaceId: '!space-a' });

    expect(store.get(atom)).toEqual({});

    unmount();
  });

  it('hydrates localStorage and applies storage events while mounted', () => {
    const key = `${SPACE_ORDER_STORAGE_KEY_PREFIX}@alice:example.org`;
    storageState.set(key, '["!space-a"]');

    const atom = makeSpaceOrderAtom('@alice:example.org');
    const store = createStore();
    const unmount = store.sub(atom, () => undefined);

    expect(store.get(atom)).toEqual(['!space-a']);

    storageState.set(key, '["!space-b","!space-a"]');
    emitStorageEvent(key);

    expect(store.get(atom)).toEqual(['!space-b', '!space-a']);

    unmount();
  });

  it('keeps users isolated by storage key', () => {
    const aliceAtom = makeSpaceOrderAtom('@alice:example.org');
    const bobAtom = makeSpaceOrderAtom('@bob:example.org');
    const store = createStore();
    const unmountAlice = store.sub(aliceAtom, () => undefined);
    const unmountBob = store.sub(bobAtom, () => undefined);

    store.set(aliceAtom, { type: 'REORDER', order: ['!space-a'] });

    expect(store.get(aliceAtom)).toEqual(['!space-a']);
    expect(store.get(bobAtom)).toEqual([]);

    unmountAlice();
    unmountBob();
  });
});
