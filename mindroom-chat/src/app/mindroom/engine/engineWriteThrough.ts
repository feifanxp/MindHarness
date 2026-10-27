/**
 * CINNY-207 P3.1 (Commit 3): global Tier-1 write-through.
 *
 * The engine's write-through owns every live cache write. It is called
 * once per live event delivered by the client-level listeners in
 * `mindroomSyncEngine.ts`, and it covers EVERY joined room — not just
 * the room currently mounted in the UI. That's the fix for finding F1
 * (background room cache freshness): a live message in a background
 * room now reaches the cache immediately, so switching to that room
 * later renders from a cache that already knows about it.
 *
 * Semantics preserved verbatim from the previous
 * `roomLiveEventController` write path:
 *   - scheduleReplaceCompaction: arm-time cross-sender direct persist,
 *     D12-latest pending map (isEventOrderedAfter), fire-time
 *     target-miss standalone fallback with editCompactionTargetMisses
 *     probe, fire-time cross-sender [target, replace] pair emit,
 *     thread attribution captured at schedule time.
 *   - Redaction lifecycle: planRedactionCacheCleanup +
 *     removeAggregatedReactionByEventId over both timelineSets, with
 *     candidateParentIds derived from the room's live timeline event
 *     ids plus every thread timelineSet's live event ids.
 *
 * Semantic changes (product-owner-accepted, recorded in Deviations):
 *   - Live thread appends persist `tailLoaded: true` always. Today
 *     the component controller passes `atLiveEndRef.current`; the
 *     engine has no atLiveEnd notion because it isn't the UI. This
 *     is safe because `mergeThreadCacheFlag` never downgrades true
 *     to false; a live event by definition IS at the tail.
 *   - Redaction persists use `tailLoaded: undefined` (no-downgrade)
 *     regardless of which thread is open — same as today except we
 *     no longer key off "the currently open thread".
 */

import type { EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk';
import { isEventOrderedAfter } from '../../utils/room';
import { countCacheProbe } from '../threads/cacheProbe';
import {
  deleteRoomEventsFromCache,
  deleteThreadEventFromCacheByEventId,
  deleteThreadEventsFromCache,
  getThreadCacheTargetId,
  persistRoomEventCacheSnapshot,
  persistThreadEventCacheSnapshot,
} from '../threads/eventRepository';
import { THREAD_EDIT_COMPACTION_DEBOUNCE_MS } from '../threads/preloadSettings';
import { forgetRedactedThreadSummaries } from '../threads/threadSummaryState';
import {
  createEditCompactionScheduler,
  type EditCompactionScheduler,
} from './editCompactionScheduler';
import {
  planRedactionCacheCleanup,
  removeAggregatedReactionByEventId,
} from './redactionCacheLifecycle';
import type { EngineLiveEventHandler, EngineLiveEventMeta } from './types';
import { captureCacheStoreWriteLease, isCacheStoreWriteLeaseCurrent } from '../threads/cacheStore';

export type EngineWriteThroughOptions = {
  sessionId: string;
  persist?: (room: Room, events: MatrixEvent[], tailLoaded?: boolean, threadId?: string) => void;
  /**
   * Test hook: override the scheduler (e.g. to use a shorter debounce
   * or to inspect internal state). Production always uses the default.
   */
  scheduler?: EditCompactionScheduler;
};

export type EngineWriteThrough = {
  handleLiveEvent: EngineLiveEventHandler;
  /**
   * Flush any pending compaction work to the cache. Called by the
   * engine on stop() and on window pagehide / document
   * visibilitychange→hidden.
   */
  flush(): void;
};

/**
 * Persist a single thread event via the snapshot writer. Wraps
 * `persistThreadEventCacheSnapshot` so the call sites stay short and
 * always agree on the tailLoaded default (true — see file header).
 */
const persistThreadEvents = (
  sessionId: string,
  room: Room,
  threadId: string,
  events: MatrixEvent[],
  tailLoaded: boolean | undefined = true
): void => {
  const rootEvent = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);
  persistThreadEventCacheSnapshot({
    sessionId,
    room,
    threadId,
    events,
    rootEvent,
    tailLoaded,
  });
};

const persistRoomEvents = (sessionId: string, room: Room, events: MatrixEvent[]): void => {
  persistRoomEventCacheSnapshot({ sessionId, room, events });
};

/**
 * Collect the ids of every event the SDK currently has in memory for
 * this room, across the room's live timeline and every thread's
 * unfiltered timelineSet. This is the same set the component
 * controller used to build `candidateParentIds` for the redaction
 * cleanup — reactions can hang off any of these.
 */
