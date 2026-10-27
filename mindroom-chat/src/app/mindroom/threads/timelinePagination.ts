import type { Dispatch, SetStateAction } from 'react';
import { Direction, type EventTimeline, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { ItemRange } from '../../hooks/useVirtualPaginator';
import { getFirstLinkedTimeline, getLinkedTimelines } from './linkedTimelines';
import { getRenderableEvents } from './roomTimelineEvents';

export { getFirstLinkedTimeline, getLinkedTimelines } from './linkedTimelines';

export type Timeline = {
  linkedTimelines: EventTimeline[];
  range: ItemRange;
};

export type RecalibrateFilterOpts = {
  room: Room;
  threadId: string | undefined;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  showThreadRepliesInRoom?: boolean;
};

export const getLiveTimeline = (room: Room): EventTimeline =>
  room.getUnfilteredTimelineSet().getLiveTimeline();

export const getEventTimeline = (room: Room, eventId: string): EventTimeline | undefined => {
  const timelineSet = room.getUnfilteredTimelineSet();
  return timelineSet.getTimelineForEvent(eventId) ?? undefined;
};

export const timelineToEventsCount = (timeline: EventTimeline) => timeline.getEvents().length;

export const getTimelinesEventsCount = (timelines: EventTimeline[]): number =>
  timelines.reduce((count, timeline) => count + timelineToEventsCount(timeline), 0);

export const getLinkedTimelinesEventAbsoluteIndex = (
  linkedTimelines: EventTimeline[],
  eventId: string
): number | undefined => {
  let absoluteIndex = 0;

  for (const timeline of linkedTimelines) {
    const relativeIndex = timeline.getEvents().findIndex((mEvent) => mEvent.getId() === eventId);
    if (relativeIndex !== -1) {
      return absoluteIndex + relativeIndex;
    }

    absoluteIndex += timeline.getEvents().length;
  }

  return undefined;
};

export const getTimelineAndBaseIndex = (
  timelines: EventTimeline[],
  index: number
): [EventTimeline | undefined, number] => {
  let uptoTimelineLen = 0;
  const timeline = timelines.find((t) => {
    uptoTimelineLen += t.getEvents().length;
    if (index < uptoTimelineLen) return true;
    return false;
  });
  if (!timeline) return [undefined, 0];
  return [timeline, uptoTimelineLen - timeline.getEvents().length];
};

export const getTimelineRelativeIndex = (absoluteIndex: number, timelineBaseIndex: number) =>
  absoluteIndex - timelineBaseIndex;

export const getTimelineEvent = (timeline: EventTimeline, index: number): MatrixEvent | undefined =>
  timeline.getEvents()[index];

export const getEventIdAbsoluteIndex = (
  timelines: EventTimeline[],
  eventTimeline: EventTimeline,
  eventId: string
): number | undefined => {
  const timelineIndex = timelines.findIndex((t) => t === eventTimeline);
  if (timelineIndex === -1) return undefined;
  const eventIndex = eventTimeline.getEvents().findIndex((evt) => evt.getId() === eventId);
  if (eventIndex === -1) return undefined;
  const baseIndex = timelines
    .slice(0, timelineIndex)
    .reduce((accValue, timeline) => timeline.getEvents().length + accValue, 0);
  return baseIndex + eventIndex;
};

export const recalibrateTimelinePagination = (
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  linkedTimelines: EventTimeline[],
  timelinesEventsCount: number[],
  backwards: boolean,
  filterOpts?: RecalibrateFilterOpts,
  timelinesRenderableCounts?: number[]
) => {
  const topTimeline = linkedTimelines[0];
  const timelineMatch = (mt: EventTimeline) => (t: EventTimeline) => t === mt;

  const newLTimelines = getLinkedTimelines(topTimeline);
  const topTmIndex = newLTimelines.findIndex(timelineMatch(topTimeline));
  const topAddedTm = topTmIndex === -1 ? [] : newLTimelines.slice(0, topTmIndex);

  let offsetRange: number;
  if (filterOpts) {
    const countRenderable = (tms: EventTimeline[]) =>
      getRenderableEvents(
        tms,
        filterOpts.room,
        filterOpts.threadId,
        filterOpts.ignoredUsersSet,
        filterOpts.showHiddenEvents,
        filterOpts.hideMembershipEvents,
        filterOpts.hideNickAvatarEvents,
        filterOpts.showThreadRepliesInRoom
      ).length;
    const oldTopRenderableCount =
      timelinesRenderableCounts?.[0] ?? countRenderable([linkedTimelines[0]]);
    const newTopRenderableCount = countRenderable([newLTimelines[topTmIndex]]);
    const topTmAddedRenderable = newTopRenderableCount - oldTopRenderableCount;
    const addedTmRenderable = countRenderable(topAddedTm);
    offsetRange = addedTmRenderable + (backwards ? topTmAddedRenderable : 0);
  } else {
    const topTmAddedEvt =
      timelineToEventsCount(newLTimelines[topTmIndex]) - timelinesEventsCount[0];
    offsetRange = getTimelinesEventsCount(topAddedTm) + (backwards ? topTmAddedEvt : 0);
  }

  setTimeline((currentTimeline) => {
    // Pagination captures one linked chain before awaiting cache/network.
    // A route change or TimelineReset can install a different chain while
    // that work is in flight; never let the stale completion replace it.
    if (currentTimeline.linkedTimelines !== linkedTimelines) return currentTimeline;

    return {
      linkedTimelines: newLTimelines,
      range:
        offsetRange > 0
          ? {
              start: currentTimeline.range.start + offsetRange,
              end: currentTimeline.range.end + offsetRange,
            }
          : { ...currentTimeline.range },
    };
  });
};

export const getInitialTimeline = (
  room: Room,
  windowLimit: number,
  filterOpts?: {
    threadId: string | undefined;
    ignoredUsersSet: Set<string>;
    showHiddenEvents: boolean;
    hideMembershipEvents: boolean;
    hideNickAvatarEvents: boolean;
    showThreadRepliesInRoom?: boolean;
  }
): Timeline => {
  const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
  const count = filterOpts
    ? getRenderableEvents(
        linkedTimelines,
        room,
        filterOpts.threadId,
        filterOpts.ignoredUsersSet,
        filterOpts.showHiddenEvents,
        filterOpts.hideMembershipEvents,
        filterOpts.hideNickAvatarEvents,
        filterOpts.showThreadRepliesInRoom
      ).length
    : getTimelinesEventsCount(linkedTimelines);
  return {
    linkedTimelines,
    range: {
      start: Math.max(count - windowLimit, 0),
      end: count,
    },
  };
};

export const getEmptyTimeline = (): Timeline => ({
  range: { start: 0, end: 0 },
  linkedTimelines: [],
});

export const getLatestTimelineRange = (count: number, windowLimit: number): ItemRange => ({
  start: Math.max(count - windowLimit, 0),
  end: count,
});

export const getVisibleTimelineRange = (
  range: ItemRange,
  count: number,
  windowLimit: number
): ItemRange => {
  if (count === 0) {
    return { start: 0, end: 0 };
  }

  if (range.start >= count || range.start >= range.end) {
    return getLatestTimelineRange(count, windowLimit);
  }

  const start = Math.max(range.start, 0);
  const end = Math.min(Math.max(range.end, start + 1), count);

  return { start, end };
};

export const getActiveTimelineRange = (
  threadId: string | undefined,
  roomThreadOverviewActive: boolean,
  range: ItemRange,
  count: number,
  windowLimit: number
): ItemRange => {
  if (threadId) {
    return { start: 0, end: 0 };
  }

  if (roomThreadOverviewActive) {
    return { start: 0, end: count };
  }

  return getVisibleTimelineRange(range, count, windowLimit);
};

export const getFocusedRoomEventIndex = (
  filteredEvents: MatrixEvent[],
  eventId: string | undefined,
  fallbackIndex: number
): number => {
  if (!eventId) return fallbackIndex;
  const filteredIndex = filteredEvents.findIndex((event) => event.getId() === eventId);
  return filteredIndex === -1 ? fallbackIndex : filteredIndex;
};

export const getRoomUnreadInfo = (room: Room, scrollTo = false) => {
  const readUptoEventId = room.getEventReadUpTo(room.client.getUserId() ?? '');
  if (!readUptoEventId) return undefined;
  const evtTimeline = getEventTimeline(room, readUptoEventId);
  const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
  return {
    readUptoEventId,
    inLiveTimeline: latestTimeline === room.getLiveTimeline(),
    scrollTo,
  };
};
