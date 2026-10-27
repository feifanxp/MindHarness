/**
 * CINNY-207 P3.3: room cached-back state refresh.
 *
 * Extracted verbatim from `roomCacheLifecycleController`'s second
 * effect (the read-only one). The persist half of that controller
 * moved into the engine's write-through in Commit 3; only this
 * cache-read effect remained render-side because it drives the
 * `hasCachedBack` UI state and clears a stale SDK backward token
 * when the cache proves the room start.
 */

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Direction, type Room } from 'matrix-js-sdk';
import { getEarliestLoadedRoomEvent, loadRoomCachedBackStateSnapshot } from './eventRepository';
import type { Timeline } from './timelinePagination';

export const useRoomCachedBackState = ({
  alive,
  eventId,
  eventsLength,
  room,
  roomIdRef,
  sessionId,
  setRoomHasMoreCachedBack,
  setTimeline,
  threadId,
  threadIdRef,
  timeline,
}: {
  alive: () => boolean;
  eventId?: string;
  eventsLength: number;
  room: Room;
  roomIdRef: MutableRefObject<string>;
  sessionId: string;
  setRoomHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
  timeline: Timeline;
}): void => {
  useEffect(() => {
    if (threadId) {
      setRoomHasMoreCachedBack(false);
      return undefined;
    }

    let cancelled = false;
    const refreshRoomCachedBackState = async () => {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const earliestLoadedEvent = getEarliestLoadedRoomEvent(room, currentLinkedTimelines);
      const cachedBackState = await loadRoomCachedBackStateSnapshot({
        sessionId,
        roomId: room.roomId,
        earliestLoadedEvent,
      });
      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const firstTimeline = currentLinkedTimelines[0];
      if (firstTimeline && cachedBackState.cachedBeforeToken === null) {
        const currentBeforeToken = firstTimeline.getPaginationToken(Direction.Backward);
        if (currentBeforeToken !== null) {
          firstTimeline.setPaginationToken(null, Direction.Backward);
          setTimeline((currentTimeline) =>
            currentTimeline.linkedTimelines === currentLinkedTimelines
              ? { ...currentTimeline }
              : currentTimeline
          );
        }
      }

      setRoomHasMoreCachedBack(cachedBackState.hasCachedBack);
    };

    refreshRoomCachedBackState();
    return () => {
      cancelled = true;
    };
  }, [
    alive,
    eventId,
    eventsLength,
    room,
    roomIdRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline.linkedTimelines,
  ]);
};
