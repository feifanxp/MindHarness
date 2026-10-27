import type { EventAttachmentMessage } from '../../messages/eventAttachments';
import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  openCacheStore,
  type CacheStoreWriteLease,
} from './cacheStoreDb';
import {
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
  ATTACHMENT_REFERENCES_BY_ROOM_INDEX,
  ATTACHMENT_REFERENCES_BY_OWNER_INDEX,
  ROOM_LEDGER_STORE,
  META_STORE,
  buildRedactedRelationMetaKey,
  type CachedRoomLedgerRecord,
  ATTACHMENT_REFERENCES_STORE,
  ATTACHMENTS_STORE,
  buildAttachmentReferenceKey,
  type CachedAttachmentRecord,
  type CachedAttachmentReferenceRecord,
} from './cacheStoreSchema';

export type CachedAttachmentMetadata = Omit<CachedAttachmentRecord, 'bytes'> & {
  references: CachedAttachmentReferenceRecord[];
};

export type CacheAttachmentWriteStatus = 'committed' | 'failed' | 'revoked' | 'unavailable';

export type CacheAttachmentWriteOptions = {
  essential?: boolean;
  roomId?: string;
  eventId?: string;
  revisionTs?: number;
  revisionId?: string;
  signal?: AbortSignal;
  writeLease?: CacheStoreWriteLease;
};

const abortError = (): DOMException => new DOMException('The operation was aborted', 'AbortError');

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

export const loadCachedAttachment = async (
  sessionId: string,
  mxcUri: string
): Promise<CachedAttachmentRecord | undefined> => {
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return undefined;
    const transaction = db.transaction(ATTACHMENTS_STORE, 'readonly');
    return (await requestResult(transaction.objectStore(ATTACHMENTS_STORE).get(mxcUri))) as
      | CachedAttachmentRecord
      | undefined;
  } catch {
    return undefined;
  }
};

const putAttachmentTransaction = async (
  db: IDBDatabase,
  input: Pick<CachedAttachmentRecord, 'bytes' | 'mimeType' | 'mxcUri'>,
  options: CacheAttachmentWriteOptions
): Promise<void> => {
  const transaction = db.transaction([ATTACHMENTS_STORE, ATTACHMENT_REFERENCES_STORE], 'readwrite');
  const done = transactionComplete(transaction);
  const abortTransaction = () => {
    try {
      transaction.abort();
    } catch {
      /* Already completed. */
    }
  };
  options.signal?.addEventListener('abort', abortTransaction, { once: true });
  try {
    if (options.signal?.aborted) throw abortError();
    const blobs = transaction.objectStore(ATTACHMENTS_STORE);
    const refs = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
    const [previous, references] = await Promise.all([
      requestResult(blobs.get(input.mxcUri)) as Promise<CachedAttachmentRecord | undefined>,
      requestResult(
        refs.index(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX).getAll(input.mxcUri)
      ) as Promise<CachedAttachmentReferenceRecord[]>,
    ]);
    if (options.signal?.aborted) throw abortError();
    if (
      !options.eventId ||
      references.some(
        (row) =>
          row.roomId === options.roomId &&
          row.eventId === options.eventId &&
          row.revisionTs === options.revisionTs &&
          (row.revisionId ?? '') === (options.revisionId ?? '') &&
          !row.redacted
      )
    ) {
      const now = Date.now();
      const record: CachedAttachmentRecord = {
        mxcUri: input.mxcUri,
        bytes: previous?.bytes ?? input.bytes,
        mimeType: previous?.mimeType || input.mimeType,
        byteLength: previous?.byteLength ?? input.bytes.byteLength,
        storedAt: previous?.storedAt ?? now,
        lastAccessedAt: now,
        essential: previous?.essential === true || options.essential === true,
      };
      const updated = references.map(
        (row): CachedAttachmentReferenceRecord => ({
          ...row,
          byteLength: record.byteLength,
          updatedAt: now,
          status:
            record.byteLength <= (row.maxBytes ?? Infinity) &&
            (!row.essential ||
              row.status === 'cached' ||
              (options.essential &&
                row.roomId === options.roomId &&
                row.eventId === options.eventId &&
                row.revisionTs === options.revisionTs &&
                (row.revisionId ?? '') === (options.revisionId ?? '')))
              ? 'cached'
              : 'missing',
        })
      );
      updated.forEach((row) => refs.put(row));
      if (references.length)
        record.essential = updated.some((row) => row.essential && row.status === 'cached');
      if (
        options.roomId &&
        !options.eventId &&
        !references.some((row) => row.roomId === options.roomId && row.eventId)
      ) {
        const referenceKey = buildAttachmentReferenceKey(options.roomId, input.mxcUri);
        const essential =
          references.some((row) => row.referenceKey === referenceKey && row.essential) ||
          options.essential === true;
        refs.put({
          referenceKey,
          roomId: options.roomId,
          mxcUri: input.mxcUri,
          byteLength: record.byteLength,
          essential,
          status: 'cached',
          updatedAt: now,
        });
        record.essential ||= essential;
      }
      blobs.put(record);
    }
    await done;
  } catch (error) {
    abortTransaction();
    await done.catch(() => undefined);
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abortTransaction);
  }
};

