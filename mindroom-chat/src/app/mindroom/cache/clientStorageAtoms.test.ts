import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import {
  makeMindroomClientStorageAtoms,
  registerMindroomClientStorageAtoms,
} from './clientStorageAtoms';
import { bumpRecentThread, clearRecentThreadsStore } from '../recent-threads/recentThreads';
import {
  DEFAULT_CROSS_ROOM_THREAD_FILTERS,
  clearCrossRoomThreadFiltersStore,
  makeCrossRoomThreadFiltersAtom,
} from '../cross-room-threads/crossRoomThreadFilters';

const USER_ID = '@alice:example.org';
const storage = new Map<string, string>();

const clearMindroomStorage = () => {
  clearRecentThreadsStore(USER_ID);
  clearCrossRoomThreadFiltersStore(USER_ID);
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
  });
  clearMindroomStorage();
});

afterEach(() => {
  clearMindroomStorage();
  vi.unstubAllGlobals();
});

describe('MindRoom client storage atom registration', () => {
  it('persists imperative client UI storage atoms for the active user', () => {
    const atoms = makeMindroomClientStorageAtoms(USER_ID);
    const unregister = registerMindroomClientStorageAtoms(atoms);
    const store = getDefaultStore();

    bumpRecentThread('!room:example.org', '$thread-root', 200, 'Preview text');
    store.set(makeCrossRoomThreadFiltersAtom(USER_ID), {
      ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
      query: 'agent',
    });

    expect(storage.get(`recentThreads:${USER_ID}`)).toBe(
      '{"v":1,"entries":[{"roomId":"!room:example.org","threadId":"$thread-root","openedAt":200,"summaryText":"Preview text"}]}'
    );
    expect(store.get(makeCrossRoomThreadFiltersAtom(USER_ID)).query).toBe('agent');
    expect(storage.get(`crossRoomThreadFilters:${USER_ID}`)).not.toContain('"query"');

    unregister();

    // After unregister, recentThreads' imperative writer no longer resolves
    // the registered atom, so bumpRecentThread stops persisting.
    bumpRecentThread('!room:example.org', '$after-unregister', 300);
    expect(storage.get(`recentThreads:${USER_ID}`)).toBe(
      '{"v":1,"entries":[{"roomId":"!room:example.org","threadId":"$thread-root","openedAt":200,"summaryText":"Preview text"}]}'
    );
  });
});
