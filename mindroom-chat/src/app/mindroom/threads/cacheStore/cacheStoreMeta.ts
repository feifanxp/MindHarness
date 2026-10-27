/**
 * Shared helpers for read-modify-write cycles on the `meta` object store.
 * The discontinuity marker and the thread reconciliation continuation
 * both drive the same pattern: open the DB, run a `META_STORE` txn,
 * fetch the (roomId, scope) row, mutate it, `put` it back, and resolve
 * (or throw) when the transaction completes. Centralizing that wiring
 * removes ~60 lines of hand-repeated boilerplate and gives every caller
 * a single error surface with an "unavailable" substring.
 */
import {
  openCacheStore,
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  type CacheStoreWriteLease,
} from './cacheStoreDb';
import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  buildMetaKey,
  META_STORE,
  type CachedMetaRecord,
  type RoomOfflineProgress,
} from './cacheStoreSchema';

const CACHE_STORE_UNAVAILABLE_MESSAGE = 'Cache store meta storage is unavailable.';

export class CacheStoreMetaUnavailableError extends Error {
  constructor() {
    super(CACHE_STORE_UNAVAILABLE_MESSAGE);
    this.name = 'CacheStoreMetaUnavailableError';
  }
}

/**
 * Run a mutating read-modify-write cycle over the meta row for (roomId,
 * scope). Throws `CacheStoreMetaUnavailableError` when IndexedDB is
 * unavailable and rejects on transaction failure.
 */
export const updateMetaRecord = async <T>(
  sessionId: string,
  roomId: string,
  scope: string,
  update: (existing: CachedMetaRecord | undefined, store: IDBObjectStore) => T,
  lease: CacheStoreWriteLease = captureCacheStoreWriteLease(sessionId, roomId)
): Promise<T> => {
  const db = await openCacheStore(sessionId);
  if (!db) throw new CacheStoreMetaUnavailableError();
  const metaKey = buildMetaKey(roomId, scope);
  let result: T;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const store = transaction.objectStore(META_STORE);
    const request = store.get(metaKey);
    request.onsuccess = () => {
      if (!isCacheStoreWriteLeaseCurrent(lease)) {
        transaction.abort();
        return;
      }
      result = update(request.result as CachedMetaRecord | undefined, store);
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  return result!;
};

/**
 * Read the meta row for (roomId, scope). Throws
 * `CacheStoreMetaUnavailableError` when IndexedDB is unavailable and
 * rejects on transaction failure.
 */
export const readMetaRecord = async (
  sessionId: string,
  roomId: string,
  scope: string
): Promise<CachedMetaRecord | undefined> => {
  const db = await openCacheStore(sessionId);
  if (!db) throw new CacheStoreMetaUnavailableError();
  const metaKey = buildMetaKey(roomId, scope);

  return new Promise<CachedMetaRecord | undefined>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readonly');
    const request = transaction.objectStore(META_STORE).get(metaKey);
    request.onsuccess = () => resolve(request.result as CachedMetaRecord | undefined);
    request.onerror = () => reject(request.error);
  });
};

// Ordinary room/thread writers rebuild their metadata. Keep durable offline
// progress in its own scope, removed by the existing whole-room clear.
const OFFLINE_SCOPE = '__offline';
export const readRoomOfflineProgress = async (
  sessionId: string,
  roomId: string
): Promise<RoomOfflineProgress> =>
  (await readMetaRecord(sessionId, roomId, OFFLINE_SCOPE))?.offline ?? {};

export const updateRoomOfflineProgress = async (
  sessionId: string,
  roomId: string,
  patch:
    | Partial<RoomOfflineProgress>
    | ((current: RoomOfflineProgress) => Partial<RoomOfflineProgress>),
  lease: CacheStoreWriteLease = captureCacheStoreWriteLease(sessionId, roomId)
): Promise<boolean> => {
  if (!isCacheWritable() || !isCacheStoreWriteLeaseCurrent(lease)) return false;
  try {
    return await updateMetaRecord(
      sessionId,
      roomId,
      OFFLINE_SCOPE,
      (existing, store) => {
        if (!isCacheStoreWriteLeaseCurrent(lease)) return false;
        const offline = {
          ...existing?.offline,
          ...(typeof patch === 'function' ? patch(existing?.offline ?? {}) : patch),
        };
        if (JSON.stringify(offline) === JSON.stringify(existing?.offline ?? {})) return true;
        store.put({
          metaKey: buildMetaKey(roomId, OFFLINE_SCOPE),
          roomId,
          scope: OFFLINE_SCOPE,
          updatedAt: Date.now(),
          offline,
        } satisfies CachedMetaRecord);
        return true;
      },
      lease
    );
  } catch (error) {
    if (isCacheStoreWriteLeaseCurrent(lease)) reportCacheWriteError('offline.progress', error);
    return false;
  }
};
