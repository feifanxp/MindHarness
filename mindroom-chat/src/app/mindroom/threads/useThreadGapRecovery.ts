import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  RelationType,
  RoomEvent,
  type MatrixEvent,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { scheduleReconcile, type MindroomSyncEngine } from '../engine';
import { hydrateThreadFromCache } from './threadOpenCacheController';
import { compareThreadRenderOrder } from './threadRenderUtils';

export type ThreadGapRecoveryOptions = {
  engine: MindroomSyncEngine;
  room: Room;
  threadId?: string;
  append: (threadId: string, events: MatrixEvent[]) => void;
  /** The thread events currently rendered, oldest first. */
  getLoadedEvents?: () => readonly MatrixEvent[];
  /** Thread trace that records the gap reconcile in diagnostics. */
  debugTraceId?: string;
};

// Edits, reactions and redactions modify a row instead of adding one.
const isRowModifier = (mEvent: MatrixEvent): boolean => {
  const relationType = mEvent.getRelation()?.rel_type;
  return (
    relationType === RelationType.Replace ||
    relationType === RelationType.Annotation ||
    mEvent.isRedaction()
  );
};

/**
 * Recovered events restore what the reader's loaded span missed: replies inside or after it, and
 * edits, reactions and redactions. Older replies stay behind Load Older, whose pagination keeps
 * the reader's scroll anchor. Adding them here would insert rows above a reader who scrolled up.
 * "Older" uses the rendered order, so a reply that would render above the first loaded reply is
 * held back even when the timestamps tie.
 */
export const keepRecoveredEventsInLoadedSpan = (
  threadId: string,
  recoveredEvents: MatrixEvent[],
  loadedEvents: readonly MatrixEvent[]
): MatrixEvent[] => {
  const earliestLoadedReply = loadedEvents.find(
    (mEvent) => mEvent.getId() !== threadId && !isRowModifier(mEvent)
  );
  if (!earliestLoadedReply) return recoveredEvents;
  const loadedEventIds = new Set(loadedEvents.map((mEvent) => mEvent.getId()));
  return recoveredEvents.filter(
    (mEvent) =>
      loadedEventIds.has(mEvent.getId()) ||
      isRowModifier(mEvent) ||
      compareThreadRenderOrder(mEvent, earliestLoadedReply) >= 0
  );
};

export const useThreadGapRecovery = ({
  engine,
  room,
  threadId,
  append,
  getLoadedEvents,
  debugTraceId,
}: ThreadGapRecoveryOptions): void => {
  // The render callbacks change identity when the SDK creates the thread,
  // which a limited sync can do mid-read. Read them at delivery time, so the
  // read in flight is not discarded with the old callbacks. Updated after
  // commit, so a discarded render's callbacks are never used.
  const latestRef = useRef({ append, getLoadedEvents, debugTraceId });
  useLayoutEffect(() => {
    latestRef.current = { append, getLoadedEvents, debugTraceId };
  });
  useEffect(() => {
    if (!threadId) return undefined;
    let active = true;
    let reading = false;
    let dirty = false;
    const readCache = () =>
      hydrateThreadFromCache(
        {
          mx: engine.mx,
          sessionId: engine.sessionId,
          room,
          isCurrentThread: () => active,
        },
        threadId
      );
    const appendInLoadedSpan = (events: MatrixEvent[]) => {
      if (!active) return;
      const latest = latestRef.current;
      const recoveredEvents = keepRecoveredEventsInLoadedSpan(
        threadId,
        events,
        latest.getLoadedEvents?.() ?? []
      );
      if (recoveredEvents.length) latest.append(threadId, recoveredEvents);
    };
    const refresh = async () => {
      dirty = true;
      if (reading) return;
      reading = true;
      try {
        // Coalesce pages committed during a read, then read again so a late
        // commit cannot be hidden by the earlier IndexedDB snapshot.
        while (active && dirty) {
          dirty = false;
          // eslint-disable-next-line no-await-in-loop
          const page = await readCache().catch(() => undefined);
          if (page?.hydratedEvents?.length) appendInLoadedSpan(page.hydratedEvents);
        }
      } finally {
        reading = false;
      }
    };
    // The room gap fill can wait indefinitely: it is paused while the cache is
    // over its byte budget, offline, or out of history allowance. Replies the
    // reader missed are at the thread's newest end, so one reconcile of the
    // thread's relations restores them, as reopening the thread does.
    let reconciling = false;
    let reconcileAgain = false;
    const reconcileThread = async () => {
      reconcileAgain = true;
      if (reconciling) return;
      reconciling = true;
      try {
        while (active && reconcileAgain) {
          reconcileAgain = false;
          // A pass that began before the reset fetched before the gap, and the
          // scheduler would hand a new request that pass's result. Let it
          // finish, so this one fetches after the gap.
          // eslint-disable-next-line no-await-in-loop
          await Promise.allSettled(
            engine.scheduler
              .pendingJobs()
              .filter(
                (job) =>
                  job.kind === 'reconcile' &&
                  job.roomId === room.roomId &&
                  job.threadId === threadId
              )
              .map((job) => job.promise)
          );
          if (!active) return;
          // eslint-disable-next-line no-await-in-loop
          const cachedPage = await readCache().catch(() => undefined);
          if (!active) return;
          // eslint-disable-next-line no-await-in-loop
          await scheduleReconcile({
            mx: engine.mx,
            sessionId: engine.sessionId,
            scheduler: engine.scheduler,
            roomId: room.roomId,
            room,
            threadId,
            cachedPage,
            debugTraceId: latestRef.current.debugTraceId,
            onRepaired: (events) => appendInLoadedSpan([...events]),
          }).catch((error: unknown) => {
            // eslint-disable-next-line no-console
            console.warn('[thread-gap-recovery] reconcile rejected', error);
          });
        }
      } finally {
        reconciling = false;
      }
    };
    const handleTimelineReset: RoomEventHandlerMap[RoomEvent.TimelineReset] = (
      _room,
      timelineSet
    ) => {
      if (timelineSet !== room.getUnfilteredTimelineSet()) return;
      void reconcileThread().catch(() => undefined);
    };
    const unsubscribe = engine.subscribeRoomRecovery(room.roomId, () => {
      void refresh().catch(() => undefined);
    });
    room.on(RoomEvent.TimelineReset, handleTimelineReset);
    return () => {
      active = false;
      unsubscribe();
      room.removeListener(RoomEvent.TimelineReset, handleTimelineReset);
    };
  }, [engine, room, threadId]);
};