export const putCachedAttachment = async (
  sessionId: string,
  input: Pick<CachedAttachmentRecord, 'bytes' | 'mimeType' | 'mxcUri'>,
  options: CacheAttachmentWriteOptions = {}
): Promise<CacheAttachmentWriteStatus> => {
  const writeLease = options.writeLease ?? captureCacheStoreWriteLease(sessionId, options.roomId);
  if (options.signal?.aborted) throw abortError();
  if (!isCacheStoreWriteLeaseCurrent(writeLease)) return 'revoked';
  if (!isCacheWritable()) return 'unavailable';

  try {
    const db = await openCacheStore(sessionId);
    if (!db) return 'unavailable';
    if (options.signal?.aborted) throw abortError();
    if (!isCacheStoreWriteLeaseCurrent(writeLease)) return 'revoked';

    await putAttachmentTransaction(db, input, options);
    return 'committed';
  } catch (error) {
    if (options.signal?.aborted) {
      throw abortError();
    }
    if (!isCacheStoreWriteLeaseCurrent(writeLease)) return 'revoked';
    reportCacheWriteError('attachment.save', error);
    return 'failed';
  }
};

export const getCachedAttachmentMetadata = async (
  sessionId: string,
  mxcUri: string
): Promise<CachedAttachmentMetadata | undefined> => {
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return undefined;
    const transaction = db.transaction(
      [ATTACHMENTS_STORE, ATTACHMENT_REFERENCES_STORE],
      'readonly'
    );
    const attachmentRequest = transaction.objectStore(ATTACHMENTS_STORE).get(mxcUri);
    const referenceRequest = transaction
      .objectStore(ATTACHMENT_REFERENCES_STORE)
      .index(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX)
      .getAll(mxcUri);
    const [record, references] = await Promise.all([
      requestResult(attachmentRequest),
      requestResult(referenceRequest),
    ]);
    if (!record) return undefined;
    const { bytes: _bytes, ...metadata } = record as CachedAttachmentRecord;
    return {
      ...metadata,
      references: references as CachedAttachmentReferenceRecord[],
    };
  } catch {
    return undefined;
  }
};

/** Drop unshared bytes and keep shared-byte retention derived from validated owners. */
const pruneAttachmentBytes = async (transaction: IDBTransaction, mxcUris: Iterable<string>) => {
  const refs = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
  const blobs = transaction.objectStore(ATTACHMENTS_STORE);
  for (const mxcUri of new Set(mxcUris)) {
    if (!mxcUri) continue;
    const cached = (await requestResult(blobs.get(mxcUri))) as CachedAttachmentRecord | undefined;
    if (!cached) continue;
    const remaining = (await requestResult(
      refs.index(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX).getAll(mxcUri)
    )) as CachedAttachmentReferenceRecord[];
    const essential = remaining.some((row) => row.essential && row.status === 'cached');
    if (!remaining.length) blobs.delete(mxcUri);
    else if (cached.essential !== essential) blobs.put({ ...cached, essential });
  }
};

