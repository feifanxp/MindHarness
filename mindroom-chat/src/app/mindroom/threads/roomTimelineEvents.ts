import { EventTimeline, MatrixEvent, Room } from 'matrix-js-sdk';
import { MessageEvent, StateEvent } from '../../../types/matrix/room';
import { isHiddenReferenceEvent, isMembershipChanged, reactionOrEditEvent } from '../../utils/room';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../messages/toolApproval';
import { buildVisibleThreadReplyCountMap, isThreadReplyEvent } from './threadUtils';
import {
  isNestedThreadReplyEvent,
  isZeroReplyStandaloneThreadRootEvent,
} from './compactThreadRootData';
import { isThreadOnlyRoomActivity } from './threadRenderUtils';

export type TimelineEventEntry = {
  event: MatrixEvent;
  absoluteIndex: number;
};

type RoomPreloadCounts = {
  cacheCount: number;
  renderableCount: number;
  surfaceCount: number;
};

const KNOWN_EVENT_TYPES = new Set<string>([
  MessageEvent.RoomMessage,
  MessageEvent.RoomMessageEncrypted,
  MessageEvent.Sticker,
  MINDROOM_TOOL_APPROVAL_EVENT,
  StateEvent.RoomMember,
  StateEvent.RoomName,
  StateEvent.RoomTopic,
  StateEvent.RoomAvatar,
]);

export const isRenderableEvent = (
  mEvent: MatrixEvent,
  _room: Room,
  threadId: string | undefined,
  ignoredUsersSet: Set<string>,
  showHiddenEvents: boolean,
  hideMembershipEvents: boolean,
  hideNickAvatarEvents: boolean,
  showThreadRepliesInRoom = false
): boolean => {
  const mEventId = mEvent.getId();
  if (!mEvent || !mEventId) return false;
  const eventSender = mEvent.getSender();
  if (eventSender && ignoredUsersSet.has(eventSender)) return false;
  if (!threadId && !showThreadRepliesInRoom && isThreadReplyEvent(mEventId, mEvent.threadRootId)) {
    return false;
  }
  if (mEvent.isRedacted() && !showHiddenEvents) return false;
  if (reactionOrEditEvent(mEvent)) return false;
  if (mEvent.isRedaction()) return false;
  if (isHiddenReferenceEvent(mEvent) && !showHiddenEvents) return false;

  if (mEvent.getType() === StateEvent.RoomMember) {
    const membershipChanged = isMembershipChanged(mEvent);
    if (membershipChanged && hideMembershipEvents) return false;
    if (!membershipChanged && hideNickAvatarEvents) return false;
  }

  if (!KNOWN_EVENT_TYPES.has(mEvent.getType()) && !showHiddenEvents) return false;

  if (!KNOWN_EVENT_TYPES.has(mEvent.getType()) && typeof mEvent.getStateKey() !== 'string') {
    if (Object.keys(mEvent.getContent()).length === 0) return false;
    if (mEvent.getRelation()) return false;
  }

  return true;
};

export const getRenderableEventEntries = (
  linkedTimelines: EventTimeline[],
  room: Room,
  threadId: string | undefined,
  ignoredUsersSet: Set<string>,
  showHiddenEvents: boolean,
  hideMembershipEvents: boolean,
  hideNickAvatarEvents: boolean,
  showThreadRepliesInRoom = false
): TimelineEventEntry[] => {
  const entries: TimelineEventEntry[] = [];
  let absoluteIndex = 0;

  linkedTimelines.forEach((timeline) => {
    timeline.getEvents().forEach((mEvent) => {
      if (
        isRenderableEvent(
          mEvent,
          room,
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
          showThreadRepliesInRoom
        )
      ) {
        entries.push({ event: mEvent, absoluteIndex });
      }

      absoluteIndex += 1;
    });
  });

  return entries;
};

