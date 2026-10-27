import { MatrixEvent, RelationType, type IEvent, type Room } from 'matrix-js-sdk';
import { getSerializedReplacementEvent, isSameSenderEditEvent } from '../../utils/editEvent';
import { getLatestEdit } from '../../utils/room';

export type ReplacementRevision = {
  readonly eventId: string;
  readonly ts: number;
};

export type EventRevisionDescriptor = {
  readonly redacted: boolean;
  readonly replacement?: ReplacementRevision;
  readonly aggregations: Record<string, unknown>;
};

export type RelationSnapshotMode = 'partial' | 'authoritative';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
};

const getRawReplacement = (rawEvent: Partial<IEvent>): Partial<IEvent> | undefined => {
  const relations = (rawEvent.unsigned as Record<string, unknown> | undefined)?.['m.relations'] as
    | Record<string, unknown>
    | undefined;
  const replacement = relations?.[RelationType.Replace];
  if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
    return undefined;
  }
  return replacement as Partial<IEvent>;
};

export const withoutRawReplacement = (rawEvent: Partial<IEvent>): Partial<IEvent> => {
  const unsigned = rawEvent.unsigned;
  const relations = unsigned?.['m.relations'];
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) return rawEvent;
  if (!(RelationType.Replace in relations)) return rawEvent;

  const nextRelations = { ...relations };
  delete nextRelations[RelationType.Replace];
  const nextUnsigned = { ...unsigned };
  if (Object.keys(nextRelations).length > 0) {
    nextUnsigned['m.relations'] = nextRelations;
  } else {
    delete nextUnsigned['m.relations'];
  }
  return { ...rawEvent, unsigned: nextUnsigned };
};

const withRawReplacement = (
  rawEvent: Partial<IEvent>,
  replacement: MatrixEvent | undefined
): Partial<IEvent> => {
  const base = withoutRawReplacement(rawEvent);
  if (!replacement) return base;

  const unsigned = { ...base.unsigned };
  const currentRelations = unsigned['m.relations'];
  const relations = isRecord(currentRelations) ? { ...currentRelations } : {};
  relations[RelationType.Replace] = replacement.event;
  unsigned['m.relations'] = relations;
  return { ...base, unsigned };
};

const withoutMatchingRawReplacement = (
  rawEvent: Partial<IEvent>,
  redactedEventIds: ReadonlySet<string>
): Partial<IEvent> => {
  const replacement = getRawReplacement(rawEvent);
  const replacementId = replacement?.event_id;
  return typeof replacementId === 'string' && redactedEventIds.has(replacementId)
    ? withoutRawReplacement(rawEvent)
    : rawEvent;
};

/** Remove cached relation bundles that still reference redacted events. */
export const stripRedactedRelationsFromRawEvent = (
  rawEvent: Partial<IEvent>,
  redactedEventIds: ReadonlySet<string>
): Partial<IEvent> => {
  if (redactedEventIds.size === 0) return rawEvent;

  let nextEvent = withoutMatchingRawReplacement(rawEvent, redactedEventIds);
  const relations = nextEvent.unsigned?.['m.relations'];
  if (!isRecord(relations)) return nextEvent;

  const thread = relations[RelationType.Thread];
  if (!isRecord(thread) || !isRecord(thread.latest_event)) return nextEvent;

  const latestEvent = thread.latest_event as Partial<IEvent>;
  const latestEventId = latestEvent.event_id;
  const nextLatestEvent =
    typeof latestEventId === 'string' && redactedEventIds.has(latestEventId)
      ? undefined
      : stripRedactedRelationsFromRawEvent(latestEvent, redactedEventIds);
  if (nextLatestEvent === latestEvent) return nextEvent;

  const nextThread = { ...thread };
  if (nextLatestEvent) {
    nextThread.latest_event = nextLatestEvent;
  } else {
    delete nextThread.latest_event;
  }
  const nextRelations = { ...relations, [RelationType.Thread]: nextThread };
  nextEvent = {
    ...nextEvent,
    unsigned: {
      ...nextEvent.unsigned,
      'm.relations': nextRelations,
    },
  };
  return nextEvent;
};

