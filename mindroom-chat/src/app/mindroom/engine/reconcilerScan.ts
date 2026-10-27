import { Direction } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import to from 'await-to-js';
import { countCacheProbe } from '../threads/cacheProbe';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  beginThreadReconcileContinuation,
  checkpointThreadReconcileContinuation,
  clearThreadReconcileContinuation,
  loadThreadReconcileContinuation,
  restartThreadReconcileContinuationFromHead,
  type ThreadReconcileContinuation,
} from '../threads/cacheStore';
import { getKnownThreadReplyCount } from '../threads/threadRecord';
import type { HydratedThreadCachePage } from '../threads/types';
import { logTimelineDebug } from '../threads/timelineDebug';

const RECONCILE_BATCH_SIZE = 200;
const MAX_RECONCILE_ITERATIONS = 25;
const RECONCILE_REQUEST_TIMEOUT_MS = 15_000;

type ReconcileScanExit = 'overlap' | 'end' | 'fetch-failed' | 'page-cap' | 'token-loop' | 'aborted';

export type ThreadReconcileContinuationStore = {
  load: typeof loadThreadReconcileContinuation;
  begin: typeof beginThreadReconcileContinuation;
  checkpoint: typeof checkpointThreadReconcileContinuation;
  clear: typeof clearThreadReconcileContinuation;
  restartFromHead: typeof restartThreadReconcileContinuationFromHead;
};

export const DEFAULT_CONTINUATION_STORE: ThreadReconcileContinuationStore = {
  load: loadThreadReconcileContinuation,
  begin: beginThreadReconcileContinuation,
  checkpoint: checkpointThreadReconcileContinuation,
  clear: clearThreadReconcileContinuation,
  restartFromHead: restartThreadReconcileContinuationFromHead,
};

type ScanAccumulator = {
  readonly allMapped: MatrixEvent[];
  readonly allRaw: Partial<IEvent>[];
  fetchedCount: number;
  iterations: number;
  drainedToExhaustion: boolean;
  pagedPastOverlapForShortfall: boolean;
};

type ScanPhaseResult = {
  readonly aborted: boolean;
  readonly exit: ReconcileScanExit;
  readonly fetchFailed: boolean;
  readonly fromToken: string | undefined;
  readonly savedTokenRejected: boolean;
};

export type ThreadRelationScanResult = {
  readonly aborted: boolean;
  readonly allMapped: MatrixEvent[];
  readonly allRaw: Partial<IEvent>[];
  readonly fetchedCount: number;
  readonly fetchFailed: boolean;
  readonly iterations: number;
  readonly pagedPastOverlapForShortfall: boolean;
  readonly scanComplete: boolean;
  readonly scanExit: ReconcileScanExit;
  readonly serverConfirmedStart: boolean;
  settleWithoutRepair: () => Promise<void>;
  prepareRepairPersistence: () => Promise<boolean>;
  commitRepairPersistence: (writeCommitted: boolean) => Promise<boolean>;
};

const isRawThreadReply = (rawEvent: Partial<IEvent>, threadId: string): boolean => {
  const eventId = rawEvent.event_id;
  if (typeof eventId !== 'string' || eventId.length === 0 || eventId === threadId) return false;
  const relatesTo = (rawEvent.content as Record<string, unknown> | undefined)?.['m.relates_to'] as
    | { rel_type?: string; event_id?: string }
    | undefined;
  return relatesTo?.rel_type === 'm.thread' && relatesTo.event_id === threadId;
};

const fetchThreadRelationPage = async (
  mx: MatrixClient,
  roomId: string,
  threadId: string,
  fromToken: string | undefined,
  signal: AbortSignal
): Promise<
  { events: Partial<IEvent>[]; nextToken?: string } | 'invalid-token' | 'timeout' | undefined
> => {
  const [err, relData] = await to(
    mx.fetchRelations(roomId, threadId, null, null, {
      dir: Direction.Backward,
      limit: RECONCILE_BATCH_SIZE,
      recurse: true,
      abortSignal: signal,
      localTimeoutMs: RECONCILE_REQUEST_TIMEOUT_MS,
      ...(fromToken ? { from: fromToken } : {}),
    })
  );
  if (err) {
    // The SDK uses AbortError for the local deadline. Cancellation of the
    // scheduler's job is checked separately and must never start a retry.
    if (!signal.aborted && err.name === 'AbortError') return 'timeout';
    const { errcode, httpStatus } = err as { errcode?: string; httpStatus?: number };
    return errcode === 'M_UNKNOWN_TOKEN' || httpStatus === 400 ? 'invalid-token' : undefined;
  }
  if (!relData) return undefined;
  return {
    events: (relData.chunk ?? []) as Partial<IEvent>[],
    nextToken: relData.next_batch ?? undefined,
  };
};

