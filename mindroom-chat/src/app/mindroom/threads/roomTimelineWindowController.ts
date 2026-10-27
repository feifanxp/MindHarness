import { useMemo } from 'react';
import type { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import type { RoomViewMode } from './roomViewMode';
import type { Timeline } from './timelinePagination';
import {
  getActiveTimelineRange,
  getLinkedTimelinesEventAbsoluteIndex,
} from './timelinePagination';
import type { TimelineEventEntry } from './roomTimelineEvents';
import { resolveOrderedRoomOverviewEvents } from './threadRoomFocus';
import {
  getEventEntryIndex,
  getNextRenderableEntryIndex,
} from './timelineScrollUtils';
import { collectPriorityThreadSeedPrewarmRoots } from './threadBootstrap';
import {
  buildThreadCacheCoverage,
  shouldShowThreadLoadOlderFromCoverage,
} from './threadCacheCoverage';
import { shouldUseSurfacePreloadTarget } from './roomPreloadTarget';

type RoomUnreadInfoLike = {
  readUptoEventId?: string;
};

export type RoomTimelineWindowControllerOptions = {
  canPaginateThreadBack: boolean;
  effectiveViewMode: RoomViewMode;
  filteredRoomThreadActive: boolean;
  filteredRoomOverviewOrderActive: boolean;
  lastThreadBackwardPaginationToken: string | null;
  overviewRefreshCounter: number;
  overviewThreadRootIds: string[];
  renderableEventEntries: TimelineEventEntry[];
  renderableEvents: MatrixEvent[];
  room: Room;
  roomSurfaceEventEntries: TimelineEventEntry[];
  roomThreadListThreads: Thread[];
  prefetchDepth: number;
  threadEventsLength: number;
  threadHasMoreCachedBack: boolean;
  threadId?: string;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  threadTailLoaded: boolean;
  timeline: Timeline;
  unreadInfo?: RoomUnreadInfoLike;
};

export type RoomTimelineWindowControllerResult = {
  activeTimelineRange: Timeline['range'];
  filteredLength: number;
  priorityThreadSeedPrewarmRoots: ReturnType<typeof collectPriorityThreadSeedPrewarmRoots>;
  readUptoAbsoluteIndex: number | undefined;
  showThreadLoadOlderMessages: boolean;
  threadFilteredEventEntries: TimelineEventEntry[];
  threadFilteredEvents: MatrixEvent[];
  unreadScrollAnchorIndex: number | undefined;
  useSurfacePreloadTarget: boolean;
};

export const useRoomTimelineWindowController = ({
  canPaginateThreadBack,
  effectiveViewMode,
  filteredRoomThreadActive,
  filteredRoomOverviewOrderActive,
  lastThreadBackwardPaginationToken,
  overviewRefreshCounter,
  overviewThreadRootIds,
  renderableEventEntries,
  renderableEvents,
  room,
  roomSurfaceEventEntries,
  roomThreadListThreads,
  prefetchDepth,
  threadEventsLength,
  threadHasMoreCachedBack,
  threadId,
  threadReplyCountMap,
  threadResolutionMap,
  threadTailLoaded,
  timeline,
  unreadInfo,
}: RoomTimelineWindowControllerOptions): RoomTimelineWindowControllerResult => {
  const useSurfacePreloadTarget = shouldUseSurfacePreloadTarget({
    threadId,
    roomThreadFilterActive: filteredRoomThreadActive,
    viewMode: effectiveViewMode,
  });

  const threadFilteredEvents = useMemo(() => {
    if (threadId) return renderableEvents;
    if (filteredRoomOverviewOrderActive) {
      return resolveOrderedRoomOverviewEvents({
        orderedRootIds: overviewThreadRootIds,
        renderableEvents: roomSurfaceEventEntries.map(({ event }) => event),
        room,
        roomThreads: roomThreadListThreads,
      });
    }

    return renderableEvents;
  }, [
    filteredRoomOverviewOrderActive,
    overviewThreadRootIds,
    renderableEvents,
    room,
    roomSurfaceEventEntries,
    roomThreadListThreads,
    threadId,
  ]);

  const threadFilteredEventEntries = useMemo(() => {
    if (!filteredRoomOverviewOrderActive) {
      return renderableEventEntries;
    }

    const entryMap = new Map<string, TimelineEventEntry>();
    roomSurfaceEventEntries.forEach((entry) => {
      const entryEventId = entry.event.getId();
      if (entryEventId) entryMap.set(entryEventId, entry);
    });

    return threadFilteredEvents
      .map((event) => {
        const eventId = event.getId();
        return eventId ? entryMap.get(eventId) : undefined;
      })
      .filter((entry): entry is TimelineEventEntry => entry !== undefined);
  }, [
    filteredRoomOverviewOrderActive,
    renderableEventEntries,
    roomSurfaceEventEntries,
    threadFilteredEvents,
  ]);

  const readUptoAbsoluteIndex = useMemo(() => {
    if (threadId) return undefined;
    const currentReadUptoEventId = unreadInfo?.readUptoEventId;
    if (!currentReadUptoEventId) return undefined;

    return getLinkedTimelinesEventAbsoluteIndex(timeline.linkedTimelines, currentReadUptoEventId);
  }, [threadId, timeline.linkedTimelines, unreadInfo?.readUptoEventId]);

  const unreadScrollAnchorIndex = useMemo(() => {
    const currentReadUptoEventId = unreadInfo?.readUptoEventId;
    if (threadId || !currentReadUptoEventId) return undefined;

    const visibleIndex = getEventEntryIndex(threadFilteredEventEntries, currentReadUptoEventId);
    if (visibleIndex !== -1) {
      return visibleIndex;
    }

    if (readUptoAbsoluteIndex === undefined) return undefined;
    return getNextRenderableEntryIndex(threadFilteredEventEntries, readUptoAbsoluteIndex);
  }, [threadFilteredEventEntries, threadId, unreadInfo?.readUptoEventId, readUptoAbsoluteIndex]);

  const filteredLength = threadFilteredEvents.length;
  const activeTimelineRange = useMemo(
    () =>
      getActiveTimelineRange(
        threadId,
        filteredRoomThreadActive,
        timeline.range,
        filteredLength,
        prefetchDepth
      ),
    [threadId, filteredRoomThreadActive, timeline.range, filteredLength, prefetchDepth]
  );

  const priorityThreadSeedPrewarmRoots = useMemo(() => {
    // Keep refresh generation in the dependency contract so cache metadata updates can re-rank
    // prewarm targets even when the visible event list is referentially stable.
    void overviewRefreshCounter;
    return collectPriorityThreadSeedPrewarmRoots({
      room,
      threadFilteredEventEntries,
      threadId,
      threadReplyCountMap,
      threadResolutionMap,
      rangeEnd: activeTimelineRange.end,
      rangeStart: activeTimelineRange.start,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    overviewRefreshCounter,
    room,
    threadFilteredEventEntries,
    threadId,
    threadReplyCountMap,
    threadResolutionMap,
  ]);

  const threadPaginationCoverage = useMemo(
    () =>
      buildThreadCacheCoverage({
        eventCount: threadEventsLength,
        backwardToken: canPaginateThreadBack
          ? lastThreadBackwardPaginationToken
          : threadHasMoreCachedBack
          ? undefined
          : null,
        hasMoreBackward: threadHasMoreCachedBack || canPaginateThreadBack,
        relationSnapshotComplete: false,
        tailLoaded: threadTailLoaded,
      }),
    [
      canPaginateThreadBack,
      lastThreadBackwardPaginationToken,
      threadEventsLength,
      threadHasMoreCachedBack,
      threadTailLoaded,
    ]
  );
  const showThreadLoadOlderMessages = shouldShowThreadLoadOlderFromCoverage({
    coverage: threadPaginationCoverage,
    sdkHasBackwardToken: canPaginateThreadBack,
  });

  return {
    activeTimelineRange,
    filteredLength,
    priorityThreadSeedPrewarmRoots,
    readUptoAbsoluteIndex,
    showThreadLoadOlderMessages,
    threadFilteredEventEntries,
    threadFilteredEvents,
    unreadScrollAnchorIndex,
    useSurfacePreloadTarget,
  };
};
