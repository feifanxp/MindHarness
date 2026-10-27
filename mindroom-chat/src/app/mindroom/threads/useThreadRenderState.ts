import {
  MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  EventStatus,
  EventTimelineSet,
  MatrixEvent,
  RelationType,
  Room,
  RoomEvent,
  type RoomEventHandlerMap,
  Thread,
} from 'matrix-js-sdk';
import { aggregateCachedRelationEvents, hydrateCachedEvents } from './eventCacheEditUtils';
import { removeAggregatedReactionByEventId } from '../engine/redactionCacheLifecycle';
import { useThreadEventRefresh } from './useThreadEventRefresh';
import {
  buildResolveConfirmedEventId,
  getThreadInitialRenderMode,
  mergeThreadRenderEvents,
  ThreadInitialRenderMode,
} from './threadRenderUtils';
import { eventBelongsToThread } from './threadUtils';
import { logTimelineDebug } from './timelineDebug';
import { isLocalEchoEventId } from './threadRouteUtils';
import { getPendingThreadEvents } from './pendingThreadEvents';
import { getThreadTimelineEvents } from './linkedTimelines';

type UseThreadRenderStateOpts = {
  room: Room;
  roomTimelineSet: EventTimelineSet;
  threadTimelineSet?: EventTimelineSet;
  threadId?: string;
  thread: Thread | null;
  threadInitialCacheHydrated: boolean;
  threadInitialSdkLoaded?: boolean;
  timelineRevision?: number;
  debugTraceId?: string;
};

type ThreadRelationState = {
  threadId?: string;
  relationEventIds: Set<string>;
};

type ThreadFallbackState = {
  threadId?: string;
  events: MatrixEvent[];
};

const EMPTY_THREAD_EVENTS: MatrixEvent[] = [];

const buildThreadEvents = ({
  room,
  threadId,
  thread,
  fallbackEvents,
  threadInitialCacheHydrated,
  threadInitialSdkLoaded = false,
}: {
  room: Room;
  threadId: string;
  thread: Thread | null;
  fallbackEvents: MatrixEvent[];
  threadInitialCacheHydrated: boolean;
  threadInitialSdkLoaded: boolean;
}): {
  events: MatrixEvent[];
  indexMap: Map<string, number>;
  initialRenderMode: ThreadInitialRenderMode;
} => {
  const collectedEvents: MatrixEvent[] = [];
  const sdkEvents = thread ? getThreadTimelineEvents(thread) : [];
  const initializationComplete =
    threadInitialCacheHydrated || threadInitialSdkLoaded || isLocalEchoEventId(threadId);

  const addThreadEvent = (mEvent?: MatrixEvent | null, requireThreadMatch = true) => {
    if (!mEvent) return;
    const eventId = mEvent.getId();
    if (!eventId) return;
    if (requireThreadMatch && eventId !== threadId && !eventBelongsToThread(mEvent, threadId))
      return;
    collectedEvents.push(mEvent);
  };

  if (sdkEvents.length > 0 || initializationComplete) {
    const threadModelReady = !!thread;
    addThreadEvent(thread?.rootEvent ?? room.findEventById(threadId), !threadModelReady);
    if (threadModelReady) {
      sdkEvents.forEach((mEvent) => addThreadEvent(mEvent, false));
    }
  }

  if (fallbackEvents.length > 0) {
    fallbackEvents.forEach((mEvent) => addThreadEvent(mEvent, false));
  }

  getPendingThreadEvents(room, threadId).forEach((event) => addThreadEvent(event));

  const resolveConfirmedId = buildResolveConfirmedEventId(room, collectedEvents);
  const sortedEvents = mergeThreadRenderEvents([], collectedEvents, resolveConfirmedId);

  const indexMap = new Map<string, number>();
  sortedEvents.forEach((mEvent, index) => {
    const eventId = mEvent.getId();
    if (eventId) indexMap.set(eventId, index);
  });

  return {
    events: sortedEvents,
    indexMap,
    initialRenderMode: getThreadInitialRenderMode({
      initializationComplete,
      availableEventCount: sortedEvents.length,
    }),
  };
};