export const mergeClassicRoomThreadReplyEntries = ({
  renderableEventEntries,
  room,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
}: {
  renderableEventEntries: TimelineEventEntry[];
  room: Room;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
}): TimelineEventEntry[] => {
  if (renderableEventEntries.length === 0) return renderableEventEntries;

  const loadedEventIds = new Set<string>();
  const loadedRootEntries = new Map<string, TimelineEventEntry>();

  renderableEventEntries.forEach((entry) => {
    const eventId = entry.event.getId();
    if (!eventId) return;

    loadedEventIds.add(eventId);
    loadedRootEntries.set(eventId, entry);
  });

  const replyEventsByRootId = new Map<string, MatrixEvent[]>();

  loadedRootEntries.forEach((_rootEntry, rootId) => {
    const thread = room.getThread(rootId);
    if (!thread) return;

    thread.events.forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (
        !eventId ||
        loadedEventIds.has(eventId) ||
        mEvent.threadRootId !== rootId ||
        !isThreadReplyEvent(eventId, mEvent.threadRootId) ||
        !isRenderableEvent(
          mEvent,
          room,
          undefined,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
          true
        )
      ) {
        return;
      }

      const replyEvents = replyEventsByRootId.get(rootId);
      if (replyEvents) {
        replyEvents.push(mEvent);
      } else {
        replyEventsByRootId.set(rootId, [mEvent]);
      }
      loadedEventIds.add(eventId);
    });
  });

  if (replyEventsByRootId.size === 0) return renderableEventEntries;

  const replyEntries: TimelineEventEntry[] = [];
  replyEventsByRootId.forEach((replyEvents, rootId) => {
    const rootEntry = loadedRootEntries.get(rootId);
    if (!rootEntry) return;

    replyEvents
      .sort((eventA, eventB) => {
        const tsDiff = eventA.getTs() - eventB.getTs();
        if (tsDiff !== 0) return tsDiff;
        return (eventA.getId() ?? '').localeCompare(eventB.getId() ?? '');
      })
      .forEach((mEvent, index) => {
        replyEntries.push({
          event: mEvent,
          absoluteIndex: rootEntry.absoluteIndex + (index + 1) / (replyEvents.length + 1),
        });
      });
  });

  return [...renderableEventEntries, ...replyEntries].sort((entryA, entryB) => {
    const absoluteIndexDiff = entryA.absoluteIndex - entryB.absoluteIndex;
    if (absoluteIndexDiff !== 0) return absoluteIndexDiff;

    const tsDiff = entryA.event.getTs() - entryB.event.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (entryA.event.getId() ?? '').localeCompare(entryB.event.getId() ?? '');
  });
};

export const getRenderableEvents = (
  linkedTimelines: EventTimeline[],
  room: Room,
  threadId: string | undefined,
  ignoredUsersSet: Set<string>,
  showHiddenEvents: boolean,
  hideMembershipEvents: boolean,
  hideNickAvatarEvents: boolean,
  showThreadRepliesInRoom = false
): MatrixEvent[] =>
  getRenderableEventEntries(
    linkedTimelines,
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showThreadRepliesInRoom
  ).map(({ event }) => event);

export const getLinkedTimelineEvents = (linkedTimelines: EventTimeline[]): MatrixEvent[] =>
  linkedTimelines.flatMap((timeline) => timeline.getEvents());

export const isVisibleThreadRootEvent = (
  event: MatrixEvent,
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  threadReplyCountMap?: Map<string, number>
): boolean => {
  const eventId = event.getId();
  if (!eventId) return false;
  if (event.threadRootId && event.threadRootId !== eventId) return false;
  if (isNestedThreadReplyEvent(event)) return false;

  return (
    event.isThreadRoot ||
    !!room.getThread(eventId) ||
    threadResolutionMap.has(eventId) ||
    (threadReplyCountMap?.get(eventId) ?? 0) > 0 ||
    isZeroReplyStandaloneThreadRootEvent(event)
  );
};

