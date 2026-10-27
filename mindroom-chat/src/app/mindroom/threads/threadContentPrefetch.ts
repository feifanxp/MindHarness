/**
 * Eager thread cache (2026-07-06): shared fetch→persist→seed pipeline
 * for proactively downloading a thread's full content.
 *
 * Extracted from `threadOverviewResumeController`'s
 * `refreshOverviewThreadCacheFromRelations` so the resume path (page
 * focus / online / visibility) and the thread-seed prewarm band share
 * ONE implementation of "drain this thread's `/relations`, then record
 * an honest snapshot". Both producers route the network side through
 * the engine scheduler's `'thread-backfill'` kind, so a user-triggered
 * thread open, a resume refresh, and a prewarm prefetch for the same
 * thread coalesce into a single round-trip (AC8 dedup).
 */

import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  enqueueThreadBackfillJob,
  type BackfillJobPriority,
  type BackfillScheduler,
} from '../engine';
import {
  getThreadSummaryInfosFromEventSources,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import { isCompleteCachedThreadSnapshot } from './threadCacheSnapshot';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { getKnownThreadReplyCount } from './threadRecord';
import type { FetchedRelationOverviewUpdateOptions } from './threadOverviewCacheHydration';

import type { PersistThreadEventCache } from '../engine/enginePersistFacade';
import type { ThreadSummaryWriter } from './threadSummaryState';

export type FetchAndPersistThreadContentResult = {
  fetchedCount: number;
  snapshotComplete: boolean;
  relationSnapshotComplete: boolean;
};

export const fetchAndPersistThreadContent = async ({
  mx,
  scheduler,
  room,
  threadId,
  priority,
  shouldContinue,
  shouldApply,
  getCurrentThreadSummary,
  beginThreadCacheWrite,
  onApplyThreadRelations,
  onStoreThreadSummary,
}: {
  mx: MatrixClient;
  scheduler: BackfillScheduler;
  room: Room;
  threadId: string;
  priority: BackfillJobPriority;
  /**
   * Polled between fetch batches (cooperative abort) — see
   * `enqueueThreadBackfillJob`.
   */
  shouldContinue?: () => boolean;
  /**
   * Checked once after the fetch settles, BEFORE any state is written.
   * Callers use it for staleness guards (unmount, thread switch).
   */
  shouldApply?: () => boolean;
  /**
   * Returns the current shared summary object for this thread. A changed
   * object means a newer summary source was published while the relation
   * request was in flight, so the entire fetched snapshot must be discarded.
   */
  getCurrentThreadSummary?: (threadRootId: string) => MindroomThreadSummaryInfo | undefined;
  beginThreadCacheWrite: () => PersistThreadEventCache;
  onApplyThreadRelations?: (options: FetchedRelationOverviewUpdateOptions) => void;
  onStoreThreadSummary?: ThreadSummaryWriter;
}): Promise<FetchAndPersistThreadContentResult | undefined> => {
  const persistThreadEventCache = beginThreadCacheWrite();
  const rootEvent = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);
  if (!rootEvent) return undefined;
  const summaryBeforeFetch = getCurrentThreadSummary?.(threadId);

  const relationPageResult = await enqueueThreadBackfillJob({
    mx,
    scheduler,
    room,
    threadId,
    priority,
    shouldContinue,
  });
  if (
    !relationPageResult ||
    (shouldApply && !shouldApply()) ||
    (getCurrentThreadSummary && getCurrentThreadSummary(threadId) !== summaryBeforeFetch)
  ) {
    return undefined;
  }

  const relationEvents = relationPageResult.events;
  const relationSnapshotComplete = typeof relationPageResult.nextBatchToken !== 'string';
  const expectedReplyCount = getKnownThreadReplyCount(rootEvent);
  const snapshotComplete = isCompleteCachedThreadSnapshot({
    room,
    threadId,
    rootEvent,
    cachedRootEvent: rootEvent,
    cachedEvents: [rootEvent, ...relationEvents],
    beforeToken: relationPageResult.nextBatchToken ?? null,
    hasMoreBefore: typeof relationPageResult.nextBatchToken === 'string',
    expectedReplyCount,
    snapshotComplete: relationSnapshotComplete,
    tailLoaded: true,
  });

  if (relationEvents.length > 0) {
    saveThreadOpenSeedSnapshot(room, threadId, relationEvents);
  }

  onApplyThreadRelations?.({
    rootId: threadId,
    room,
    events: relationEvents,
    rootEvent,
    beforeToken: relationPageResult.nextBatchToken ?? null,
    tailLoaded: true,
    snapshotComplete,
    expectedReplyCount,
    relationSnapshotComplete,
  });

  persistThreadEventCache(
    threadId,
    relationEvents,
    rootEvent,
    relationPageResult.nextBatchToken ?? null,
    true,
    snapshotComplete,
    expectedReplyCount,
    relationSnapshotComplete
  );

  if (onStoreThreadSummary) {
    const infos = getThreadSummaryInfosFromEventSources(relationEvents);
    if (infos.length > 0) onStoreThreadSummary(threadId, ...infos);
  }

  return {
    fetchedCount: relationEvents.length,
    snapshotComplete,
    relationSnapshotComplete,
  };
};
