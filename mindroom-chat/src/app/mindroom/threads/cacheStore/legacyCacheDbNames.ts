import { getSessionScopedStorageKey } from '../../../state/sessions';

// CINNY-207 P2.1 (decision D8): legacy IndexedDB names retained here so
// sessionCleanup / logout paths can keep deleting them across upgrades
// and so the D8 wipe on first v3 open knows exactly what to remove.
//
// These names must NEVER be reintroduced as active DBs — the unified
// `mindroom-cache` DB (see `cacheStoreSchema.ts`) is the sole owner of
// the shape from schema v3 onwards.

export const LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME = 'mindroom-room-event-cache';
export const LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME = 'mindroom-thread-event-cache';
export const LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME = 'mindroom-thread-summary-cache';

export const LEGACY_MINDROOM_SINGLETON_DB_NAMES = [
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME,
] as const;

export const getLegacyRoomEventCacheDbName = (sessionId: string): string =>
  getSessionScopedStorageKey(sessionId, LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME);

export const getLegacyThreadEventCacheDbName = (sessionId: string): string =>
  getSessionScopedStorageKey(sessionId, LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME);

export const getLegacyThreadSummaryCacheDbName = (sessionId: string): string =>
  getSessionScopedStorageKey(sessionId, LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME);

export const getLegacySessionScopedCacheDbNames = (sessionId: string): string[] => [
  getLegacyRoomEventCacheDbName(sessionId),
  getLegacyThreadEventCacheDbName(sessionId),
  getLegacyThreadSummaryCacheDbName(sessionId),
];