/** Only the canonical event transaction calls this after accepting the same raw revision. */
export const replaceCachedAttachmentReferences = async (
  transaction: IDBTransaction,
  message: EventAttachmentMessage
): Promise<void> => {
  const { roomId, eventId, revisionTs, revisionId, attachments } = message;
  const refs = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
  const blobs = transaction.objectStore(ATTACHMENTS_STORE);
  const meta = transaction.objectStore(META_STORE);
  const owned = (await requestResult(
    refs.index(ATTACHMENT_REFERENCES_BY_OWNER_INDEX).getAll([roomId, eventId])
  )) as CachedAttachmentReferenceRecord[];
  const retired = new Set<string>();
  await Promise.all(
    [...new Set([eventId, revisionId, ...owned.map((row) => row.revisionId)])]
      .filter((id): id is string => !!id)
      .map(async (id) => {
        if (await requestResult(meta.get(buildRedactedRelationMetaKey(roomId, id))))
          retired.add(id);
      })
  );
  if (
    retired.has(eventId) ||
    retired.has(revisionId ?? '') ||
    owned.some(
      (row) =>
        row.redacted ||
        (!retired.has(row.revisionId ?? '') &&
          ((row.revisionTs ?? 0) > revisionTs ||
            (row.revisionTs === revisionTs && (row.revisionId ?? '') > (revisionId ?? ''))))
    )
  )
    return;
  const entries = attachments.length
    ? attachments
    : [{ mxcUri: '', essential: false, maxBytes: undefined }];
  if (
    owned.length === entries.length &&
    entries.every((input) =>
      owned.some(
        (row) =>
          row.mxcUri === input.mxcUri &&
          row.revisionTs === revisionTs &&
          (row.revisionId ?? '') === (revisionId ?? '') &&
          !row.redacted &&
          row.essential === input.essential &&
          row.maxBytes === input.maxBytes
      )
    )
  )
    return;
  const legacy = await Promise.all(
    entries.map(
      (entry) =>
        requestResult(refs.get(buildAttachmentReferenceKey(roomId, entry.mxcUri))) as Promise<
          CachedAttachmentReferenceRecord | undefined
        >
    )
  );
  const removed = [
    ...owned,
    ...legacy.filter((row): row is CachedAttachmentReferenceRecord => !!row && !row.eventId),
  ];
  removed.forEach((row) => refs.delete(row.referenceKey));
  for (const input of entries) {
    const cached = (await requestResult(blobs.get(input.mxcUri))) as
      | CachedAttachmentRecord
      | undefined;
    const validated = owned.some(
      (row) =>
        row.mxcUri === input.mxcUri &&
        row.essential &&
        row.status === 'cached' &&
        row.revisionTs === revisionTs &&
        (row.revisionId ?? '') === (revisionId ?? '')
    );
    refs.put({
      referenceKey: buildAttachmentReferenceKey(roomId, input.mxcUri, eventId),
      roomId,
      eventId,
      revisionTs,
      revisionId,
      mxcUri: input.mxcUri,
      essential: input.essential,
      maxBytes: input.maxBytes,
      byteLength: cached?.byteLength ?? 0,
      status:
        cached &&
        (!input.essential || validated) &&
        cached.byteLength <= (input.maxBytes ?? Infinity)
          ? 'cached'
          : 'missing',
      updatedAt: Date.now(),
    } satisfies CachedAttachmentReferenceRecord);
  }
  await pruneAttachmentBytes(
    transaction,
    [...removed, ...entries].map((row) => row.mxcUri)
  );
};

/** Keep the retired revision as a fence until a surviving canonical revision is admitted. */
export const invalidateCachedAttachmentReferences = async (
  transaction: IDBTransaction,
  roomId: string,
  redactedIds: ReadonlySet<string>
): Promise<void> => {
  const refs = transaction.objectStore(ATTACHMENT_REFERENCES_STORE);
  const rows = (await requestResult(
    refs.index(ATTACHMENT_REFERENCES_BY_ROOM_INDEX).getAll(roomId)
  )) as CachedAttachmentReferenceRecord[];
  const removed = rows.filter(
    (row) => row.eventId && (redactedIds.has(row.eventId) || redactedIds.has(row.revisionId ?? ''))
  );
  for (const row of removed) {
    refs.delete(row.referenceKey);
    refs.put({
      ...row,
      referenceKey: buildAttachmentReferenceKey(roomId, '', row.eventId),
      mxcUri: '',
      essential: false,
      byteLength: 0,
      status: 'missing',
      redacted: redactedIds.has(row.eventId!),
      updatedAt: Date.now(),
    });
  }
  await pruneAttachmentBytes(
    transaction,
    removed.map((row) => row.mxcUri)
  );
};

