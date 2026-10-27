import type { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { buildCompactThreadRootData } from './compactThreadRootData';
import { isVisibleThreadRootEvent } from './roomTimelineEvents';
import {
  createThreadSortControlSignature,
  hasActiveThreadFilters,
  isRoomThreadOverviewActive,
  type ThreadFilterState,
  type ThreadSortFreezeState,
} from './roomThreadOverviewModel';
import type { RoomViewMode } from './roomViewMode';
import { buildThreadRecordMap } from './threadRecord';
import {
  matchesThreadRecordFilterState,
  resolveThreadRecordOverviewRootIds,
} from './threadRecordOverview';
import type { ThreadScheduledStatus } from './threadScheduledStatus';
import { findThreadRootEvent } from './threadUtils';
import type { ThreadRecord } from './types';

type ThreadResolutionLike = {
  isResolved: boolean;
  tags: Record<string, unknown> | null;
};

export const getThreadFilteredEvents = (
  renderableEvents: MatrixEvent[],
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  threadId: string | undefined,
  threadFilterState: ThreadFilterState,
  threadReplyCountMap?: Map<string, number>,
  threadRecordMap?: ReadonlyMap<string, ThreadRecord>
): MatrixEvent[] => {
  if (threadId || !hasActiveThreadFilters(threadFilterState)) return renderableEvents;

  return renderableEvents.filter((event) => {
    const eventId = event.getId();
    if (!eventId) return false;
    if (!isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
      return false;
    }

    const record = threadRecordMap?.get(eventId);
    if (!record) return false;
    return matchesThreadRecordFilterState(record, threadFilterState);
  });
};

export const resolveOrderedRoomOverviewEvents = ({
  orderedRootIds,
  renderableEvents,
  room,
  roomThreads = [],
}: {
  orderedRootIds: string[];
  renderableEvents: MatrixEvent[];
  room: Pick<Room, 'getThread' | 'getUnfilteredTimelineSet'>;
  roomThreads?: Pick<Thread, 'id' | 'rootEvent'>[];
}): MatrixEvent[] => {
  const eventMap = new Map<string, MatrixEvent>();
  renderableEvents.forEach((event) => {
    const eventId = event.getId();
    if (eventId) eventMap.set(eventId, event);
  });

  const threadRootEventMap = new Map<string, MatrixEvent>();
  roomThreads.forEach((thread) => {
    if (thread.id && thread.rootEvent) {
      threadRootEventMap.set(thread.id, thread.rootEvent);
    }
  });

  return orderedRootIds
    .map(
      (rootId) =>
        eventMap.get(rootId) ?? findThreadRootEvent(room, rootId) ?? threadRootEventMap.get(rootId)
    )
    .filter((event): event is MatrixEvent => event !== undefined);
};

const getFilteredRoomOverviewEvents = (
  renderableEvents: MatrixEvent[],
  room: Room,
  threadResolutionMap: Map<string, ThreadResolutionLike>,
  threadFilterState: ThreadFilterState,
  threadReplyCountMap: Map<string, number> | undefined,
  scheduledStatusMap: Map<string, ThreadScheduledStatus>,
  threadReplyCountMapForMeta: Map<string, number>,
  threadParticipantMap: Map<string, string[]>,
  summaryMap: Map<string, MindroomThreadSummaryInfo>,
  currentUserId: string,
  searchQuery: string,
  threadSortFreezeState: ThreadSortFreezeState | null,
  threadSortControlSignature: string,
  viewMode: RoomViewMode = 'threaded',
  roomThreads: Thread[] = []
): MatrixEvent[] => {
  const compactViewRequested = viewMode === 'compact';
  if (!isRoomThreadOverviewActive(undefined, threadFilterState) && !compactViewRequested) {
    return renderableEvents;
  }

  const visibleThreadRootIds: string[] = [];
  const absoluteIndexMap = new Map<string, number>();
  const bodyMap = new Map<string, string>();

  renderableEvents.forEach((event, index) => {
    const currentEventId = event.getId();
    if (!currentEventId) return;
    if (!isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
      return;
    }

    visibleThreadRootIds.push(currentEventId);
    absoluteIndexMap.set(currentEventId, index);
    const body = event.getContent()?.body;
    if (typeof body === 'string') bodyMap.set(currentEventId, body);
  });

  const activeThreadRootData = compactViewRequested
    ? buildCompactThreadRootData({
        room,
        visibleIds: visibleThreadRootIds,
        visibleIndexMap: absoluteIndexMap,
        visibleBodyMap: bodyMap,
        threads: roomThreads,
      })
    : {
        ids: visibleThreadRootIds,
        indexMap: absoluteIndexMap,
        bodyMap,
      };
  const activeThreadRootEventMap = new Map<string, MatrixEvent>();
  renderableEvents.forEach((event) => {
    const eventId = event.getId();
    if (eventId && activeThreadRootData.indexMap.has(eventId)) {
      activeThreadRootEventMap.set(eventId, event);
    }
  });
  roomThreads.forEach((thread) => {
    if (thread.id && thread.rootEvent && activeThreadRootData.indexMap.has(thread.id)) {
      activeThreadRootEventMap.set(thread.id, thread.rootEvent);
    }
  });
  const recordMap = buildThreadRecordMap({
    room,
    threadRootIds: activeThreadRootData.ids,
    threadRootEventMap: activeThreadRootEventMap,
    summaryMap,
    fallbackSummaryMap: summaryMap,
    fallbackReplyCountMap: threadReplyCountMapForMeta,
    rootPreviewTextMap: activeThreadRootData.bodyMap,
    fallbackParticipantMap: threadParticipantMap,
    threadResolutionMap,
    currentUserId,
    scheduledStatusMap,
    absoluteIndexMap: activeThreadRootData.indexMap,
  });

  const orderedRootIds = resolveThreadRecordOverviewRootIds({
    threadRootIds: activeThreadRootData.ids,
    threadFilterState,
    searchQuery,
    recordMap,
    threadSortFreezeState,
    threadSortControlSignature,
  }).displayOrderedIds;

  return resolveOrderedRoomOverviewEvents({
    orderedRootIds,
    renderableEvents,
    room,
    roomThreads,
  });
};

export const getRoomEventFocusTarget = ({
  eventId,
  renderableEvents,
  room,
  threadResolutionMap,
  threadId,
  threadFilterState,
  threadReplyCountMap,
  scheduledStatusMap,
  threadReplyCountMapForMeta,
  threadParticipantMap,
  summaryMap,
  currentUserId,
  searchQuery,
  threadSortFreezeState,
  threadSortControlSignature,
  viewMode,
  roomThreads,
  orderedRoomOverviewEventIds,
}: {
  eventId: string;
  renderableEvents: MatrixEvent[];
  room: Room;
  threadResolutionMap: Map<string, ThreadResolutionLike>;
  threadId: string | undefined;
  threadFilterState: ThreadFilterState;
  threadReplyCountMap?: Map<string, number>;
  scheduledStatusMap: Map<string, ThreadScheduledStatus>;
  threadReplyCountMapForMeta: Map<string, number>;
  threadParticipantMap: Map<string, string[]>;
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  currentUserId: string;
  searchQuery?: string;
  threadSortFreezeState?: ThreadSortFreezeState | null;
  threadSortControlSignature?: string;
  viewMode?: RoomViewMode;
  roomThreads?: Thread[];
  orderedRoomOverviewEventIds?: string[];
}): {
  index: number;
  count: number;
  canFocus: boolean;
} => {
  if (!threadId && orderedRoomOverviewEventIds) {
    const visibleIndex = orderedRoomOverviewEventIds.indexOf(eventId);
    if (visibleIndex !== -1) {
      return {
        index: visibleIndex,
        count: orderedRoomOverviewEventIds.length,
        canFocus: true,
      };
    }
  }
  const effectiveSearchQuery = searchQuery ?? threadFilterState.freeText;

  const visibleEvents = threadId
    ? renderableEvents
    : getFilteredRoomOverviewEvents(
        renderableEvents,
        room,
        threadResolutionMap,
        threadFilterState,
        threadReplyCountMap,
        scheduledStatusMap,
        threadReplyCountMapForMeta,
        threadParticipantMap,
        summaryMap,
        currentUserId,
        effectiveSearchQuery,
        threadSortFreezeState ?? null,
        threadSortControlSignature ??
          createThreadSortControlSignature({
            state: threadFilterState,
            searchQuery: effectiveSearchQuery,
            viewMode,
          }),
        viewMode,
        roomThreads
      );
  const visibleIndex = visibleEvents.findIndex((event) => event.getId() === eventId);
  if (visibleIndex !== -1) {
    return {
      index: visibleIndex,
      count: visibleEvents.length,
      canFocus: true,
    };
  }

  return {
    index: 0,
    count: visibleEvents.length,
    canFocus: false,
  };
};
