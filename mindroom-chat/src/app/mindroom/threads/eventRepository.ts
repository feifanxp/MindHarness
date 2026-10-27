import {
  RelationType,
  type EventTimeline,
  type IEvent,
  type MatrixClient,
  MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import {
  deleteThreadEventsFromCache as deleteThreadEventsFromCacheToStorage,
  getRoomCursorAnchor,
  getThreadCursorAnchor as getCachedThreadCursorAnchor,
  loadCachedRoomEventsBefore as loadCachedRoomEventsBeforeFromCache,
  loadCachedRoomPaginationToken as loadCachedRoomPaginationTokenFromCache,
  loadCachedThreadEvent,
  loadCachedThreadEventsBefore as loadCachedThreadEventsBeforeFromCache,
  loadLatestCachedRoomEvents as loadLatestCachedRoomEventsFromCache,
  loadLatestCachedThreadEvents as loadLatestCachedThreadEventsFromCache,
  normalizeCachedRoomEvents,
  normalizeCachedThreadEvents,
  saveRoomEventsToCache as saveRoomEventsToCacheToStorage,
  saveRoomEventsToCacheCommitted,
  saveThreadEventsToCacheCommitted,
  type CachedRoomEventPage,
  type CachedThreadEvent,
  type CachedThreadEventPage,
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  type CacheStoreWriteLease,
} from './cacheStore';
import { compareCachedPaginationAnchors } from './eventCacheTokenUtils';
import { hydrateCachedEvents, serializeEventsForCache } from './eventCacheEditUtils';
import { loadCachedEventAcrossRoomScopes } from './cacheStore/cacheStoreEvents';
import { readRoomOfflineProgress, updateRoomOfflineProgress } from './cacheStore/cacheStoreMeta';
import { collectEventAttachments } from '../messages/eventAttachments';
import {
  getThreadSummaryInfosFromEventSources,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import { getSerializedRelationEvent, isSameSenderEditEvent } from '../../utils/editEvent';
import { getLatestEdit } from '../../utils/room';
import { isThreadOnlyRoomActivity } from './threadRenderUtils';
import { buildThreadReplyCountMap } from './threadUtils';
import { getKnownThreadReplyCount } from './threadRecord';
import {
  getRoomDerivedThreadSnapshotState,
  mergeThreadBackfillEvents,
} from './threadCacheSnapshot';
import { getThreadOpenSeedSnapshot, saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { forgetRedactedThreadSummaries, storeThreadSummaryInState } from './threadSummaryState';
import { countCacheProbe } from './cacheProbe';
import {
  collectExplicitRedactedEventIds,
  collectKnownRedactedEventIds,
  compareEventRevisions,
  describeMatrixEventRevision,
  describeRawEventRevision,
  mergeRawEventRevisions,
  mapEventDetached,
  mergeSameIdEventRevision,
  stripRedactedRelationsFromRawEvent,
  type RelationSnapshotMode,
} from './eventRevision';

// CINNY-207 P2.3: the write-boundary now lives inside cacheStore save
// entry points (single choke point). eventRepository is a serialization
// seam only — it does NOT wrap the save with its own health gate or
// catch. Callers still import from here and see the same return shape.
export { resolveHydratedRoomBeforeToken } from './eventCacheTokenUtils';

export {
  deleteRoomEventsFromCache,
  getRoomCursorAnchor,
  loadCachedRoomEvent,
  loadCachedRoomEventsBefore,
  loadCachedRoomPaginationToken,
  loadLatestCachedRoomEvents,
  normalizeCachedRoomEvents,
  saveRoomEventsToCache,
  type CachedRoomEvent,
  type CachedRoomEventPage,
} from './cacheStore';

export {
  deleteThreadEventFromCacheByEventId,
  deleteThreadEventsFromCache,
  getThreadCursorAnchor,
  loadCachedThreadEvent,
  loadCachedThreadRootsForRoom,
  type CachedThreadRoot,
  loadCachedThreadEventsBefore,
  loadLatestCachedThreadEvents,
  loadLatestCachedThreadEventsBatch,
  normalizeCachedThreadEvents,
  saveThreadEventsToCache,
  type CachedThreadEvent,
  type CachedThreadEventPage,
} from './cacheStore';

/**
 * CINNY-207 P1.2 (finding F6-B): prefer the SDK's live event instance over a
 * cache-mapped clone. The SDK applies redactions and relation removal by
 * object identity, so clones injected into relation aggregations never learn
 * about later redactions. When the SDK already holds the event, hydrate with
 * that instance.
 *
 * The mapper also heals the reverse divergence: the SDK's sync store is saved
 * periodically, so after a reload the restored live instance can predate a
 * redaction that a cached/fetched raw copy already knows about
 * (`unsigned.redacted_because`). Applying it via `makeRedacted` cascades into
 * the SDK's relation cleanup (Relations listens for BeforeRedaction), which
 * is what removes a stale reaction chip.
 */
export const createPreferLiveEventMapper =
  (
    room: Room,
    mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent
  ): ((rawEvent: Partial<IEvent>) => MatrixEvent) =>
  (rawEvent) => {
    const eventId = typeof rawEvent.event_id === 'string' ? rawEvent.event_id : undefined;
    const liveEvent = eventId ? room.findEventById(eventId) : undefined;
    if (!liveEvent) {
      const mappedEvent = mapEvent(rawEvent);
      const redactedBecause = rawEvent.unsigned?.redacted_because;
      if (redactedBecause) {
        // The redaction event itself may be live in the room; mapping it
        // through the SDK mapper would trip the reuse branch and poison the
        // mapper's preventReEmit flag for the rest of the pass.
        mappedEvent.makeRedacted(mapEventDetached(room, mapEvent, redactedBecause), room);
      }
      return mappedEvent;
    }

    return mergeSameIdEventRevision({ liveEvent, rawEvent, mapEvent, room });
  };

type ThreadCursorAnchor = ReturnType<typeof getCachedThreadCursorAnchor>;

type SaveThreadEventsToCache = (
  ...args: Parameters<typeof saveThreadEventsToCacheCommitted>
) => Promise<void | boolean>;
type SaveRoomEventsToCache = (
  ...args: Parameters<typeof saveRoomEventsToCacheToStorage>
) => Promise<void | boolean>;
type LoadCachedRoomEventsBefore = typeof loadCachedRoomEventsBeforeFromCache;
type LoadCachedRoomPaginationToken = typeof loadCachedRoomPaginationTokenFromCache;
type LoadCachedThreadEventsBefore = typeof loadCachedThreadEventsBeforeFromCache;

type LoadCachedThreadSnapshotOptions = {
  sessionId: string;
  roomId: string;
  threadId: string;
  limit: number;
  maxPages: number;
  shouldContinue?: () => boolean;
  onPage?: (page: CachedThreadEventPage, pageIndex: number, snapshot: CachedThreadSnapshot) => void;
  loadLatest?: typeof loadLatestCachedThreadEventsFromCache;
  loadBefore?: typeof loadCachedThreadEventsBeforeFromCache;
  /**
   * CINNY-207 P1.4: injected so tests can observe/override the lazy cleanup
   * of legacy standalone m.replace records. Defaults to the storage-backed
   * delete API.
   */
  deleteEvents?: typeof deleteThreadEventsFromCacheToStorage;
};

export type CachedThreadSnapshot = CachedThreadEventPage & {
  events: CachedThreadEvent[];
};

/**
 * CINNY-207 P1.4 (finding F5, decision D5): identify legacy standalone
 * `m.replace` records inside a hydrated batch that are safe to delete: their
 * target record is in the same batch AND already carries a bundled edit
 * (`unsigned['m.relations']['m.replace']`) at least as new as the standalone
 * record under the D12 ordering (ts, then event id). Deleting a standalone
 * whose target does NOT yet carry an equal-or-newer bundled edit would lose
 * the edit from cache until some later re-persist — a stale paint on the
 * next open — so those are left in place (the Phase 2 D8 wipe purges them).
 * Cross-sender replaces are never considered.
 */
export const collectLegacyStandaloneReplaceIds = (
  events: Array<Partial<IEvent> | CachedThreadEvent>
): string[] => {
  const eventsById = new Map<string, Partial<IEvent>>();
  events.forEach((rawEvent) => {
    const eventId = rawEvent.event_id;
    if (typeof eventId === 'string' && eventId.length > 0) {
      eventsById.set(eventId, rawEvent);
    }
  });

  const isBundledReplaceAtLeastAsNew = (
    targetEvent: Partial<IEvent>,
    standaloneEvent: Partial<IEvent>
  ): boolean => {
    const relations = (targetEvent.unsigned as Record<string, unknown> | undefined)?.[
      'm.relations'
    ] as Record<string, unknown> | undefined;
    const bundled = relations?.[RelationType.Replace] as Partial<IEvent> | undefined;
    if (!bundled) return false;

    // The bundle only proves supersession if hydration would actually apply
    // it: it must carry a nonempty event id and come from the same sender as
    // the standalone (mirroring the read path's serialized-relation and
    // same-sender validation). A server-provided cross-sender or id-less
    // aggregation must not license deleting a record hydration still needs.
    if (typeof bundled.event_id !== 'string' || bundled.event_id.length === 0) return false;
    if (bundled.sender !== standaloneEvent.sender) return false;

    const bundledTs = bundled.origin_server_ts;
    const standaloneTs = standaloneEvent.origin_server_ts;
    if (typeof bundledTs !== 'number' || typeof standaloneTs !== 'number') return false;
    if (bundledTs !== standaloneTs) return bundledTs > standaloneTs;

    const standaloneId = standaloneEvent.event_id;
    if (typeof standaloneId !== 'string') return false;
    // Equal ids mean the bundled edit IS the standalone record's event.
    return bundled.event_id >= standaloneId;
  };

  const legacyReplaceIds: string[] = [];
  events.forEach((rawEvent) => {
    const eventId = rawEvent.event_id;
    if (typeof eventId !== 'string' || eventId.length === 0) return;
    const relatesTo = rawEvent.content?.['m.relates_to'] as
      | { rel_type?: string; event_id?: string }
      | undefined;
    if (relatesTo?.rel_type !== RelationType.Replace) return;
    const targetEventId = relatesTo.event_id;
    if (!targetEventId) return;
    const targetEvent = eventsById.get(targetEventId);
    if (!targetEvent) return;
    if (targetEvent.sender !== rawEvent.sender) return;
    if (!isBundledReplaceAtLeastAsNew(targetEvent, rawEvent)) return;
    legacyReplaceIds.push(eventId);
  });

  return legacyReplaceIds;
};

export const loadCachedThreadSnapshot = async ({
  sessionId,
  roomId,
  threadId,
  limit,
  maxPages,
  shouldContinue,
  onPage,
  loadLatest = loadLatestCachedThreadEventsFromCache,
  loadBefore = loadCachedThreadEventsBeforeFromCache,
  deleteEvents,
}: LoadCachedThreadSnapshotOptions): Promise<CachedThreadSnapshot | undefined> => {
  let cachedPage = await loadLatest(sessionId, roomId, threadId, limit);
  const cachedThreadEvents = [...cachedPage.events];
  let cachedRootEvent = cachedPage.rootEvent;
  let cachedBeforeToken = cachedPage.beforeToken;
  let cachedHasMoreBefore = cachedPage.hasMoreBefore;
  let cachedExpectedReplyCount = cachedPage.expectedReplyCount;
  const cachedSnapshotComplete = cachedPage.snapshotComplete === true;
  const cachedRelationSnapshotComplete = cachedPage.relationSnapshotComplete === true;
  const tailLoaded = cachedPage.tailLoaded === true;

  onPage?.(cachedPage, 1, {
    ...cachedPage,
    beforeToken: cachedBeforeToken,
    events: cachedThreadEvents,
    hasMoreBefore: cachedHasMoreBefore,
    rootEvent: cachedRootEvent,
    expectedReplyCount: cachedExpectedReplyCount,
    relationSnapshotComplete: cachedRelationSnapshotComplete,
    snapshotComplete: cachedSnapshotComplete,
    tailLoaded,
  });

  for (let pageIndex = 1; cachedPage.hasMoreBefore && pageIndex < maxPages; pageIndex += 1) {
    if (shouldContinue && !shouldContinue()) return undefined;

    const earliestCachedReply = cachedPage.events[0];
    const beforeAnchor: ThreadCursorAnchor = getCachedThreadCursorAnchor(earliestCachedReply);
    if (!beforeAnchor) break;

    cachedPage = await loadBefore(sessionId, roomId, threadId, beforeAnchor, limit);
    cachedThreadEvents.unshift(...cachedPage.events);
    cachedRootEvent ??= cachedPage.rootEvent;
    cachedBeforeToken = cachedPage.beforeToken;
    cachedHasMoreBefore = cachedPage.hasMoreBefore;
    cachedExpectedReplyCount = cachedPage.expectedReplyCount ?? cachedExpectedReplyCount;
    onPage?.(cachedPage, pageIndex + 1, {
      ...cachedPage,
      beforeToken: cachedBeforeToken,
      events: cachedThreadEvents,
      hasMoreBefore: cachedHasMoreBefore,
      rootEvent: cachedRootEvent,
      expectedReplyCount: cachedExpectedReplyCount,
      relationSnapshotComplete: cachedRelationSnapshotComplete,
      snapshotComplete: cachedSnapshotComplete,
      tailLoaded,
    });

    if (cachedPage.events.length === 0) {
      break;
    }
  }

  if (shouldContinue && !shouldContinue()) return undefined;

  // CINNY-207 P1.4: lazy cleanup — legacy standalone m.replace records
  // whose target is present in the same batch are dead weight (the target
  // now carries the bundled edit). Delete them best-effort; hydration still
  // sees the replace via the target's bundled edit, and getLatestEdit
  // (P1.3 / D12) picks the newest deterministically. `deleteEvents` is
  // resolved lazily so the storage import is not touched when a test-injected
  // deleter is passed (avoids evaluating the storage identifier under
  // partial vitest mocks that reject unlisted exports).
  const legacyReplaceIds = collectLegacyStandaloneReplaceIds(cachedThreadEvents);
  if (legacyReplaceIds.length > 0) {
    const resolvedDeleteEvents = deleteEvents ?? deleteThreadEventsFromCacheToStorage;
    resolvedDeleteEvents(sessionId, roomId, threadId, legacyReplaceIds).catch(() => undefined);
  }

  return {
    ...cachedPage,
    beforeToken: cachedBeforeToken,
    events: cachedThreadEvents,
    hasMoreBefore: cachedHasMoreBefore,
    rootEvent: cachedRootEvent,
    expectedReplyCount: cachedExpectedReplyCount,
    relationSnapshotComplete: cachedRelationSnapshotComplete,
    snapshotComplete: cachedSnapshotComplete,
    tailLoaded,
  };
};

export const mapCachedThreadPageEvents = ({
  events,
  rootEvent,
  mapEvent,
}: {
  events: Partial<IEvent>[];
  rootEvent?: Partial<IEvent>;
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
}): MatrixEvent[] =>
  normalizeCachedThreadEvents(events, rootEvent).map((rawEvent) => mapEvent(rawEvent));

export type ThreadCachedSnapshot = {
  cachedPage: CachedThreadSnapshot;
  events: MatrixEvent[];
  rootEvent?: Partial<IEvent>;
  beforeToken?: string | null;
  hasMoreBefore: boolean;
  expectedReplyCount?: number;
  relationSnapshotComplete?: boolean;
  snapshotComplete?: boolean;
  tailLoaded?: boolean;
};

export const loadThreadCachedSnapshot = async ({
  mapEvent,
  ...options
}: LoadCachedThreadSnapshotOptions & {
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
}): Promise<ThreadCachedSnapshot | undefined> => {
  const cachedPage = await loadCachedThreadSnapshot(options);
  if (!cachedPage) return undefined;

  return {
    cachedPage,
    events: mapCachedThreadPageEvents({
      events: cachedPage.events,
      rootEvent: cachedPage.rootEvent,
      mapEvent,
    }),
    rootEvent: cachedPage.rootEvent,
    beforeToken: cachedPage.beforeToken,
    hasMoreBefore: cachedPage.hasMoreBefore,
    expectedReplyCount: cachedPage.expectedReplyCount,
    relationSnapshotComplete: cachedPage.relationSnapshotComplete,
    snapshotComplete: cachedPage.snapshotComplete,
    tailLoaded: cachedPage.tailLoaded,
  };
};

export type ThreadCachedPaginationSnapshot = {
  cachedPage: CachedThreadEventPage;
  events: MatrixEvent[];
  beforeToken?: string | null;
  hasMoreCachedBack: boolean;
  status: 'cache-hit' | 'cache-miss';
};

export const loadThreadCachedPaginationSnapshot = async ({
  sessionId,
  roomId,
  threadId,
  earliestLoadedReply,
  limit,
  mapEvent,
  loadBefore = loadCachedThreadEventsBeforeFromCache,
}: {
  sessionId: string;
  roomId: string;
  threadId: string;
  earliestLoadedReply?: MatrixEvent;
  limit: number;
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
  loadBefore?: LoadCachedThreadEventsBefore;
}): Promise<ThreadCachedPaginationSnapshot> => {
  const cachedPage = await loadBefore(
    sessionId,
    roomId,
    threadId,
    getCachedThreadCursorAnchor(earliestLoadedReply?.event as Partial<IEvent> | undefined),
    limit
  );
  const events = mapCachedThreadPageEvents({
    events: cachedPage.events,
    rootEvent: cachedPage.rootEvent,
    mapEvent,
  });

  return {
    cachedPage,
    events,
    beforeToken: cachedPage.beforeToken,
    hasMoreCachedBack: cachedPage.hasMoreBefore || typeof cachedPage.beforeToken === 'string',
    // Hit/miss is judged on the RAW older-reply page, not the mapped list:
    // `normalizeCachedThreadEvents` folds the thread root into `events`,
    // and the root is always already rendered at index 0. A root-only page
    // would otherwise report an eternal barren "cache-hit" — committing
    // nothing new on every gesture while the network leg (the only source
    // of genuinely older events) never runs, leaving a partially-opened
    // thread permanently un-paginatable.
    status: cachedPage.events.length > 0 ? 'cache-hit' : 'cache-miss',
  };
};

export const getThreadCacheTargetId = (room: Room, mEvent: MatrixEvent): string | undefined => {
  const eventId = mEvent.getId();
  if (!eventId) return undefined;

  const threadRootId = mEvent.threadRootId;
  if (threadRootId && threadRootId !== eventId) {
    return threadRootId;
  }

  const relationTargetId = mEvent.getAssociatedId() ?? mEvent.getRelation()?.event_id;
  if (!relationTargetId) return undefined;

  const relatedEvent = room.findEventById(relationTargetId);
  if (!relatedEvent) return undefined;
  const relatedEventId = relatedEvent.getId();
  if (!relatedEventId) return undefined;

  if (relatedEvent.threadRootId && relatedEvent.threadRootId !== relatedEventId) {
    return relatedEvent.threadRootId;
  }

  return relatedEvent.isThreadRoot ||
    room.getThread(relatedEventId)?.rootEvent?.getId() === relatedEventId
    ? relatedEventId
    : undefined;
};

export const groupThreadCacheEvents = (
  room: Room,
  events: MatrixEvent[]
): Map<string, MatrixEvent[]> => {
  const grouped = new Map<string, MatrixEvent[]>();

  events.forEach((mEvent) => {
    const threadCacheTargetId = getThreadCacheTargetId(room, mEvent);
    if (!threadCacheTargetId) return;
    const cachedThreadEvents = grouped.get(threadCacheTargetId);
    if (cachedThreadEvents) {
      cachedThreadEvents.push(mEvent);
      return;
    }
    grouped.set(threadCacheTargetId, [mEvent]);
  });

  return grouped;
};

export const getMainTimelineCacheEvents = (
  room: Room,
  linkedTimelines: EventTimeline[]
): MatrixEvent[] =>
  linkedTimelines.flatMap((timeline) =>
    timeline.getEvents().filter((mEvent) => !isThreadOnlyRoomActivity(room, mEvent))
  );

export const findEarliestLoadedRoomEventByCacheOrder = (
  cacheEvents: MatrixEvent[]
): MatrixEvent | undefined => {
  const earliestEventId = normalizeCachedRoomEvents(
    cacheEvents.map((mEvent) => mEvent.event as Partial<IEvent>)
  )[0]?.event_id;

  return earliestEventId
    ? cacheEvents.find((mEvent) => mEvent.getId() === earliestEventId)
    : undefined;
};

export const getEarliestLoadedRoomEvent = (
  room: Room,
  linkedTimelines: EventTimeline[]
): MatrixEvent | undefined =>
  findEarliestLoadedRoomEventByCacheOrder(getMainTimelineCacheEvents(room, linkedTimelines));

export const shouldHydrateLatestRoomCache = (
  loadedLatestEvent: MatrixEvent | undefined,
  cachedLatestEvent: Partial<IEvent> | undefined
): boolean => {
  if (!cachedLatestEvent) return false;
  const loadedRaw = loadedLatestEvent?.event as Partial<IEvent> | undefined;
  const anchorComparison = compareCachedPaginationAnchors(
    getRoomCursorAnchor(cachedLatestEvent),
    getRoomCursorAnchor(loadedRaw)
  );
  if (anchorComparison !== 0) return anchorComparison > 0;
  if (!loadedLatestEvent || !loadedRaw || cachedLatestEvent.event_id !== loadedRaw.event_id) {
    return false;
  }
  return (
    compareEventRevisions(
      describeRawEventRevision(cachedLatestEvent),
      describeMatrixEventRevision(loadedLatestEvent)
    ) > 0
  );
};

export const filterLatestRoomCacheHydrationEvents = (
  rawCachedEvents: Partial<IEvent>[],
  loadedEvents: MatrixEvent[],
  includeMissing = true
): Partial<IEvent>[] => {
  const loadedEventsById = new Map<string, MatrixEvent>();
  loadedEvents.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) loadedEventsById.set(eventId, mEvent);
  });

  return rawCachedEvents.filter((rawEvent) => {
    const eventId = rawEvent.event_id;
    if (typeof eventId !== 'string') return false;
    const loadedEvent = loadedEventsById.get(eventId);
    if (!loadedEvent) return includeMissing;
    return (
      compareEventRevisions(
        describeRawEventRevision(rawEvent),
        describeMatrixEventRevision(loadedEvent)
      ) > 0
    );
  });
};

