import { getSessionScopedStorageKey, listSessions } from '../../../state/sessions';
import {
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
  ATTACHMENT_REFERENCES_BY_ROOM_INDEX,
  ATTACHMENT_REFERENCES_STORE,
  ATTACHMENTS_STORE,
  ATTACHMENTS_BY_ACCESS_BYTES_INDEX,
  ATTACHMENT_REFERENCES_BY_OWNER_INDEX,
  CACHE_STORE_DB_VERSION,
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_BY_ROOM_EVENT_INDEX,
  EVENTS_STORE,
  META_STORE,
  MINDROOM_CACHE_DB_BASE_NAME,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
} from './cacheStoreSchema';
import { performLegacyDbWipe } from './cacheStoreLegacyWipe';
import {
  traceCacheStoreClose,
  traceCacheStoreOpen,
  traceCacheTransactions,
} from './cacheStoreTrace';

// The opener follows the corruption self-heal pattern from the legacy
// `threadEventCache`: if an open succeeds but any required store is missing
// (partial upgrade, prior interrupted create), delete the DB and recreate it
// exactly once (`allowRecovery` flag).
//
// The D8 legacy-wipe step (P2.1 commit 3) is invoked here between open
// success and resolving the memoized promise so the wipe runs exactly
// once per session.

const dbPromiseByName = new Map<string, Promise<IDBDatabase | undefined>>();

export const getCacheStoreDbName = (sessionId: string): string =>
  getSessionScopedStorageKey(sessionId, MINDROOM_CACHE_DB_BASE_NAME);

const REQUIRED_STORES = [
  ATTACHMENTS_STORE,
  ATTACHMENT_REFERENCES_STORE,
  EVENTS_STORE,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_STORE,
] as const;

export class CacheStoreBlockedError extends Error {
  constructor(operation: 'open' | 'delete', dbName: string) {
    super(`IndexedDB ${operation} blocked for ${dbName}`);
    this.name = 'CacheStoreBlockedError';
  }
}

const hasRequiredCacheStoreStores = (db: Pick<IDBDatabase, 'objectStoreNames'>): boolean =>
  REQUIRED_STORES.every((store) => db.objectStoreNames.contains(store));

const deleteIndexedDb = async (dbName: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new CacheStoreBlockedError('delete', dbName));
  });
};

const applyUpgrade = (db: IDBDatabase, transaction: IDBTransaction): void => {
  if (!db.objectStoreNames.contains(ATTACHMENTS_STORE)) {
    db.createObjectStore(ATTACHMENTS_STORE, { keyPath: 'mxcUri' });
  }
  if (!db.objectStoreNames.contains(ATTACHMENT_REFERENCES_STORE)) {
    const referencesStore = db.createObjectStore(ATTACHMENT_REFERENCES_STORE, {
      keyPath: 'referenceKey',
    });
    referencesStore.createIndex(ATTACHMENT_REFERENCES_BY_ROOM_INDEX, 'roomId', {
      unique: false,
    });
    referencesStore.createIndex(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX, 'mxcUri', {
      unique: false,
    });
  }
  const attachments = transaction.objectStore(ATTACHMENTS_STORE);
  if (!attachments.indexNames.contains(ATTACHMENTS_BY_ACCESS_BYTES_INDEX)) {
    attachments.createIndex(ATTACHMENTS_BY_ACCESS_BYTES_INDEX, ['lastAccessedAt', 'byteLength']);
  }
  const references = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
  if (!references.indexNames.contains(ATTACHMENT_REFERENCES_BY_OWNER_INDEX)) {
    references.createIndex(ATTACHMENT_REFERENCES_BY_OWNER_INDEX, ['roomId', 'eventId']);
  }
  if (!db.objectStoreNames.contains(EVENTS_STORE)) {
    const eventsStore = db.createObjectStore(EVENTS_STORE, { keyPath: 'cacheKey' });
    eventsStore.createIndex(EVENTS_BY_SCOPE_TS_INDEX, ['roomId', 'scope', 'ts', 'eventId'], {
      unique: false,
    });
  }
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE, { keyPath: 'metaKey' });
  }
  const events = transaction.objectStore(EVENTS_STORE);
  if (!events.indexNames.contains(EVENTS_BY_ROOM_EVENT_INDEX)) {
    events.createIndex(EVENTS_BY_ROOM_EVENT_INDEX, ['roomId', 'eventId'], { unique: false });
  }
  if (!db.objectStoreNames.contains(ROOM_LEDGER_STORE)) {
    // CINNY-207 P2.2 preparation: created empty in v3. Filled by the
    // eviction ledger in the next step. Room id is the natural primary key.
    db.createObjectStore(ROOM_LEDGER_STORE, { keyPath: 'roomId' });
  }
  if (!db.objectStoreNames.contains(THREAD_SUMMARIES_STORE)) {
    const summariesStore = db.createObjectStore(THREAD_SUMMARIES_STORE, {
      keyPath: 'cacheKey',
    });
    summariesStore.createIndex(THREAD_SUMMARIES_BY_ROOM_INDEX, 'roomId', { unique: false });
  }
};

// D8 legacy-wipe step: after a unified-cache open we delete the three legacy
// DB names once per session, writing an idempotency marker into the meta
// store so second opens are a cheap marker read. Tests mock the
// `cacheStoreLegacyWipe` module directly via `vi.mock`, so no runtime
// hook indirection is needed.