export const collectExplicitRedactedEventIds = (
  rawEvents: readonly Partial<IEvent>[]
): Set<string> => {
  const redactedEventIds = new Set<string>();
  const collect = (rawEvent: Partial<IEvent>): void => {
    if (rawEvent.unsigned?.redacted_because && typeof rawEvent.event_id === 'string') {
      redactedEventIds.add(rawEvent.event_id);
    }
    if (rawEvent.type === 'm.room.redaction') {
      const contentRedacts = isRecord(rawEvent.content) ? rawEvent.content.redacts : undefined;
      const redactedEventId =
        typeof rawEvent.redacts === 'string'
          ? rawEvent.redacts
          : typeof contentRedacts === 'string'
          ? contentRedacts
          : undefined;
      if (redactedEventId) redactedEventIds.add(redactedEventId);
    }

    const replacement = getRawReplacement(rawEvent);
    if (replacement) collect(replacement);
    const relations = rawEvent.unsigned?.['m.relations'];
    if (!isRecord(relations)) return;
    const thread = relations[RelationType.Thread];
    if (isRecord(thread) && isRecord(thread.latest_event)) {
      collect(thread.latest_event as Partial<IEvent>);
    }
  };
  rawEvents.forEach(collect);
  return redactedEventIds;
};

export const collectEmbeddedRelationEventIds = (
  rawEvents: readonly Partial<IEvent>[]
): Set<string> => {
  const eventIds = new Set<string>();
  const collect = (rawEvent: Partial<IEvent>): void => {
    const replacementId = getRawReplacement(rawEvent)?.event_id;
    if (typeof replacementId === 'string') eventIds.add(replacementId);

    const relations = rawEvent.unsigned?.['m.relations'];
    if (!isRecord(relations)) return;
    const thread = relations[RelationType.Thread];
    if (!isRecord(thread) || !isRecord(thread.latest_event)) return;
    const latestEvent = thread.latest_event as Partial<IEvent>;
    if (typeof latestEvent.event_id === 'string') eventIds.add(latestEvent.event_id);
    collect(latestEvent);
  };
  rawEvents.forEach(collect);
  return eventIds;
};

/**
 * Union of every event id known to be redacted from the given raw batch: the
 * batch's own explicit redactions (from `unsigned.redacted_because` or
 * `m.room.redaction` records, including `content.redacts` for room-v11) plus
 * embedded relation targets that the live room already reports redacted.
 * Callers use this both to prune stale relation bundles from persisted raws
 * (see `stripRedactedRelationsFromRawEvent`) and to gate live SDK relation
 * application against events the SDK has already redacted.
 */
export const collectKnownRedactedEventIds = (
  room: Room,
  rawEvents: readonly Partial<IEvent>[]
): Set<string> => {
  const knownRedactedIds = collectExplicitRedactedEventIds(rawEvents);
  collectEmbeddedRelationEventIds(rawEvents).forEach((eventId) => {
    if (room.findEventById(eventId)?.isRedacted()) knownRedactedIds.add(eventId);
  });
  return knownRedactedIds;
};

/**
 * Returns a predicate that answers whether a live MatrixEvent is redacted in
 * either the SDK-owned instance or in the caller's `knownRedactedIds`
 * (typically built by `collectKnownRedactedEventIds`). The extra room lookup
 * catches an event whose current in-batch instance predates a redaction the
 * live room already applied.
 */
export const createIsKnownRedacted =
  (room: Room, knownRedactedIds: ReadonlySet<string>): ((event: MatrixEvent) => boolean) =>
  (event) => {
    if (event.isRedacted()) return true;
    const eventId = event.getId();
    return (
      !!eventId &&
      (knownRedactedIds.has(eventId) || room.findEventById(eventId)?.isRedacted() === true)
    );
  };

const getNonReplacementRelations = (rawEvent: Partial<IEvent>): Record<string, unknown> => {
  const relations = rawEvent.unsigned?.['m.relations'];
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) return {};
  const nextRelations = { ...relations };
  delete nextRelations[RelationType.Replace];
  return nextRelations;
};

const canonicalizeAggregation = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeAggregation(item));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((childKey) => [childKey, canonicalizeAggregation(value[childKey])])
  );
};

const canonicalizeRelationBundle = (relationType: string, value: unknown): unknown => {
  const canonical = canonicalizeAggregation(value);
  if (
    (relationType === RelationType.Annotation || relationType === RelationType.Reference) &&
    isRecord(canonical) &&
    Array.isArray(canonical.chunk)
  ) {
    return {
      ...canonical,
      chunk: [...canonical.chunk].sort((left, right) =>
        stableSerialize(left).localeCompare(stableSerialize(right))
      ),
    };
  }
  return canonical;
};

