import type { EventTimeline, MatrixEvent } from 'matrix-js-sdk';
import { getTimelineEventById } from './roomDeepLink';
import type { TimelineEventEntry } from './roomTimelineEvents';

type TimelineAtLiveEndOpts = {
  threadId?: string;
  liveTimelineLinked: boolean;
  rangeAtEnd: boolean;
  canPaginateThreadFront: boolean;
  threadTailLoaded?: boolean;
};

type ScrollNearBottomOpts = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  thresholdPx?: number;
};

type ThreadAutoScrollOpts = {
  relationType?: string;
  isNearBottom: boolean;
  isTimelineAtLiveEnd: boolean;
};

const ROOM_FOCUS_SCROLL_RETRY_MAX_ATTEMPTS = 10;
export const ROOM_FOCUS_OBSERVER_IDLE_MS = 200;
export const ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS = 2000;
const ROOM_FOCUS_NEAR_START_THRESHOLD = 5;
const ROOM_FOCUS_NEAR_END_THRESHOLD = 5;
const ROOM_FOCUS_START_MARGIN_PX = 32;
const ROOM_FOCUS_END_MARGIN_PX = 32;

export type RoomFocusRetry = {
  eventId: string;
  attempts: number;
};

export type TimelineAnchor = {
  eventId: string;
  index: number;
  absoluteIndex: number;
};

export const isTimelineAtLiveEnd = ({
  threadId,
  liveTimelineLinked,
  rangeAtEnd,
  canPaginateThreadFront,
  threadTailLoaded,
}: TimelineAtLiveEndOpts): boolean =>
  threadId ? !!threadTailLoaded || !canPaginateThreadFront : liveTimelineLinked && rangeAtEnd;

export const isScrollNearBottom = ({
  scrollHeight,
  scrollTop,
  clientHeight,
  thresholdPx = 24,
}: ScrollNearBottomOpts): boolean => scrollHeight - scrollTop - clientHeight <= thresholdPx;

export const shouldAutoScrollThreadOnLiveEvent = ({
  relationType,
  isNearBottom,
  isTimelineAtLiveEnd: atLiveEnd,
}: ThreadAutoScrollOpts): boolean => relationType === 'm.thread' && isNearBottom && atLiveEnd;

type RoomAutoScrollOpts = {
  scrollElement: HTMLElement | null;
  isTimelineAtLiveEnd: boolean;
  thresholdPx?: number;
};

/**
 * Determines whether the main room timeline should auto-scroll to bottom
 * on a live event by measuring the **current** scroll position instead of
 * relying on the debounced `atBottom` state.  This prevents streaming
 * `m.replace` edits from trapping the user at the bottom when they have
 * already scrolled away (CINNY-031).
 */
export const shouldAutoScrollRoomOnLiveEvent = ({
  scrollElement,
  isTimelineAtLiveEnd,
  thresholdPx = 100,
}: RoomAutoScrollOpts): boolean => {
  if (!isTimelineAtLiveEnd || !scrollElement) return false;
  return isScrollNearBottom({
    scrollHeight: scrollElement.scrollHeight,
    scrollTop: scrollElement.scrollTop,
    clientHeight: scrollElement.clientHeight,
    thresholdPx,
  });
};

export const getEventElementById = (
  container: ParentNode | null | undefined,
  eventId: string
): HTMLElement | null => {
  if (!container) return null;
  const messageItems = container.querySelectorAll<HTMLElement>('[data-message-id]');
  for (const item of messageItems) {
    if (item.getAttribute('data-message-id') === eventId) {
      return item;
    }
  }
  return null;
};

export const getEventEntryIndex = (entries: TimelineEventEntry[], eventId: string): number =>
  entries.findIndex(({ event }) => event.getId() === eventId);

const getVisibleAnchorCandidateIds = (mEvent: MatrixEvent): string[] => {
  const eventId = mEvent.getId();
  if (!eventId) return [];

  const candidateIds = new Set<string>();
  const associatedEventId = mEvent.getAssociatedId() ?? mEvent.getRelation()?.event_id;
  if (associatedEventId && associatedEventId !== eventId) {
    candidateIds.add(associatedEventId);
  }

  const threadRootId = mEvent.threadRootId;
  if (threadRootId && threadRootId !== eventId) {
    candidateIds.add(threadRootId);
  }

  return Array.from(candidateIds);
};

