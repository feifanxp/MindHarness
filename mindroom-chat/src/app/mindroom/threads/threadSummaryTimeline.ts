import type { MatrixEvent } from 'matrix-js-sdk';
import { reactionOrEditEvent } from '../../utils/room';
import {
  getMindroomThreadSummaryInfo,
  isMindroomThreadSummaryEvent,
} from '../messages/threadSummary';

export type ThreadSummaryMarkerPlan = {
  /** The thread's first summary: it titled the thread rather than updating the title. */
  first: boolean;
  previousSummaryText?: string;
};

export type ThreadSummaryTimelinePlan = {
  hiddenEventIds: ReadonlySet<string>;
  markersByEventId: ReadonlyMap<string, ThreadSummaryMarkerPlan>;
};

/** What is known about thread history older than the events given. */
export type ThreadSummaryHistory = {
  sdkLoaded: boolean;
  canPaginateBack: boolean;
  hasMoreCachedBack: boolean;
};

type PlanOptions = {
  history: ThreadSummaryHistory;
  /** Events the route or a jump opened stay visible even when they repeat the previous summary. */
  revealedEventIds?: ReadonlySet<string>;
  /** The content an event's row shows, after its latest edit. */
  getContent?: (event: MatrixEvent) => Record<string, unknown>;
  /** Senders whose rows the timeline hides. */
  ignoredUserIds?: ReadonlySet<string>;
};

// MindRoom posts a summary after the first reply and then every ten messages,
// and it is meant to stay the same while the thread's topic does. In a thread,
// a summary that repeats the previous one is hidden; the others become markers.
export const planThreadSummaryTimeline = (
  events: readonly MatrixEvent[],
  {
    history,
    revealedEventIds,
    getContent = (event) => event.getContent(),
    ignoredUserIds,
  }: PlanOptions
): ThreadSummaryTimelinePlan => {
  // Only then is the earliest summary given also the thread's first.
  const historyStartLoaded =
    history.sdkLoaded && !history.canPaginateBack && !history.hasMoreCachedBack;
  const hiddenEventIds = new Set<string>();
  const markersByEventId = new Map<string, ThreadSummaryMarkerPlan>();
  let previousSummaryText: string | undefined;

  events.forEach((event) => {
    const eventId = event.getId();
    // Edits, reactions and ignored senders have no row of their own.
    if (!eventId || reactionOrEditEvent(event) || !isMindroomThreadSummaryEvent(event)) return;
    if (ignoredUserIds?.has(event.getSender() ?? '')) return;
    // Parse as the timeline row does, so only rows that would show a marker are planned.
    const summaryText = getMindroomThreadSummaryInfo(getContent(event))?.summaryText;
    if (!summaryText) return;

    const repeated = summaryText === previousSummaryText;
    if (repeated && !revealedEventIds?.has(eventId)) {
      hiddenEventIds.add(eventId);
      return;
    }
    markersByEventId.set(eventId, {
      first: previousSummaryText === undefined && historyStartLoaded,
      ...(previousSummaryText !== undefined && !repeated ? { previousSummaryText } : {}),
    });
    previousSummaryText = summaryText;
  });

  return { hiddenEventIds, markersByEventId };
};
