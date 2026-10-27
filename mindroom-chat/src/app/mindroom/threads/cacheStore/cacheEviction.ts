import { recordDeepTraceEvent } from '../../diagnostics/deepTrace';
import { openCacheStore, revokeRoomCacheStoreWrites } from './cacheStoreDb';
import {
  ATTACHMENTS_STORE,
  ATTACHMENTS_BY_ACCESS_BYTES_INDEX,
  ATTACHMENT_REFERENCES_STORE,
  ATTACHMENT_REFERENCES_BY_ROOM_INDEX,
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
  EVENTS_STORE,
  EVICTION_CHECK_MIN_INTERVAL_MS,
  EVICTION_RECENT_OPEN_WINDOW_MS,
  EVICTION_TARGET_UTILIZATION,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  getCacheStoreByteBudget,
  type CachedMetaRecord,
  type CachedRoomLedgerRecord,
  type CachedAttachmentRecord,
  type CachedAttachmentReferenceRecord,
} from './cacheStoreSchema';

const protectedRoomIds = new Set<string>();
export const setEvictionProtectedRoomIds = (roomIds: readonly string[]): void => {
  protectedRoomIds.clear();
  roomIds.forEach((id) => protectedRoomIds.add(id));
};
export const getEvictionProtectedRoomIds = (): string[] => [...protectedRoomIds];
const downloadingRoomIdsBySession = new Map<string, ReadonlySet<string>>();
/** Rooms with an explicit Download in progress keep their cache, wherever they are opened from. */
export const setEvictionDownloadingRoomIds = (
  sessionId: string,
  roomIds: readonly string[]
): void => {
  if (roomIds.length) downloadingRoomIdsBySession.set(sessionId, new Set(roomIds));
  else downloadingRoomIdsBySession.delete(sessionId);
};
/** Focus and Download change while a pass runs, so the pass asks again before each deletion. */
const isRoomInUse = (sessionId: string, roomId: string): boolean =>
  protectedRoomIds.has(roomId) || downloadingRoomIdsBySession.get(sessionId)?.has(roomId) === true;
const lastCheckAtBySession = new Map<string, number>();
const runningEvictions = new Map<string, Promise<EvictionResult>>();
export const __resetEvictionForTests = (): void => {
  protectedRoomIds.clear();
  downloadingRoomIdsBySession.clear();
  lastCheckAtBySession.clear();
  runningEvictions.clear();
};

/**
 * Local storage cleanup; other active tabs may cache the room again. Resolves
 * with the text and unshared attachment bytes it removed from the budget.
 */