type LoadLatestRoomCacheHydrationSnapshotOptions = {
  sessionId: string;
  roomId: string;
  limit: number;
  loadedEvents: MatrixEvent[];
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
  loadLatest?: typeof loadLatestCachedRoomEventsFromCache;
};

export type LatestRoomCacheHydrationSnapshot = {
  cachedPage: CachedRoomEventPage;
  events: MatrixEvent[];
  prependEvents: MatrixEvent[];
  loadedRoomCount: number;
  status: 'already-loaded' | 'empty-after-filter' | 'hydrate';
};

export const loadLatestRoomCacheHydrationSnapshot = async ({
  sessionId,
  roomId,
  limit,
  loadedEvents,
  mapEvent,
  loadLatest = loadLatestCachedRoomEventsFromCache,
}: LoadLatestRoomCacheHydrationSnapshotOptions): Promise<LatestRoomCacheHydrationSnapshot> => {
  const cachedPage = await loadLatest(sessionId, roomId, limit);
  const loadedLatestEvent = loadedEvents[loadedEvents.length - 1];
  const cachedLatestEvent = cachedPage.events[cachedPage.events.length - 1];
  const cachedTailIsNewer = shouldHydrateLatestRoomCache(loadedLatestEvent, cachedLatestEvent);
  // A restored SDK tail can already contain the newest event while missing
  // the rest of the cached page. Overlap at its oldest event proves where
  // cached history can be prepended without joining across an unknown gap.
  const earliestLoadedId = findEarliestLoadedRoomEventByCacheOrder(loadedEvents)?.getId();
  const overlapIndex = cachedPage.events.findIndex(
    (rawEvent) => rawEvent.event_id === earliestLoadedId
  );
  const loadedIds = new Set(loadedEvents.map((event) => event.getId()));
  const rawPrependEvents =
    overlapIndex > 0
      ? cachedPage.events.slice(0, overlapIndex).filter((event) => !loadedIds.has(event.event_id))
      : [];
  const prependIds = new Set<string | undefined>(rawPrependEvents.map((event) => event.event_id));
  const rawEventsToHydrate = filterLatestRoomCacheHydrationEvents(
    cachedPage.events,
    loadedEvents,
    cachedTailIsNewer
  ).filter((event) => !prependIds.has(event.event_id));

  if (!cachedTailIsNewer && rawEventsToHydrate.length === 0 && rawPrependEvents.length === 0) {
    return {
      cachedPage,
      events: [],
      prependEvents: [],
      loadedRoomCount: loadedEvents.length,
      status: 'already-loaded',
    };
  }

  const events = normalizeCachedRoomEvents(rawEventsToHydrate).map((rawEvent) =>
    mapEvent(rawEvent)
  );
  const prependEvents = normalizeCachedRoomEvents(rawPrependEvents).map((rawEvent) =>
    mapEvent(rawEvent)
  );

  return {
    cachedPage,
    events,
    prependEvents,
    loadedRoomCount: loadedEvents.length,
    status: events.length > 0 || prependEvents.length > 0 ? 'hydrate' : 'empty-after-filter',
  };
};