export const useThreadRenderState = ({
  room,
  roomTimelineSet,
  threadTimelineSet,
  threadId,
  thread,
  threadInitialCacheHydrated,
  threadInitialSdkLoaded = false,
  timelineRevision = 0,
  debugTraceId,
}: UseThreadRenderStateOpts): {
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  threadEventIndexMap: Map<string, number>;
  threadEvents: MatrixEvent[];
  threadInitialRenderMode: ThreadInitialRenderMode;
  setSupplementalThreadEvents: (expectedThreadId: string, events: MatrixEvent[]) => void;
  resetThreadRenderState: (nextThreadId?: string) => void;
} => {
  const threadEventIndexMapRef = useRef<Map<string, number>>(new Map());
  const threadSupplementalRelationIdsRef = useRef<ThreadRelationState>({
    threadId: undefined,
    relationEventIds: new Set(),
  });
  const fallbackThreadEventsRef = useRef<ThreadFallbackState>({
    threadId: undefined,
    events: [],
  });
  const [fallbackThreadEventsState, setFallbackThreadEventsState] = useState<ThreadFallbackState>({
    threadId: undefined,
    events: [],
  });
  const [threadEventRefreshTick, setThreadEventRefreshTick] = useState(0);
  const refreshThreadEvents = useCallback(() => {
    setThreadEventRefreshTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (!thread) return undefined;
    // Thread.Update waits for metadata requests; timeline insertion/reset does not.
    thread.on(RoomEvent.Timeline, refreshThreadEvents);
    thread.on(RoomEvent.TimelineReset, refreshThreadEvents);
    // Capture arrivals between render and subscription.
    refreshThreadEvents();
    return () => {
      thread.removeListener(RoomEvent.Timeline, refreshThreadEvents);
      thread.removeListener(RoomEvent.TimelineReset, refreshThreadEvents);
    };
  }, [thread, refreshThreadEvents]);

  const setSupplementalThreadEvents = useCallback(
    (expectedThreadId: string, events: MatrixEvent[]) => {
      const fallbackState = fallbackThreadEventsRef.current;
      const currentEvents = fallbackState.threadId === expectedThreadId ? fallbackState.events : [];
      const cancelledEvents = events.filter((mEvent) => mEvent.status === EventStatus.CANCELLED);
      const cancelledEventIds = new Set(
        cancelledEvents
          .map((mEvent) => mEvent.getId())
          .filter((eventId): eventId is string => !!eventId)
      );
      const retainedCurrentEvents = currentEvents.filter(
        (candidate) =>
          !cancelledEvents.includes(candidate) &&
          (!candidate.getId() || !cancelledEventIds.has(candidate.getId()!))
      );
      const activeEvents = events.filter((mEvent) => mEvent.status !== EventStatus.CANCELLED);
      const resolveConfirmedId = buildResolveConfirmedEventId(room, [
        ...retainedCurrentEvents,
        ...activeEvents,
      ]);
      const mergedEvents = mergeThreadRenderEvents(
        retainedCurrentEvents,
        activeEvents,
        resolveConfirmedId
      );

      const redactedRelationTargets = hydrateCachedEvents({
        room,
        events: mergedEvents,
      });

      const relationState = threadSupplementalRelationIdsRef.current;
      if (relationState.threadId !== expectedThreadId) {
        relationState.threadId = expectedThreadId;
        relationState.relationEventIds = new Set();
      }
      aggregateCachedRelationEvents(
        activeEvents,
        [threadTimelineSet, roomTimelineSet],
        relationState.relationEventIds,
        redactedRelationTargets
      );

      // CINNY-207 P1.2 (finding F6): homeservers can serve stale un-pruned
      // copies of redacted reactions for a while after the redaction
      // (observed on Tuwunel /relations and /messages), and the SDK's own
      // timeline ingestion aggregates them outside our pipelines. Scrub
      // aggregations by event id for every target our merged set knows is
      // redacted — instance-agnostic, so both SDK copies and cache clones go.
      const redactionTargetIds = Array.from(
        new Set([
          ...mergedEvents
            .filter((mEvent) => mEvent.isRedaction())
            .map((mEvent) => mEvent.getAssociatedId())
            .filter((eventId): eventId is string => !!eventId),
        ])
      );
      if (redactionTargetIds.length > 0) {
        const candidateParentIds = mergedEvents
          .map((mEvent) => mEvent.getId())
          .filter((eventId): eventId is string => !!eventId);
        redactionTargetIds.forEach((redactedEventId) => {
          removeAggregatedReactionByEventId({
            timelineSets: [threadTimelineSet, roomTimelineSet],
            candidateParentIds,
            redactedEventId,
          });
        });
      }

      const nextFallbackState = {
        threadId: expectedThreadId,
        events: mergedEvents,
      };
      fallbackThreadEventsRef.current = nextFallbackState;
      setFallbackThreadEventsState(nextFallbackState);
    },
    [room, roomTimelineSet, threadTimelineSet]
  );

  const resetThreadRenderState = useCallback((nextThreadId?: string) => {
    threadEventIndexMapRef.current = new Map();
    threadSupplementalRelationIdsRef.current = {
      threadId: nextThreadId,
      relationEventIds: new Set(),
    };
    const nextFallbackState = {
      threadId: nextThreadId,
      events: [],
    };
    fallbackThreadEventsRef.current = nextFallbackState;
    setFallbackThreadEventsState(nextFallbackState);
  }, []);

  useEffect(() => {
    if (!threadId) return undefined;

    const handleLocalEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (
      mEvent,
      eventRoom
    ) => {
      if (eventRoom.roomId !== room.roomId) return;
      if (mEvent.getRelation()?.rel_type !== RelationType.Thread) return;
      if (!eventBelongsToThread(mEvent, threadId)) return;

      // The SDK waits for its background thread-metadata request before it
      // emits Thread.NewReply. Render the room's direct local echo immediately
      // so a slow root request cannot hide a newly sent first reply. The
      // supplemental sink also removes this event if cancellation arrives.
      setSupplementalThreadEvents(threadId, [mEvent]);
    };

    room.on(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    return () => {
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    };
  }, [room, setSupplementalThreadEvents, threadId]);

  const fallbackEvents = useMemo(() => {
    if (!threadId || fallbackThreadEventsState.threadId !== threadId) {
      return EMPTY_THREAD_EVENTS;
    }
    return fallbackThreadEventsState.events;
  }, [fallbackThreadEventsState.events, fallbackThreadEventsState.threadId, threadId]);

  const threadEventState = useMemo(() => {
    void threadEventRefreshTick;
    // SDK joins can change history without emitting a thread event.
    void timelineRevision;

    if (!threadId) {
      return {
        events: EMPTY_THREAD_EVENTS,
        indexMap: new Map<string, number>(),
        initialRenderMode: 'live' as const,
      };
    }

    return buildThreadEvents({
      room,
      threadId,
      thread,
      fallbackEvents,
      threadInitialCacheHydrated,
      threadInitialSdkLoaded,
    });
  }, [
    fallbackEvents,
    room,
    thread,
    threadEventRefreshTick,
    timelineRevision,
    threadId,
    threadInitialCacheHydrated,
    threadInitialSdkLoaded,
  ]);
  const {
    events: threadEvents,
    indexMap: threadEventIndexMap,
    initialRenderMode: threadInitialRenderMode,
  } = threadEventState;
  useLayoutEffect(() => {
    threadEventIndexMapRef.current = threadEventIndexMap;
  }, [threadEventIndexMap]);

  const handleThreadNewReply = useCallback(
    (mEvent: MatrixEvent) => {
      if (!threadId) return;
      setSupplementalThreadEvents(threadId, [mEvent]);
    },
    [setSupplementalThreadEvents, threadId]
  );

  useThreadEventRefresh(
    thread ?? undefined,
    threadEvents,
    refreshThreadEvents,
    handleThreadNewReply
  );

  useEffect(() => {
    if (!threadId) return;
    logTimelineDebug(debugTraceId, 'render-state', {
      fallbackCount: fallbackEvents.length,
      indexCount: threadEventIndexMapRef.current.size,
      initialCacheHydrated: threadInitialCacheHydrated,
      initialRenderMode: threadInitialRenderMode,
      mergedCount: threadEvents.length,
      sdkThreadCount: thread ? getThreadTimelineEvents(thread).length : 0,
    });
  }, [
    debugTraceId,
    fallbackEvents.length,
    thread,
    threadEvents.length,
    threadId,
    threadInitialCacheHydrated,
    threadInitialRenderMode,
  ]);

  return {
    threadEventIndexMapRef,
    threadEventIndexMap,
    threadEvents,
    threadInitialRenderMode,
    setSupplementalThreadEvents,
    resetThreadRenderState,
  };
};