export const clearRoomCachedContent = async (
  sessionId: string,
  roomId: string
): Promise<number> => {
  revokeRoomCacheStoreWrites(sessionId, roomId);
  const db = await openCacheStore(sessionId);
  if (!db) return 0;
  return new Promise((resolve, reject) => {
    const txn = db.transaction(
      [
        EVENTS_STORE,
        META_STORE,
        ROOM_LEDGER_STORE,
        THREAD_SUMMARIES_STORE,
        ATTACHMENTS_STORE,
        ATTACHMENT_REFERENCES_STORE,
      ],
      'readwrite'
    );
    const eventsStore = txn.objectStore(EVENTS_STORE);
    const metaStore = txn.objectStore(META_STORE);
    const ledgerStore = txn.objectStore(ROOM_LEDGER_STORE);
    const summariesStore = txn.objectStore(THREAD_SUMMARIES_STORE);

    let freedBytes = 0;

    // Events: the primary key is `${roomId}|${scope}|${eventId}`, so one
    // key range removes every scope without reading each record; eviction
    // clears many rooms, and a cursor deserialized every event while this
    // transaction locked all six stores. U+FFFF sorts above any scope or
    // event id character, and a room id cannot contain `|`.
    eventsStore.delete(IDBKeyRange.bound(`${roomId}|`, `${roomId}|￿`));

    // Meta: the primary key is `${roomId}|${scope}`, so a bounded key
    // range confines the cursor to this room's rows instead of walking
    // the whole meta store.
    // CINNY-207 P2 review: was `openCursor()` (full-store walk).
    const metaRange = IDBKeyRange.bound(`${roomId}|`, `${roomId}|￿`);
    const metaCursor = metaStore.openCursor(metaRange);
    metaCursor.onsuccess = () => {
      const cursor = metaCursor.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    metaCursor.onerror = () => reject(metaCursor.error);

    // Thread summaries: has by_room index.
    const summariesIndex = summariesStore.index(THREAD_SUMMARIES_BY_ROOM_INDEX);
    const summariesCursor = summariesIndex.openCursor(IDBKeyRange.only(roomId));
    summariesCursor.onsuccess = () => {
      const cursor = summariesCursor.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    summariesCursor.onerror = () => reject(summariesCursor.error);

    const references = txn.objectStore(ATTACHMENT_REFERENCES_STORE);
    const blobs = txn.objectStore(ATTACHMENTS_STORE);
    const roomReferences = references.index(ATTACHMENT_REFERENCES_BY_ROOM_INDEX).getAll(roomId);
    roomReferences.onsuccess = () => {
      const rows = roomReferences.result as CachedAttachmentReferenceRecord[];
      rows.forEach((row) => references.delete(row.referenceKey));
      // References carry the blob's size, so the blob is not read. A reference
      // marked missing can still describe a blob kept for another reason (too
      // large for its slot, an unvalidated revision).
      const blobBytes = new Map<string, number>();
      rows.forEach((row) => {
        if (row.mxcUri)
          blobBytes.set(row.mxcUri, Math.max(blobBytes.get(row.mxcUri) ?? 0, row.byteLength));
      });
      blobBytes.forEach((byteLength, mxcUri) => {
        const remaining = references
          .index(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX)
          .getAll(mxcUri);
        remaining.onsuccess = () => {
          const shared = remaining.result as CachedAttachmentReferenceRecord[];
          if (!shared.length) {
            blobs.delete(mxcUri);
            freedBytes += byteLength;
          } else {
            const blob = blobs.get(mxcUri);
            blob.onsuccess = () => {
              if (blob.result)
                blobs.put({ ...blob.result, essential: shared.some((row) => row.essential) });
            };
          }
        };
      });
    };
    // Ledger row: primary key. Its byte total is what the room's text cost.
    const ledgerRow = ledgerStore.get(roomId);
    ledgerRow.onsuccess = () => {
      freedBytes += (ledgerRow.result as CachedRoomLedgerRecord | undefined)?.approxBytes ?? 0;
    };
    ledgerStore.delete(roomId);

    txn.oncomplete = () => resolve(freedBytes);
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });
};

export type EvictionResult = {
  bytesBefore: number;
  bytesAfter: number;
  evictedMxcUris: string[];
  evictedRoomIds: string[];
  underPressure: boolean;
};

const isRecentlyOpened = (row: CachedMetaRecord): boolean =>
  (row.lastOpenedTs ?? 0) > Date.now() - EVICTION_RECENT_OPEN_WINDOW_MS;

/** Focused, downloading, pinned and recently opened rooms keep their text and media under pressure. */
const collectProtectedRoomIds = (
  sessionId: string,
  ledger: readonly CachedRoomLedgerRecord[],
  meta: readonly CachedMetaRecord[]
): Set<string> => {
  const protectedIds = new Set([
    ...protectedRoomIds,
    ...(downloadingRoomIdsBySession.get(sessionId) ?? []),
  ]);
  ledger.filter((row) => row.pinned).forEach((row) => protectedIds.add(row.roomId));
  meta.filter(isRecentlyOpened).forEach((row) => protectedIds.add(row.roomId));
  return protectedIds;
};

/** Pin and recent opening as stored now; either can change while a pass runs. */
const isRoomProtectedInStore = (db: IDBDatabase, roomId: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const transaction = db.transaction([ROOM_LEDGER_STORE, META_STORE], 'readonly');
    const ledger = transaction.objectStore(ROOM_LEDGER_STORE).get(roomId);
    const meta = transaction
      .objectStore(META_STORE)
      .getAll(IDBKeyRange.bound(`${roomId}|`, `${roomId}|￿`));
    transaction.oncomplete = () =>
      resolve(
        (ledger.result as CachedRoomLedgerRecord | undefined)?.pinned === true ||
          (meta.result as CachedMetaRecord[]).some(isRecentlyOpened)
      );
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

/** Admission reads index keys only, never attachment payloads or room references. */
const readCachedBytes = (db: IDBDatabase): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const transaction = db.transaction([ATTACHMENTS_STORE, ROOM_LEDGER_STORE], 'readonly');
    const ledger = transaction.objectStore(ROOM_LEDGER_STORE).getAll();
    const cursor = transaction
      .objectStore(ATTACHMENTS_STORE)
      .index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX)
      .openKeyCursor();
    let attachmentBytes = 0;
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      attachmentBytes += (cursor.result.key as number[])[1];
      cursor.result.continue();
    };
    transaction.oncomplete = () =>
      resolve(
        attachmentBytes +
          (ledger.result as CachedRoomLedgerRecord[]).reduce((sum, row) => sum + row.approxBytes, 0)
      );
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

type MediaPhaseResult = Pick<EvictionResult, 'bytesAfter' | 'evictedMxcUris'> & {
  /** Text and blobs of protected rooms: bytes no eviction can free. */
  protectedBytes: number;
};

/** Optional media of unprotected rooms, least recently used first. */
const reclaimOptionalMedia = (
  sessionId: string,
  db: IDBDatabase,
  budget: number
): Promise<MediaPhaseResult> =>
  new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [ATTACHMENTS_STORE, ATTACHMENT_REFERENCES_STORE, ROOM_LEDGER_STORE, META_STORE],
      'readwrite'
    );
    const blobs = transaction.objectStore(ATTACHMENTS_STORE);
    const refs = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
    const ledgerRequest = transaction.objectStore(ROOM_LEDGER_STORE).getAll();
    const metaRequest = transaction.objectStore(META_STORE).getAll();
    const referencesRequest = refs.getAll();
    const records: Pick<CachedAttachmentRecord, 'mxcUri' | 'lastAccessedAt' | 'byteLength'>[] = [];
    const cursorRequest = blobs.index(ATTACHMENTS_BY_ACCESS_BYTES_INDEX).openKeyCursor();
    let result: MediaPhaseResult;
    cursorRequest.onsuccess = async () => {
      try {
        const cursor = cursorRequest.result;
        if (cursor) {
          const [lastAccessedAt, byteLength] = cursor.key as number[];
          records.push({ mxcUri: cursor.primaryKey as string, lastAccessedAt, byteLength });
          cursor.continue();
          return;
        }
        const ledger = ledgerRequest.result as CachedRoomLedgerRecord[];
        const references = referencesRequest.result as CachedAttachmentReferenceRecord[];
        const protectedIds = collectProtectedRoomIds(
          sessionId,
          ledger,
          metaRequest.result as CachedMetaRecord[]
        );
        // Every edited message without media has a reference with an empty
        // MXC URI; no blob has one, so those rows are skipped.
        const ownersByMxcUri = new Map<string, CachedAttachmentReferenceRecord[]>();
        references.forEach((row) => {
          if (!row.mxcUri) return;
          const owners = ownersByMxcUri.get(row.mxcUri);
          if (owners) owners.push(row);
          else ownersByMxcUri.set(row.mxcUri, [row]);
        });
        const ownedByProtectedRoom = (mxcUri: string) =>
          (ownersByMxcUri.get(mxcUri) ?? []).some((row) => protectedIds.has(row.roomId));
        const protectedBytes =
          ledger
            .filter((row) => protectedIds.has(row.roomId))
            .reduce((sum, row) => sum + row.approxBytes, 0) +
          records
            .filter((record) => ownedByProtectedRoom(record.mxcUri))
            .reduce((sum, record) => sum + record.byteLength, 0);
        const bytesBefore =
          ledger.reduce((sum, row) => sum + row.approxBytes, 0) +
          records.reduce((sum, row) => sum + row.byteLength, 0);
        let bytesAfter = bytesBefore;
        const evictedMxcUris: string[] = [];
        if (bytesBefore > budget) {
          records.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
          for (const record of records) {
            if (bytesAfter <= budget * EVICTION_TARGET_UTILIZATION) break;
            const owners = ownersByMxcUri.get(record.mxcUri) ?? [];
            if (owners.some((row) => row.essential || protectedIds.has(row.roomId))) continue;
            // Only eviction candidates need a value read (unowned essentials also survive).
            // eslint-disable-next-line no-await-in-loop
            const cached = await new Promise<CachedAttachmentRecord | undefined>(
              (resolveRecord, rejectRecord) => {
                const request = blobs.get(record.mxcUri);
                request.onsuccess = () => resolveRecord(request.result);
                request.onerror = () => rejectRecord(request.error);
              }
            );
            if (cached?.essential) continue;
            if (owners.some((row) => isRoomInUse(sessionId, row.roomId))) continue;
            blobs.delete(record.mxcUri);
            owners.forEach((row) => refs.put({ ...row, byteLength: 0, status: 'missing' }));
            bytesAfter -= record.byteLength;
            evictedMxcUris.push(record.mxcUri);
          }
        }
        result = { bytesAfter, evictedMxcUris, protectedBytes };
      } catch (error) {
        reject(error);
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

/**
 * Unprotected rooms, least recently opened first (never opened before any),
 * then least recently active. Federation and traffic do not say whether anyone
 * uses a room. A room whose last event was deleted has no ledger row but can
 * still own attachments, so rooms known only from references are included.
 */
const readRoomEvictionOrder = (sessionId: string, db: IDBDatabase): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [ROOM_LEDGER_STORE, META_STORE, ATTACHMENT_REFERENCES_STORE],
      'readonly'
    );
    const ledgerRequest = transaction.objectStore(ROOM_LEDGER_STORE).getAll();
    const metaRequest = transaction.objectStore(META_STORE).getAll();
    const referencedRoomIds: string[] = [];
    const roomCursor = transaction
      .objectStore(ATTACHMENT_REFERENCES_STORE)
      .index(ATTACHMENT_REFERENCES_BY_ROOM_INDEX)
      .openKeyCursor(null, 'nextunique');
    roomCursor.onsuccess = () => {
      if (!roomCursor.result) return;
      referencedRoomIds.push(roomCursor.result.key as string);
      roomCursor.result.continue();
    };
    transaction.oncomplete = () => {
      const ledger = ledgerRequest.result as CachedRoomLedgerRecord[];
      const meta = metaRequest.result as CachedMetaRecord[];
      const protectedIds = collectProtectedRoomIds(sessionId, ledger, meta);
      const lastOpenedTs = new Map<string, number>();
      meta.forEach((row) =>
        lastOpenedTs.set(
          row.roomId,
          Math.max(lastOpenedTs.get(row.roomId) ?? 0, row.lastOpenedTs ?? 0)
        )
      );
      const lastActivityTs = new Map(ledger.map((row) => [row.roomId, row.lastActivityTs]));
      resolve(
        [...new Set([...ledger.map((row) => row.roomId), ...referencedRoomIds])]
          .filter((roomId) => !protectedIds.has(roomId))
          .sort(
            (a, b) =>
              (lastOpenedTs.get(a) ?? 0) - (lastOpenedTs.get(b) ?? 0) ||
              (lastActivityTs.get(a) ?? 0) - (lastActivityTs.get(b) ?? 0)
          )
      );
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const evictUntilUnderBudget = async (sessionId: string): Promise<EvictionResult> => {
  const db = await openCacheStore(sessionId);
  if (!db)
    return {
      bytesBefore: 0,
      bytesAfter: 0,
      evictedMxcUris: [],
      evictedRoomIds: [],
      underPressure: false,
    };
  const budget = getCacheStoreByteBudget();
  const bytesBefore = await readCachedBytes(db);
  if (bytesBefore <= budget)
    return {
      bytesBefore,
      bytesAfter: bytesBefore,
      evictedMxcUris: [],
      evictedRoomIds: [],
      underPressure: false,
    };
  const media = await reclaimOptionalMedia(sessionId, db, budget);
  let { bytesAfter } = media;
  const evictedRoomIds: string[] = [];
  // When protected rooms alone exceed the budget, clearing the others cannot
  // end the pressure and would only empty them on every pass.
  if (bytesAfter > budget && media.protectedBytes <= budget) {
    // Text counts toward the budget, so media alone cannot always bring it
    // back. Rooms go whole, with their markers and media, so no room keeps a
    // partial history that claims to be complete.
    const target = budget * EVICTION_TARGET_UTILIZATION;
    let estimated = false;
    for (const roomId of await readRoomEvictionOrder(sessionId, db)) {
      if (bytesAfter <= target) break;
      // A pass can take seconds; the user may pin, open, focus or download a
      // room meanwhile. The in-memory check comes last: nothing awaits between
      // it and the clear revoking the room's writes.
      // eslint-disable-next-line no-await-in-loop
      if (await isRoomProtectedInStore(db, roomId)) continue;
      if (isRoomInUse(sessionId, roomId)) continue;
      // eslint-disable-next-line no-await-in-loop
      const freedBytes = await clearRoomCachedContent(sessionId, roomId);
      evictedRoomIds.push(roomId);
      bytesAfter -= freedBytes;
      estimated = true;
      // The freed bytes come from the ledger and references; confirm against
      // the stores once they say the target is met.
      if (bytesAfter <= target) {
        // eslint-disable-next-line no-await-in-loop
        bytesAfter = await readCachedBytes(db);
        estimated = false;
      }
    }
    if (estimated) bytesAfter = await readCachedBytes(db);
  }
  const result = {
    bytesBefore,
    bytesAfter,
    evictedMxcUris: media.evictedMxcUris,
    evictedRoomIds,
    underPressure: bytesAfter > budget,
  };
  // An export showed only that eviction ran, not how full the cache was or why
  // pressure stayed; the totals tell protected bytes from reclaimable ones.
  recordDeepTraceEvent('storage.cache.eviction', {
    budget_bytes: budget,
    bytes_before: bytesBefore,
    bytes_after: bytesAfter,
    protected_bytes: media.protectedBytes,
    evicted_media: result.evictedMxcUris.length,
    evicted_rooms: evictedRoomIds.length,
    under_pressure: result.underPressure,
  });
  return result;
};

/**
 * Reclaim optional media first, then whole unprotected rooms, until the cache
 * is back under its budget. Focused, downloading, pinned and recently opened
 * rooms are never touched, so pressure remains only when they alone exceed the budget.
 * Concurrent checks share one pass, so they cannot each evict a room.
 */
export const runCacheEvictionIfOverBudget = (sessionId: string): Promise<EvictionResult> => {
  const running = runningEvictions.get(sessionId);
  if (running) return running;
  const eviction = evictUntilUnderBudget(sessionId).finally(() => {
    if (runningEvictions.get(sessionId) === eviction) runningEvictions.delete(sessionId);
  });
  runningEvictions.set(sessionId, eviction);
  return eviction;
};

export const maybeScheduleEvictionCheck = (sessionId: string): void => {
  const now = Date.now();
  if (now - (lastCheckAtBySession.get(sessionId) ?? 0) < EVICTION_CHECK_MIN_INTERVAL_MS) return;
  lastCheckAtBySession.set(sessionId, now);
  void runCacheEvictionIfOverBudget(sessionId).catch(() => undefined);
};
