import { Page } from '@playwright/test';

type SessionLike = {
  sessionId: string;
  deviceId?: string;
};

const LEGACY_SESSION_STORAGE_KEYS = [
  'cinny_access_token',
  'cinny_device_id',
  'cinny_user_id',
  'cinny_hs_base_url',
] as const;

export const readIndexedDbNames = async (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const databases = await indexedDB.databases();
    return databases
      .map((database) => database.name)
      .filter((name): name is string => typeof name === 'string')
      .sort();
  });

// CINNY-207 P2.1 (D8): the legacy summary DB `mindroom-thread-summary-cache`
// was consolidated into the unified `mindroom-cache` DB (schema v3),
// which wipes the legacy names on first open. E2e seed operations
// therefore write directly into the unified DB so seeded data
// survives app boot.
const SESSION_DB_PREFIX = '::';
const UNIFIED_CACHE_DB = 'mindroom-cache';

export const getThreadSummaryCacheDbName = (sessionId: string): string =>
  `${UNIFIED_CACHE_DB}${SESSION_DB_PREFIX}${sessionId}`;

export const createIndexedDbNames = async (page: Page, names: string[]): Promise<void> => {
  await page.evaluate(async (dbNames) => {
    const openDatabase = (name: string) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onerror = () => reject(request.error ?? new Error(`Failed to open ${name}`));
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('store')) {
            db.createObjectStore('store');
          }
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });

    await Promise.all(dbNames.map((name) => openDatabase(name)));
  }, names);
};

export const seedThreadSummaryCache = async ({
  page,
  sessionId,
  roomId,
  threadRootId,
  summaryText,
  generatedTs,
  messageCount,
}: {
  page: Page;
  sessionId: string;
  roomId: string;
  threadRootId: string;
  summaryText: string;
  generatedTs?: number;
  messageCount?: number;
}): Promise<void> => {
  // CINNY-207 P2 review: pre-seeding the D8 wipe marker would suppress
  // the legacy wipe on a warm profile. E2e contexts are always fresh
  // (deleteDatabase is a no-op on names that don't exist), but delete
  // every name the app wipe would delete — the three session-scoped
  // legacy DBs AND the unsuffixed singletons (the seeded profile has a
  // single session, so the app's single-session gate would be open) —
  // so the seed is truthful about what the D8 wipe would have done.
  const legacyDbNames = [
    `mindroom-room-event-cache${SESSION_DB_PREFIX}${sessionId}`,
    `mindroom-thread-event-cache${SESSION_DB_PREFIX}${sessionId}`,
    `mindroom-thread-summary-cache${SESSION_DB_PREFIX}${sessionId}`,
    'mindroom-room-event-cache',
    'mindroom-thread-event-cache',
    'mindroom-thread-summary-cache',
  ];
  await page.evaluate(async (names) => {
    await Promise.all(
      names.map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          })
      )
    );
  }, legacyDbNames);

  await page.evaluate(
    async ({ dbName, room, rootId, summary, generatedAt, count }) => {
      await new Promise<void>((resolve, reject) => {
        // Preserve the app's current schema on a warm profile. A cold fixture
        // starts at version 1 so the app can apply its normal schema upgrades.
        const request = indexedDB.open(dbName);

        // If this seed opens the DB before the app does, create the
        // full v3 schema (all four stores) so the app's corruption
        // self-heal path does not delete-and-recreate on boot.
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('events')) {
            const events = db.createObjectStore('events', { keyPath: 'cacheKey' });
            events.createIndex('by_scope_ts', ['roomId', 'scope', 'ts', 'eventId'], {
              unique: false,
            });
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'metaKey' });
          }
          if (!db.objectStoreNames.contains('room_ledger')) {
            db.createObjectStore('room_ledger', { keyPath: 'roomId' });
          }
          if (!db.objectStoreNames.contains('thread_summaries')) {
            const summaries = db.createObjectStore('thread_summaries', { keyPath: 'cacheKey' });
            summaries.createIndex('by_room', 'roomId', { unique: false });
          }
        };

        request.onerror = () => reject(request.error ?? new Error(`Failed to open ${dbName}`));
        request.onsuccess = () => {
          const db = request.result;
          // Pre-populate the D8 wipe marker so the app's first open
          // skips the legacy-wipe step (there is nothing to wipe in an
          // e2e clean-slate scenario, and we do not want the wipe to
          // race the seed on a warm profile).
          const transaction = db.transaction(['thread_summaries', 'meta'], 'readwrite');
          const store = transaction.objectStore('thread_summaries');
          const metaStore = transaction.objectStore('meta');

          store.put({
            cacheKey: `${room}|${rootId}`,
            roomId: room,
            threadRootId: rootId,
            summaryText: summary,
            generatedTs: generatedAt,
            messageCount: count,
            updatedAt: Date.now(),
          });
          metaStore.put({
            metaKey: '__cacheStore|migration',
            roomId: '__cacheStore',
            scope: 'migration',
            updatedAt: Date.now(),
            legacyWipeCompletedAt: Date.now(),
          });

          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () =>
            reject(transaction.error ?? new Error('Failed to seed cache'));
          transaction.onabort = () => reject(transaction.error ?? new Error('Seeding aborted'));
        };
      });
    },
    {
      dbName: getThreadSummaryCacheDbName(sessionId),
      room: roomId,
      rootId: threadRootId,
      summary: summaryText,
      generatedAt: generatedTs,
      count: messageCount,
    }
  );
};