const logReconcileChunk = (
  debugTraceId: string | undefined,
  iteration: number,
  events: readonly Partial<IEvent>[],
  nextToken: string | undefined
): void => {
  if (!debugTraceId) return;
  const triples = events.map((raw) => {
    const relatesTo = (raw.content as Record<string, unknown> | undefined)?.['m.relates_to'] as
      | { rel_type?: string }
      | undefined;
    const bundled = (raw.unsigned as Record<string, unknown> | undefined)?.['m.relations'] as
      | Record<string, unknown>
      | undefined;
    return {
      event_id: raw.event_id,
      type: raw.type,
      rel_type: relatesTo?.rel_type,
      bundled_relations: bundled ? Object.keys(bundled) : undefined,
    };
  });
  logTimelineDebug(debugTraceId, 'reconcile-chunk', {
    iteration,
    chunkSize: events.length,
    replyCount: triples.filter((event) => event.rel_type === 'm.thread').length,
    nextToken: nextToken ? 'present' : 'absent',
    triples,
  });
};

const runScanPhase = async ({
  mx,
  roomId,
  threadId,
  signal,
  debugTraceId,
  preferLive,
  originalOverlapEventIds,
  expectedReplyCount,
  knownReplyIds,
  initialFromToken,
  accumulator,
}: {
  mx: MatrixClient;
  roomId: string;
  threadId: string;
  signal: AbortSignal;
  debugTraceId: string | undefined;
  preferLive: (rawEvent: Partial<IEvent>) => MatrixEvent;
  originalOverlapEventIds: ReadonlySet<string>;
  expectedReplyCount: number | undefined;
  knownReplyIds: Set<string>;
  initialFromToken: string | undefined;
  accumulator: ScanAccumulator;
}): Promise<ScanPhaseResult> => {
  const phaseStartToken = initialFromToken;
  let fromToken = initialFromToken;
  let phaseIterations = 0;
  let fetchedPage = false;
  let retriedSavedCursorFetch = false;
  let retriedTimeout = false;
  let fetchFailed = false;

  while (phaseIterations < MAX_RECONCILE_ITERATIONS) {
    if (signal.aborted) {
      return {
        aborted: true,
        exit: 'aborted',
        fetchFailed,
        fromToken,
        savedTokenRejected: false,
      };
    }

    phaseIterations += 1;
    accumulator.iterations += 1;
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchThreadRelationPage(mx, roomId, threadId, fromToken, signal);
    if (signal.aborted) {
      return { aborted: true, exit: 'aborted', fetchFailed, fromToken, savedTokenRejected: false };
    }
    if (page === 'timeout') {
      if (!retriedTimeout) {
        retriedTimeout = true;
        // A timeout is a retry of this page, not another pagination step.
        phaseIterations -= 1;
        continue;
      }
      return {
        aborted: false,
        exit: 'fetch-failed',
        fetchFailed: true,
        fromToken,
        savedTokenRejected: false,
      };
    }
    if (page === 'invalid-token') {
      return {
        aborted: false,
        exit: 'fetch-failed',
        fetchFailed: true,
        fromToken,
        savedTokenRejected: phaseStartToken !== undefined && !fetchedPage,
      };
    }
    if (!page) {
      fetchFailed = true;
      if (phaseStartToken !== undefined && !fetchedPage && !retriedSavedCursorFetch) {
        retriedSavedCursorFetch = true;
        continue;
      }
      return {
        aborted: false,
        exit: 'fetch-failed',
        fetchFailed,
        fromToken,
        savedTokenRejected: false,
      };
    }

    fetchedPage = true;
    retriedTimeout = false;
    logReconcileChunk(debugTraceId, accumulator.iterations, page.events, page.nextToken);

    const pageRaw = page.events.slice().reverse();
    const pageMapped = pageRaw.map(preferLive);
    accumulator.fetchedCount += pageMapped.length;
    accumulator.allRaw.push(...pageRaw);
    accumulator.allMapped.push(...pageMapped);
    pageRaw.forEach((rawEvent) => {
      if (isRawThreadReply(rawEvent, threadId)) knownReplyIds.add(rawEvent.event_id as string);
    });

    const overlap = pageMapped.some((mEvent) => {
      const id = mEvent.getId();
      return typeof id === 'string' && originalOverlapEventIds.has(id);
    });
    if (!page.nextToken) {
      if (phaseStartToken === undefined) accumulator.drainedToExhaustion = true;
      return {
        aborted: false,
        exit: 'end',
        fetchFailed,
        fromToken,
        savedTokenRejected: false,
      };
    }

    const replyShortfall =
      typeof expectedReplyCount === 'number' && knownReplyIds.size < expectedReplyCount;
    if (overlap && !replyShortfall) {
      return {
        aborted: false,
        exit: 'overlap',
        fetchFailed,
        fromToken,
        savedTokenRejected: false,
      };
    }
    if (page.nextToken === fromToken) {
      return {
        aborted: false,
        exit: 'token-loop',
        fetchFailed,
        fromToken,
        savedTokenRejected: false,
      };
    }
    if (overlap && phaseIterations < MAX_RECONCILE_ITERATIONS) {
      accumulator.pagedPastOverlapForShortfall = true;
      countCacheProbe('reconcileShortfallPagesPastOverlap');
    }
    fromToken = page.nextToken;
  }

  return {
    aborted: false,
    exit: 'page-cap',
    fetchFailed,
    fromToken,
    savedTokenRejected: false,
  };
};

