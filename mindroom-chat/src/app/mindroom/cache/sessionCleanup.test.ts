import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../../state/room/roomInputDrafts';
import { clearMindroomLongTextHydrationCache } from '../messages/longText';
import { clearAttachmentRepositoryMemory } from '../messages/attachmentRepository';
import { clearIOSPushState } from '../native/iosPush';
import { clearRecentThreadsStore } from '../recent-threads/recentThreads';
import { clearRecentlyOpenedPanelHeightStore } from '../recent-threads/recentlyOpenedPanelHeight';
import { clearThreadSidebarPreferencesStore } from '../recent-threads/threadSidebarPreferences';
import { clearCrossRoomThreadFiltersStore } from '../cross-room-threads/crossRoomThreadFilters';
import { clearRoomThreadFiltersStore } from '../threads/roomThreadFilterState';
import { clearRoomViewModeStore } from '../threads/roomViewMode';
import { clearThreadSummarySharedState } from '../threads/threadSummaryStore';
import {
  deleteCacheStoreDb,
  getCacheStoreDbName,
  getLegacyRoomEventCacheDbName,
  getLegacySessionScopedCacheDbNames,
  getLegacyThreadEventCacheDbName,
  getLegacyThreadSummaryCacheDbName,
} from '../threads/cacheStore';
import {
  MINDROOM_SINGLETON_INDEXED_DB_NAMES,
  clearMindroomInMemoryCaches,
  clearMindroomSessionNativeState,
  clearMindroomSessionUiState,
  clearMindroomUserUiState,
  deleteMindroomSessionCaches,
  getMindroomSessionIndexedDbNames,
} from './sessionCleanup';

vi.mock('../messages/longText', () => ({
  clearMindroomLongTextHydrationCache: vi.fn(),
}));

vi.mock('../messages/attachmentRepository', () => ({
  clearAttachmentRepositoryMemory: vi.fn(),
}));

it('removes only the logged-out account composer drafts from storage and memory', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  });
  const aliceKey = getRoomInputDraftKey('@draft-alice:example.org', '!room:example.org', '$root');
  const bobKey = getRoomInputDraftKey('@draft-bob:example.org', '!room:example.org', '$root');
  const store = createStore();
  const draft = [{ type: 'paragraph' as const, children: [{ text: 'Private draft' }] }];
  store.set(roomIdToMsgDraftAtomFamily(aliceKey), draft);
  store.set(roomIdToMsgDraftAtomFamily(bobKey), draft);
  clearMindroomUserUiState('@draft-alice:example.org');
  expect(values.size).toBe(1);
  expect(store.get(roomIdToMsgDraftAtomFamily(aliceKey))).toEqual([]);
  expect(store.get(roomIdToMsgDraftAtomFamily(bobKey))).toEqual(draft);
  roomIdToMsgDraftAtomFamily.remove(aliceKey);
  expect(createStore().get(roomIdToMsgDraftAtomFamily(aliceKey))).toEqual([]);
  vi.unstubAllGlobals();
});

vi.mock('../native/iosPush', () => ({
  IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX: 'mindroom_ios_push_',
  clearIOSPushState: vi.fn(),
}));

vi.mock('../recent-threads/recentThreads', () => ({
  clearRecentThreadsStore: vi.fn(),
}));

vi.mock('../recent-threads/recentlyOpenedPanelHeight', () => ({
  clearRecentlyOpenedPanelHeightStore: vi.fn(),
}));

vi.mock('../recent-threads/threadSidebarPreferences', () => ({
  clearThreadSidebarPreferencesStore: vi.fn(),
}));

vi.mock('../cross-room-threads/crossRoomThreadFilters', () => ({
  clearCrossRoomThreadFiltersStore: vi.fn(),
}));

vi.mock('../threads/roomThreadFilterState', () => ({
  clearRoomThreadFiltersStore: vi.fn(),
}));

vi.mock('../threads/roomViewMode', () => ({
  clearRoomViewModeStore: vi.fn(),
}));

vi.mock('../threads/threadSummaryStore', () => ({
  clearThreadSummarySharedState: vi.fn(),
}));

// CINNY-207 P2.3: sessionCleanup now imports directly from `cacheStore`
// (the shim modules are gone). This single mock covers every accessor
// the module needs. Legacy DB name accessors are STILL exported by the
// store (via the `legacyCacheDbNames` submodule) so logout cleanup
// keeps working for rolled-back installs that never opened v3.
vi.mock('../threads/cacheStore', () => ({
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME: 'mindroom-room-event-cache',
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME: 'mindroom-thread-event-cache',
  LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME: 'mindroom-thread-summary-cache',
  MINDROOM_CACHE_DB_BASE_NAME: 'mindroom-cache',
  deleteCacheStoreDb: vi.fn().mockResolvedValue(undefined),
  getCacheStoreDbName: vi.fn((sessionId: string) => `mindroom-cache::${sessionId}`),
  getLegacyRoomEventCacheDbName: vi.fn((sessionId: string) => `room-cache::${sessionId}`),
  getLegacyThreadEventCacheDbName: vi.fn((sessionId: string) => `thread-cache::${sessionId}`),
  getLegacyThreadSummaryCacheDbName: vi.fn((sessionId: string) => `summary-cache::${sessionId}`),
  getLegacySessionScopedCacheDbNames: vi.fn((sessionId: string) => [
    `room-cache::${sessionId}`,
    `thread-cache::${sessionId}`,
    `summary-cache::${sessionId}`,
  ]),
  revokeAllCacheStoreWrites: vi.fn(),
}));

