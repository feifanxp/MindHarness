import { MatrixError, RelationType } from 'matrix-js-sdk';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { ErrorCode } from '../../cs-errorcode';
import { getCompactThreadRootBodyPreviewText } from './compactThreadRootData';
import { isVisibleThreadRootEvent, type TimelineEventEntry } from './roomTimelineEvents';
import {
  hasLikelyIncompleteStreamingBody,
  shouldFetchThreadEditBackfill,
} from './threadEditBackfill';
import { getLinkedTimelines, getLiveTimeline } from './timelinePagination';
import { eventBelongsToThread, findThreadRootEvent, isThreadReplyEvent } from './threadUtils';
import { reactionOrEditEvent } from '../../utils/room';
import { getThreadCacheTargetId } from './eventRepository';
import { getKnownThreadReplyCount } from './threadBadgeViewModel';
import { mergeThreadBackfillEvents } from './threadCacheSnapshot';
import { getThreadOpenSeedSnapshot } from './threadOpenSeedCache';

// CINNY-207 P5.1 Commit 2: `fetchAllThreadRelations`,
// `MAX_THREAD_FETCH_EVENTS`, and `MAX_THREAD_FETCH_ITERATIONS` moved
// to `engine/threadRelationsFetcher.ts` so the `/relations` boundary
// can be arch-guarded to "defined in engine/, imported only within
// engine/**". Re-exported here for the existing unit test surface
// (`threadBootstrap.test.ts` covers the fetcher end-to-end) and any
// call sites that haven't been rewired yet — see arch guard for the
// current allowlist.
export {
  fetchAllThreadRelations,
  MAX_THREAD_FETCH_EVENTS,
  MAX_THREAD_FETCH_ITERATIONS,
  type ThreadRelationPageResult,
} from '../engine/threadRelationsFetcher';
export const THREAD_OPEN_PREWARM_WAIT_MS = 400;

const VISIBLE_THREAD_CACHE_PREWARM_LIMIT = 8;
const VISIBLE_THREAD_CACHE_PREWARM_MIN_REPLY_COUNT = 20;
const VISIBLE_THREAD_CACHE_PREWARM_OVERSCAN = 8;

type ThreadSeedPrewarmTarget = {
  threadId: string;
  replyCount: number;
  visible: boolean;
};

export const isThreadNotFoundError = (error: unknown): error is MatrixError =>
  error instanceof MatrixError &&
  (error.httpStatus === 404 || error.errcode === ErrorCode.M_NOT_FOUND);

export const shouldRefreshOverviewForTimelineEvent = (room: Room, mEvent: MatrixEvent): boolean => {
  const eventId = mEvent.getId();
  if (eventId && (mEvent.isThreadRoot || isThreadReplyEvent(eventId, mEvent.threadRootId))) {
    return true;
  }

  return getThreadCacheTargetId(room, mEvent) !== undefined;
};

const sortThreadSeedEvents = (events: MatrixEvent[]): MatrixEvent[] =>
  events.sort((left, right) => {
    const tsDiff = left.getTs() - right.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (left.getId() ?? '').localeCompare(right.getId() ?? '');
  });

export const getLoadedRoomThreadEvents = (room: Room, threadId: string): MatrixEvent[] => {
  const eventsById = new Map<string, MatrixEvent>();
  const rootEvent = room.findEventById(threadId);
  const rootEventId = rootEvent?.getId();
  if (rootEvent && rootEventId) {
    eventsById.set(rootEventId, rootEvent);
  }

  getLinkedTimelines(getLiveTimeline(room)).forEach((timeline) => {
    timeline.getEvents().forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (!eventId) return;
      if (eventId === threadId) {
        eventsById.set(eventId, mEvent);
        return;
      }
      if (!eventBelongsToThread(mEvent, threadId)) return;
      if (mEvent.getRelation()?.rel_type === RelationType.Replace) return;
      if (reactionOrEditEvent(mEvent) || mEvent.isRedaction()) return;
      eventsById.set(eventId, mEvent);
    });
  });

  return sortThreadSeedEvents(Array.from(eventsById.values()));
};

export const getLoadedRoomThreadSeedEvents = (room: Room, threadId: string): MatrixEvent[] => {
  const seedEventsById = new Map<string, MatrixEvent>();
  const loadedThreadEvents = getLoadedRoomThreadEvents(room, threadId);
  const linkedTimelineEvents = getLinkedTimelines(getLiveTimeline(room)).flatMap((timeline) =>
    timeline.getEvents()
  );

  loadedThreadEvents.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (!eventId) return;
    seedEventsById.set(eventId, mEvent);
  });

  if (seedEventsById.size === 0) return [];

  let addedEvent = true;
  while (addedEvent) {
    addedEvent = false;

    linkedTimelineEvents.forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (!eventId || seedEventsById.has(eventId)) return;

      if (mEvent.isRedaction()) {
        const targetEventId = mEvent.getAssociatedId();
        if (targetEventId && seedEventsById.has(targetEventId)) {
          seedEventsById.set(eventId, mEvent);
          addedEvent = true;
        }
        return;
      }

      const relation = mEvent.getRelation();
      if (relation?.rel_type !== RelationType.Replace) return;

      if (relation.event_id && seedEventsById.has(relation.event_id)) {
        seedEventsById.set(eventId, mEvent);
        addedEvent = true;
      }
    });
  }

  return sortThreadSeedEvents(Array.from(seedEventsById.values()));
};

