import { Direction, EventTimeline, MatrixEvent } from 'matrix-js-sdk';
import { eventBelongsToThread } from './threadUtils';

/**
 * Find the earliest reply in a thread's loaded events, using timestamp + event ID
 * as a stable tie-breaker (matching cache ordering). The thread root is excluded.
 */
export const findEarliestLoadedThreadReplyByCacheOrder = (
  events: MatrixEvent[],
  threadId: string
): MatrixEvent | undefined => {
  let earliest: MatrixEvent | undefined;
  let earliestTs = Infinity;
  let earliestId = '';

  for (const mEvent of events) {
    const eventId = mEvent.getId();
    if (!eventId || eventId === threadId || !eventBelongsToThread(mEvent, threadId)) continue;
    const ts = mEvent.getTs() ?? 0;
    if (ts < earliestTs || (ts === earliestTs && eventId.localeCompare(earliestId) < 0)) {
      earliest = mEvent;
      earliestTs = ts;
      earliestId = eventId;
    }
  }

  return earliest;
};

/**
 * Compute the backward pagination token for reconciliation using in-memory
 * values, avoiding the async persist→read-back race through IndexedDB.
 *
 * - If the server says no more pages (token is null), return null.
 * - If more pages exist and the earliest loaded reply matches the earliest
 *   fetched reply, return the server token.
 * - Otherwise (earliest loaded reply is older than the fetched slice),
 *   return undefined to preserve the SDK token.
 */
export const computeReconciliationToken = (
  serverToken: string | null,
  fetchedEvents: MatrixEvent[],
  loadedEvents: MatrixEvent[],
  threadId: string
): string | null | undefined => {
  if (serverToken === null) {
    // Server returned all thread replies — no more backward pages
    return null;
  }

  const earliestFetched = findEarliestLoadedThreadReplyByCacheOrder(fetchedEvents, threadId);
  const earliestLoaded = findEarliestLoadedThreadReplyByCacheOrder(loadedEvents, threadId);

  if (earliestLoaded && earliestFetched && earliestLoaded.getId() === earliestFetched.getId()) {
    // Earliest loaded reply is the earliest fetched reply — server token applies
    return serverToken;
  }

  // Earliest loaded reply is older than fetched slice — preserve SDK state
  return undefined;
};

/**
 * Reconcile the backward pagination token on a thread timeline from the cached
 * token for the earliest loaded reply.
 *
 * - `null` → server confirmed no more pages; clear token and hide button.
 * - `string` → more pages exist; set token and show button.
 * - `undefined` → no cache data; preserve SDK token (safe fallback).
 */
export const reconcileThreadBackwardPagination = (
  firstThreadTimeline: EventTimeline | undefined,
  cachedToken: string | null | undefined,
  setHasMoreCachedBack: (hasMoreCachedBack: boolean) => void
): void => {
  if (cachedToken === null) {
    firstThreadTimeline?.setPaginationToken(null, Direction.Backward);
    setHasMoreCachedBack(false);
  } else if (typeof cachedToken === 'string') {
    firstThreadTimeline?.setPaginationToken(cachedToken, Direction.Backward);
    setHasMoreCachedBack(true);
  }
  // undefined: no cache data — preserve SDK token
};