export type RoomCachedBackStateSnapshot = {
  cachedPage: CachedRoomEventPage;
  cachedBeforeToken: string | null | undefined;
  hasCachedBack: boolean;
};

export const loadRoomCachedBackStateSnapshot = async ({
  sessionId,
  roomId,
  earliestLoadedEvent,
  loadBefore = loadCachedRoomEventsBeforeFromCache,
  loadPaginationToken = loadCachedRoomPaginationTokenFromCache,
}: {
  sessionId: string;
  roomId: string;
  earliestLoadedEvent?: MatrixEvent;
  loadBefore?: LoadCachedRoomEventsBefore;
  loadPaginationToken?: LoadCachedRoomPaginationToken;
}): Promise<RoomCachedBackStateSnapshot> => {
  const [cachedPage, cachedBeforeToken] = await Promise.all([
    loadBefore(
      sessionId,
      roomId,
      getRoomCursorAnchor(earliestLoadedEvent?.event as Partial<IEvent> | undefined),
      1
    ),
    loadPaginationToken(sessionId, roomId, earliestLoadedEvent?.getId()),
  ]);

  return {
    cachedPage,
    cachedBeforeToken,
    hasCachedBack: cachedPage.events.length > 0,
  };
};

export type RoomCachedPaginationSnapshot = {
  cachedBeforeToken: string | null | undefined;
  cachedPage?: CachedRoomEventPage;
  events: MatrixEvent[];
  beforeToken?: string | null;
  hasMoreCachedBack: boolean;
  status: 'start-known' | 'cache-hit' | 'cache-miss';
};

