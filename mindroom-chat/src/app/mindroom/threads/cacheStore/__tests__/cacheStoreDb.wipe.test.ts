/**
 * CINNY-207 P2.1 (AC14): the D8 wipe deletes legacy cache DBs on the
 * first open of the schema-v3 unified DB per session, writes an
 * idempotency marker into the `meta` store, and never runs again.
 *
 * Environment: `fake-indexeddb/auto` supplies the IDB, plus a fresh
 * `IDBFactory` per test. `listSessions` is mocked to a single session
 * so the singleton-name wipe gate opens (matches the pre-existing
 * legacy-migration gate — see `shouldAttemptLegacyRoomEventCacheMigration`
 * in the modules being replaced).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME,
  getLegacyRoomEventCacheDbName,
  getLegacyThreadEventCacheDbName,
  getLegacyThreadSummaryCacheDbName,
} from '../legacyCacheDbNames';

// Force `listSessions` to a single stored session so
// `shouldAttemptLegacySingletonWipe` returns true (legacy migration gate).
vi.mock('../../../../state/sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../state/sessions')>();
  return {
    ...actual,
    listSessions: () => [
      {
        sessionId: SESSION_ID,
        userId: '@alice:example.org',
        deviceId: 'DEVICE',
        baseUrl: 'https://example.org',
        accessToken: 'token',
        lastUsedAt: 0,
      } as unknown as ReturnType<typeof actual.listSessions>[number],
    ],
  };
});

const SESSION_ID = 'wipe-test-session';

const SESSION_SCOPED_LEGACY_NAMES = [
  getLegacyRoomEventCacheDbName(SESSION_ID),
  getLegacyThreadEventCacheDbName(SESSION_ID),
  getLegacyThreadSummaryCacheDbName(SESSION_ID),
];
const SINGLETON_LEGACY_NAMES = [
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME,
];

const openLegacyRoomDb = (dbName: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('room_events')) {
        const store = db.createObjectStore('room_events', { keyPath: 'cacheKey' });
        store.createIndex('by_room_ts', ['roomId', 'ts', 'eventId']);
      }
      if (!db.objectStoreNames.contains('room_meta')) {
        db.createObjectStore('room_meta', { keyPath: 'roomId' });
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

const openLegacyThreadDbWithReplaceRecord = (dbName: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('thread_events')) {
        const store = db.createObjectStore('thread_events', { keyPath: 'cacheKey' });
        store.createIndex('by_thread_ts', ['roomId', 'threadId', 'ts', 'eventId']);
      }
      if (!db.objectStoreNames.contains('thread_meta')) {
        db.createObjectStore('thread_meta', { keyPath: 'threadKey' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Seed a standalone same-sender m.replace record — exactly the
      // legacy shape D5/D8 want gone from schema v3 storage.
      const tx = db.transaction(['thread_events'], 'readwrite');
      tx.objectStore('thread_events').put({
        cacheKey: '!room:x|$thread|$edit-1',
        roomId: '!room:x',
        threadId: '$thread',
        eventId: '$edit-1',
        ts: 1000,
        rawEvent: {
          event_id: '$edit-1',
          origin_server_ts: 1000,
          sender: '@alice:example.org',
          type: 'm.room.message',
          content: {
            body: '* edit body',
            'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
          },
        },
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });

const openLegacySummaryDb = (dbName: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('thread_summaries')) {
        const store = db.createObjectStore('thread_summaries', { keyPath: 'cacheKey' });
        store.createIndex('by_room', 'roomId');
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

const listDatabaseNames = async (): Promise<string[]> => {
  const dbs = await indexedDB.databases();
  return dbs
    .map((d) => d.name)
    .filter((name): name is string => typeof name === 'string')
    .sort();
};

describe('cacheStore D8 legacy wipe (AC14)', () => {
  beforeEach(() => {
    // Fresh IDB per test so no residual state bleeds between scenarios.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    // Rebuild the module graph so the memoized dbPromiseByName is dropped
    // and the freshly rewired `listSessions` mock is picked up.
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes legacy session-scoped and singleton DBs on first v3 open and records a marker', async () => {
    await Promise.all([
      openLegacyRoomDb(SESSION_SCOPED_LEGACY_NAMES[0]),
      openLegacyThreadDbWithReplaceRecord(SESSION_SCOPED_LEGACY_NAMES[1]),
      openLegacySummaryDb(SESSION_SCOPED_LEGACY_NAMES[2]),
      openLegacyRoomDb(SINGLETON_LEGACY_NAMES[0]),
      openLegacyThreadDbWithReplaceRecord(SINGLETON_LEGACY_NAMES[1]),
      openLegacySummaryDb(SINGLETON_LEGACY_NAMES[2]),
    ]);

    const namesBefore = await listDatabaseNames();
    // Sanity: all six legacy names exist before the open.
    [...SESSION_SCOPED_LEGACY_NAMES, ...SINGLETON_LEGACY_NAMES].forEach((name) => {
      expect(namesBefore).toContain(name);
    });

    const {
      openCacheStore,
      resetCacheStoreForTesting,
      getCacheStoreDbName,
    } = await import('../cacheStoreDb');
    const { META_STORE, LEGACY_WIPE_MARKER_META_KEY } = await import('../cacheStoreSchema');

    const db = await openCacheStore(SESSION_ID);
    expect(db).toBeDefined();

    const namesAfter = await listDatabaseNames();
    // All six legacy names are gone; the unified DB exists.
    [...SESSION_SCOPED_LEGACY_NAMES, ...SINGLETON_LEGACY_NAMES].forEach((name) => {
      expect(namesAfter).not.toContain(name);
    });
    expect(namesAfter).toContain(getCacheStoreDbName(SESSION_ID));

    // Marker is present in meta store.
    const marker = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const tx = db!.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get(LEGACY_WIPE_MARKER_META_KEY);
      tx.oncomplete = () => resolve(req.result as Record<string, unknown> | undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    expect(marker).toBeDefined();
    expect(marker?.metaKey).toBe(LEGACY_WIPE_MARKER_META_KEY);
    expect(typeof marker?.legacyWipeCompletedAt).toBe('number');

    // Reopen after singleton reset — no further deleteDatabase should fire.
    resetCacheStoreForTesting();
    const deleteSpy = vi.spyOn(indexedDB, 'deleteDatabase');
    const reopened = await openCacheStore(SESSION_ID);
    expect(reopened).toBeDefined();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('leaves legacy singleton DBs alone when the app has multiple stored sessions (gate closed)', async () => {
    // Override the listSessions mock for this scenario to return two
    // sessions — the singleton wipe gate must stay closed.
    const sessionsModule = await import('../../../../state/sessions');
    vi.spyOn(sessionsModule, 'listSessions').mockReturnValue([
      {
        sessionId: SESSION_ID,
        userId: '@alice:example.org',
        deviceId: 'DEVICE',
        baseUrl: 'https://example.org',
        accessToken: 'token',
        lastUsedAt: 0,
      },
      {
        sessionId: 'other-session',
        userId: '@bob:example.org',
        deviceId: 'DEVICE2',
        baseUrl: 'https://example.org',
        accessToken: 'token2',
        lastUsedAt: 0,
      },
    ]);

    await Promise.all([
      openLegacyRoomDb(SESSION_SCOPED_LEGACY_NAMES[0]),
      openLegacyThreadDbWithReplaceRecord(SESSION_SCOPED_LEGACY_NAMES[1]),
      openLegacySummaryDb(SESSION_SCOPED_LEGACY_NAMES[2]),
      openLegacyRoomDb(SINGLETON_LEGACY_NAMES[0]),
      openLegacyThreadDbWithReplaceRecord(SINGLETON_LEGACY_NAMES[1]),
      openLegacySummaryDb(SINGLETON_LEGACY_NAMES[2]),
    ]);

    const { openCacheStore } = await import('../cacheStoreDb');
    const db = await openCacheStore(SESSION_ID);
    expect(db).toBeDefined();

    const namesAfter = await listDatabaseNames();
    // Session-scoped legacy DBs are still wiped — the gate only guards
    // the shared singletons.
    SESSION_SCOPED_LEGACY_NAMES.forEach((name) => {
      expect(namesAfter).not.toContain(name);
    });
    // Singleton legacy DBs remain, because they might belong to the
    // other session.
    SINGLETON_LEGACY_NAMES.forEach((name) => {
      expect(namesAfter).toContain(name);
    });
  });
});
