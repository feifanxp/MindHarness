// CINNY-207 P2.1: barrel for the unified CacheStore module. The legacy
// per-domain files (`roomEventCache.ts`, `threadEventCache.ts`,
// `threadSummaryCache.ts`) become pure re-export shims over this module
// in commit 4 of the P2.1 stack.

export {
  ATTACHMENTS_STORE,
  ATTACHMENT_REFERENCES_STORE,
  ATTACHMENT_REFERENCES_BY_ROOM_INDEX,
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
  MINDROOM_CACHE_DB_BASE_NAME,
  CACHE_STORE_DB_VERSION,
  MAX_CACHE_BEFORE_TOKENS,
  __setCacheStoreByteBudgetForTests,
  buildEventCacheKey,
  buildMetaKey,
  estimateRawEventBytes,
  EVENTS_STORE,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_STORE,
  EVENTS_BY_SCOPE_TS_INDEX,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  LEGACY_WIPE_MARKER_META_KEY,
  type CachedEventRecord,
  type CachedAttachmentRecord,
  type CachedAttachmentReferenceRecord,
  type CachedMetaRecord,
  type CachedRoomLedgerRecord,
} from './cacheStoreSchema';

export {
  captureCacheStoreWriteLease,
  getCacheStoreDbName,
  deleteCacheStoreDb,
  openCacheStore,
  resetCacheStoreForTesting,
  revokeAllCacheStoreWrites,
  revokeCacheStoreWrites,
  revokeRoomCacheStoreWrites,
  isCacheStoreWriteLeaseCurrent,
  type CacheStoreWriteLease,
} from './cacheStoreDb';

export {
  getCachedAttachmentMetadata,
  loadCachedAttachment,
  putCachedAttachment,
  readRoomAttachmentStorage,
  setRoomAttachmentPinned,
  type CacheAttachmentWriteOptions,
  type CacheAttachmentWriteStatus,
  type CachedAttachmentMetadata,
} from './cacheStoreAttachments';

export {
  filterPageableCachedThreadEvents,
  getCachedThreadSummaryInfoFromRawEvent,
  getRoomCursorAnchor,
  getThreadCursorAnchor,
  mergeThreadCacheFlag,
  normalizeCachedRoomEvents,
  normalizeCachedThreadEvents,
  type CachedRoomEvent,
  type CachedThreadEvent,
} from './cacheStoreNormalize';

export {
  deleteRoomEventsFromCache,
  deleteThreadEventFromCacheByEventId,
  deleteThreadEventsFromCache,
  loadCachedRoomEvent,
  loadCachedRoomEventsBefore,
  loadCachedRoomPaginationToken,
  loadCachedThreadEvent,
  loadCachedThreadRootsForRoom,
  type CachedThreadRoot,
  loadCachedThreadEventsBefore,
  loadLatestCachedRoomEvents,
  loadLatestCachedThreadEvents,
  loadLatestCachedThreadEventsBatch,
  noteRoomOpened,
  noteThreadOpened,
  saveRoomEventsToCache,
  saveRoomEventsToCacheCommitted,
  saveThreadEventsToCache,
  saveThreadEventsToCacheCommitted,
  type CachedRoomEventPage,
  type CachedThreadEventPage,
} from './cacheStoreEvents';

export { noteRoomFederated, readLedgerSnapshot } from './cacheStoreLedger';

export {
  runCacheEvictionIfOverBudget,
  clearRoomCachedContent,
  maybeScheduleEvictionCheck,
  setEvictionProtectedRoomIds,
  getEvictionProtectedRoomIds,
  setEvictionDownloadingRoomIds,
  __resetEvictionForTests,
} from './cacheEviction';

export { EVICTION_TARGET_UTILIZATION, EVICTION_RECENT_OPEN_WINDOW_MS } from './cacheStoreSchema';

export { loadCachedThreadSummaries, saveCachedThreadSummary } from './cacheStoreSummaries';

export {
  markRoomTailDiscontinuity,
  checkpointRoomTailDiscontinuity,
  clearRoomTailDiscontinuity,
  getTailDiscontinuityGeneration,
  loadRoomTailDiscontinuity,
} from './cacheStoreDiscontinuity';

export {
  beginThreadReconcileContinuation,
  checkpointThreadReconcileContinuation,
  clearThreadReconcileContinuation,
  loadThreadReconcileContinuation,
  restartThreadReconcileContinuationFromHead,
  type ThreadReconcileContinuation,
} from './cacheStoreReconcileContinuation';

export {
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME,
  LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME,
  getLegacyRoomEventCacheDbName,
  getLegacyThreadEventCacheDbName,
  getLegacyThreadSummaryCacheDbName,
  getLegacySessionScopedCacheDbNames,
} from './legacyCacheDbNames';