export const readRoomAttachmentStorage = async (sessionId: string, roomId: string) => {
  const db = await openCacheStore(sessionId);
  if (!db)
    return {
      storageAvailable: false,
      bytes: 0,
      saved: 0,
      missing: 0,
      missingEssential: 0,
      pinned: false,
    };
  const transaction = db.transaction([ATTACHMENT_REFERENCES_STORE, ROOM_LEDGER_STORE], 'readonly');
  const [references, ledger] = await Promise.all([
    requestResult(
      transaction
        .objectStore(ATTACHMENT_REFERENCES_STORE)
        .index(ATTACHMENT_REFERENCES_BY_ROOM_INDEX)
        .getAll(roomId)
    ) as Promise<CachedAttachmentReferenceRecord[]>,
    requestResult(transaction.objectStore(ROOM_LEDGER_STORE).get(roomId)) as Promise<
      CachedRoomLedgerRecord | undefined
    >,
  ]);
  const byUri = new Map<
    string,
    { byteLength: number; saved: boolean; missingEssential: boolean }
  >();
  references
    .filter((row) => row.mxcUri)
    .forEach((row) => {
      const previous = byUri.get(row.mxcUri);
      byUri.set(row.mxcUri, {
        byteLength: Math.max(row.byteLength, previous?.byteLength ?? 0),
        saved: row.status === 'cached' && previous?.saved !== false,
        missingEssential:
          (row.essential && row.status === 'missing') || previous?.missingEssential === true,
      });
    });
  const rows = [...byUri.values()];
  return {
    storageAvailable: true,
    bytes: rows.reduce((sum, row) => sum + row.byteLength, 0),
    saved: rows.filter((row) => row.saved).length,
    missing: rows.filter((row) => !row.saved).length,
    missingEssential: rows.filter((row) => row.missingEssential).length,
    pinned: ledger?.pinned === true,
  };
};

export const setRoomAttachmentPinned = async (
  sessionId: string,
  roomId: string,
  pinned: boolean
): Promise<void> => {
  const lease = captureCacheStoreWriteLease(sessionId, roomId);
  const db = await openCacheStore(sessionId);
  if (!db || !isCacheStoreWriteLeaseCurrent(lease)) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ROOM_LEDGER_STORE, 'readwrite');
    const ledger = transaction.objectStore(ROOM_LEDGER_STORE);
    const request = ledger.get(roomId);
    request.onsuccess = () => {
      const previous = request.result as CachedRoomLedgerRecord | undefined;
      ledger.put({
        ...previous,
        roomId,
        pinned,
        approxBytes: previous?.approxBytes ?? 0,
        eventCount: previous?.eventCount ?? 0,
        lastActivityTs: previous?.lastActivityTs ?? 0,
      });
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

/** Pending owners only; descriptors are reconstructed from their saved event. */
export const readRoomMissingAttachmentEventIds = async (
  sessionId: string,
  roomId: string
): Promise<string[]> => {
  const db = await openCacheStore(sessionId);
  if (!db) return [];
  const transaction = db.transaction(ATTACHMENT_REFERENCES_STORE, 'readonly');
  const rows = (await requestResult(
    transaction
      .objectStore(ATTACHMENT_REFERENCES_STORE)
      .index(ATTACHMENT_REFERENCES_BY_ROOM_INDEX)
      .getAll(roomId)
  )) as CachedAttachmentReferenceRecord[];
  return [
    ...new Set(
      rows
        .filter((row) => row.mxcUri && row.status === 'missing' && row.eventId)
        .map((row) => row.eventId!)
    ),
  ];
};
