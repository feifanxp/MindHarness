import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { buildThreadReplyCountMap } from './threadUtils';
import { getKnownThreadReplyCount } from './threadRecord';

export const getRoomDerivedThreadSnapshotState = ({
  threadId,
  rootEvent,
  threadEvents,
  roomStartKnown,
  roomTailLoaded,
}: {
  room: Room;
  threadId: string;
  rootEvent: MatrixEvent | undefined;
  threadEvents: MatrixEvent[];
  roomStartKnown: boolean;
  roomTailLoaded: boolean;
}) => {
  const loadedReplyCount = buildThreadReplyCountMap(threadEvents).get(threadId) ?? 0;
  const expectedReplyCount = rootEvent ? getKnownThreadReplyCount(rootEvent) : undefined;
  const snapshotComplete =
    roomStartKnown && roomTailLoaded && typeof expectedReplyCount === 'number'
      ? loadedReplyCount >= expectedReplyCount
      : undefined;

  return {
    beforeTokenForEarliest: snapshotComplete === true ? null : undefined,
    expectedReplyCount,
    loadedReplyCount,
    snapshotComplete,
    tailLoaded: roomTailLoaded ? true : undefined,
  };
};

export const isCompleteCachedThreadSnapshot = ({
  threadId,
  rootEvent,
  cachedRootEvent,
  cachedEvents,
  beforeToken,
  hasMoreBefore,
  expectedReplyCount,
  snapshotComplete,
  tailLoaded,
}: {
  room: Room;
  threadId: string;
  rootEvent?: MatrixEvent;
  cachedRootEvent?: MatrixEvent;
  cachedEvents: MatrixEvent[];
  beforeToken: string | null | undefined;
  hasMoreBefore: boolean;
  expectedReplyCount?: number;
  snapshotComplete: boolean;
  tailLoaded: boolean;
}): boolean => {
  if (beforeToken != null || hasMoreBefore || !tailLoaded) {
    return false;
  }

  const authoritativeExpectedReplyCount = getAuthoritativeCachedThreadReplyCount({
    rootEvent,
    cachedRootEvent,
    expectedReplyCount,
  });
  if (typeof authoritativeExpectedReplyCount !== 'number') {
    return snapshotComplete;
  }

  const loadedReplyCount = buildThreadReplyCountMap(cachedEvents).get(threadId) ?? 0;
  return loadedReplyCount >= authoritativeExpectedReplyCount;
};

export const getAuthoritativeCachedThreadReplyCount = ({
  rootEvent,
  cachedRootEvent,
  expectedReplyCount,
}: {
  rootEvent?: MatrixEvent;
  cachedRootEvent?: MatrixEvent;
  expectedReplyCount?: number;
}): number | undefined =>
  (rootEvent ? getKnownThreadReplyCount(rootEvent) : undefined) ??
  (cachedRootEvent ? getKnownThreadReplyCount(cachedRootEvent) : undefined) ??
  expectedReplyCount;

export const mergeThreadBackfillEvents = (
  existingEvents: MatrixEvent[],
  incomingEvents: MatrixEvent[]
): MatrixEvent[] => {
  const eventsById = new Map<string, MatrixEvent>();

  [...existingEvents, ...incomingEvents].forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (!eventId) return;
    eventsById.set(eventId, mEvent);
  });

  return Array.from(eventsById.values()).sort((left, right) => {
    const tsDiff = left.getTs() - right.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (left.getId() ?? '').localeCompare(right.getId() ?? '');
  });
};