export const seedLegacySessionStorage = async (
  page: Page,
  values: Partial<Record<typeof LEGACY_SESSION_STORAGE_KEYS[number], string>> = {}
): Promise<void> => {
  await page.evaluate(
    ({ keys, seededValues }) => {
      keys.forEach((key) => {
        window.localStorage.setItem(key, seededValues[key] ?? `seeded-${key}`);
      });
    },
    { keys: LEGACY_SESSION_STORAGE_KEYS, seededValues: values }
  );
};

export const readLegacySessionStorage = async (
  page: Page
): Promise<Record<typeof LEGACY_SESSION_STORAGE_KEYS[number], string | null>> =>
  page.evaluate((keys) => {
    const entries = keys.map((key) => [key, window.localStorage.getItem(key)] as const);
    return Object.fromEntries(entries) as Record<typeof keys[number], string | null>;
  }, LEGACY_SESSION_STORAGE_KEYS);

export const getExpectedSessionDbNames = (session: SessionLike): string[] => {
  const names = [`matrix-js-sdk:web-sync-store::${session.sessionId}`];

  if (session.deviceId) {
    const rustPrefix = `matrix-js-sdk::${session.sessionId}::${encodeURIComponent(
      session.deviceId
    )}`;
    names.push(`${rustPrefix}::matrix-sdk-crypto`);
  }

  return names;
};

const findMindroomCacheDbNames = async (page: Page, dbPrefix: string): Promise<string[]> =>
  page.evaluate(async (prefix) => {
    const databases = await indexedDB.databases();
    return databases
      .map((database) => database.name)
      .filter((name): name is string => typeof name === 'string' && name.startsWith(prefix));
  }, dbPrefix);

const readStoreRecords = async (
  page: Page,
  dbNames: string[],
  storeName: string
): Promise<Record<string, unknown>[]> =>
  page.evaluate(
    async ({ names, store }) => {
      const readAll = (dbName: string) =>
        new Promise<Record<string, unknown>[]>((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onerror = () => reject(request.error ?? new Error(`Failed to open ${dbName}`));
          request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(store)) {
              db.close();
              resolve([]);
              return;
            }
            const transaction = db.transaction(store, 'readonly');
            const getAllRequest = transaction.objectStore(store).getAll();
            getAllRequest.onerror = () => {
              db.close();
              reject(getAllRequest.error ?? new Error(`Failed to read ${store}`));
            };
            transaction.oncomplete = () => {
              db.close();
              resolve((getAllRequest.result ?? []) as Record<string, unknown>[]);
            };
            transaction.onerror = () => {
              db.close();
              reject(transaction.error ?? new Error('read failed'));
            };
          };
        });

      const recordLists = await Promise.all(names.map((name) => readAll(name)));
      return recordLists.flat();
    },
    { names: dbNames, store: storeName }
  );

// CINNY-207 P2.1 (D8): the two legacy per-domain DBs (`mindroom-room-event-cache`,
// `mindroom-thread-event-cache`) were consolidated into a single
// `mindroom-cache` DB with an `events` store. Records now carry a
// `scope` field: empty string for room-timeline records, threadId for
// thread records. The e2e helpers still return the same record shapes
// so cinny207 specs that assert against them keep working after the
// storage flip.
const UNIFIED_CACHE_DB_PREFIX = 'mindroom-cache';
const UNIFIED_EVENTS_STORE = 'events';

export const readThreadEventCacheRecords = async (
  page: Page,
  roomId: string,
  threadId: string
): Promise<
  {
    eventId: string;
    eventType?: string;
    bundledReplaceEventId?: string;
    bundledReplaceBody?: string;
  }[]
> => {
  const dbNames = await findMindroomCacheDbNames(page, UNIFIED_CACHE_DB_PREFIX);
  const records = await readStoreRecords(page, dbNames, UNIFIED_EVENTS_STORE);
  return records
    .filter((record) => record.roomId === roomId && record.scope === threadId)
    .map((record) => {
      const rawEvent = record.rawEvent as
        | {
            type?: string;
            unsigned?: {
              'm.relations'?: {
                'm.replace'?: {
                  event_id?: string;
                  content?: { 'm.new_content'?: { body?: string } };
                };
              };
            };
          }
        | undefined;
      const bundledReplace = rawEvent?.unsigned?.['m.relations']?.['m.replace'];
      return {
        eventId: String(record.eventId ?? ''),
        eventType: rawEvent?.type,
        bundledReplaceEventId: bundledReplace?.event_id,
        bundledReplaceBody: bundledReplace?.content?.['m.new_content']?.body,
      };
    });
};

export const readRoomEventCacheEventIds = async (page: Page, roomId: string): Promise<string[]> => {
  const dbNames = await findMindroomCacheDbNames(page, UNIFIED_CACHE_DB_PREFIX);
  const records = await readStoreRecords(page, dbNames, UNIFIED_EVENTS_STORE);
  return records
    .filter((record) => record.roomId === roomId && record.scope === '')
    .map((record) => String(record.eventId ?? ''));
};
