import { useCallback, useEffect, useRef } from 'react';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import {
  getThreadSummaryInfosFromEventSources,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import type { ThreadSummaryWriter } from './threadSummaryState';
import type { ThreadCacheCoverage, ThreadRecord } from './types';
import {
  getCompactCachedThreadActivityTs,
  getCompactCachedThreadRootPreviewInfo,
  getCompactThreadRootPreviewInfo,
} from './compactThreadRootData';
import { type CachedThreadEventPage, loadLatestCachedThreadEventsBatch } from './eventRepository';
import { hasLikelyIncompleteStreamingBody } from './threadEditBackfill';
import { resolveThreadPresentationSnapshot } from './threadPresentation';
import { buildThreadCacheCoverage } from './threadCacheCoverage';
import type {
  ThreadOverviewCachedMetadataController,
  ThreadOverviewCachedMetadataUpdate,
} from './threadOverviewCacheMetadata';

type ThreadLikeRoot = {
  id: string;
  rootEvent?: MatrixEvent;
};

const OVERVIEW_CACHE_PUBLICATION_INTERVAL_MS = 250;
const OVERVIEW_CACHE_EVENT_LIMIT = 32;

type UseThreadOverviewCacheHydrationOptions = {
  threadId?: string;
  overviewThreadRootIds: string[];
  overviewThreadMetadataCacheLimit: number;
  room: Room;
  roomThreadListThreads: ThreadLikeRoot[];
  sessionId: string;
  mx: MatrixClient;
  showCompactRoomView: boolean;
  compactThreadRootBodyMap: Map<string, string>;
  compactThreadRecordMap: ReadonlyMap<string, ThreadRecord>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  cachedMetadata: ThreadOverviewCachedMetadataController;
  onStoreThreadSummary: ThreadSummaryWriter;
};

type CachedOverviewUpdate = ThreadOverviewCachedMetadataUpdate & {
  nextSummaryInfo?: MindroomThreadSummaryInfo;
  summaryCandidates?: Array<MindroomThreadSummaryInfo | undefined>;
};

export type FetchedRelationOverviewUpdateOptions = {
  rootId: string;
  room: Room;
  events: MatrixEvent[];
  currentRecord?: ThreadRecord;
  rootEvent?: MatrixEvent | null;
  beforeToken?: string | null;
  expectedReplyCount?: number;
  relationSnapshotComplete?: boolean;
  snapshotComplete?: boolean;
  tailLoaded?: boolean;
};

type ResolveCachedOverviewUpdateOptions = {
  rootId: string;
  room: Room;
  mapper: (rawEvent: IEvent) => MatrixEvent;
  cachedPage: CachedThreadEventPage;
  currentRecord?: ThreadRecord;
  currentRootEvent?: MatrixEvent;
  showCompactRoomView: boolean;
  compactCachedThreadRootBodyMap: ReadonlyMap<string, string>;
  compactThreadRootBodyMap: ReadonlyMap<string, string>;
};

const getCachedEventTsRange = (
  cachedPage: Pick<CachedThreadEventPage, 'events'>
): { oldestTs: number | undefined; newestTs: number | undefined } => {
  const timestamps = cachedPage.events
    .map((event) => event.origin_server_ts)
    .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts));

  return {
    oldestTs: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    newestTs: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
  };
};

const getMatrixEventTsRange = (
  events: MatrixEvent[]
): { oldestTs: number | undefined; newestTs: number | undefined } => {
  const timestamps = events
    .map((event) => event.getTs())
    .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts));

  return {
    oldestTs: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    newestTs: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
  };
};

export const buildCachedOverviewCoverage = (
  cachedPage: CachedThreadEventPage
): ThreadCacheCoverage => {
  const { oldestTs, newestTs } = getCachedEventTsRange(cachedPage);

  return buildThreadCacheCoverage({
    eventCount: cachedPage.events.length,
    oldestTs,
    newestTs,
    backwardToken: cachedPage.beforeToken,
    hasMoreBackward: cachedPage.hasMoreBefore || typeof cachedPage.beforeToken === 'string',
    expectedReplyCount: cachedPage.expectedReplyCount,
    relationSnapshotComplete: cachedPage.relationSnapshotComplete,
    snapshotComplete: cachedPage.snapshotComplete,
    tailLoaded: cachedPage.tailLoaded,
  });
};

