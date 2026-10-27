import { listSessions } from '../../../state/sessions';
import { META_STORE, type CachedMetaRecord } from './cacheStoreSchema';
import {
  LEGACY_MINDROOM_SINGLETON_DB_NAMES,
  getLegacySessionScopedCacheDbNames,
} from './legacyCacheDbNames';

// CINNY-207 P2.1 / decision D8: on the first open of the schema-v3
// unified DB per session, wipe the legacy per-domain IndexedDB names so
// there is exactly one write path from schema v3 onwards (D8 —
// "migrate: wipe and rebuild"). We drop:
//   - the three session-scoped legacy DBs (`...::<sessionId>`)
//   - the three unsuffixed singletons, but only when the singleton DBs
//     unambiguously belong to this session (0 or 1 stored sessions),
//     matching the pre-existing legacy migration gate in
//     `shouldAttemptLegacy*CacheMigration`.
// A marker record is then written into the `meta` store to make the
// wipe idempotent — AC14 asserts exactly-once behavior against this
// marker.
//
// The wipe is invoked directly by `openCacheStore` after schema-v3
// open success, so this module has no consumers other than the DB
// opener bootstrap.

// Reserved metaKey (see cacheStoreSchema); duplicated here to keep the
// wipe module independent of the schema import for constant tree-shake.
export const LEGACY_WIPE_MARKER_META_KEY = '__cacheStore|migration';
const INTERNAL_META_ROOM_ID = '__cacheStore';
const INTERNAL_META_SCOPE = 'migration';

const readWipeMarker = (db: IDBDatabase): Promise<CachedMetaRecord | undefined> =>
  new Promise<CachedMetaRecord | undefined>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readonly');
    const request = transaction.objectStore(META_STORE).get(LEGACY_WIPE_MARKER_META_KEY);
    transaction.oncomplete = () => resolve(request.result as CachedMetaRecord | undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    request.onerror = () => reject(request.error);
  });

const writeWipeMarker = (db: IDBDatabase): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const record: CachedMetaRecord = {
      metaKey: LEGACY_WIPE_MARKER_META_KEY,
      roomId: INTERNAL_META_ROOM_ID,
      scope: INTERNAL_META_SCOPE,
      updatedAt: Date.now(),
      legacyWipeCompletedAt: Date.now(),
    };
    transaction.objectStore(META_STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const deleteIndexedDb = (dbName: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    // Blocked: another tab is holding the DB open. The existing pattern
    // is to resolve rather than hang the open — a subsequent open will
    // re-check the marker.
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });

const shouldAttemptLegacySingletonWipe = (sessionId: string): boolean => {
  // Match the pre-existing legacy migration gate: singleton DBs can be
  // safely attributed to this session only when it is the sole (or the
  // very first) stored session. In multi-session installs the singleton
  // may belong to a different session and must be left alone.
  try {
    const sessions = listSessions();
    return sessions.length === 0 || (sessions.length === 1 && sessions[0]?.sessionId === sessionId);
  } catch {
    return true;
  }
};

/**
 * Perform the one-time wipe of the legacy IndexedDB names for this
 * session and record a marker in the v3 meta store. Idempotent: on any
 * subsequent open the marker is found and this function returns without
 * touching IndexedDB.
 */
export const performLegacyDbWipe = async (sessionId: string, db: IDBDatabase): Promise<void> => {
  const marker = await readWipeMarker(db).catch(() => undefined);
  if (marker) return;

  const namesToDelete: string[] = [...getLegacySessionScopedCacheDbNames(sessionId)];
  if (shouldAttemptLegacySingletonWipe(sessionId)) {
    namesToDelete.push(...LEGACY_MINDROOM_SINGLETON_DB_NAMES);
  }

  // deleteDatabase is idempotent — if the DB does not exist, onsuccess
  // still fires. Run them in parallel; failures on individual names are
  // best-effort (the caller catches and swallows so the app boots even
  // if a legacy DB refuses to die).
  await Promise.all(namesToDelete.map((name) => deleteIndexedDb(name).catch(() => undefined)));

  await writeWipeMarker(db).catch(() => undefined);
};