export const loadRoomCachedPaginationSnapshot = async ({
  sessionId,
  roomId,
  earliestLoadedEvent,
  limit,
  mapEvent,
  loadBefore = loadCachedRoomEventsBeforeFromCache,
  loadPaginationToken = loadCachedRoomPaginationTokenFromCache,
}: {
  sessionId: string;
  roomId: string;
  earliestLoadedEvent?: MatrixEvent;
  limit: number;
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
  loadBefore?: LoadCachedRoomEventsBefore;
  loadPaginationToken?: LoadCachedRoomPaginationToken;
}): Promise<RoomCachedPaginationSnapshot> => {
  const cachedBeforeToken = await loadPaginationToken(
    sessionId,
    roomId,
    earliestLoadedEvent?.getId()
  );

  if (cachedBeforeToken === null) {
    return {
      cachedBeforeToken,
      events: [],
      hasMoreCachedBack: false,
      status: 'start-known',
    };
  }

  const cachedPage = await loadBefore(
    sessionId,
    roomId,
    getRoomCursorAnchor(earliestLoadedEvent?.event as Partial<IEvent> | undefined),
    limit
  );
  const events = normalizeCachedRoomEvents(cachedPage.events)
    .map((rawEvent) => mapEvent(rawEvent))
    .reverse();

  return {
    cachedBeforeToken,
    cachedPage,
    events,
    beforeToken: cachedPage.beforeToken,
    hasMoreCachedBack: cachedPage.hasMoreBefore,
    status: events.length > 0 ? 'cache-hit' : 'cache-miss',
  };
};