export const resolveFetchedRelationOverviewUpdate = ({
  rootId,
  room,
  events,
  currentRecord,
  rootEvent,
  beforeToken,
  expectedReplyCount,
  relationSnapshotComplete,
  snapshotComplete,
  tailLoaded,
}: FetchedRelationOverviewUpdateOptions): CachedOverviewUpdate | null => {
  const { oldestTs, newestTs } = getMatrixEventTsRange(events);
  const liveActivityTs = currentRecord?.status.lastActivityTs ?? 0;
  const nextActivityTs = newestTs !== undefined && newestTs > liveActivityTs ? newestTs : undefined;
  const cachedPresentation = resolveThreadPresentationSnapshot({
    room,
    threadRootId: rootId,
    thread: { events, timeline: events },
    rootEvent: rootEvent ?? undefined,
  });
  const currentPresentation = currentRecord?.presentation;
  const shouldUseFetchedReplyMetadata =
    (newestTs !== undefined && newestTs >= liveActivityTs) ||
    !currentPresentation?.latestReplyPreviewText;
  const nextReplyPreviewText =
    shouldUseFetchedReplyMetadata &&
    cachedPresentation.latestReplyPreviewText &&
    cachedPresentation.latestReplyPreviewText !== currentPresentation?.latestReplyPreviewText
      ? cachedPresentation.latestReplyPreviewText
      : undefined;
  const nextLastSenderId =
    shouldUseFetchedReplyMetadata &&
    cachedPresentation.lastSenderId &&
    cachedPresentation.lastSenderId !== currentPresentation?.lastSenderId
      ? cachedPresentation.lastSenderId
      : undefined;
  const currentMessageCount =
    currentPresentation?.messageCount ?? currentRecord?.status.replyCount ?? 0;
  const nextMessageCount =
    cachedPresentation.messageCount > 0 && cachedPresentation.messageCount > currentMessageCount
      ? cachedPresentation.messageCount
      : undefined;
  const nextSummaryInfo = cachedPresentation.summaryInfo?.summaryText
    ? cachedPresentation.summaryInfo
    : undefined;
  const nextCacheCoverage = buildThreadCacheCoverage({
    eventCount: events.length,
    oldestTs,
    newestTs,
    backwardToken: beforeToken,
    hasMoreBackward: typeof beforeToken === 'string',
    expectedReplyCount,
    relationSnapshotComplete,
    snapshotComplete,
    tailLoaded,
  });

  if (
    nextActivityTs === undefined &&
    nextReplyPreviewText === undefined &&
    nextLastSenderId === undefined &&
    nextMessageCount === undefined &&
    nextSummaryInfo === undefined
  ) {
    return {
      rootId,
      nextCacheCoverage,
    };
  }

  return {
    rootId,
    nextActivityTs,
    nextReplyPreviewText,
    nextLastSenderId,
    nextMessageCount,
    nextSummaryInfo,
    summaryCandidates: getThreadSummaryInfosFromEventSources(events),
    nextCacheCoverage,
  };
};

const hasCachedOverviewCoverage = (cachedPage: CachedThreadEventPage): boolean =>
  cachedPage.events.length > 0 ||
  !!cachedPage.rootEvent ||
  cachedPage.beforeToken !== undefined ||
  cachedPage.expectedReplyCount !== undefined ||
  cachedPage.snapshotComplete !== undefined ||
  cachedPage.relationSnapshotComplete !== undefined ||
  cachedPage.tailLoaded !== undefined;