export const getLoadedThreadModelSeedEvents = (room: Room, threadId: string): MatrixEvent[] => {
  const cachedThreadSeedEvents = getThreadOpenSeedSnapshot(room, threadId);
  const eventsById = new Map<string, MatrixEvent>();
  const thread = room.getThread(threadId);
  if (!thread || thread.events.length === 0) {
    return cachedThreadSeedEvents;
  }

  const addThreadEvent = (mEvent?: MatrixEvent | null) => {
    if (!mEvent) return;
    const eventId = mEvent.getId();
    if (!eventId) return;
    if (reactionOrEditEvent(mEvent) || mEvent.isRedaction()) return;
    eventsById.set(eventId, mEvent);
  };

  addThreadEvent(thread?.rootEvent ?? room.findEventById(threadId));
  thread?.events.forEach((mEvent) => addThreadEvent(mEvent));

  const modelSeedEvents = sortThreadSeedEvents(Array.from(eventsById.values()));

  if (cachedThreadSeedEvents.length === 0) {
    return modelSeedEvents;
  }

  return mergeThreadBackfillEvents(cachedThreadSeedEvents, modelSeedEvents);
};

export const collectPriorityThreadSeedPrewarmRoots = ({
  room,
  threadFilteredEventEntries,
  threadId,
  threadReplyCountMap,
  threadResolutionMap,
  rangeEnd,
  rangeStart,
}: {
  room: Room;
  threadFilteredEventEntries: TimelineEventEntry[];
  threadId?: string;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  rangeStart: number;
  rangeEnd: number;
}): ThreadSeedPrewarmTarget[] => {
  if (threadId) return [];

  const candidateRoots = new Map<string, ThreadSeedPrewarmTarget>();

  const recordCandidate = (expectedThreadId: string, replyCount: number, visible: boolean) => {
    if (replyCount < VISIBLE_THREAD_CACHE_PREWARM_MIN_REPLY_COUNT) return;
    const existingCandidate = candidateRoots.get(expectedThreadId);
    if (!existingCandidate) {
      candidateRoots.set(expectedThreadId, {
        threadId: expectedThreadId,
        replyCount,
        visible,
      });
      return;
    }

    candidateRoots.set(expectedThreadId, {
      threadId: expectedThreadId,
      replyCount: Math.max(existingCandidate.replyCount, replyCount),
      visible: existingCandidate.visible || visible,
    });
  };

  const overscanStart = Math.max(0, rangeStart - VISIBLE_THREAD_CACHE_PREWARM_OVERSCAN);
  const overscanEnd = Math.min(
    threadFilteredEventEntries.length,
    rangeEnd + VISIBLE_THREAD_CACHE_PREWARM_OVERSCAN + 1
  );

  for (const entry of threadFilteredEventEntries.slice(overscanStart, overscanEnd)) {
    const event = entry.event;
    const eventId = event.getId();
    if (!eventId) continue;
    if (!isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) continue;

    const replyCount = threadReplyCountMap.get(eventId) ?? getKnownThreadReplyCount(event) ?? 0;
    recordCandidate(eventId, replyCount, true);
  }

  const roomThreads = typeof room.getThreads === 'function' ? room.getThreads() : [];
  roomThreads.forEach((thread) => {
    const expectedThreadId = thread.id;
    if (!expectedThreadId) return;
    const threadRootEvent = thread.rootEvent ?? room.findEventById(expectedThreadId);
    const replyCount =
      threadReplyCountMap.get(expectedThreadId) ??
      (typeof thread.length === 'number' && thread.length > 0 ? thread.length : undefined) ??
      (threadRootEvent ? getKnownThreadReplyCount(threadRootEvent) : undefined) ??
      0;
    recordCandidate(expectedThreadId, replyCount, false);
  });

  return [...candidateRoots.values()]
    .sort((left, right) => {
      if (left.visible !== right.visible) return left.visible ? -1 : 1;
      return right.replyCount - left.replyCount;
    })
    .slice(0, VISIBLE_THREAD_CACHE_PREWARM_LIMIT);
};

export const getCompactRootEventsNeedingBackfill = ({
  room,
  roomSurfaceEventEntries,
  threadRootIds,
  roomThreadListThreads,
  attemptedEvents,
}: {
  room: Pick<Room, 'getThread' | 'getUnfilteredTimelineSet'>;
  roomSurfaceEventEntries: Array<{ event: MatrixEvent }>;
  threadRootIds: string[];
  roomThreadListThreads: Array<{ id?: string; rootEvent?: MatrixEvent }>;
  attemptedEvents: WeakMap<MatrixEvent, number>;
}): Array<{ threadRootId: string; events: MatrixEvent[] }> =>
  threadRootIds
    .map((threadRootId) => ({
      threadRootId,
      events: [
        roomSurfaceEventEntries.find((entry) => entry.event.getId() === threadRootId)?.event,
        findThreadRootEvent(room, threadRootId),
        room.getThread(threadRootId)?.rootEvent,
        roomThreadListThreads.find((thread) => thread.id === threadRootId)?.rootEvent,
      ].filter(
        (event, index, allEvents): event is MatrixEvent =>
          !!event && allEvents.indexOf(event) === index
      ),
    }))
    .map(({ threadRootId, events }) => ({
      threadRootId,
      events: events.filter((event) => {
        const resolvedPreview = getCompactThreadRootBodyPreviewText(event, {
          eventId: threadRootId,
          room,
        });
        if (!hasLikelyIncompleteStreamingBody(resolvedPreview)) return false;

        return shouldFetchThreadEditBackfill(event, attemptedEvents, true, false);
      }),
    }))
    .filter(({ events }) => events.length > 0);