const collectRoomEventIds = (room: Room): Set<string> => {
  const ids = new Set<string>();
  room
    .getLiveTimeline()
    .getEvents()
    .forEach((mEvent) => {
      const id = mEvent.getId();
      if (id) ids.add(id);
    });
  const threads = room.getThreads?.() ?? [];
  threads.forEach((thread) => {
    thread
      .getUnfilteredTimelineSet()
      .getLiveTimeline()
      .getEvents()
      .forEach((mEvent) => {
        const id = mEvent.getId();
        if (id) ids.add(id);
      });
  });
  return ids;
};

/**
 * Collect the timelineSets the redaction cleanup should scan for
 * aggregated reactions on the redacted target. Includes the room's
 * unfiltered timelineSet plus the thread timelineSet of the redacted
 * target if we have a thread attribution.
 */
const collectRedactionTimelineSets = (
  room: Room,
  threadCacheTargetId: string | undefined
): (EventTimelineSet | undefined)[] => {
  const threadTimelineSet = threadCacheTargetId
    ? room.getThread(threadCacheTargetId)?.getUnfilteredTimelineSet()
    : undefined;
  return [threadTimelineSet, room.getUnfilteredTimelineSet()];
};

export const createEngineWriteThrough = (
  options: EngineWriteThroughOptions
): EngineWriteThrough => {
  const { sessionId } = options;
  const persistRoom = (session: string, room: Room, events: MatrixEvent[]) => {
    if (options.persist) options.persist(room, events, false);
    else persistRoomEvents(session, room, events);
  };
  const persistThread = (
    session: string,
    room: Room,
    threadId: string,
    events: MatrixEvent[],
    tailLoaded?: boolean
  ) => {
    if (options.persist) options.persist(room, events, tailLoaded, threadId);
    else persistThreadEvents(session, room, threadId, events, tailLoaded);
  };
  const scheduler =
    options.scheduler ?? createEditCompactionScheduler(THREAD_EDIT_COMPACTION_DEBOUNCE_MS);
  const pendingCompactionReplace = new Map<string, MatrixEvent>();

  /**
   * Shared compaction scheduling. Returns false when the replace must
   * persist directly (no scheduler — impossible in production, kept
   * for parity — or a cross-sender arm-time replace: the serializer
   * only bundles same-sender replacements onto the target, so
   * compacting a cross-sender replace would drop it from cache
   * entirely). Fire-time misses persist the replace standalone via
   * the durability fallback (also counted in the probe).
   */
  const scheduleReplaceCompaction = (
    key: string,
    targetEventId: string,
    replaceEvent: MatrixEvent,
    room: Room,
    persistEvents: (events: MatrixEvent[]) => void
  ): boolean => {
    if (!scheduler) return false;
    const knownTarget = room.findEventById(targetEventId);
    if (knownTarget && knownTarget.getSender() !== replaceEvent.getSender()) {
      return false;
    }
    const previousReplace = pendingCompactionReplace.get(key);
    const capturedReplace =
      previousReplace && isEventOrderedAfter(previousReplace, replaceEvent)
        ? previousReplace
        : replaceEvent;
    pendingCompactionReplace.set(key, capturedReplace);
    const lease = captureCacheStoreWriteLease(sessionId, room.roomId);

    scheduler.scheduleTargetUpsert(key, () => {
      const pendingReplace = pendingCompactionReplace.get(key) ?? capturedReplace;
      pendingCompactionReplace.delete(key);
      if (!isCacheStoreWriteLeaseCurrent(lease)) return;
      const targetEvent = room.findEventById(targetEventId);
      countCacheProbe('editCompactions');
      if (!targetEvent) {
        countCacheProbe('editCompactionTargetMisses');
        persistEvents([pendingReplace]);
        return;
      }
      if (targetEvent.getSender() !== pendingReplace.getSender()) {
        persistEvents([targetEvent, pendingReplace]);
        return;
      }
      persistEvents([targetEvent]);
    });
    return true;
  };

  const handleRedactionLive = (event: MatrixEvent, room: Room, meta: EngineLiveEventMeta) => {
    const lease = captureCacheStoreWriteLease(sessionId, room.roomId);
    const sdkThreadIdHint = meta.kind === 'redaction' ? meta.sdkThreadId : undefined;
    const cleanupPlan = planRedactionCacheCleanup({
      room,
      redactionEvent: event,
      // Layer 2 (secondary): pre-prune threadId captured by matrix-js-sdk
      // before `makeRedacted` strips the target. Absent for Timeline-
      // channel re-emits.
      sdkThreadIdHint,
      // Engine has no notion of an "open thread" — the pre-strip
      // component controller set this; we intentionally do not.
      fallbackThreadId: undefined,
    });
    if (!cleanupPlan) return;
    forgetRedactedThreadSummaries(sessionId, room.roomId, new Set([cleanupPlan.redactedEventId]));

    // Room-scoped record for the redacted target (if any) is always
    // cleared for reactions — a reaction can technically exist as a
    // room-cache record too if it was ever persisted outside a thread
    // scope. Cheap, and preserves legacy semantics.
    if (cleanupPlan.deleteRecords) {
      deleteRoomEventsFromCache(sessionId, room.roomId, [cleanupPlan.redactedEventId]).catch(
        () => undefined
      );
    }

    // Reaction record + aggregation scrub. Two dispatch paths:
    //   (a) Plan already gave us the thread scope → keyed thread delete,
    //       then persist the redaction tombstone to that scope.
    //   (b) Plan could not attribute → walk the cache by event id,
    //       take the returned scopes (this is the guaranteed-correct
    //       cache-derived attribution, layer 1), and persist the
    //       redaction tombstone to each. If the walker returned no
    //       scopes, fall through to room-scope persist.
    // Aggregation scrub uses the plan's thread scope (undefined ok —
    // the room's unfiltered timelineSet is still scanned).
    const candidateParentIds = collectRoomEventIds(room);
    removeAggregatedReactionByEventId({
      timelineSets: collectRedactionTimelineSets(room, cleanupPlan.threadCacheTargetId),
      candidateParentIds,
      redactedEventId: cleanupPlan.redactedEventId,
    });

    if (cleanupPlan.deleteRecords && !cleanupPlan.threadCacheTargetId) {
      // Layer 1: cache-derived attribution.
      void deleteThreadEventFromCacheByEventId(sessionId, room.roomId, cleanupPlan.redactedEventId)
        .catch(() => [] as string[])
        .then((scopes) => {
          if (!isCacheStoreWriteLeaseCurrent(lease)) return;
          if (scopes.length > 0) {
            scopes.forEach((threadId) => {
              persistThread(
                sessionId,
                room,
                threadId,
                [event],
                // No-downgrade: redactions must not assert tail state.
                undefined
              );
            });
            return;
          }
          // Nothing in the cache → the redaction really is unattributed.
          // Persist to room scope so hydration at least has the tombstone.
          persistRoom(sessionId, room, [event]);
        });
      return;
    }

    if (cleanupPlan.deleteRecords && cleanupPlan.threadCacheTargetId) {
      deleteThreadEventsFromCache(sessionId, room.roomId, cleanupPlan.threadCacheTargetId, [
        cleanupPlan.redactedEventId,
      ]).catch(() => undefined);
    }

    // Persist the redaction event itself. Every case: homeservers can
    // serve stale un-pruned copies of the redacted event, so the cached
    // redaction record lets hydration re-apply it locally (I2).
    if (cleanupPlan.threadCacheTargetId) {
      persistThread(
        sessionId,
        room,
        cleanupPlan.threadCacheTargetId,
        [event],
        // No-downgrade: redactions must not assert tail state either
        // way (the redaction can arrive without any tail context).
        undefined
      );
    }
    if (!cleanupPlan.threadCacheTargetId || cleanupPlan.threadTargetFromFallback) {
      persistRoom(sessionId, room, [event]);
    }
  };

  const handleTimelineLive = (event: MatrixEvent, room: Room) => {
    const relation = event.getRelation();
    const relationTargetId = relation?.event_id;
    const threadCacheTargetId = getThreadCacheTargetId(room, event);

    // Thread-attributed live event.
    if (threadCacheTargetId) {
      const scheduled =
        relation?.rel_type === RelationType.Replace && relationTargetId
          ? scheduleReplaceCompaction(
              `thread|${room.roomId}|${threadCacheTargetId}|${relationTargetId}`,
              relationTargetId,
              event,
              room,
              (events) => persistThread(sessionId, room, threadCacheTargetId, events, true)
            )
          : false;
      if (!scheduled) {
        persistThread(sessionId, room, threadCacheTargetId, [event], true);
      }
      return;
    }

    // Room-level (non-thread) replace: coalesce onto the target's
    // room cache record.
    if (relation?.rel_type === RelationType.Replace && relationTargetId) {
      const scheduled = scheduleReplaceCompaction(
        `room|${room.roomId}|${relationTargetId}`,
        relationTargetId,
        event,
        room,
        (events) => persistRoom(sessionId, room, events)
      );
      if (scheduled) return;
    }

    // Plain room-level append.
    persistRoom(sessionId, room, [event]);
  };

  const handleLiveEvent: EngineLiveEventHandler = (
    event: MatrixEvent,
    room: Room,
    meta: EngineLiveEventMeta
  ) => {
    countCacheProbe('engineLiveWrites');

    if (meta.kind === 'redaction') {
      handleRedactionLive(event, room, meta);
      return;
    }

    // Timeline dispatch: redactions can also arrive through the
    // Timeline channel (the SDK re-emits them). Route via the
    // redaction lifecycle so the two entry points share cleanup.
    if (event.isRedaction()) {
      handleRedactionLive(event, room, meta);
      return;
    }

    handleTimelineLive(event, room);
  };

  const flush = () => {
    scheduler.flushAll();
  };

  return { handleLiveEvent, flush };
};