describe('MindRoom session cleanup', () => {
  const originalIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB;
  let deleteCalls: string[];

  beforeEach(() => {
    deleteCalls = [];
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      deleteDatabase: vi.fn((dbName: string) => {
        deleteCalls.push(dbName);
        const request: {
          onsuccess?: () => void;
          onerror?: () => void;
          onblocked?: () => void;
        } = {};
        queueMicrotask(() => request.onsuccess?.());
        return request;
      }),
    };
  });

  afterEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = originalIndexedDB;
    vi.clearAllMocks();
  });

  it('exposes MindRoom-owned app cleanup keys from one boundary', () => {
    // CINNY-207 P2.1 (D8) / P2.3: legacy singleton names are RETAINED
    // here so logout cleanup keeps working on installs that never opened
    // v3 (e.g. rolled-back binaries); the unified `mindroom-cache` name
    // is listed alongside. The legacy summary DB is deleted per-session
    // via `getLegacySessionScopedCacheDbNames`, not through this list.
    expect(MINDROOM_SINGLETON_INDEXED_DB_NAMES).toEqual([
      'mindroom-room-event-cache',
      'mindroom-thread-event-cache',
      'mindroom-cache',
    ]);
  });

  it('derives session-scoped MindRoom IndexedDB names', () => {
    expect(getMindroomSessionIndexedDbNames('session-a')).toEqual([
      'thread-cache::session-a',
      'room-cache::session-a',
      'summary-cache::session-a',
      'mindroom-cache::session-a',
    ]);
    expect(vi.mocked(getLegacyThreadEventCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getLegacyRoomEventCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getLegacyThreadSummaryCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getCacheStoreDbName)).toHaveBeenCalledWith('session-a');
  });

  it('deletes the unified DB plus every legacy per-session DB together', async () => {
    await deleteMindroomSessionCaches('session-a');

    // The unified deleteCacheStoreDb still gets called through the store
    // API. Every legacy per-session DB is deleted directly via the
    // origin's indexedDB.deleteDatabase gesture — the three-way legacy
    // split collapsed to a single unified DB in P2.1, but the logout
    // gesture must still target rolled-back installs.
    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getLegacySessionScopedCacheDbNames)).toHaveBeenCalledWith('session-a');
    expect(deleteCalls.sort()).toEqual(
      ['room-cache::session-a', 'summary-cache::session-a', 'thread-cache::session-a'].sort()
    );
  });

  it('attempts every database without rejecting blocked logout cleanup', async () => {
    const blockedError = new Error('blocked');
    blockedError.name = 'CacheStoreBlockedError';
    vi.mocked(deleteCacheStoreDb).mockRejectedValueOnce(blockedError);
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      deleteDatabase: vi.fn((dbName: string) => {
        deleteCalls.push(dbName);
        const request: { onblocked?: () => void } = {};
        queueMicrotask(() => request.onblocked?.());
        return request;
      }),
    };

    await expect(deleteMindroomSessionCaches('session-a')).resolves.toBeUndefined();

    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith('session-a');
    expect(deleteCalls.sort()).toEqual(
      ['room-cache::session-a', 'summary-cache::session-a', 'thread-cache::session-a'].sort()
    );
  });

  it('clears MindRoom UI, native, and in-memory state', () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });

    clearMindroomUserUiState('@alice:example.com');
    clearMindroomSessionUiState('session-a');
    clearMindroomSessionNativeState('session-a');
    clearMindroomInMemoryCaches();

    vi.unstubAllGlobals();

    expect(removeItem).toHaveBeenCalledWith('lastOpenThread@alice:example.com');
    expect(vi.mocked(clearRoomThreadFiltersStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearCrossRoomThreadFiltersStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearRecentlyOpenedPanelHeightStore)).toHaveBeenCalledWith(
      '@alice:example.com'
    );
    expect(vi.mocked(clearThreadSidebarPreferencesStore)).toHaveBeenCalledWith(
      '@alice:example.com'
    );
    expect(vi.mocked(clearRoomViewModeStore)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(clearThreadSummarySharedState)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(clearMindroomLongTextHydrationCache)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearAttachmentRepositoryMemory)).toHaveBeenCalledTimes(1);
  });
});
