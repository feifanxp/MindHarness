import {
  Direction,
  type EventTimeline,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import { flushThreadSyncGap } from './activeThreadSyncGaps';
import { compareCachedPaginationAnchors } from './eventCacheTokenUtils';
import { isZeroReplyStandaloneThreadRootEvent } from './compactThreadRootData';
import { isPendingLocalEchoThreadRoot } from './threadRouteUtils';
import {
  findEarliestLoadedThreadReplyByCacheOrder,
  reconcileThreadBackwardPagination,
} from './threadPaginationUtils';
import { getLinkedTimelines, getThreadTimelineEvents } from './linkedTimelines';
import { logTimelineDebug } from './timelineDebug';
import { getThreadCursorAnchor } from './eventRepository';
import { isThreadNotFoundError } from './threadBootstrap';
import type { HydratedThreadCachePage } from './types';
import {
  appendThreadBootstrapRelations,
  createInitializedThreadForRoot,
  fetchThreadBootstrapRelations,
} from './sdk/threadBootstrapSdk';

type PersistThreadEventCache = (
  expectedThreadId: string,
  events: MatrixEvent[],
  rootEvent?: MatrixEvent | null,
  beforeTokenForEarliest?: string | null,
  tailLoaded?: boolean,
  snapshotComplete?: boolean,
  expectedReplyCount?: number,
  relationSnapshotComplete?: boolean
) => void;

export type ThreadBootstrapObservation =
  | { kind: 'root-ready' }
  | { kind: 'load-error' }
  | { kind: 'backward-availability'; hasMoreCachedBack: boolean };
type RunThreadOpenSdkBootstrapOptions = {
  debugTraceId: string | undefined;
  isMounted: () => boolean;
  mx: MatrixClient;
  onThreadLoadError?: (threadId: string) => void;
  persistThreadEventCache: PersistThreadEventCache;
  pinThreadToBottomOnOpen: () => void;
  room: Room;
  setSupplementalThreadEvents: (threadId: string, events: MatrixEvent[]) => void;
  onBootstrap: (observation: ThreadBootstrapObservation) => void;
  shouldScrollToLatestOnOpen: boolean;
  threadId: string;
};

const mapBootstrapRelations = (mx: MatrixClient, chunk: IEvent[]): MatrixEvent[] => {
  const mapper = mx.getEventMapper();
  return chunk
    .slice()
    .reverse()
    .map((event) => mapper(event));
};

export const runThreadOpenSdkBootstrap = async ({
  debugTraceId,
  isMounted,
  mx,
  onThreadLoadError,
  persistThreadEventCache,
  pinThreadToBottomOnOpen,
  room,
  setSupplementalThreadEvents,
  onBootstrap,
  shouldScrollToLatestOnOpen,
  threadId,
}: RunThreadOpenSdkBootstrapOptions): Promise<boolean> => {
  logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-start');
  if (isPendingLocalEchoThreadRoot(room, threadId)) {
    onBootstrap({ kind: 'root-ready' });
    logTimelineDebug(debugTraceId, 'thread-open-pending-local-echo-root', {
      threadId,
    });
    if (shouldScrollToLatestOnOpen) {
      pinThreadToBottomOnOpen();
    }
    return false;
  }

  let threadModel = room.getThread(threadId);
  const zeroReplyStandaloneRootEvent = threadModel ? undefined : room.findEventById(threadId);
  if (
    !threadModel &&
    zeroReplyStandaloneRootEvent &&
    isZeroReplyStandaloneThreadRootEvent(zeroReplyStandaloneRootEvent)
  ) {
    threadModel = createInitializedThreadForRoot(room, zeroReplyStandaloneRootEvent);
    onBootstrap({ kind: 'root-ready' });
    logTimelineDebug(debugTraceId, 'thread-open-zero-reply-root-without-thread-model', {
      threadId,
    });
    if (shouldScrollToLatestOnOpen) {
      pinThreadToBottomOnOpen();
    }
  }

  if (!threadModel) {
    const [ctxErr] = await to(mx.getEventTimeline(room.getUnfilteredTimelineSet(), threadId));
    if (!isMounted()) {
      return false;
    }
    if (ctxErr) {
      logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-context-error', {
        threadId,
      });
      onBootstrap({ kind: 'load-error' });
      if (isThreadNotFoundError(ctxErr)) {
        onThreadLoadError?.(threadId);
      }
      return false;
    }
    threadModel = room.getThread(threadId);
  }

  if (!threadModel) {
    const [relErr, relData] = await to(fetchThreadBootstrapRelations(mx, room.roomId, threadId));
    if (!isMounted()) {
      return false;
    }
    if (relErr) {
      logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-relations-error', {
        threadId,
      });
      onBootstrap({ kind: 'load-error' });
      if (isThreadNotFoundError(relErr)) {
        onThreadLoadError?.(threadId);
      }
      return false;
    }

    threadModel = room.getThread(threadId);
    if (!threadModel && relData?.chunk?.length) {
      const mappedEvents = mapBootstrapRelations(mx, relData.chunk);
      setSupplementalThreadEvents(threadId, mappedEvents);
      persistThreadEventCache(
        threadId,
        mappedEvents,
        room.findEventById(threadId),
        relData.next_batch
      );
      reconcileThreadBackwardPagination(
        undefined,
        relData.next_batch ?? null,
        (hasMoreCachedBack) => onBootstrap({ kind: 'backward-availability', hasMoreCachedBack })
      );
      logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-relations-fallback', {
        mappedCount: mappedEvents.length,
        nextBatchPresent: typeof relData.next_batch === 'string',
        threadId,
      });
    }
  }

  if (!threadModel) {
    logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-missing-thread-model', {
      threadId,
    });
    return true;
  }

  const pendingReset = flushThreadSyncGap(threadModel, isMounted);
  if (pendingReset) {
    const [resetError] = await to(pendingReset);
    if (!isMounted()) return false;
    if (resetError) {
      onBootstrap({ kind: 'load-error' });
      return false;
    }
  }
  // Listed threads skip the SDK's root and first-page requests until they are shown or opened.
  // A failed initialization leaves the thread uninitialized; the requests below still run.
  const initializing = threadModel.initialize();
  if (initializing) {
    await to(initializing);
    if (!isMounted()) return false;
  }
  const loadedThreadTimelineSet = threadModel.getUnfilteredTimelineSet();
  // Only a thread with no loaded events needs the root's context. The SDK prepends the context's
  // reply page newest first to the segment holding the root (or a new one), so a segment that
  // already holds those newer replies becomes its older neighbour; later history then cannot join
  // the live segment. Backward pagination of the live segment reaches the root instead.
  const contextRequested = loadedThreadTimelineSet
    .getTimelines()
    .every((timeline) => timeline.getEvents().length === 0);
  if (contextRequested) {
    const [err] = await to(mx.getThreadTimeline(loadedThreadTimelineSet, threadId));
    if (!isMounted()) {
      return false;
    }
    if (err) {
      logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-get-thread-timeline-error', {
        error: err,
        threadId,
      });
    }
  }

  let firstThreadTimeline = getLinkedTimelines(loadedThreadTimelineSet.getLiveTimeline())[0];

  // A root is a renderable placeholder, not evidence that reply history loaded.
  if (getThreadTimelineEvents(threadModel).every((event) => event.getId() === threadId)) {
    const [relErr, relData] = await to(fetchThreadBootstrapRelations(mx, room.roomId, threadId));
    if (!isMounted()) {
      return false;
    }
    if (relErr) {
      onBootstrap({ kind: 'load-error' });
      return false;
    }
    if (relData?.chunk) {
      const mappedEvents = mapBootstrapRelations(mx, relData.chunk);
      appendThreadBootstrapRelations({
        thread: threadModel,
        events: mappedEvents,
        nextBatch: relData.next_batch,
      });
      firstThreadTimeline = getLinkedTimelines(loadedThreadTimelineSet.getLiveTimeline())[0];
      logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-empty-thread-relations-fill', {
        mappedCount: mappedEvents.length,
        nextBatchPresent: typeof relData.next_batch === 'string',
        threadId,
      });
    }
  }

  logTimelineDebug(debugTraceId, 'thread-sdk-bootstrap-ready', {
    contextRequested,
    rootPresent: !!threadModel.rootEvent,
    sdkEventCount: getThreadTimelineEvents(threadModel).length,
    threadId,
  });
  persistThreadEventCache(
    threadId,
    getThreadTimelineEvents(threadModel),
    threadModel.rootEvent,
    firstThreadTimeline?.getPaginationToken(Direction.Backward)
  );

  if (firstThreadTimeline) {
    const sdkBackwardToken = firstThreadTimeline.getPaginationToken(Direction.Backward) ?? null;
    reconcileThreadBackwardPagination(firstThreadTimeline, sdkBackwardToken, (hasMoreCachedBack) =>
      onBootstrap({ kind: 'backward-availability', hasMoreCachedBack })
    );
  }

  // Newly created models still need the caller's history refresh to exhaust
  // fallback pagination cursors and settle the open-thread render state.
  return true;
};

export const reconcileCachedThreadBackwardToken = ({
  cachedPage,
  firstThreadTimeline,
  threadEvents,
  threadId,
}: {
  cachedPage?: HydratedThreadCachePage;
  firstThreadTimeline?: EventTimeline;
  threadEvents: MatrixEvent[];
  threadId: string;
}): void => {
  const cachedEarliestAnchor = getThreadCursorAnchor(cachedPage?.events[0]);
  const earliestThreadReply = findEarliestLoadedThreadReplyByCacheOrder(threadEvents, threadId);
  const threadTimelineAnchor = getThreadCursorAnchor(
    earliestThreadReply?.event as Partial<IEvent> | undefined
  );
  if (
    firstThreadTimeline &&
    cachedPage?.beforeToken !== undefined &&
    cachedEarliestAnchor &&
    (!threadTimelineAnchor ||
      compareCachedPaginationAnchors(threadTimelineAnchor, cachedEarliestAnchor) >= 0)
  ) {
    firstThreadTimeline.setPaginationToken(cachedPage.beforeToken ?? null, Direction.Backward);
  }
};