export const resolveCachedOverviewUpdate = ({
  rootId,
  room,
  mapper,
  cachedPage,
  currentRecord,
  currentRootEvent,
  showCompactRoomView,
  compactCachedThreadRootBodyMap,
  compactThreadRootBodyMap,
}: ResolveCachedOverviewUpdateOptions): CachedOverviewUpdate | null => {
  // Capture the SDK revision before the cache mapper gets a chance to reuse
  // and update the same MatrixEvent instance.
  const livePreview = compactThreadRootBodyMap.get(rootId);
  const livePreviewSourceTs = getCompactThreadRootPreviewInfo(currentRootEvent, {
    eventId: rootId,
    room,
  })?.sourceTs;
  const cachedActivityTs = getCompactCachedThreadActivityTs({
    threadId: rootId,
    cachedPage,
    mapper,
  });
  const liveActivityTs = currentRecord?.status.lastActivityTs ?? 0;
  const nextActivityTs =
    cachedActivityTs && cachedActivityTs > liveActivityTs ? cachedActivityTs : undefined;
  const cachedEvents = cachedPage.events.map((rawEvent) => mapper(rawEvent as IEvent));
  const cachedPresentation = resolveThreadPresentationSnapshot({
    room,
    threadRootId: rootId,
    thread: { events: cachedEvents, timeline: cachedEvents },
    rootEvent: cachedEvents.find((event) => event.getId() === rootId) ?? currentRootEvent,
  });
  const currentPresentation = currentRecord?.presentation;
  const shouldUseCachedReplyMetadata =
    (cachedActivityTs !== undefined && cachedActivityTs >= liveActivityTs) ||
    !currentPresentation?.latestReplyPreviewText;
  const nextReplyPreviewText =
    shouldUseCachedReplyMetadata &&
    cachedPresentation.latestReplyPreviewText &&
    cachedPresentation.latestReplyPreviewText !== currentPresentation?.latestReplyPreviewText
      ? cachedPresentation.latestReplyPreviewText
      : undefined;
  const nextLastSenderId =
    shouldUseCachedReplyMetadata &&
    cachedPresentation.lastSenderId &&
    cachedPresentation.lastSenderId !== currentPresentation?.lastSenderId
      ? cachedPresentation.lastSenderId
      : undefined;
  const currentMessageCount =
    currentPresentation?.messageCount ?? currentRecord?.status.replyCount ?? 0;
  const nextMessageCount =
    cachedPresentation.messageCount > 0 && cachedPresentation.messageCount > currentMessageCount
      ? cachedPresentation.messageCount
      : undefined;
  const nextSummaryInfo = cachedPresentation.summaryInfo?.summaryText
    ? cachedPresentation.summaryInfo
    : undefined;
  const nextCacheCoverage = hasCachedOverviewCoverage(cachedPage)
    ? buildCachedOverviewCoverage(cachedPage)
    : undefined;

  let nextPreview: string | undefined;
  let nextPreviewSourceTs: number | undefined;
  if (showCompactRoomView && !compactCachedThreadRootBodyMap.has(rootId)) {
    const cachedPreviewInfo = getCompactCachedThreadRootPreviewInfo({
      threadId: rootId,
      cachedPage,
      mapper,
    });
    const shouldUseCachedPreview =
      !!cachedPreviewInfo &&
      (!livePreview ||
        (hasLikelyIncompleteStreamingBody(livePreview) &&
          !hasLikelyIncompleteStreamingBody(cachedPreviewInfo.previewText)) ||
        (!hasLikelyIncompleteStreamingBody(cachedPreviewInfo.previewText) &&
          livePreviewSourceTs !== undefined &&
          cachedPreviewInfo.sourceTs > livePreviewSourceTs));
    if (cachedPreviewInfo && shouldUseCachedPreview) {
      nextPreview = cachedPreviewInfo.previewText;
      nextPreviewSourceTs = cachedPreviewInfo.sourceTs;
    }
  }

  if (
    nextActivityTs === undefined &&
    nextPreview === undefined &&
    nextReplyPreviewText === undefined &&
    nextLastSenderId === undefined &&
    nextMessageCount === undefined &&
    nextSummaryInfo === undefined &&
    nextCacheCoverage === undefined
  ) {
    return null;
  }

  return {
    rootId,
    nextActivityTs,
    nextPreview,
    nextPreviewSourceTs,
    nextReplyPreviewText,
    nextLastSenderId,
    nextMessageCount,
    nextSummaryInfo,
    summaryCandidates: getThreadSummaryInfosFromEventSources(cachedEvents),
    nextCacheCoverage,
  };
};

