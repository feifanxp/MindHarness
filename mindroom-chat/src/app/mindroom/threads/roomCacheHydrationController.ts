import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { type MatrixClient, type Room } from 'matrix-js-sdk';
import { insertCachedRoomTimeline, prependCachedRoomTimeline } from './sdk/roomTimelineSdk';
import { markCacheHydrateEnd, markCacheHydrateStart } from './cacheProbe';
import { logTimelineDebug } from './timelineDebug';
import { ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE } from './preloadSettings';
import { getLinkedTimelines, getLiveTimeline, type Timeline } from './timelinePagination';
import {
  createPreferLiveEventMapper,
  findEarliestLoadedRoomEventByCacheOrder,
  getMainTimelineCacheEvents,
  loadLatestRoomCacheHydrationSnapshot,
  shouldHydrateLatestRoomCache,
} from './eventRepository';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

export const useRoomCacheHydrationController = ({
  alive,
  buildInitialTimeline,
  eventId,
  mx,
  room,
  roomDebugTraceId,
  roomIdRef,
  scrollToBottomRef,
  sessionId,
  setAtBottom,
  setRoomInitialCacheHydratedKey,
  setTimeline,
  threadId,
  threadIdRef,
}: {
  alive: () => boolean;
  buildInitialTimeline: () => Timeline;
  eventId?: string;
  mx: MatrixClient;
  room: Room;
  roomDebugTraceId: string;
  roomIdRef: MutableRefObject<string>;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  sessionId: string;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setRoomInitialCacheHydratedKey: Dispatch<SetStateAction<string | undefined>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
}): void => {
  useEffect(() => {
    if (threadId || eventId) return undefined;

    let cancelled = false;
    const hydrateRoomFromCache = async () => {
      markCacheHydrateStart('room');
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-start', {
        limit: ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const currentLinkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const loadedRoomEvents = getMainTimelineCacheEvents(room, currentLinkedTimelines);
      const mapper = mx.getEventMapper();
      const mapCachedEvent = createPreferLiveEventMapper(room, mapper);
      const hydrationSnapshot = await loadLatestRoomCacheHydrationSnapshot({
        sessionId,
        roomId: room.roomId,
        // CINNY-207 PR #72 review (greptile P2): paint-time hydration
        // reads the interactive bound, not `prefetchDepth` (default
        // 10_000, which scanned/materialized thousands of IDB records
        // before first paint). Background depth belongs to the
        // deep-history job alone.
        limit: ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
        loadedEvents: loadedRoomEvents,
        mapEvent: mapCachedEvent,
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-page', {
        cachedCount: hydrationSnapshot.cachedPage.events.length,
        hasMoreBefore: hydrationSnapshot.cachedPage.hasMoreBefore,
        loadedRoomCount: hydrationSnapshot.loadedRoomCount,
      });

      if (hydrationSnapshot.status === 'already-loaded') {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-skip-latest-already-loaded', {
          cachedCount: hydrationSnapshot.cachedPage.events.length,
          loadedRoomCount: hydrationSnapshot.loadedRoomCount,
        });
        return;
      }

      const { events: cachedEvents, prependEvents } = hydrationSnapshot;
      if (cachedEvents.length === 0 && prependEvents.length === 0) {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-empty-after-filter', {
          cachedCount: hydrationSnapshot.cachedPage.events.length,
          loadedRoomCount: hydrationSnapshot.loadedRoomCount,
        });
        return;
      }

      // A limited sync may replace the live chain while IndexedDB is reading.
      // Never apply a cached overlap/token decision to a different chain.
      if (getLiveTimeline(room) !== currentLinkedTimelines[currentLinkedTimelines.length - 1]) {
        return;
      }
      const timelineWasEmpty = getLiveTimeline(room).getEvents().length === 0;
      if (prependEvents.length > 0) {
        const currentRoomEvents = getMainTimelineCacheEvents(
          room,
          getLinkedTimelines(getLiveTimeline(room))
        );
        if (
          findEarliestLoadedRoomEventByCacheOrder(currentRoomEvents)?.getId() !==
          findEarliestLoadedRoomEventByCacheOrder(loadedRoomEvents)?.getId()
        ) {
          return;
        }
        await prependCachedRoomTimeline({
          mx,
          room,
          events: [...prependEvents].reverse(),
          firstTimeline: currentLinkedTimelines[0],
          beforeToken: hydrationSnapshot.cachedPage.beforeToken,
          showThreadRepliesInRoom: false,
        });
      }
      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;
      if (getLiveTimeline(room) !== currentLinkedTimelines[currentLinkedTimelines.length - 1]) {
        return;
      }
      // Decryption during prepend can yield to newer live events on the same
      // timeline. Only append missing events beyond its current tail, while
      // retaining cached revisions and reusing any newly arrived live copies.
      const currentRoomEvents = getMainTimelineCacheEvents(
        room,
        getLinkedTimelines(getLiveTimeline(room))
      );
      const currentLatestEvent = currentRoomEvents[currentRoomEvents.length - 1];
      const currentEventIds = new Set(currentRoomEvents.map((event) => event.getId()));
      const eventsToInsert = cachedEvents
        .filter(
          (event) =>
            currentEventIds.has(event.getId()) ||
            shouldHydrateLatestRoomCache(currentLatestEvent, event.event)
        )
        .map((event) => mapCachedEvent(event.event));
      if (eventsToInsert.length > 0) {
        await insertCachedRoomTimeline({ mx, room, events: eventsToInsert });
      }

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;
      setTimeline(buildInitialTimeline());
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
      setAtBottom(true);
      markCacheHydrateEnd('room');
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-complete', {
        hydratedCount: eventsToInsert.length + prependEvents.length,
        timelineWasEmpty,
      });
    };

    hydrateRoomFromCache()
      .catch((error) => {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-error', {
          error,
          roomId: room.roomId,
        });
      })
      .finally(() => {
        if (!cancelled && alive() && roomIdRef.current === room.roomId && !threadIdRef.current) {
          setRoomInitialCacheHydratedKey(room.roomId);
        }
        // CINNY-207 P4.3: the old preload-done bookkeeping (used to
        // clear the eagerPreloading state when re-entering a room)
        // is gone with `useRoomEagerPreload`. Deep history now runs
        // in the engine's scheduler and does not gate rendering.
      });
    return () => {
      cancelled = true;
    };
  }, [
    alive,
    buildInitialTimeline,
    eventId,
    mx,
    room,
    roomDebugTraceId,
    roomIdRef,
    scrollToBottomRef,
    sessionId,
    setAtBottom,
    setRoomInitialCacheHydratedKey,
    setTimeline,
    threadId,
    threadIdRef,
  ]);
};