export const collectStateTargetEvents = (room: Room, events: MatrixEvent[]): MatrixEvent[] => {
  const eventsById = new Map<string, MatrixEvent>();

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) {
      eventsById.set(eventId, mEvent);
    }

    const targetEventId =
      mEvent.getRelation()?.rel_type === RelationType.Replace || mEvent.isRedaction()
        ? mEvent.getAssociatedId()
        : undefined;
    if (!targetEventId || eventsById.has(targetEventId)) return;

    const targetEvent = room.findEventById(targetEventId);
    if (!targetEvent?.getId()) return;
    // CINNY-207 P1.2/P1.4 interplay: a redacted reaction's records are
    // DELETED by the redaction lifecycle (planRedactionCacheCleanup gives
    // reactions no tombstone). Pulling the pruned reaction back in here
    // while persisting the redaction event would re-insert the record the
    // same handler just deleted.
    if (mEvent.isRedaction() && targetEvent.getType() === 'm.reaction') return;
    eventsById.set(targetEventId, targetEvent);
  });

  return Array.from(eventsById.values());
};

export const serializeThreadCacheEvents = (
  room: Room,
  events: MatrixEvent[],
  rootEvent?: MatrixEvent
): Partial<IEvent>[] =>
  serializeEventsForCache(
    room,
    collectStateTargetEvents(room, rootEvent ? [rootEvent, ...events] : events)
  );

export const serializeRoomCacheEvents = (room: Room, events: MatrixEvent[]): Partial<IEvent>[] =>
  serializeEventsForCache(
    room,
    collectStateTargetEvents(room, events).filter(
      (mEvent) => !isThreadOnlyRoomActivity(room, mEvent)
    )
  );

export type ThreadEventCacheSnapshotWrite = {
  rawEvents: Partial<IEvent>[];
  rawRootEvent?: Partial<IEvent>;
  loadedReplyCount: number;
  expectedReplyCount?: number;
  beforeTokenForEarliest?: string | null;
  tailLoaded?: boolean;
  snapshotComplete?: boolean;
  relationSnapshotComplete?: boolean;
  write: Promise<void | boolean>;
};

export type PersistThreadEventCacheSnapshotArgs = {
  writeLease?: CacheStoreWriteLease;
  sessionId: string;
  room: Room;
  threadId: string;
  events: MatrixEvent[];
  rootEvent?: MatrixEvent | null;
  beforeTokenForEarliest?: string | null;
  tailLoaded?: boolean;
  snapshotComplete?: boolean;
  expectedReplyCount?: number;
  relationSnapshotComplete?: boolean;
  relationSnapshotMode?: RelationSnapshotMode;
  /** Raw server observations used when their relation snapshot is authoritative. */
  authoritativeRawEvents?: Partial<IEvent>[];
  save?: SaveThreadEventsToCache;
};

const sanitizeAuthoritativeRawEvents = (
  room: Room,
  events: MatrixEvent[],
  authoritativeRawEvents: Partial<IEvent>[]
): Partial<IEvent>[] => {
  const redactedEventById = new Map<string, MatrixEvent>();
  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId && mEvent.isRedacted()) redactedEventById.set(eventId, mEvent);
  });
  const redactedEventIds = collectKnownRedactedEventIds(room, authoritativeRawEvents);
  redactedEventById.forEach((_event, eventId) => redactedEventIds.add(eventId));

  const sanitizedRawEvents = authoritativeRawEvents.map((rawEvent) => {
    const eventId = rawEvent.event_id;
    const redactedEvent = eventId ? redactedEventById.get(eventId) : undefined;
    if (!redactedEvent) {
      return stripRedactedRelationsFromRawEvent(rawEvent, redactedEventIds);
    }

    // The prefer-live mapper has already applied makeRedacted(room), so this
    // base carries the SDK's pruned content. Merge the server observation only
    // for its authoritative non-replacement relation bundles; never let its
    // temporarily stale plaintext become the persisted base again.
    return stripRedactedRelationsFromRawEvent(
      mergeRawEventRevisions(redactedEvent.event as Partial<IEvent>, rawEvent, 'authoritative'),
      redactedEventIds
    );
  });

  // Reconciliation owns the authoritative server snapshot, but it still
  // must pass through the same edit-compaction boundary as live writes.
  // Otherwise a repair that arrives before every streamed edit is observed
  // live stores each same-sender replacement as an independent record.
  return serializeEventsForCache(
    room,
    sanitizedRawEvents.map((rawEvent) => new MatrixEvent(rawEvent as IEvent))
  );
};

/** Transient descriptions follow serialized authority, borrowing only matching decrypted content. */
const collectSnapshotAttachmentOwners = (
  room: Room,
  rawEvents: Partial<IEvent>[],
  events: MatrixEvent[]
) => {
  const sources = collectStateTargetEvents(room, events);
  const byId = new Map(
    sources
      .flatMap((event) => [event, event.replacingEvent()])
      .filter((event): event is MatrixEvent => !!event)
      .map((event) => [event.getId(), event])
  );
  const decode = (raw: Partial<IEvent>): MatrixEvent => {
    const source =
      byId.get(raw.event_id) ?? (raw.event_id ? room.findEventById(raw.event_id) : undefined);
    return new MatrixEvent({
      ...raw,
      room_id: room.roomId,
      ...(raw.type === 'm.room.encrypted' &&
      source?.getRoomId() === room.roomId &&
      !source.status &&
      !source.isDecryptionFailure()
        ? { type: source.getType(), content: source.getOriginalContent() }
        : {}),
    });
  };
  const snapshots = rawEvents.map((raw) => {
    const event = decode(raw);
    const replacement = getSerializedRelationEvent(new MatrixEvent(raw), RelationType.Replace);
    if (replacement) {
      const decoded = decode(replacement.event);
      if (isSameSenderEditEvent(event, decoded)) event.makeReplaced(decoded);
    }
    return event;
  });
  return collectEventAttachments(snapshots).filter(
    (message) => !message.redacted && (message.attachments.length > 0 || !!message.revisionId)
  );
};