export const openCacheStore = (
  sessionId: string,
  allowRecovery = true
): Promise<IDBDatabase | undefined> => {
  const dbName = getCacheStoreDbName(sessionId);
  const currentPromise = dbPromiseByName.get(dbName);
  if (currentPromise) return currentPromise;
  if (typeof indexedDB === 'undefined') {
    const missing = Promise.resolve(undefined);
    dbPromiseByName.set(dbName, missing);
    return missing;
  }

  const dbPromise = new Promise<IDBDatabase | undefined>((resolve, reject) => {
    const request = indexedDB.open(dbName, CACHE_STORE_DB_VERSION);
    let blocked = false;

    request.onupgradeneeded = () => {
      applyUpgrade(request.result, request.transaction!);
    };

    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      if (!hasRequiredCacheStoreStores(db)) {
        // Corruption self-heal — delete and recreate once.
        db.close();
        dbPromiseByName.delete(dbName);

        if (allowRecovery) {
          deleteIndexedDb(dbName)
            .catch(() => undefined)
            .then(() => openCacheStore(sessionId, false))
            .then(resolve)
            .catch(reject);
          return;
        }
        // Recovery already attempted — give up and yield undefined so
        // callers skip cache writes gracefully.
        resolve(undefined);
        return;
      }

      const invalidateConnection = (versionChange: boolean) => {
        traceCacheStoreClose(versionChange);
        if (dbPromiseByName.get(dbName) === dbPromise) dbPromiseByName.delete(dbName);
        // Also settle an open interrupted during the legacy migration.
        reject(new DOMException('Cache database connection closed', 'InvalidStateError'));
      };
      db.onclose = () => invalidateConnection(false);
      db.onversionchange = () => {
        revokeCacheStoreWrites(sessionId);
        db.close();
        invalidateConnection(true);
      };
      traceCacheTransactions(db);
      // D8 wipe runs after the schema is confirmed and before we hand
      // the DB out to callers.
      performLegacyDbWipe(sessionId, db)
        .catch(() => undefined)
        .finally(() => resolve(db));
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new CacheStoreBlockedError('open', dbName));
    };
  });

  // CINNY-207 P2 review: on rejection, evict the memo entry so the next
  // caller retries a fresh open instead of receiving the cached
  // rejected promise forever (one transient open failure would brick
  // the cache for the session otherwise). The corruption self-heal
  // path above uses its own `allowRecovery=false` recursion so this
  // eviction does not create an infinite retry loop — it only enables
  // retry on the NEXT top-level `openCacheStore` call.
  dbPromise.catch(() => {
    if (dbPromiseByName.get(dbName) === dbPromise) {
      dbPromiseByName.delete(dbName);
    }
  });

  traceCacheStoreOpen(dbPromise);
  dbPromiseByName.set(dbName, dbPromise);
  return dbPromise;
};

export const deleteCacheStoreDb = async (sessionId: string): Promise<void> => {
  revokeCacheStoreWrites(sessionId);
  if (typeof indexedDB === 'undefined') return;

  const dbName = getCacheStoreDbName(sessionId);
  const currentDb = await dbPromiseByName.get(dbName)?.catch(() => undefined);
  currentDb?.close();
  dbPromiseByName.delete(dbName);
  await deleteIndexedDb(dbName);
};

const writeGenerationBySession = new Map<string, number>();

export type CacheStoreWriteLease = {
  readonly sessionId: string;
  readonly generation: number;
  readonly roomId?: string;
  readonly roomGeneration?: number;
};

const writeGenerationByRoom = new Map<string, number>();
const roomLeaseKey = (sessionId: string, roomId: string): string =>
  JSON.stringify([sessionId, roomId]);

export const captureCacheStoreWriteLease = (
  sessionId: string,
  roomId?: string
): CacheStoreWriteLease => {
  const generation = writeGenerationBySession.get(sessionId) ?? 0;
  writeGenerationBySession.set(sessionId, generation);
  return {
    sessionId,
    generation,
    roomId,
    roomGeneration: roomId
      ? writeGenerationByRoom.get(roomLeaseKey(sessionId, roomId)) ?? 0
      : undefined,
  };
};

export const isCacheStoreWriteLeaseCurrent = (lease: CacheStoreWriteLease): boolean =>
  (writeGenerationBySession.get(lease.sessionId) ?? 0) === lease.generation &&
  (!lease.roomId ||
    (writeGenerationByRoom.get(roomLeaseKey(lease.sessionId, lease.roomId)) ?? 0) ===
      lease.roomGeneration);

export const revokeRoomCacheStoreWrites = (sessionId: string, roomId: string): void => {
  const key = roomLeaseKey(sessionId, roomId);
  writeGenerationByRoom.set(key, (writeGenerationByRoom.get(key) ?? 0) + 1);
};

export const revokeCacheStoreWrites = (sessionId: string): void => {
  writeGenerationBySession.set(sessionId, (writeGenerationBySession.get(sessionId) ?? 0) + 1);
};

export const revokeAllCacheStoreWrites = (): void => {
  writeGenerationBySession.forEach((generation, sessionId) => {
    writeGenerationBySession.set(sessionId, generation + 1);
  });
};

/**
 * Testing utility — drop all memoized dbPromise entries so the next
 * `openCacheStore` re-opens against a fresh `IDBFactory`.
 */
export const resetCacheStoreForTesting = (): void => {
  dbPromiseByName.clear();
  writeGenerationBySession.clear();
  writeGenerationByRoom.clear();
};

// Re-exported so the wipe hook (P2.1 commit 3) can iterate stored
// sessions to gate the singleton-DB wipe.
export { listSessions };
