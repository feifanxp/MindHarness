import { useEffect, useMemo, useReducer, useRef } from 'react';
import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { isMindroomThreadSummaryEvent } from '../messages/threadSummary';
import { planThreadSummaryTimeline, type ThreadSummaryHistory } from './threadSummaryTimeline';

type ThreadSummaryTimelineOptions = {
  history: ThreadSummaryHistory;
  /** The content an event's row shows, after its latest edit; keep it stable. */
  getContent?: (event: MatrixEvent) => Record<string, unknown>;
  ignoredUserIds?: ReadonlySet<string>;
  routeId?: string;
  focusId?: string;
};

export const useThreadSummaryTimeline = (
  events: readonly MatrixEvent[],
  { history, getContent, ignoredUserIds, routeId, focusId }: ThreadSummaryTimelineOptions
) => {
  // A jumped-to summary stays visible after its temporary highlight ends.
  const revealed = useRef(new Set<string>());
  // Live events reach the thread before they decrypt, and a missing room key
  // can fail the first attempt, so a summary is planned again once readable.
  const [decryptions, countDecryption] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    // The wire type, so an event whose first attempt failed still counts.
    const encrypted = events.filter((event) => event.isEncrypted());
    const decrypted = (event: MatrixEvent) => {
      if (isMindroomThreadSummaryEvent(event)) countDecryption();
    };
    encrypted.forEach((event) => event.on(MatrixEventEvent.Decrypted, decrypted));
    return () => {
      encrypted.forEach((event) => event.off(MatrixEventEvent.Decrypted, decrypted));
    };
  }, [events]);

  const { sdkLoaded, canPaginateBack, hasMoreCachedBack } = history;
  return useMemo(() => {
    // Replans once an encrypted summary is readable.
    void decryptions;
    if (routeId) revealed.current.add(routeId);
    if (focusId) revealed.current.add(focusId);
    return planThreadSummaryTimeline(events, {
      history: { sdkLoaded, canPaginateBack, hasMoreCachedBack },
      revealedEventIds: revealed.current,
      getContent,
      ignoredUserIds,
    });
  }, [
    events,
    sdkLoaded,
    canPaginateBack,
    hasMoreCachedBack,
    getContent,
    ignoredUserIds,
    routeId,
    focusId,
    decryptions,
  ]);
};