export const useThreadOverviewCacheHydration = ({
  threadId,
  overviewThreadRootIds,
  overviewThreadMetadataCacheLimit,
  room,
  roomThreadListThreads,
  sessionId,
  mx,
  showCompactRoomView,
  compactThreadRootBodyMap,
  compactThreadRecordMap,
  threadRecordMap,
  cachedMetadata,
  onStoreThreadSummary,
}: UseThreadOverviewCacheHydrationOptions): void => {
  const {
    compactRootBodyMap: compactCachedThreadRootBodyMap,
    lastActivityTsMap: cachedThreadLastActivityTsMap,
    coverageMap: cachedThreadCoverageMap,
    compactRootPreviewAttemptCountsRef,
    applyUpdates,
  } = cachedMetadata;
  const preferImmediatePublicationRef = useRef(false);
  const pendingReadsRef = useRef(
    new Map<string, ReturnType<typeof loadLatestCachedThreadEventsBatch>>()
  );

  useEffect(() => {
    if (threadId || overviewThreadRootIds.length === 0 || overviewThreadMetadataCacheLimit <= 0)
      return;

    const threadRootIdsToLoad = overviewThreadRootIds.filter((rootId) => {
      const needsCacheCoverage = !cachedThreadCoverageMap.has(rootId);
      const needsActivityTs = !cachedThreadLastActivityTsMap.has(rootId) && needsCacheCoverage;

      if (!showCompactRoomView) {
        return needsActivityTs || needsCacheCoverage;
      }

      const currentPreview = compactThreadRootBodyMap.get(rootId);
      const attemptCount = compactRootPreviewAttemptCountsRef.current.get(rootId) ?? 0;
      const maxAttempts =
        !currentPreview || hasLikelyIncompleteStreamingBody(currentPreview) ? 3 : 1;
      const needsPreview =
        !compactCachedThreadRootBodyMap.has(rootId) && attemptCount < maxAttempts;

      return needsActivityTs || needsPreview || needsCacheCoverage;
    });
    if (threadRootIdsToLoad.length === 0) return;

    let cancelled = false;
    let hasBufferedUpdates = false;
    let publicationTimer: ReturnType<typeof setTimeout> | undefined;
    let finishPublicationWait: (() => void) | undefined;

    const loadCachedThreadOverviewRecords = async () => {
      const startedAt = performance.now();
      const nextUpdates: CachedOverviewUpdate[] = [];
      const attemptedRootIds: string[] = [];
      for (
        let offset = 0;
        offset < threadRootIdsToLoad.length;
        offset += overviewThreadMetadataCacheLimit
      ) {
        const batchIds = threadRootIdsToLoad.slice(
          offset,
          offset + overviewThreadMetadataCacheLimit
        );
        let cachedPages: Map<string, CachedThreadEventPage> | undefined;
        try {
          // Keep reads bounded and yield to IndexedDB between batches, without
          // rebuilding the entire overview after every fast cache response.
          const readKey = JSON.stringify([
            sessionId,
            room.roomId,
            OVERVIEW_CACHE_EVENT_LIMIT,
            Array.from(new Set(batchIds)).sort(),
          ]);
          const pendingReads = pendingReadsRef.current;
          let read = pendingReads.get(readKey);
          if (!read) {
            read = loadLatestCachedThreadEventsBatch(
              sessionId,
              room.roomId,
              batchIds,
              OVERVIEW_CACHE_EVENT_LIMIT
            );
            pendingReads.set(readKey, read);
            const releaseRead = () => pendingReads.delete(readKey);
            void read.then(releaseRead, releaseRead);
          }
          // Share only pending raw reads across restarts. Each current effect
          // still derives metadata from its latest live records after awaiting.
          cachedPages = await (nextUpdates.length === 0
            ? read
            : Promise.race([
                read,
                new Promise<undefined>((resolve) => {
                  finishPublicationWait = () => resolve(undefined);
                  publicationTimer = setTimeout(
                    finishPublicationWait,
                    Math.max(
                      0,
                      OVERVIEW_CACHE_PUBLICATION_INTERVAL_MS - (performance.now() - startedAt)
                    )
                  );
                }),
              ]));
        } catch {
          break;
        } finally {
          clearTimeout(publicationTimer);
          publicationTimer = undefined;
          finishPublicationWait = undefined;
        }
        if (cancelled) return;
        if (!cachedPages) break;
        const mapper = mx.getEventMapper();
        attemptedRootIds.push(...batchIds);
        batchIds.forEach((rootId) => {
          const cachedPage = cachedPages.get(rootId);
          if (!cachedPage) return;
          try {
            const currentRecord = (
              showCompactRoomView ? compactThreadRecordMap : threadRecordMap
            ).get(rootId);
            const currentRootEvent =
              room.findEventById(rootId) ??
              room.getThread(rootId)?.rootEvent ??
              roomThreadListThreads.find((thread) => thread.id === rootId)?.rootEvent;

            const update = resolveCachedOverviewUpdate({
              rootId,
              room,
              mapper,
              cachedPage,
              currentRecord,
              currentRootEvent,
              showCompactRoomView,
              compactCachedThreadRootBodyMap,
              compactThreadRootBodyMap,
            });
            if (update) nextUpdates.push(update);
          } catch {
            // A single unreadable cached page must not block the others.
          }
        });
        hasBufferedUpdates = nextUpdates.length > 0;
        // Publish the first useful batch promptly, then amortize full-room
        // derivation while keeping progress visible during slower cache reads.
        if (
          nextUpdates.length > 0 &&
          (preferImmediatePublicationRef.current ||
            cachedThreadCoverageMap.size === 0 ||
            performance.now() - startedAt >= OVERVIEW_CACHE_PUBLICATION_INTERVAL_MS)
        )
          break;
      }
      if (cancelled) return;

      if (showCompactRoomView) {
        attemptedRootIds.forEach((rootId) => {
          if (compactCachedThreadRootBodyMap.has(rootId)) return;
          const currentCount = compactRootPreviewAttemptCountsRef.current.get(rootId) ?? 0;
          compactRootPreviewAttemptCountsRef.current.set(rootId, currentCount + 1);
        });
      }

      if (nextUpdates.length === 0) return;

      hasBufferedUpdates = false;
      preferImmediatePublicationRef.current = false;
      applyUpdates(nextUpdates, { includeCompactRootBody: showCompactRoomView });

      nextUpdates.forEach(({ rootId, nextSummaryInfo, summaryCandidates }) => {
        if (!nextSummaryInfo?.summaryText) return;
        onStoreThreadSummary(rootId, ...(summaryCandidates ?? [nextSummaryInfo]));
      });
    };

    void loadCachedThreadOverviewRecords();

    return () => {
      cancelled = true;
      // Live updates can invalidate derived values while the next read waits.
      // Re-derive them next time, but publish promptly so streaming cannot starve progress.
      if (hasBufferedUpdates) preferImmediatePublicationRef.current = true;
      finishPublicationWait?.();
      clearTimeout(publicationTimer);
    };
  }, [
    cachedThreadLastActivityTsMap,
    cachedThreadCoverageMap,
    compactRootPreviewAttemptCountsRef,
    compactCachedThreadRootBodyMap,
    compactThreadRecordMap,
    compactThreadRootBodyMap,
    mx,
    onStoreThreadSummary,
    overviewThreadMetadataCacheLimit,
    overviewThreadRootIds,
    room,
    room.roomId,
    roomThreadListThreads,
    sessionId,
    applyUpdates,
    showCompactRoomView,
    threadId,
    threadRecordMap,
  ]);
};