const canonicalizeRelations = (relations: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.keys(relations)
      .sort()
      .map((relationType) => [
        relationType,
        canonicalizeRelationBundle(relationType, relations[relationType]),
      ])
  );

const getFiniteCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

const getRawObservationTs = (rawEvent: Record<string, unknown> | undefined): number => {
  if (!rawEvent) return 0;
  const event = rawEvent as Partial<IEvent>;
  const replacement = getRawReplacement(event);
  const replacementTs = getReplacementRevision(event.sender, replacement)?.ts ?? 0;
  const eventTs =
    typeof event.origin_server_ts === 'number' && Number.isFinite(event.origin_server_ts)
      ? event.origin_server_ts
      : 0;
  return Math.max(eventTs, replacementTs);
};

const pickFresherRawObservation = (
  current: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!current) return incoming;
  if (!incoming) return current;
  const currentTs = getRawObservationTs(current);
  const incomingTs = getRawObservationTs(incoming);
  if (currentTs !== incomingTs) return incomingTs > currentTs ? incoming : current;

  const currentId = typeof current.event_id === 'string' ? current.event_id : '';
  const incomingId = typeof incoming.event_id === 'string' ? incoming.event_id : '';
  if (currentId !== incomingId) return incomingId > currentId ? incoming : current;
  return stableSerialize(incoming) > stableSerialize(current) ? incoming : current;
};

const mergePartialThreadBundle = (current: unknown, incoming: unknown): unknown => {
  if (!isRecord(current)) return canonicalizeAggregation(incoming);
  if (!isRecord(incoming)) return canonicalizeAggregation(current);

  const currentLatest = isRecord(current.latest_event) ? current.latest_event : undefined;
  const incomingLatest = isRecord(incoming.latest_event) ? incoming.latest_event : undefined;
  const latestEvent = pickFresherRawObservation(currentLatest, incomingLatest);
  const canonicalCurrent = canonicalizeAggregation(current) as Record<string, unknown>;
  const canonicalIncoming = canonicalizeAggregation(incoming) as Record<string, unknown>;
  const merged: Record<string, unknown> = {
    ...canonicalIncoming,
    ...canonicalCurrent,
  };

  const currentCount = getFiniteCount(current.count);
  const incomingCount = getFiniteCount(incoming.count);
  if (currentCount !== undefined || incomingCount !== undefined) {
    merged.count = Math.max(currentCount ?? 0, incomingCount ?? 0);
  }

  if (current.current_user_participated === true || incoming.current_user_participated === true) {
    merged.current_user_participated = true;
  } else if (
    current.current_user_participated === false ||
    incoming.current_user_participated === false
  ) {
    merged.current_user_participated = false;
  }

  if (latestEvent) merged.latest_event = canonicalizeAggregation(latestEvent);
  else delete merged.latest_event;
  return canonicalizeAggregation(merged);
};

const getAnnotationBucketId = (bucket: Record<string, unknown>): string => {
  const type = typeof bucket.type === 'string' ? bucket.type : '';
  const key = typeof bucket.key === 'string' ? bucket.key : '';
  return type || key ? `${type}\u0000${key}` : stableSerialize(bucket);
};