/**
 * Publish a thread write's summary notices once it commits, so a thread keeps
 * its title when the notice is older than the cached tail the overview reads.
 * The save refuses copies of notices it knows are redacted, also from earlier
 * writes, so only notices it stored unredacted are published.
 */
const publishCachedThreadSummaries = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  summaries: MindroomThreadSummaryInfo[],
  write: Promise<void | boolean>,
  lease: CacheStoreWriteLease
): Promise<void> => {
  if ((await write) === false) return;
  const cached = await Promise.all(
    summaries.map((info) =>
      info.eventId ? loadCachedThreadEvent(sessionId, roomId, threadId, info.eventId) : undefined
    )
  );
  const kept = summaries.filter((_info, index) => {
    const event = cached[index];
    return !!event && !event.unsigned?.redacted_because;
  });
  if (kept.length > 0 && isCacheStoreWriteLeaseCurrent(lease))
    storeThreadSummaryInState(sessionId, roomId, threadId, ...kept);
};

export const persistThreadEventCacheSnapshot = ({
  sessionId,
  room,
  threadId,
  events,
  rootEvent,
  beforeTokenForEarliest,
  tailLoaded,
  snapshotComplete,
  expectedReplyCount,
  relationSnapshotComplete,
  relationSnapshotMode,
  authoritativeRawEvents,
  writeLease,
  save = saveThreadEventsToCacheCommitted,
}: PersistThreadEventCacheSnapshotArgs): ThreadEventCacheSnapshotWrite => {
  const resolvedRootEvent = rootEvent ?? undefined;
  const loadedReplyCount = buildThreadReplyCountMap(events).get(threadId) ?? 0;
  const persistedExpectedReplyCount =
    expectedReplyCount ??
    (resolvedRootEvent ? getKnownThreadReplyCount(resolvedRootEvent) : undefined) ??
    (snapshotComplete === true || (beforeTokenForEarliest === null && tailLoaded === true)
      ? loadedReplyCount
      : undefined);
  const rawEvents = authoritativeRawEvents
    ? sanitizeAuthoritativeRawEvents(room, events, authoritativeRawEvents)
    : serializeThreadCacheEvents(room, events, resolvedRootEvent);
  const rawRootEvent = resolvedRootEvent
    ? rawEvents.find((rawEvent) => rawEvent.event_id === resolvedRootEvent.getId())
    : undefined;

  countCacheProbe('serializedEvents', rawEvents.length);
  // Fetched or backfilled copies can carry a redaction the live handler never saw.
  forgetRedactedThreadSummaries(sessionId, room.roomId, collectExplicitRedactedEventIds(rawEvents));
  // CINNY-207 P2.3: health gate + failure surfacing moved into the
  // cacheStore save entry point (single choke point). This seam only
  // serializes and delegates.
  const saveArgs = [
    sessionId,
    room.roomId,
    threadId,
    rawEvents,
    rawRootEvent,
    beforeTokenForEarliest,
    tailLoaded,
    snapshotComplete,
    persistedExpectedReplyCount,
    relationSnapshotComplete,
  ] as const;
  const attachmentOwners = collectSnapshotAttachmentOwners(
    room,
    rawEvents,
    resolvedRootEvent ? [...events, resolvedRootEvent] : events
  );
  const write = attachmentOwners.length
    ? save(...saveArgs, relationSnapshotMode ?? 'partial', writeLease, attachmentOwners)
    : writeLease
    ? save(...saveArgs, relationSnapshotMode ?? 'partial', writeLease)
    : relationSnapshotMode === undefined
    ? save(...saveArgs)
    : save(...saveArgs, relationSnapshotMode);
  const summaries = getThreadSummaryInfosFromEventSources(events).filter(
    (info): info is MindroomThreadSummaryInfo => !!info?.summaryText
  );
  if (summaries.length > 0) {
    const lease = writeLease ?? captureCacheStoreWriteLease(sessionId, room.roomId);
    publishCachedThreadSummaries(sessionId, room.roomId, threadId, summaries, write, lease).catch(
      () => undefined
    );
  }

  return {
    rawEvents,
    rawRootEvent,
    loadedReplyCount,
    expectedReplyCount: persistedExpectedReplyCount,
    beforeTokenForEarliest,
    tailLoaded,
    snapshotComplete,
    relationSnapshotComplete,
    write,
  };
};

/** Snapshot writer whose result distinguishes a committed transaction from a skipped/failed write. */
export const persistThreadEventCacheSnapshotCommitted = (
  args: Omit<PersistThreadEventCacheSnapshotArgs, 'save'>
): ThreadEventCacheSnapshotWrite =>
  persistThreadEventCacheSnapshot({
    ...args,
    writeLease: args.writeLease ?? captureCacheStoreWriteLease(args.sessionId, args.room.roomId),
    save: saveThreadEventsToCacheCommitted,
  });

type ThreadCacheFromRoomEventsOptions = {
  threadScope?: { threadId: string; events: MatrixEvent[] };
  beforeTokenForEarliest?: string | null;
  roomStartKnown?: boolean;
  roomTailLoaded?: boolean;
  snapshotComplete?: boolean;
  tailLoaded?: boolean;
};

export type ThreadCacheFromRoomEventsWrite = {
  threadId: string;
  threadEvents: MatrixEvent[];
  rootEvent?: MatrixEvent;
  nextSeedEvents: MatrixEvent[];
  roomDerivedSnapshot?: ReturnType<typeof getRoomDerivedThreadSnapshotState>;
  cacheSnapshot: ThreadEventCacheSnapshotWrite;
};