export type UseThreadOverviewRelationUpdatesOptions = {
  threadId?: string;
  showCompactRoomView: boolean;
  compactThreadRecordMap: ReadonlyMap<string, ThreadRecord>;
  normalThreadRecordMap: ReadonlyMap<string, ThreadRecord>;
  cachedMetadata: ThreadOverviewCachedMetadataController;
  room: Room;
  roomThreadListThreads: ThreadLikeRoot[];
  onStoreThreadSummary: ThreadSummaryWriter;
};

export const useThreadOverviewRelationUpdates = ({
  threadId,
  showCompactRoomView,
  compactThreadRecordMap,
  normalThreadRecordMap,
  cachedMetadata,
  room,
  roomThreadListThreads,
  onStoreThreadSummary,
}: UseThreadOverviewRelationUpdatesOptions): ((
  options: FetchedRelationOverviewUpdateOptions
) => void) =>
  useCallback(
    (options: FetchedRelationOverviewUpdateOptions) => {
      if (threadId) return;

      const rootId = options.rootId;
      const currentRecord = (
        showCompactRoomView ? compactThreadRecordMap : normalThreadRecordMap
      ).get(rootId);
      const rootEvent =
        options.rootEvent ??
        room.findEventById(rootId) ??
        room.getThread(rootId)?.rootEvent ??
        roomThreadListThreads.find((thread) => thread.id === rootId)?.rootEvent ??
        undefined;
      const update = resolveFetchedRelationOverviewUpdate({
        ...options,
        currentRecord,
        rootEvent,
        room,
      });
      if (!update) return;

      cachedMetadata.applyUpdate(update, { includeCompactRootBody: false });

      if (update.nextSummaryInfo?.summaryText) {
        onStoreThreadSummary(rootId, ...(update.summaryCandidates ?? [update.nextSummaryInfo]));
      }
    },
    [
      compactThreadRecordMap,
      cachedMetadata,
      normalThreadRecordMap,
      onStoreThreadSummary,
      room,
      roomThreadListThreads,
      showCompactRoomView,
      threadId,
    ]
  );