const getClosestRenderableEntryIndex = (
  entries: TimelineEventEntry[],
  absoluteIndex: number
): number | undefined => {
  if (entries.length === 0) return undefined;

  const nextIndex = entries.findIndex((entry) => entry.absoluteIndex > absoluteIndex);
  if (nextIndex === -1) return entries.length - 1;
  if (nextIndex === 0) return 0;

  const previousIndex = nextIndex - 1;
  const previousDistance = absoluteIndex - entries[previousIndex].absoluteIndex;
  const nextDistance = entries[nextIndex].absoluteIndex - absoluteIndex;

  return nextDistance < previousDistance ? nextIndex : previousIndex;
};

export const getNextRenderableEntryIndex = (
  entries: TimelineEventEntry[],
  absoluteIndex: number
): number | undefined => {
  const nextIndex = entries.findIndex((entry) => entry.absoluteIndex > absoluteIndex);
  return nextIndex === -1 ? undefined : nextIndex;
};

const getEntryAnchor = (
  entries: TimelineEventEntry[],
  entryIndex: number
): TimelineAnchor | undefined => {
  const entry = entries[entryIndex];
  const eventId = entry?.event.getId();
  if (!entry || !eventId) return undefined;

  return {
    eventId,
    index: entryIndex,
    absoluteIndex: entry.absoluteIndex,
  };
};

export const getTimelineTargetAnchor = ({
  linkedTimelines,
  renderableEntries,
  eventId,
  absoluteIndex,
}: {
  linkedTimelines: EventTimeline[];
  renderableEntries: TimelineEventEntry[];
  eventId: string;
  absoluteIndex: number;
}): TimelineAnchor | undefined => {
  const visibleIndex = getEventEntryIndex(renderableEntries, eventId);
  if (visibleIndex !== -1) {
    return getEntryAnchor(renderableEntries, visibleIndex);
  }

  const targetEvent = getTimelineEventById(linkedTimelines, eventId);
  if (targetEvent) {
    for (const candidateId of getVisibleAnchorCandidateIds(targetEvent)) {
      const candidateIndex = getEventEntryIndex(renderableEntries, candidateId);
      if (candidateIndex !== -1) {
        return getEntryAnchor(renderableEntries, candidateIndex);
      }
    }
  }

  const closestIndex = getClosestRenderableEntryIndex(renderableEntries, absoluteIndex);
  if (closestIndex === undefined) return undefined;

  return getEntryAnchor(renderableEntries, closestIndex);
};

export const getUnreadTargetAnchor = ({
  renderableEntries,
  eventId,
  absoluteIndex,
}: {
  renderableEntries: TimelineEventEntry[];
  eventId: string;
  absoluteIndex: number;
}): TimelineAnchor | undefined => {
  const visibleIndex = getEventEntryIndex(renderableEntries, eventId);
  if (visibleIndex !== -1) {
    return getEntryAnchor(renderableEntries, visibleIndex);
  }

  const nextIndex = getNextRenderableEntryIndex(renderableEntries, absoluteIndex);
  if (nextIndex !== undefined) {
    return getEntryAnchor(renderableEntries, nextIndex);
  }

  const closestIndex = getClosestRenderableEntryIndex(renderableEntries, absoluteIndex);
  if (closestIndex === undefined) return undefined;

  return getEntryAnchor(renderableEntries, closestIndex);
};

export const shouldRenderUnreadDividerAt = ({
  readUptoAbsoluteIndex,
  eventAbsoluteIndex,
  prevRenderedEventAbsoluteIndex,
}: {
  readUptoAbsoluteIndex: number | undefined;
  eventAbsoluteIndex: number | undefined;
  prevRenderedEventAbsoluteIndex: number | undefined;
}): boolean =>
  readUptoAbsoluteIndex !== undefined &&
  eventAbsoluteIndex !== undefined &&
  eventAbsoluteIndex > readUptoAbsoluteIndex &&
  (prevRenderedEventAbsoluteIndex === undefined ||
    prevRenderedEventAbsoluteIndex <= readUptoAbsoluteIndex);