export const persistThreadCacheFromRoomEventsSnapshot = ({
  sessionId,
  room,
  events,
  opts,
  getSeedSnapshot = getThreadOpenSeedSnapshot,
  saveSeedSnapshot = saveThreadOpenSeedSnapshot,
  saveThreadSnapshot = saveThreadEventsToCacheCommitted,
}: {
  sessionId: string;
  room: Room;
  events: MatrixEvent[];
  opts?: ThreadCacheFromRoomEventsOptions;
  getSeedSnapshot?: typeof getThreadOpenSeedSnapshot;
  saveSeedSnapshot?: typeof saveThreadOpenSeedSnapshot;
  saveThreadSnapshot?: SaveThreadEventsToCache;
}): ThreadCacheFromRoomEventsWrite[] => {
  const writes: ThreadCacheFromRoomEventsWrite[] = [];
  const groupedThreadEvents = groupThreadCacheEvents(
    room,
    events.filter((event) => !opts?.threadScope?.events.includes(event))
  );
  if (opts?.threadScope) {
    const { threadId, events: hinted } = opts.threadScope;
    groupedThreadEvents.set(threadId, [...(groupedThreadEvents.get(threadId) ?? []), ...hinted]);
  }

  groupedThreadEvents.forEach((threadEvents, threadId) => {
    const rootEvent = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);
    const existingThreadSeedEvents = getSeedSnapshot(room, threadId);
    const roomDerivedThreadSeedEvents = rootEvent
      ? mergeThreadBackfillEvents([rootEvent], threadEvents)
      : threadEvents;
    const nextSeedEvents = mergeThreadBackfillEvents(
      existingThreadSeedEvents,
      roomDerivedThreadSeedEvents
    );
    let beforeTokenForEarliest = opts?.beforeTokenForEarliest;
    let expectedReplyCount: number | undefined;
    let snapshotComplete = opts?.snapshotComplete;
    let tailLoaded = opts?.tailLoaded;
    let roomDerivedSnapshot: ReturnType<typeof getRoomDerivedThreadSnapshotState> | undefined;

    if (opts?.roomStartKnown !== undefined || opts?.roomTailLoaded !== undefined) {
      roomDerivedSnapshot = getRoomDerivedThreadSnapshotState({
        room,
        threadId,
        rootEvent,
        threadEvents,
        roomStartKnown: opts?.roomStartKnown === true,
        roomTailLoaded: opts?.roomTailLoaded === true,
      });
      beforeTokenForEarliest = roomDerivedSnapshot.beforeTokenForEarliest;
      expectedReplyCount = roomDerivedSnapshot.expectedReplyCount;
      snapshotComplete = roomDerivedSnapshot.snapshotComplete;
      tailLoaded = roomDerivedSnapshot.tailLoaded;
    }

    saveSeedSnapshot(room, threadId, nextSeedEvents);

    const cacheSnapshot = persistThreadEventCacheSnapshot({
      sessionId,
      room,
      threadId,
      events: threadEvents,
      rootEvent,
      beforeTokenForEarliest,
      tailLoaded,
      snapshotComplete,
      expectedReplyCount,
      save: saveThreadSnapshot,
    });

    writes.push({
      threadId,
      threadEvents,
      rootEvent,
      nextSeedEvents,
      roomDerivedSnapshot,
      cacheSnapshot,
    });
  });

  return writes;
};

export type RoomEventCacheSnapshotWrite = {
  rawEvents: Partial<IEvent>[];
  sourceEventCount: number;
  beforeTokenForEarliest?: string | null;
  write: Promise<void | boolean>;
};

export const persistRoomEventCacheSnapshot = ({
  sessionId,
  room,
  events,
  beforeTokenForEarliest,
  save = saveRoomEventsToCacheToStorage,
}: {
  sessionId: string;
  room: Room;
  events: MatrixEvent[];
  beforeTokenForEarliest?: string | null;
  save?: SaveRoomEventsToCache;
}): RoomEventCacheSnapshotWrite => {
  const rawEvents = serializeRoomCacheEvents(room, events);

  countCacheProbe('serializedEvents', rawEvents.length);
  forgetRedactedThreadSummaries(sessionId, room.roomId, collectExplicitRedactedEventIds(rawEvents));
  // CINNY-207 P2.3: same as the thread path — gating/surfacing lives
  // in the cacheStore save entry point.
  const attachmentOwners = collectSnapshotAttachmentOwners(room, rawEvents, events);
  const write = attachmentOwners.length
    ? save(
        sessionId,
        room.roomId,
        rawEvents,
        beforeTokenForEarliest,
        'partial',
        undefined,
        attachmentOwners
      )
    : save(sessionId, room.roomId, rawEvents, beforeTokenForEarliest);

  return {
    rawEvents,
    sourceEventCount: events.length,
    beforeTokenForEarliest,
    write,
  };
};

// SDK mapper objects can emit Decrypted long after their originating operation.
// Keep provenance, not another generation: CacheStore owns revocation.
const eventWriteLeases = new WeakMap<MatrixEvent, CacheStoreWriteLease>();
// Explicit persistence already awaits these decryptions; their SDK notification
// must not start a second write. Later key arrivals still use normal write-through.
const persistingDecryptions = new WeakSet<MatrixEvent>();
export const rememberEventCacheWriteLease = (
  event: MatrixEvent,
  lease: CacheStoreWriteLease
): void => {
  if (!eventWriteLeases.has(event)) eventWriteLeases.set(event, lease);
};
export const canPersistDecryptedEvent = (event: MatrixEvent, sessionId: string): boolean => {
  const lease = eventWriteLeases.get(event);
  return (
    !!lease &&
    !persistingDecryptions.has(event) &&
    lease.sessionId === sessionId &&
    isCacheStoreWriteLeaseCurrent(lease)
  );
};

/**
 * CINNY-207 P7.2 audit finding #3: gap-fill and deep-history paths
 * fetch raw `/messages` chunks and persist them to the room cache. Per
 * `engine/reconciler.ts`'s header, Tuwunel (and any homeserver) can
 * serve un-pruned copies of redacted events for ~10s after a
 * redaction; feeding those raw copies directly to `saveRoomEventsToCache`
 * overwrites a cached tombstone with pre-redaction plaintext at rest,
 * violating invariant I2.
 *
 * Funnel each chunk event through `createPreferLiveEventMapper` (the
 * same mapper the reconciler uses) which either returns the SDK's live
 * instance (if it already knows the event) or applies
 * `unsigned.redacted_because` before persisting. Then serialize through
 * the shared `serializeRoomCacheEvents` pipeline via
 * `persistRoomEventCacheSnapshot` — the same path the write-through and
 * reconciler use for room-scope persistence.
 *
 * `beforeTokenForEarliest` is forwarded so the gap-fill executor's
 * paging semantics (see `runSaveRoomEventsTxn`) are preserved for the
 * earliest event's ledger.
 *
 * Eager thread cache (2026-07-06): the chunk ALSO teaches the thread
 * caches. `/messages` returns thread replies (they are room DAG
 * events), but `serializeRoomCacheEvents` deliberately filters them
 * out of the room scope — before this fix the deep-history sweep and
 * gap-fill catchup downloaded every thread's content and then threw
 * it away, so a cold-cache thread open re-downloaded what the sweep
 * had already fetched (the pre-P4.3 `useRoomEagerPreload` loop fed
 * these events through the SDK-timeline persist paths, which grouped
 * them; the engine jobs dropped that leg). Group the mapped chunk by
 * thread attribution and persist each group into its thread scope:
 *   - `roomTailLoaded: true` — both callers page BACKWARD from the
 *     room's live tail, so every encountered thread's newest replies
 *     are covered by (live write-through ∪ this sweep). The claim is
 *     what lets read-time completeness math (reply-count coverage in
 *     `isCompleteCachedThreadSnapshot`) prove a swept thread complete.
 *     No `roomStartKnown`/`snapshotComplete` claim is made per chunk —
 *     a single chunk under-counts a thread's replies, and an explicit
 *     false would downgrade a previously proven flag.
 *   - Seed snapshots are NOT written: a 10k-event sweep would pin its
 *     whole mapped batch in the in-memory seed store. Durable IDB is
 *     the product here; seeds stay owned by the prewarm/open paths.
 */
