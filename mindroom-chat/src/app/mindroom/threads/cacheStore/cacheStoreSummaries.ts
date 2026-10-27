import type { MindroomThreadSummaryInfo } from '../../messages/threadSummary';
import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  openCacheStore,
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
} from './cacheStoreDb';
import {
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  buildSummaryCacheKey,
  type CachedThreadSummaryRecord,
} from './cacheStoreSchema';

// CINNY-207 P2.1: verbatim port of `threadSummaryCache.ts`'s storage
// operations into the unified DB. The record shape is preserved.

export const saveCachedThreadSummary = async (
  sessionId: string,
  roomId: string,
  threadRootId: string,
  info: MindroomThreadSummaryInfo
): Promise<void> => {
  const lease = captureCacheStoreWriteLease(sessionId, roomId);
  // CINNY-207 P2.3: cache health gate — same choke-point pattern as
  // saveRoomEventsToCache / saveThreadEventsToCache.
  if (!isCacheWritable()) return;

  // CINNY-207 P2 review: the openCacheStore await must live inside the
  // reportCacheWriteError boundary — callers invoke us via `void save`
  // so a rejected open would escape as an unhandled rejection and
  // never trip the health gate.
  try {
    const db = await openCacheStore(sessionId);
    if (!db || !info.summaryText || !isCacheStoreWriteLeaseCurrent(lease)) return;

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(THREAD_SUMMARIES_STORE, 'readwrite');
      const store = transaction.objectStore(THREAD_SUMMARIES_STORE);

      const record: CachedThreadSummaryRecord = {
        cacheKey: buildSummaryCacheKey(roomId, threadRootId),
        roomId,
        threadRootId,
        // Guarded above (`!info.summaryText` returns early).
        summaryText: info.summaryText!,
        generatedTs: info.generatedTs,
        ...(info.eventTs !== undefined ? { eventTs: info.eventTs } : {}),
        ...(info.eventId ? { eventId: info.eventId } : {}),
        messageCount: info.messageCount,
        ...(info.isManual ? { isManual: true } : {}),
        updatedAt: Date.now(),
      };
      store.put(record);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    if (isCacheStoreWriteLeaseCurrent(lease))
      reportCacheWriteError('threadSummaryCache.save', error);
  }
};

export const loadCachedThreadSummaries = async (
  sessionId: string,
  roomId: string
): Promise<Map<string, MindroomThreadSummaryInfo>> => {
  const result = new Map<string, MindroomThreadSummaryInfo>();
  const db = await openCacheStore(sessionId);
  if (!db) return result;

  return new Promise<Map<string, MindroomThreadSummaryInfo>>((resolve, reject) => {
    const transaction = db.transaction(THREAD_SUMMARIES_STORE, 'readonly');
    const store = transaction.objectStore(THREAD_SUMMARIES_STORE);
    const index = store.index(THREAD_SUMMARIES_BY_ROOM_INDEX);
    const request = index.openCursor(IDBKeyRange.only(roomId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as CachedThreadSummaryRecord;
      result.set(record.threadRootId, {
        summaryText: record.summaryText,
        generatedTs: record.generatedTs,
        ...(record.eventTs !== undefined ? { eventTs: record.eventTs } : {}),
        ...(record.eventId ? { eventId: record.eventId } : {}),
        messageCount: record.messageCount,
        ...(record.isManual ? { isManual: true } : {}),
      });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};