export const getNextRoomFocusRetry = ({
  focusEventId,
  pendingRetry,
  scrolled,
  targetFound,
}: {
  focusEventId: string | undefined;
  pendingRetry: RoomFocusRetry | undefined;
  scrolled: boolean;
  targetFound: boolean;
}): RoomFocusRetry | undefined => {
  if (!focusEventId || targetFound || !scrolled) {
    return undefined;
  }

  const attempts = pendingRetry?.eventId === focusEventId ? pendingRetry.attempts + 1 : 1;

  if (attempts > ROOM_FOCUS_SCROLL_RETRY_MAX_ATTEMPTS) {
    return undefined;
  }

  return {
    eventId: focusEventId,
    attempts,
  };
};

export const isContinuingRoomFocusRetry = (
  focusEventId: string | undefined,
  pendingRetry: RoomFocusRetry | undefined
): boolean => !!focusEventId && pendingRetry?.eventId === focusEventId;

export const isRoomFocusNearTimelineStart = (
  focusIndex: number,
  threshold = ROOM_FOCUS_NEAR_START_THRESHOLD
): boolean => focusIndex < threshold;

export const isRoomFocusNearTimelineEnd = (
  focusIndex: number,
  itemCount: number,
  threshold = ROOM_FOCUS_NEAR_END_THRESHOLD
): boolean => itemCount - focusIndex <= threshold;

export const getRoomFocusScrollOptions = (focusIndex: number, itemCount: number) => {
  const nearStart = isRoomFocusNearTimelineStart(focusIndex);
  const nearEnd = isRoomFocusNearTimelineEnd(focusIndex, itemCount);

  if (nearStart) {
    return {
      behavior: 'instant' as const,
      align: 'start' as const,
      offset: ROOM_FOCUS_START_MARGIN_PX,
    };
  }

  if (nearEnd) {
    return {
      behavior: 'instant' as const,
      align: 'end' as const,
      offset: -ROOM_FOCUS_END_MARGIN_PX,
    };
  }

  return {
    behavior: 'instant' as const,
    align: 'center' as const,
    offset: undefined,
  };
};

export const getRoomFocusScrollToItemOptions = (focusIndex: number, itemCount: number) => ({
  ...getRoomFocusScrollOptions(focusIndex, itemCount),
  stopInView: false,
});

export const setupFocusObserver = (opts: {
  scrollContainer: HTMLElement;
  target: HTMLElement;
  onRecenter: () => void;
  onDone: () => void;
  idleMs?: number;
  hardMs?: number;
}): (() => void) => {
  if (typeof ResizeObserver === 'undefined') {
    opts.onDone();
    return () => undefined;
  }

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  let rafId: number | undefined;
  let done = false;

  let ro: ResizeObserver | undefined;

  const finish = () => {
    if (done) return;
    done = true;
    ro?.disconnect();
    if (idleTimer) clearTimeout(idleTimer);
    if (hardTimer) clearTimeout(hardTimer);
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    opts.onDone();
  };

  const scheduleRecenter = () => {
    if (done) return;
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      opts.onRecenter();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, opts.idleMs ?? ROOM_FOCUS_OBSERVER_IDLE_MS);
    });
  };

  ro = new ResizeObserver(scheduleRecenter);
  ro.observe(opts.target);
  ro.observe(opts.scrollContainer);

  idleTimer = setTimeout(finish, opts.idleMs ?? ROOM_FOCUS_OBSERVER_IDLE_MS);
  hardTimer = setTimeout(() => {
    opts.onRecenter();
    finish();
  }, opts.hardMs ?? ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS);

  return finish;
};

export const isAnchorVisibleInScroll = (
  anchor: Element,
  scroll: Element,
  marginPx = 100
): boolean => {
  const anchorRect = anchor.getBoundingClientRect();
  const scrollRect = scroll.getBoundingClientRect();
  return anchorRect.top <= scrollRect.bottom + marginPx;
};