export const persistRoomChunkWithPreferLive = async ({
  mx,
  sessionId,
  room,
  chunk,
  beforeTokenForEarliest,
  roomTailLoaded = true,
  threadId,
  mappedEvents,
  writeLease = captureCacheStoreWriteLease(sessionId, room.roomId),
}: {
  mx: MatrixClient;
  sessionId: string;
  room: Room;
  chunk: Partial<IEvent>[];
  beforeTokenForEarliest?: string | null;
  roomTailLoaded?: boolean;
  threadId?: string;
  writeLease?: CacheStoreWriteLease;
  mappedEvents?: MatrixEvent[];
}): Promise<(RoomEventCacheSnapshotWrite & { events: MatrixEvent[] }) | undefined> => {
  if (chunk.length === 0) return undefined;
  const mapper = mx.getEventMapper({ decrypt: false });
  const preferLive = createPreferLiveEventMapper(room, mapper);
  const mapped = mappedEvents ?? chunk.map((raw) => preferLive({ ...raw, room_id: room.roomId }));
  const decryptEvent = async (event: MatrixEvent) => {
    rememberEventCacheWriteLease(event, writeLease);
    if (event.getType() !== 'm.room.encrypted' && !event.isDecryptionFailure()) return;
    persistingDecryptions.add(event);
    try {
      await mx.decryptEventIfNeeded?.(event);
    } catch {
      // Missing keys remain tracked below for the existing bounded retry pass.
    } finally {
      persistingDecryptions.delete(event);
    }
  };
  const decrypt = async (event: MatrixEvent) => {
    await decryptEvent(event);
    if (event.isRedacted()) return;
    const replacement = getLatestEdit(
      event,
      [event.replacingEvent(), getSerializedRelationEvent(event, RelationType.Replace)].filter(
        (candidate): candidate is MatrixEvent => !!candidate
      )
    );
    if (!replacement) return;
    replacement.event.room_id = room.roomId;
    await decryptEvent(replacement);
    if (event.replacingEvent() !== replacement) event.makeReplaced(replacement);
  };
  await Promise.all(mapped.map(decrypt));
  if (!isCacheStoreWriteLeaseCurrent(writeLease)) throw new Error('cache room write revoked');
  const progress = await readRoomOfflineProgress(sessionId, room.roomId);
  const byId = new Map(mapped.map((event) => [event.getId(), event]));
  const resolve = async (id: string): Promise<MatrixEvent | undefined> => {
    const known = byId.get(id);
    if (known) return known;
    const bundled = [...byId.values()]
      .map((event) => event.replacingEvent())
      .find((event) => event?.getId() === id);
    if (bundled) {
      byId.set(id, bundled);
      return bundled;
    }
    const raw = await loadCachedEventAcrossRoomScopes(sessionId, room.roomId, id);
    const event = raw ? preferLive({ ...raw, room_id: room.roomId }) : room.findEventById(id);
    if (!event) return undefined;
    await decrypt(event);
    byId.set(id, event);
    return event;
  };
  // Retry only relations made relevant by this chunk. The controller owns
  // bounded retries of the rest; streaming a message must not replay the room backlog.
  const incomingIds = new Set(
    mapped.flatMap((event) => [event.getId(), event.replacingEvent()?.getId()])
  );
  await Promise.all(
    Object.entries(progress.unresolvedRelations ?? {})
      .filter(([, targetId]) => incomingIds.has(targetId))
      .map(([id]) => resolve(id))
  );
  const unresolved: Record<string, string> = {};
  for (const event of [...byId.values()]) {
    const targetId = event.isRedaction() ? event.getAssociatedId() : event.getRelation()?.event_id;
    if (!targetId || event.getRelation()?.rel_type === RelationType.Thread) continue;
    if (!(await resolve(targetId)) && event.getId()) unresolved[event.getId()!] = targetId;
  }
  const resolvedEvents = [...byId.values()];
  // A detached relation uses the same grouping/serialization as SDK-resident
  // events. This lookup facade adds no events to the SDK's live timelines.
  const lookupRoom = Object.create(room) as Room;
  lookupRoom.findEventById = (id) => byId.get(id) ?? room.findEventById(id);
  hydrateCachedEvents({ room: lookupRoom, events: resolvedEvents });
  if (!isCacheStoreWriteLeaseCurrent(writeLease)) throw new Error('cache room write revoked');
  const threadWrites = persistThreadCacheFromRoomEventsSnapshot({
    sessionId,
    room: lookupRoom,
    events: resolvedEvents,
    opts: { roomTailLoaded, threadScope: threadId ? { threadId, events: mapped } : undefined },
    saveSeedSnapshot: () => undefined,
    saveThreadSnapshot: (
      session,
      id,
      thread,
      events,
      root,
      token,
      tail,
      complete,
      count,
      relations,
      mode,
      _lease,
      owners
    ) =>
      saveThreadEventsToCacheCommitted(
        session,
        id,
        thread,
        events,
        root,
        token,
        tail,
        complete,
        count,
        relations,
        mode,
        writeLease,
        owners
      ),
  });
  const roomWrite = persistRoomEventCacheSnapshot({
    sessionId,
    room: lookupRoom,
    events: resolvedEvents,
    beforeTokenForEarliest,
    save: (session, id, events, token, mode, _lease, owners) =>
      saveRoomEventsToCacheCommitted(session, id, events, token, mode, writeLease, owners),
  });
  const commitResults = await Promise.all([
    roomWrite.write,
    ...threadWrites.map((threadWrite) => threadWrite.cacheSnapshot.write),
  ]);
  if (commitResults.some((committed) => committed !== true)) {
    throw new Error('cache chunk did not commit');
  }
  const undecrypted = new Set<string>();
  const processed = new Set<string>();
  resolvedEvents.forEach((event) => {
    const id = event.getId();
    if (!id) return;
    processed.add(id);
    const replacement = event.replacingEvent();
    if (
      event.getType() === 'm.room.encrypted' ||
      event.isDecryptionFailure() ||
      replacement?.getType() === 'm.room.encrypted' ||
      replacement?.isDecryptionFailure()
    )
      undecrypted.add(id);
  });
  if (
    !(await updateRoomOfflineProgress(
      sessionId,
      room.roomId,
      (current) => {
        // Apply only this pass's observations to current metadata. An unresolved
        // ID seen in the starting snapshot must not re-add another pass's repair.
        const merge = (
          latest: string[] | undefined,
          pending: Set<string>,
          before: string[] | undefined
        ) => {
          const result = new Set(latest);
          processed.forEach((id) => {
            if (!pending.has(id)) result.delete(id);
          });
          pending.forEach((id) => {
            if (!before?.includes(id)) result.add(id);
          });
          return [...result];
        };
        const relations = { ...current.unresolvedRelations };
        processed.forEach((id) => {
          if (!unresolved[id]) delete relations[id];
        });
        Object.entries(unresolved).forEach(([id, target]) => {
          if (!progress.unresolvedRelations?.[id]) relations[id] = target;
        });
        return {
          unresolvedRelations: relations,
          undecryptedEventIds: merge(
            current.undecryptedEventIds,
            undecrypted,
            progress.undecryptedEventIds
          ),
        };
      },
      writeLease
    ))
  )
    throw new Error('Cache coverage did not commit');
  return { ...roomWrite, events: resolvedEvents };
};