const mergeAnnotationBucket = (
  current: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> => {
  const currentCount = getFiniteCount(current.count);
  const incomingCount = getFiniteCount(incoming.count);
  const merged = { ...incoming, ...current };
  if (currentCount !== undefined || incomingCount !== undefined) {
    merged.count = Math.max(currentCount ?? 0, incomingCount ?? 0);
  }
  if (current.me === true || incoming.me === true) merged.me = true;
  return merged;
};

const mergePartialAnnotationBundle = (current: unknown, incoming: unknown): unknown => {
  if (!isRecord(current)) return canonicalizeRelationBundle(RelationType.Annotation, incoming);
  if (!isRecord(incoming)) return canonicalizeRelationBundle(RelationType.Annotation, current);

  const currentChunk = Array.isArray(current.chunk) ? current.chunk.filter(isRecord) : [];
  const incomingChunk = Array.isArray(incoming.chunk) ? incoming.chunk.filter(isRecord) : [];
  const merged: Record<string, unknown> = { ...incoming, ...current };
  const buckets = new Map<string, Record<string, unknown>>();
  [...currentChunk, ...incomingChunk].forEach((bucket) => {
    const canonicalBucket = canonicalizeAggregation(bucket) as Record<string, unknown>;
    const bucketId = getAnnotationBucketId(canonicalBucket);
    const existing = buckets.get(bucketId);
    buckets.set(
      bucketId,
      existing ? mergeAnnotationBucket(existing, canonicalBucket) : canonicalBucket
    );
  });
  merged.chunk = [...buckets.values()].sort((left, right) =>
    stableSerialize(left).localeCompare(stableSerialize(right))
  );
  return canonicalizeRelationBundle(RelationType.Annotation, merged);
};

const mergeNonReplacementRelations = (
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  mode: RelationSnapshotMode = 'partial'
): Record<string, unknown> => {
  const canonicalIncoming = canonicalizeRelations(incoming);
  if (mode === 'authoritative') return canonicalIncoming;
  // Partial SDK serializations may omit unrelated bundles, so absence never
  // deletes a relation type. Known aggregate bundles merge monotonically:
  // counts can advance and latest_event can move forward, while a stale
  // partial observation cannot lower already-seen evidence.
  const merged = canonicalizeRelations(current);
  Object.entries(canonicalIncoming).forEach(([relationType, incomingBundle]) => {
    const currentBundle = merged[relationType];
    if (currentBundle === undefined) {
      merged[relationType] = incomingBundle;
    } else if (relationType === RelationType.Thread) {
      merged[relationType] = mergePartialThreadBundle(currentBundle, incomingBundle);
    } else if (relationType === RelationType.Annotation) {
      merged[relationType] = mergePartialAnnotationBundle(currentBundle, incomingBundle);
    }
  });
  return canonicalizeRelations(merged);
};

const withMergedRelations = (
  base: Partial<IEvent>,
  current: Partial<IEvent>,
  incoming: Partial<IEvent>,
  replacement: Partial<IEvent> | undefined,
  mode: RelationSnapshotMode
): Partial<IEvent> => {
  const unsigned = { ...current.unsigned, ...incoming.unsigned };
  delete unsigned['m.relations'];
  const relations = mergeNonReplacementRelations(
    getNonReplacementRelations(current),
    getNonReplacementRelations(incoming),
    mode
  );
  if (replacement) relations[RelationType.Replace] = replacement;
  if (Object.keys(relations).length > 0) unsigned['m.relations'] = relations;
  if (Object.keys(unsigned).length === 0) {
    const withoutUnsigned = { ...base };
    delete withoutUnsigned.unsigned;
    return withoutUnsigned;
  }
  return { ...base, unsigned };
};

const mergeRedactedRawEvent = (
  redactedBase: Partial<IEvent>,
  current: Partial<IEvent>,
  incoming: Partial<IEvent>,
  mode: RelationSnapshotMode
): Partial<IEvent> => {
  const base = withoutRawReplacement(redactedBase);
  const relations = mergeNonReplacementRelations(
    getNonReplacementRelations(current),
    getNonReplacementRelations(incoming),
    mode
  );
  const unsigned = { ...base.unsigned };
  delete unsigned['m.relations'];
  if (Object.keys(relations).length === 0) return { ...base, unsigned };

  return {
    ...base,
    unsigned: {
      ...unsigned,
      'm.relations': relations,
    },
  };
};

const getReplacementRevision = (
  targetSender: string | undefined,
  replacement: Partial<IEvent> | undefined
): ReplacementRevision | undefined => {
  if (!replacement || replacement.sender !== targetSender) return undefined;
  const eventId = replacement.event_id;
  const ts = replacement.origin_server_ts;
  if (
    typeof eventId !== 'string' ||
    eventId.length === 0 ||
    typeof ts !== 'number' ||
    !Number.isFinite(ts)
  ) {
    return undefined;
  }
  return { eventId, ts };
};

const compareReplacementRevision = (
  candidate: ReplacementRevision | undefined,
  current: ReplacementRevision | undefined
): number => {
  if (!candidate) return current ? -1 : 0;
  if (!current) return 1;
  if (candidate.ts !== current.ts) return candidate.ts > current.ts ? 1 : -1;
  if (candidate.eventId === current.eventId) return 0;
  return candidate.eventId > current.eventId ? 1 : -1;
};

export const describeRawEventRevision = (rawEvent: Partial<IEvent>): EventRevisionDescriptor => ({
  redacted: !!rawEvent.unsigned?.redacted_because,
  replacement: getReplacementRevision(rawEvent.sender, getRawReplacement(rawEvent)),
  aggregations: canonicalizeRelations(getNonReplacementRelations(rawEvent)),
});

export const describeMatrixEventRevision = (event: MatrixEvent): EventRevisionDescriptor => {
  const replacement = getLatestEdit(
    event,
    [event.replacingEvent() ?? undefined, getSerializedReplacementEvent(event)].filter(
      (candidate): candidate is MatrixEvent => isSameSenderEditEvent(event, candidate)
    )
  );

  return {
    redacted: event.isRedacted(),
    replacement: replacement
      ? getReplacementRevision(event.getSender(), replacement.event as Partial<IEvent>)
      : undefined,
    aggregations: canonicalizeRelations(getNonReplacementRelations(event.event as Partial<IEvent>)),
  };
};

export const mergeEventRevisionDescriptors = (
  current: EventRevisionDescriptor,
  incoming: EventRevisionDescriptor
): EventRevisionDescriptor => ({
  redacted: current.redacted || incoming.redacted,
  replacement:
    current.redacted || incoming.redacted
      ? undefined
      : compareReplacementRevision(incoming.replacement, current.replacement) > 0
      ? incoming.replacement
      : current.replacement,
  aggregations: mergeNonReplacementRelations(current.aggregations, incoming.aggregations),
});

export const hasEventRevisionUpgrade = (
  candidate: EventRevisionDescriptor,
  current: EventRevisionDescriptor,
  relationSnapshotMode: RelationSnapshotMode = 'partial'
): boolean => {
  const redactionUpgrade = candidate.redacted && !current.redacted;
  const replacementUpgrade =
    !current.redacted &&
    !candidate.redacted &&
    compareReplacementRevision(candidate.replacement, current.replacement) > 0;
  const mergedAggregations = mergeNonReplacementRelations(
    current.aggregations,
    candidate.aggregations,
    relationSnapshotMode
  );
  return (
    redactionUpgrade ||
    replacementUpgrade ||
    stableSerialize(mergedAggregations) !== stableSerialize(current.aggregations)
  );
};

/**
 * True when a same-sender `edit` adds nothing to a target with revision
 * `target`: the target is redacted, or already carries this edit or a newer one.
 */
export const isEditKnownToRevision = (
  edit: Partial<IEvent>,
  targetSender: string | undefined,
  target: EventRevisionDescriptor
): boolean => {
  const replacement = getReplacementRevision(targetSender, edit);
  if (!replacement) return false;
  return target.redacted || compareReplacementRevision(replacement, target.replacement) <= 0;
};

/**
 * Compare two observations of one logical event. Redaction is monotonic;
 * otherwise the newest valid same-sender replacement wins by Matrix's
 * timestamp/event-id ordering.
 */
export const compareEventRevisions = (
  candidate: EventRevisionDescriptor,
  current: EventRevisionDescriptor
): number => {
  if (candidate.redacted !== current.redacted) return candidate.redacted ? 1 : -1;
  if (candidate.redacted) return 0;
  return compareReplacementRevision(candidate.replacement, current.replacement);
};

/**
 * Merge two serialized observations of one event without discarding newer
 * unrelated unsigned data. Redaction is monotonic; otherwise only an older
 * bundled replacement is carried forward into the incoming observation.
 */
export const mergeRawEventRevisions = (
  current: Partial<IEvent> | undefined,
  incoming: Partial<IEvent>,
  relationSnapshotMode: RelationSnapshotMode = 'partial'
): Partial<IEvent> => {
  if (!current || current.event_id !== incoming.event_id) {
    return describeRawEventRevision(incoming).redacted ? withoutRawReplacement(incoming) : incoming;
  }

  const currentRevision = describeRawEventRevision(current);
  const incomingRevision = describeRawEventRevision(incoming);
  if (currentRevision.redacted) {
    return mergeRedactedRawEvent(current, current, incoming, relationSnapshotMode);
  }
  if (incomingRevision.redacted) {
    return mergeRedactedRawEvent(incoming, current, incoming, relationSnapshotMode);
  }
  const currentReplacement = getRawReplacement(current);
  const incomingReplacement = getRawReplacement(incoming);
  const replacement =
    compareReplacementRevision(incomingRevision.replacement, currentRevision.replacement) >= 0
      ? incomingRevision.replacement
        ? incomingReplacement
        : undefined
      : currentRevision.replacement
      ? currentReplacement
      : undefined;
  return withMergedRelations(incoming, current, incoming, replacement, relationSnapshotMode);
};

/**
 * Map a raw event without ever triggering the SDK mapper's reuse branch:
 * that branch permanently sets the mapper instance's `preventReEmit` flag,
 * which would strip Decrypted/Replaced/BeforeRedaction re-emitters from
 * every FRESH event the same mapper maps afterwards in the pass. Settled
 * in-room instances are reused directly; only genuinely fresh raws go
 * through the mapper (keeping its re-emitter registration).
 */
export const mapEventDetached = (
  room: Room,
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent,
  raw: Partial<IEvent>
): MatrixEvent => {
  const existing = typeof raw.event_id === 'string' ? room.findEventById(raw.event_id) : undefined;
  return existing && !existing.status ? existing : mapEvent(raw);
};

/** Merge a cached/fetched observation into the SDK-owned same-id instance. */
export const mergeSameIdEventRevision = ({
  liveEvent,
  rawEvent,
  mapEvent,
  room,
}: {
  liveEvent: MatrixEvent;
  rawEvent: Partial<IEvent>;
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
  room: Room;
}): MatrixEvent => {
  const mapDetached = (raw: Partial<IEvent>): MatrixEvent => mapEventDetached(room, mapEvent, raw);

  const rawRedactedBecause = rawEvent.unsigned?.redacted_because;
  if (rawRedactedBecause && !liveEvent.isRedacted()) {
    liveEvent.makeRedacted(mapDetached(rawRedactedBecause as Partial<IEvent>), room);
  }

  if (liveEvent.isRedacted()) return liveEvent;

  // Snapshot all replacement candidates before mutating the live event, so a
  // stale bundled edit can never transiently downgrade a newer streamed edit.
  const incomingEvent = new MatrixEvent(rawEvent as IEvent);
  const incomingReplacement = getSerializedReplacementEvent(incomingEvent);
  const currentReplacement = liveEvent.replacingEvent() ?? undefined;
  const serializedLiveReplacement = getSerializedReplacementEvent(liveEvent);
  const isKnownRedactedEvent = createIsKnownRedacted(room, new Set<string>());
  const isKnownRedacted = (replacement: MatrixEvent | undefined): boolean =>
    !!replacement && isKnownRedactedEvent(replacement);
  const candidates = [currentReplacement, serializedLiveReplacement, incomingReplacement];
  const redactedReplacementIds = new Set(
    candidates
      .filter(isKnownRedacted)
      .map((candidate) => candidate?.getId())
      .filter((eventId): eventId is string => !!eventId)
  );
  const validCandidates = candidates.filter((candidate): candidate is MatrixEvent => {
    const eventId = candidate?.getId();
    return (
      isSameSenderEditEvent(liveEvent, candidate) &&
      typeof eventId === 'string' &&
      !redactedReplacementIds.has(eventId)
    );
  });
  const latestReplacement = getLatestEdit(liveEvent, validCandidates);

  // Merge the incoming unsigned onto the live event directly (the same
  // shallow merge the SDK mapper's reuse branch performs), with both sides'
  // `m.replace` bundles stripped first so nothing can eagerly apply the old
  // bundle. The winning replacement is applied explicitly below.
  const rawLiveEvent = liveEvent.event as Partial<IEvent>;
  const mergedRawEvent = withMergedRelations(
    rawEvent,
    rawLiveEvent,
    rawEvent,
    undefined,
    'partial'
  );
  const liveWithoutReplacement = withoutRawReplacement(rawLiveEvent);
  if (liveWithoutReplacement !== rawLiveEvent) {
    liveEvent.setUnsigned(liveWithoutReplacement.unsigned ?? {});
  }
  liveEvent.setUnsigned({ ...liveEvent.getUnsigned(), ...(mergedRawEvent.unsigned ?? {}) });

  let resolvedReplacement = latestReplacement;
  if (latestReplacement && latestReplacement !== currentReplacement) {
    const mappedReplacement = mapDetached(latestReplacement.event as Partial<IEvent>);
    resolvedReplacement =
      isSameSenderEditEvent(liveEvent, mappedReplacement) && !isKnownRedacted(mappedReplacement)
        ? mappedReplacement
        : undefined;
  }
  if ((liveEvent.replacingEvent() ?? undefined) !== resolvedReplacement) {
    liveEvent.makeReplaced(resolvedReplacement);
  }

  const liveWithReplacement = withRawReplacement(
    liveEvent.event as Partial<IEvent>,
    resolvedReplacement
  );
  if (liveWithReplacement !== liveEvent.event) {
    liveEvent.setUnsigned(liveWithReplacement.unsigned ?? {});
  }
  return liveEvent;
};