const getExpectedReplyCount = (
  room: Room,
  threadId: string,
  cachedPage: HydratedThreadCachePage | undefined
): number | undefined => {
  const liveRootEvent = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);
  const candidates = [
    liveRootEvent ? getKnownThreadReplyCount(liveRootEvent) : undefined,
    cachedPage?.hydratedRootEvent
      ? getKnownThreadReplyCount(cachedPage.hydratedRootEvent)
      : undefined,
    cachedPage?.expectedReplyCount,
    cachedPage?.cacheCoverage?.expectedReplyCount,
  ].filter((count): count is number => typeof count === 'number');
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
};

export const scanThreadRelations = async ({
  mx,
  sessionId,
  room,
  roomId,
  threadId,
  cachedPage,
  cachedEventIds,
  signal,
  debugTraceId,
  preferLive,
  continuationStore,
}: {
  mx: MatrixClient;
  sessionId: string;
  room: Room;
  roomId: string;
  threadId: string;
  cachedPage: HydratedThreadCachePage | undefined;
  cachedEventIds: ReadonlySet<string>;
  signal: AbortSignal;
  debugTraceId: string | undefined;
  preferLive: (rawEvent: Partial<IEvent>) => MatrixEvent;
  continuationStore: ThreadReconcileContinuationStore;
}): Promise<ThreadRelationScanResult> => {
  const lease = captureCacheStoreWriteLease(sessionId, roomId);
  const current = () => !signal.aborted && isCacheStoreWriteLeaseCurrent(lease);
  let continuation = await continuationStore
    .load(sessionId, roomId, threadId)
    .catch(() => undefined);
  let fromToken = continuation?.nextToken;
  const originalOverlapEventIds = new Set(
    continuation ? continuation.overlapEventIds : cachedEventIds
  );

  const ensureContinuation = async (): Promise<ThreadReconcileContinuation | undefined> => {
    if (!current()) return undefined;
    if (continuation) return continuation;
    const startedAt = Date.now();
    const candidate: ThreadReconcileContinuation = {
      generation: `${startedAt}:${Math.random().toString(36).slice(2)}`,
      startedAt,
      overlapEventIds: Array.from(cachedEventIds),
    };
    continuation = await continuationStore
      .begin(sessionId, roomId, threadId, candidate)
      .catch(() => undefined);
    return continuation;
  };

  const restartFromHead = async (): Promise<boolean> => {
    if (!current() || !continuation) return false;
    const restartedAt = Date.now();
    const restarted = await continuationStore
      .restartFromHead(
        sessionId,
        roomId,
        threadId,
        continuation.generation,
        `${restartedAt}:${Math.random().toString(36).slice(2)}`
      )
      .catch(() => undefined);
    if (!restarted) return false;
    continuation = restarted;
    fromToken = undefined;
    return true;
  };

  const knownReplyIds = new Set<string>();
  cachedPage?.events.forEach((rawEvent) => {
    if (isRawThreadReply(rawEvent, threadId)) knownReplyIds.add(rawEvent.event_id as string);
  });
  const expectedReplyCount = getExpectedReplyCount(room, threadId, cachedPage);
  const accumulator: ScanAccumulator = {
    allMapped: [],
    allRaw: [],
    fetchedCount: 0,
    iterations: 0,
    drainedToExhaustion: false,
    pagedPastOverlapForShortfall: false,
  };

  let scanExit: ReconcileScanExit = 'fetch-failed';
  let fetchFailed = false;
  let recoveredInvalidToken = false;
  let scanAnotherPhase = true;

  while (scanAnotherPhase) {
    scanAnotherPhase = false;
    const phaseStartToken = fromToken;
    // eslint-disable-next-line no-await-in-loop
    const phase = await runScanPhase({
      mx,
      roomId,
      threadId,
      signal,
      debugTraceId,
      preferLive,
      originalOverlapEventIds,
      expectedReplyCount,
      knownReplyIds,
      initialFromToken: fromToken,
      accumulator,
    });
    fromToken = phase.fromToken;
    scanExit = phase.exit;
    fetchFailed = fetchFailed || phase.fetchFailed;
    if (phase.aborted) break;

    const phaseComplete = scanExit === 'overlap' || scanExit === 'end';
    if (phaseComplete && continuation && continuation.validatingHead !== true) {
      if (phaseStartToken !== undefined && originalOverlapEventIds.size === 0) {
        cachedEventIds.forEach((eventId) => originalOverlapEventIds.add(eventId));
      }
      // eslint-disable-next-line no-await-in-loop
      if (await restartFromHead()) {
        scanAnotherPhase = true;
        continue;
      }
      fetchFailed = true;
      scanExit = 'fetch-failed';
    }

    const invalidSavedToken = scanExit === 'token-loop' || phase.savedTokenRejected;
    if (invalidSavedToken && continuation) {
      // eslint-disable-next-line no-await-in-loop
      const restarted = await restartFromHead();
      if (restarted && !recoveredInvalidToken) {
        recoveredInvalidToken = true;
        scanAnotherPhase = true;
        continue;
      }
    }
    break;
  }

  if (accumulator.allMapped.length > 1) {
    accumulator.allMapped.sort((a, b) => a.getTs() - b.getTs());
  }

  const aborted = scanExit === 'aborted' || signal.aborted;
  if (aborted) countCacheProbe('reconcilesSignalAborted');
  const scanComplete = scanExit === 'overlap' || scanExit === 'end';

  const settleWithoutRepair = async (): Promise<void> => {
    if (!current()) return;
    if (scanComplete && continuation?.validatingHead === true) {
      await continuationStore
        .clear(sessionId, roomId, threadId, continuation.generation)
        .catch(() => false);
      return;
    }
    if (!scanComplete && fromToken && scanExit !== 'token-loop') {
      const currentContinuation = await ensureContinuation();
      if (currentContinuation && current()) {
        await continuationStore
          .checkpoint(sessionId, roomId, threadId, currentContinuation.generation, fromToken)
          .catch(() => false);
      }
    }
  };

  const prepareRepairPersistence = async (): Promise<boolean> => {
    if (!current()) return false;
    if (!scanComplete && fromToken && scanExit !== 'token-loop') {
      await ensureContinuation();
    }
    return (
      current() && (scanComplete || Boolean(continuation && fromToken && scanExit !== 'token-loop'))
    );
  };

  const commitRepairPersistence = async (writeCommitted: boolean): Promise<boolean> => {
    if (!current() || !writeCommitted) return false;
    if (scanComplete && continuation?.validatingHead === true) {
      return continuationStore
        .clear(sessionId, roomId, threadId, continuation.generation)
        .catch(() => false);
    }
    if (scanComplete && !continuation) return true;
    if (continuation && fromToken) {
      return continuationStore
        .checkpoint(sessionId, roomId, threadId, continuation.generation, fromToken)
        .catch(() => false);
    }
    return false;
  };

  return {
    aborted,
    allMapped: accumulator.allMapped,
    allRaw: accumulator.allRaw,
    fetchedCount: accumulator.fetchedCount,
    fetchFailed,
    iterations: accumulator.iterations,
    pagedPastOverlapForShortfall: accumulator.pagedPastOverlapForShortfall,
    scanComplete,
    scanExit,
    serverConfirmedStart: accumulator.drainedToExhaustion && !fetchFailed,
    settleWithoutRepair,
    prepareRepairPersistence,
    commitRepairPersistence,
  };
};
