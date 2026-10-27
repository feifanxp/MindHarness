import { useMemo } from 'react';
import type { EventTimeline, MatrixClient, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { buildThreadSummaryMap, type MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { getRoomEventThreadOpenTarget } from './roomDeepLink';
import {
  buildRoomSurfaceEventEntries,
  getLinkedTimelineEvents,
  isVisibleThreadRootEvent,
  type TimelineEventEntry,
} from './roomTimelineEvents';
import {
  createThreadSortControlSignature,
  collectAvailableRoomTags,
  isRoomThreadOverviewActive,
  type StatusCounts,
  type ThreadFilterState,
  type ThreadSortFreezeState,
  type VisibleThreadRootData,
} from './roomThreadOverviewModel';
import type { RoomViewMode } from './roomViewMode';
import {
  computeThreadRecordStatusCounts,
  computeThreadRecordTagCounts,
  resolveThreadRecordOverviewRootIds,
} from './threadRecordOverview';
import {
  useThreadOverviewCacheHydration,
  useThreadOverviewRelationUpdates,
  type FetchedRelationOverviewUpdateOptions,
} from './threadOverviewCacheHydration';
import type { ThreadRecord } from './types';
import { buildVisibleThreadParticipantMap, buildVisibleThreadReplyCountMap } from './threadUtils';
import {
  DIRECT_ROOM_TIMELINE_FILTER_STATE,
  THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
} from './roomTimelineViewState';
import {
  buildCompactThreadRootData,
  buildCompactZeroReplyRootData,
  getCompactThreadRootPreviewInfo,
  mergeCompactThreadRootData,
} from './compactThreadRootData';
import { useScheduledTaskEvents } from './useScheduledTaskEvents';
import { usePinnedEventIds } from './useThreadPinning';
import { usePinnedThreadEvents } from './usePinnedThreadEvents';
import { useRoomThreadList } from './useRoomThreadList';
import {
  buildRoomThreadScheduledStatusMap,
  type ThreadScheduledStatus,
} from './threadScheduledStatus';
import {
  mergeCompactThreadRootBodyMaps,
  useThreadOverviewCachedMetadata,
} from './threadOverviewCacheMetadata';
import { buildMindroomThreadIndexRecordMaps } from './threadIndexRecords';

type ThreadResolutionLike = {
  isResolved: boolean;
  tags: Record<string, unknown> | null;
};

type ThreadIndexOrdering = {
  filteredIds: string[];
  liveOrderedIds: string[];
  displayOrderedIds: string[];
};

const EMPTY_ORDERING: ThreadIndexOrdering = {
  filteredIds: [],
  liveOrderedIds: [],
  displayOrderedIds: [],
};

export type MindroomThreadIndexSnapshot = {
  showCompactRoomView: boolean;
  normalThreadRecordMap: Map<string, ThreadRecord>;
  compactThreadRecordMap: Map<string, ThreadRecord>;
  threadRecordMap: Map<string, ThreadRecord>;
  normalOverviewOrdering: ThreadIndexOrdering;
  compactOverviewOrdering: ThreadIndexOrdering;
  focusedRoomOverviewRootId: string | undefined;
  focusedRoomOverviewBypass: boolean;
  liveThreadFilterState: ThreadFilterState;
  effectiveThreadFilterState: ThreadFilterState;
  roomThreadFilterRequested: boolean;
  roomThreadFilterActive: boolean;
  filteredThreadRootIds: string[];
  compactFilteredThreadRootIds: string[];
  roomOverviewOrderActive: boolean;
  activeLiveOverviewThreadRootIds: string[];
  overviewThreadRootIds: string[];
  statusCounts: StatusCounts;
  tagCounts: Record<string, number>;
  searchQuery: string;
  threadSortControlSignature: string;
};

export type UseMindroomThreadIndexResult = MindroomThreadIndexSnapshot & {
  roomSurfaceEventEntries: TimelineEventEntry[];
  visibleThreadRootData: VisibleThreadRootData;
  compactThreadRootData: VisibleThreadRootData;
  hasZeroReplyRootCoverage: boolean;
  threadReplyCountMap: Map<string, number>;
  threadParticipantMap: Map<string, string[]>;
  threadSummaryInfoMap: Map<string, MindroomThreadSummaryInfo>;
  scheduledStatusMap: Map<string, ThreadScheduledStatus>;
  availableRoomTags: string[];
  roomThreadListThreads: Thread[];
  refreshRoomThreadList: () => Promise<void>;
  applyThreadOverviewRelationEvents: (options: FetchedRelationOverviewUpdateOptions) => void;
};

export type ResolveMindroomThreadIndexSnapshotOptions = {
  pinnedThreadRootIds?: string[];
  threadId: string | undefined;
  compactViewRequested: boolean;
  visibleThreadRootIds: string[];
  compactThreadRootIds: string[];
  normalThreadRecordMap: Map<string, ThreadRecord>;
  compactThreadRecordMap: Map<string, ThreadRecord>;
  threadFilterState: ThreadFilterState;
  liveThreadFilterState: ThreadFilterState;
  fallbackThreadFilterState: ThreadFilterState;
  searchQuery: string;
  threadSortFreezeState: ThreadSortFreezeState | null;
  threadSortControlSignature: string;
  focusedRoomOverviewRequested: boolean;
  focusedRoomOverviewRootId: string | undefined;
};

export const buildThreadRootEventMap = (
  roomSurfaceEventEntries: TimelineEventEntry[],
  indexMap: ReadonlyMap<string, number>
): Map<string, MatrixEvent> => {
  const eventMap = new Map<string, MatrixEvent>();
  roomSurfaceEventEntries.forEach(({ event }) => {
    const eventId = event.getId();
    if (eventId && indexMap.has(eventId)) {
      eventMap.set(eventId, event);
    }
  });
  return eventMap;
};

export const resolveFocusedRoomOverviewRootId = ({
  eventId,
  room,
  roomThreads = [],
  threadResolutionMap,
  threadReplyCountMap,
}: {
  eventId: string;
  room: Room;
  roomThreads?: Array<Pick<Thread, 'id' | 'rootEvent'>>;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  threadReplyCountMap?: Map<string, number>;
}): string | undefined => {
  const threadTarget = getRoomEventThreadOpenTarget({
    eventId,
    room,
    roomThreads,
  });
  if (threadTarget?.threadId) return threadTarget.threadId;

  const targetEvent =
    room.findEventById(eventId) ?? roomThreads.find((thread) => thread.id === eventId)?.rootEvent;
  if (
    targetEvent &&
    isVisibleThreadRootEvent(targetEvent, room, threadResolutionMap, threadReplyCountMap)
  ) {
    return eventId;
  }

  return undefined;
};

export const resolveMindroomThreadIndexSnapshot = ({
  pinnedThreadRootIds,
  threadId,
  compactViewRequested,
  visibleThreadRootIds,
  compactThreadRootIds,
  normalThreadRecordMap,
  compactThreadRecordMap,
  threadFilterState,
  liveThreadFilterState,
  fallbackThreadFilterState,
  searchQuery,
  threadSortFreezeState,
  threadSortControlSignature,
  focusedRoomOverviewRequested,
  focusedRoomOverviewRootId,
}: ResolveMindroomThreadIndexSnapshotOptions): MindroomThreadIndexSnapshot => {
  const showCompactRoomView = compactViewRequested && compactThreadRootIds.length > 0;
  const threadRecordMap = showCompactRoomView ? compactThreadRecordMap : normalThreadRecordMap;
  const normalOverviewOrdering = threadId
    ? EMPTY_ORDERING
    : resolveThreadRecordOverviewRootIds({
        threadRootIds: visibleThreadRootIds,
        threadFilterState,
        searchQuery,
        recordMap: normalThreadRecordMap,
        threadSortFreezeState,
        threadSortControlSignature,
      });

  const focusedRoomOverviewBypass =
    focusedRoomOverviewRequested &&
    (!focusedRoomOverviewRootId ||
      !normalOverviewOrdering.filteredIds.includes(focusedRoomOverviewRootId));
  const effectiveThreadFilterState = focusedRoomOverviewBypass
    ? fallbackThreadFilterState
    : threadFilterState;
  const roomThreadFilterRequested =
    isRoomThreadOverviewActive(threadId, liveThreadFilterState) || focusedRoomOverviewRequested;
  const roomThreadFilterActive = roomThreadFilterRequested && !focusedRoomOverviewBypass;
  const compactOverviewOrdering =
    threadId || !compactViewRequested
      ? normalOverviewOrdering
      : resolveThreadRecordOverviewRootIds({
          threadRootIds: compactThreadRootIds,
          pinnedThreadRootIds,
          threadFilterState,
          searchQuery,
          recordMap: compactThreadRecordMap,
          threadSortFreezeState,
          threadSortControlSignature,
        });
  const filteredThreadRootIds = threadId
    ? visibleThreadRootIds
    : normalOverviewOrdering.filteredIds;
  const compactFilteredThreadRootIds = threadId
    ? compactThreadRootIds
    : compactOverviewOrdering.filteredIds;
  const roomOverviewOrderActive = roomThreadFilterActive || showCompactRoomView;
  const activeLiveOverviewThreadRootIds = showCompactRoomView
    ? compactOverviewOrdering.liveOrderedIds
    : normalOverviewOrdering.liveOrderedIds;
  const overviewThreadRootIds = showCompactRoomView
    ? compactOverviewOrdering.displayOrderedIds
    : roomThreadFilterActive
    ? normalOverviewOrdering.displayOrderedIds
    : [];
  const countThreadRootIds = showCompactRoomView ? compactThreadRootIds : visibleThreadRootIds;

  return {
    showCompactRoomView,
    normalThreadRecordMap,
    compactThreadRecordMap,
    threadRecordMap,
    normalOverviewOrdering,
    compactOverviewOrdering,
    focusedRoomOverviewRootId,
    focusedRoomOverviewBypass,
    liveThreadFilterState,
    effectiveThreadFilterState,
    roomThreadFilterRequested,
    roomThreadFilterActive,
    filteredThreadRootIds,
    compactFilteredThreadRootIds,
    roomOverviewOrderActive,
    activeLiveOverviewThreadRootIds,
    overviewThreadRootIds,
    statusCounts: computeThreadRecordStatusCounts(countThreadRootIds, threadRecordMap),
    tagCounts: computeThreadRecordTagCounts(countThreadRootIds, threadRecordMap),
    searchQuery,
    threadSortControlSignature,
  };
};

export type UseMindroomThreadIndexOptions = {
  room: Room;
  threadId: string | undefined;
  eventId: string | undefined;
  focusedRoomOverviewRequested: boolean;
  compactViewRequested: boolean;
  effectiveViewMode: RoomViewMode;
  linkedTimelines: EventTimeline[];
  renderableEventEntries: TimelineEventEntry[];
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  summaryMap: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  threadResolutionMap: Map<string, ThreadResolutionLike>;
  currentUserId: string | undefined;
  requestedThreadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  overviewRefreshCounter: number;
  sessionId: string;
  mx: MatrixClient;
  onStoreThreadSummary: (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => void;
};

export const useMindroomThreadIndex = ({
  room,
  threadId,
  eventId,
  focusedRoomOverviewRequested,
  compactViewRequested,
  effectiveViewMode,
  linkedTimelines,
  renderableEventEntries,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
  summaryMap,
  threadResolutionMap,
  currentUserId,
  requestedThreadFilterState,
  threadSortFreezeState,
  overviewRefreshCounter,
  sessionId,
  mx,
  onStoreThreadSummary,
}: UseMindroomThreadIndexOptions): UseMindroomThreadIndexResult => {
  const loadedTimelineEvents = useMemo(() => {
    if (threadId) return [] as MatrixEvent[];
    return getLinkedTimelineEvents(linkedTimelines);
  }, [threadId, linkedTimelines]);
  const threadReplyCountMap = useMemo(
    () =>
      threadId ? new Map<string, number>() : buildVisibleThreadReplyCountMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  const threadParticipantMap = useMemo(
    () =>
      threadId
        ? new Map<string, string[]>()
        : buildVisibleThreadParticipantMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  const threadSummaryInfoMap = useMemo(
    () =>
      threadId
        ? new Map<string, MindroomThreadSummaryInfo>()
        : buildThreadSummaryMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  const scheduledTaskEvents = useScheduledTaskEvents(room);
  const scheduledStatusMap = useMemo(
    () =>
      threadId
        ? new Map<string, ThreadScheduledStatus>()
        : buildRoomThreadScheduledStatusMap(scheduledTaskEvents),
    [threadId, scheduledTaskEvents]
  );
  const availableRoomTags = useMemo(
    () => collectAvailableRoomTags(threadResolutionMap),
    [threadResolutionMap]
  );
  const roomSurfaceEventEntries = useMemo(() => {
    // Mutable SDK/event metadata can change without changing the timeline array identity.
    void overviewRefreshCounter;
    if (threadId) return renderableEventEntries;
    return buildRoomSurfaceEventEntries({
      renderableEventEntries,
      linkedTimelines,
      room,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      threadReplyCountMap,
      threadResolutionMap,
    });
  }, [
    threadId,
    renderableEventEntries,
    linkedTimelines,
    room,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    threadReplyCountMap,
    threadResolutionMap,
    overviewRefreshCounter,
  ]);
  const visibleThreadRootData = useMemo(() => {
    const ids: string[] = [];
    const indexMap = new Map<string, number>();
    const bodyMap = new Map<string, string>();
    const sourceTsMap = new Map<string, number>();
    roomSurfaceEventEntries.forEach(({ event, absoluteIndex }) => {
      const evtId = event.getId();
      if (!evtId) return;
      if (isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
        ids.push(evtId);
        indexMap.set(evtId, absoluteIndex);
        const previewInfo = getCompactThreadRootPreviewInfo(event, {
          eventId: evtId,
          room,
        });
        if (previewInfo) {
          bodyMap.set(evtId, previewInfo.previewText);
          sourceTsMap.set(evtId, previewInfo.sourceTs);
        }
      }
    });
    return { ids, indexMap, bodyMap, sourceTsMap };
  }, [roomSurfaceEventEntries, room, threadResolutionMap, threadReplyCountMap]);
  const {
    threads: roomThreadListThreads,
    loading: roomThreadListLoading,
    loadedSuccessfully: roomThreadListLoadedSuccessfully,
    fullyLoaded: roomThreadListFullyLoaded,
    retry: refreshRoomThreadList,
  } = useRoomThreadList(room, compactViewRequested);
  const pinnedEventIds = usePinnedEventIds(room);
  const pinnedThreadEvents = usePinnedThreadEvents(
    room,
    compactViewRequested && !threadId,
    overviewRefreshCounter
  );
  const compactRoomSurfaceEntries = useMemo(() => {
    const entries = pinnedThreadEvents.map((event, index) => ({
      event: room.findEventById(event.getId()!) ?? event,
      absoluteIndex: -(index + 1),
    }));
    return [...entries, ...roomSurfaceEventEntries];
  }, [pinnedThreadEvents, room, roomSurfaceEventEntries]);
  const { compactThreadRootData, hasZeroReplyRootCoverage } = useMemo(() => {
    if (threadId || !compactViewRequested) {
      return {
        compactThreadRootData: visibleThreadRootData,
        hasZeroReplyRootCoverage: false,
      };
    }

    const baseCompactThreadRootData = buildCompactThreadRootData({
      room,
      visibleIds: visibleThreadRootData.ids,
      visibleIndexMap: visibleThreadRootData.indexMap,
      visibleBodyMap: visibleThreadRootData.bodyMap,
      visibleSourceTsMap: visibleThreadRootData.sourceTsMap,
      threads: roomThreadListThreads,
    });
    const knownRealThreadRootIds = new Set(
      roomThreadListThreads
        .map((thread) => thread.id)
        .filter((threadId): threadId is string => !!threadId)
    );
    visibleThreadRootData.ids.forEach((rootId) => {
      if (room.getThread(rootId) || (threadReplyCountMap.get(rootId) ?? 0) > 0) {
        knownRealThreadRootIds.add(rootId);
      }
    });
    const compactZeroReplyRootData = buildCompactZeroReplyRootData({
      room,
      roomSurfaceEntries: compactRoomSurfaceEntries,
      knownThreadRootIds: knownRealThreadRootIds,
    });

    return {
      compactThreadRootData: mergeCompactThreadRootData(
        baseCompactThreadRootData,
        compactZeroReplyRootData
      ),
      hasZeroReplyRootCoverage:
        roomThreadListLoadedSuccessfully &&
        !!room.threadsTimelineSets[0]?.getLiveTimeline() &&
        roomThreadListFullyLoaded &&
        !roomThreadListLoading &&
        compactZeroReplyRootData.ids.length > 0,
    };
  }, [
    threadId,
    compactViewRequested,
    room,
    compactRoomSurfaceEntries,
    visibleThreadRootData,
    roomThreadListThreads,
    roomThreadListLoading,
    roomThreadListLoadedSuccessfully,
    roomThreadListFullyLoaded,
    threadReplyCountMap,
  ]);
  const cachedMetadata = useThreadOverviewCachedMetadata(room.roomId);

  const compactThreadRootBodyMap = useMemo(() => {
    return mergeCompactThreadRootBodyMaps(
      compactThreadRootData.bodyMap,
      cachedMetadata.compactRootBodyMap,
      compactThreadRootData.sourceTsMap,
      cachedMetadata.compactRootSourceTsMap
    );
  }, [
    compactThreadRootData.bodyMap,
    compactThreadRootData.sourceTsMap,
    cachedMetadata.compactRootBodyMap,
    cachedMetadata.compactRootSourceTsMap,
  ]);

  // Typed-input debouncing (free text AND structured tokens) happens at the
  // source in useRoomViewThreadState.handleSearchQueryChange — by the time a
  // typed query lands in requestedThreadFilterState it is already settled.
  const threadSortControlSignature = useMemo(
    () =>
      createThreadSortControlSignature({
        state: requestedThreadFilterState,
        viewMode: effectiveViewMode,
      }),
    [requestedThreadFilterState, effectiveViewMode]
  );
  const visibleThreadRootEventMap = useMemo(
    () => buildThreadRootEventMap(roomSurfaceEventEntries, visibleThreadRootData.indexMap),
    [roomSurfaceEventEntries, visibleThreadRootData.indexMap]
  );
  const compactThreadRootEventMap = useMemo(
    () => buildThreadRootEventMap(compactRoomSurfaceEntries, compactThreadRootData.indexMap),
    [compactRoomSurfaceEntries, compactThreadRootData.indexMap]
  );
  const { normalThreadRecordMap, compactThreadRecordMap } = useMemo(() => {
    // External hydration can refresh mutable SDK/cache-backed sources without changing map identity.
    void overviewRefreshCounter;
    return buildMindroomThreadIndexRecordMaps({
      threadId,
      compactViewRequested,
      room,
      visibleThreadRootData,
      compactThreadRootData,
      visibleThreadRootEventMap,
      compactThreadRootEventMap,
      compactThreadRootBodyMap,
      summaryMap,
      fallbackSummaryMap: threadSummaryInfoMap,
      fallbackReplyCountMap: threadReplyCountMap,
      cachedMetadata,
      fallbackParticipantMap: threadParticipantMap,
      threadResolutionMap,
      currentUserId,
      scheduledStatusMap,
    });
  }, [
    threadId,
    compactViewRequested,
    room,
    visibleThreadRootData,
    compactThreadRootData,
    visibleThreadRootEventMap,
    compactThreadRootEventMap,
    compactThreadRootBodyMap,
    summaryMap,
    threadSummaryInfoMap,
    threadReplyCountMap,
    cachedMetadata,
    threadParticipantMap,
    threadResolutionMap,
    currentUserId,
    scheduledStatusMap,
    overviewRefreshCounter,
  ]);
  const focusedRoomOverviewRootId = useMemo(
    () =>
      focusedRoomOverviewRequested && eventId
        ? resolveFocusedRoomOverviewRootId({
            eventId,
            room,
            roomThreads: roomThreadListThreads,
            threadResolutionMap,
            threadReplyCountMap,
          })
        : undefined,
    [
      eventId,
      threadReplyCountMap,
      focusedRoomOverviewRequested,
      room,
      roomThreadListThreads,
      threadResolutionMap,
    ]
  );

  const snapshot = useMemo(
    () =>
      resolveMindroomThreadIndexSnapshot({
        pinnedThreadRootIds: [...pinnedEventIds].reverse(),
        threadId,
        compactViewRequested,
        visibleThreadRootIds: visibleThreadRootData.ids,
        compactThreadRootIds: compactThreadRootData.ids,
        normalThreadRecordMap,
        compactThreadRecordMap,
        threadFilterState: requestedThreadFilterState,
        liveThreadFilterState: requestedThreadFilterState,
        fallbackThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
        searchQuery: requestedThreadFilterState.freeText,
        threadSortFreezeState,
        threadSortControlSignature,
        focusedRoomOverviewRequested,
        focusedRoomOverviewRootId,
      }),
    [
      pinnedEventIds,
      threadId,
      compactViewRequested,
      visibleThreadRootData.ids,
      compactThreadRootData.ids,
      normalThreadRecordMap,
      compactThreadRecordMap,
      requestedThreadFilterState,
      threadSortFreezeState,
      threadSortControlSignature,
      focusedRoomOverviewRequested,
      focusedRoomOverviewRootId,
    ]
  );

  useThreadOverviewCacheHydration({
    threadId,
    overviewThreadRootIds: snapshot.overviewThreadRootIds,
    overviewThreadMetadataCacheLimit: THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
    room,
    roomThreadListThreads,
    sessionId,
    mx,
    showCompactRoomView: snapshot.showCompactRoomView,
    compactThreadRootBodyMap: compactThreadRootData.bodyMap,
    compactThreadRecordMap: snapshot.compactThreadRecordMap,
    threadRecordMap: snapshot.normalThreadRecordMap,
    cachedMetadata,
    onStoreThreadSummary,
  });

  const applyThreadOverviewRelationEvents = useThreadOverviewRelationUpdates({
    threadId,
    showCompactRoomView: snapshot.showCompactRoomView,
    compactThreadRecordMap,
    normalThreadRecordMap,
    cachedMetadata,
    room,
    roomThreadListThreads,
    onStoreThreadSummary,
  });

  return {
    ...snapshot,
    roomSurfaceEventEntries,
    visibleThreadRootData,
    compactThreadRootData,
    hasZeroReplyRootCoverage,
    threadReplyCountMap,
    threadParticipantMap,
    threadSummaryInfoMap,
    scheduledStatusMap,
    availableRoomTags,
    roomThreadListThreads,
    refreshRoomThreadList,
    applyThreadOverviewRelationEvents,
  };
};