export const buildRoomSurfaceEventEntries = ({
  renderableEventEntries,
  linkedTimelines,
  room,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
  threadReplyCountMap,
  threadResolutionMap,
}: {
  renderableEventEntries: TimelineEventEntry[];
  linkedTimelines: EventTimeline[];
  room: Room;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap?: Map<string, { isResolved: boolean }>;
}): TimelineEventEntry[] => {
  const surfaceEntryMap = new Map<string, TimelineEventEntry>();
  renderableEventEntries.forEach((entry) => {
    const eventId = entry.event.getId();
    if (eventId) {
      surfaceEntryMap.set(eventId, entry);
    }
  });

  let absoluteIndex = 0;
  linkedTimelines.forEach((timeline) => {
    timeline.getEvents().forEach((mEvent) => {
      const eventId = mEvent.getId();
      const threadRootId = mEvent.threadRootId;
      if (!eventId || !threadRootId || threadRootId === eventId) {
        absoluteIndex += 1;
        return;
      }

      if (surfaceEntryMap.has(threadRootId)) {
        absoluteIndex += 1;
        return;
      }

      const rootEvent = room.getThread(threadRootId)?.rootEvent ?? room.findEventById(threadRootId);
      if (
        !rootEvent ||
        !isRenderableEvent(
          rootEvent,
          room,
          undefined,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents
        ) ||
        !isVisibleThreadRootEvent(
          rootEvent,
          room,
          threadResolutionMap ?? new Map<string, { isResolved: boolean }>(),
          threadReplyCountMap
        )
      ) {
        absoluteIndex += 1;
        return;
      }

      const existingEntry = surfaceEntryMap.get(threadRootId);
      if (!existingEntry || absoluteIndex < existingEntry.absoluteIndex) {
        surfaceEntryMap.set(threadRootId, {
          event: rootEvent,
          absoluteIndex,
        });
      }

      absoluteIndex += 1;
    });
  });

  return Array.from(surfaceEntryMap.values()).sort((entryA, entryB) => {
    const absoluteIndexDiff = entryA.absoluteIndex - entryB.absoluteIndex;
    if (absoluteIndexDiff !== 0) return absoluteIndexDiff;
    return (entryA.event.getId() ?? '').localeCompare(entryB.event.getId() ?? '');
  });
};

export const getRoomPreloadCounts = (
  linkedTimelines: EventTimeline[],
  room: Room,
  filterOpts: {
    threadId: string | undefined;
    ignoredUsersSet: Set<string>;
    showHiddenEvents: boolean;
    hideMembershipEvents: boolean;
    hideNickAvatarEvents: boolean;
  }
): RoomPreloadCounts => {
  const loadedTimelineEvents = getLinkedTimelineEvents(linkedTimelines);
  const renderableEventEntries = getRenderableEventEntries(
    linkedTimelines,
    room,
    filterOpts.threadId,
    filterOpts.ignoredUsersSet,
    filterOpts.showHiddenEvents,
    filterOpts.hideMembershipEvents,
    filterOpts.hideNickAvatarEvents
  );
  const threadReplyCountMap = buildVisibleThreadReplyCountMap(loadedTimelineEvents);
  const surfaceEntries =
    filterOpts.threadId || threadReplyCountMap.size === 0
      ? renderableEventEntries
      : buildRoomSurfaceEventEntries({
          renderableEventEntries,
          linkedTimelines,
          room,
          ignoredUsersSet: filterOpts.ignoredUsersSet,
          showHiddenEvents: filterOpts.showHiddenEvents,
          hideMembershipEvents: filterOpts.hideMembershipEvents,
          hideNickAvatarEvents: filterOpts.hideNickAvatarEvents,
          threadReplyCountMap,
        });

  return {
    cacheCount: loadedTimelineEvents.filter((mEvent) => !isThreadOnlyRoomActivity(room, mEvent))
      .length,
    renderableCount: renderableEventEntries.length,
    surfaceCount: surfaceEntries.length,
  };
};
