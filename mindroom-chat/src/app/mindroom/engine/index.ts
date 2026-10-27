/**
 * CINNY-207 P3.1: MindroomSyncEngine barrel.
 *
 * Consumers should import from here so future internal reshuffles
 * don't ripple across the codebase.
 */

export { createMindroomSyncEngine } from './mindroomSyncEngine';
export type { CreateMindroomSyncEngineOptions } from './mindroomSyncEngine';
export {
  MindroomSyncEngineProvider,
  useMindroomSyncEngine,
  useMindroomSyncEngineOptional,
} from './engineContext';
export type { MindroomSyncEngineProviderProps } from './engineContext';
export { createEngineWriteThrough } from './engineWriteThrough';
export type { EngineWriteThrough, EngineWriteThroughOptions } from './engineWriteThrough';
export { createEngineGapTracker, createInMemoryGapFillScheduler } from './engineGapTracker';
export type {
  EngineGapTracker,
  EngineGapTrackerOptions,
  GapFillJob,
  GapFillReason,
  GapFillScheduler,
} from './engineGapTracker';
export type {
  EngineLifecycle,
  EngineLiveEventHandler,
  EngineLiveEventMeta,
  MindroomSyncEngine,
} from './types';
export { createEnginePersistFacade } from './enginePersistFacade';
export type {
  EnginePersistFacade,
  PersistRoomEventCache,
  PersistThreadEventCache,
  PersistThreadCacheFromRoomEvents,
} from './enginePersistFacade';
export {
  MAX_CONCURRENT_BACKFILL_JOBS,
  buildBackfillJobKey,
  createBackfillScheduler,
} from './backfillScheduler';
export type {
  BackfillJob,
  BackfillJobExecutor,
  BackfillJobKind,
  BackfillJobPriority,
  BackfillScheduler,
  CreateBackfillSchedulerOptions,
  EnqueueJobArgs,
} from './backfillScheduler';
export {
  CURRENT_ROOM_DEEP_HISTORY_TARGET,
  DEFAULT_PREFETCH_SCOPE,
  PREFETCH_SCOPE,
  ROOM_TAIL_PREFETCH_DEPTH,
  isRoomEligibleForBackgroundPrefetch,
  isRoomEligibleForRawFetch,
  resolvePrefetchConfig,
  resolveRoomPrefetchTier,
  sanitizePrefetchDepth,
  sanitizePrefetchScope,
} from './prefetchPolicy';
export type { PrefetchConfig, PrefetchScope, RoomPrefetchTier } from './prefetchPolicy';
export { createGapFillExecutor } from './gapFillExecutor';
export type { GapFillExecutor, GapFillExecutorOptions } from './gapFillExecutor';
export { enqueueRoomDeepHistoryJob } from './deepHistoryJob';
export type { HistoryPage } from './deepHistoryJob';
export { scheduleReconcile } from './reconciler';
export type { ReconcileResult, ScheduleReconcileArgs } from './reconciler';
export {
  fetchAllThreadRelations,
  MAX_THREAD_FETCH_EVENTS,
  MAX_THREAD_FETCH_ITERATIONS,
} from './threadRelationsFetcher';
export type { ThreadRelationPageResult } from './threadRelationsFetcher';
export { enqueueThreadBackfillJob } from './threadBackfillJob';
export { enqueueThreadApprovalBackfill } from './threadApprovalBackfill';
export type { EnqueueThreadBackfillArgs, ThreadBackfillResult } from './threadBackfillJob';
