import type { IEvent } from 'matrix-js-sdk';
import {
  getThreadSummaryEventInfo,
  hasMindroomThreadSummary,
  type MindroomThreadSummaryInfo,
} from '../../messages/threadSummary';
import { compareCachedPaginationAnchors } from '../eventCacheTokenUtils';

// CINNY-207 P2.1: pure helpers, moved verbatim from `roomEventCache.ts`
// and `threadEventCache.ts`. The two normalizers are intentionally kept
// separate — the thread version has txn-id dedup and local-echo
// preference logic that the room version does not, and unifying them
// would be a behavior change out of scope for this step (see plan §5
// P2.1: pure port).

export type CachedRoomEvent = Partial<IEvent> & {
  event_id: string;
  origin_server_ts: number;
};

export type CachedThreadEvent = Partial<IEvent> & {
  event_id: string;
  origin_server_ts: number;
};

export type CursorAnchor = {
  eventId: string;
  ts: number;
};

const getEventTs = (rawEvent: Partial<IEvent>): number =>
  typeof rawEvent.origin_server_ts === 'number' && Number.isFinite(rawEvent.origin_server_ts)
    ? rawEvent.origin_server_ts
    : 0;

const isRawLocalEchoEventId = (eventId: unknown): boolean =>
  typeof eventId === 'string' && eventId.startsWith('~');

const isRawLocalEchoEvent = (rawEvent: Partial<IEvent>): boolean =>
  isRawLocalEchoEventId(rawEvent.event_id);

const toCachedRoomEvent = (rawEvent: Partial<IEvent>): CachedRoomEvent | undefined => {
  if (typeof rawEvent.event_id !== 'string' || rawEvent.event_id.length === 0) return undefined;
  return {
    ...rawEvent,
    event_id: rawEvent.event_id,
    origin_server_ts: getEventTs(rawEvent),
  };
};

const toCachedThreadEvent = (rawEvent: Partial<IEvent>): CachedThreadEvent | undefined => {
  if (typeof rawEvent.event_id !== 'string' || rawEvent.event_id.length === 0) return undefined;
  return {
    ...rawEvent,
    event_id: rawEvent.event_id,
    origin_server_ts: getEventTs(rawEvent),
  };
};

const sortRoomEvents = (a: CachedRoomEvent, b: CachedRoomEvent): number =>
  compareCachedPaginationAnchors(getRoomCursorAnchor(a), getRoomCursorAnchor(b));

const sortThreadEvents = (a: CachedThreadEvent, b: CachedThreadEvent): number => {
  const tsDiff = a.origin_server_ts - b.origin_server_ts;
  if (tsDiff !== 0) return tsDiff;
  return a.event_id.localeCompare(b.event_id);
};

export const normalizeCachedRoomEvents = (rawEvents: Partial<IEvent>[]): CachedRoomEvent[] => {
  const eventMap = new Map<string, CachedRoomEvent>();

  rawEvents.forEach((rawEvent) => {
    const normalized = toCachedRoomEvent(rawEvent);
    if (!normalized) return;
    if (isRawLocalEchoEvent(normalized)) return;
    eventMap.set(normalized.event_id, normalized);
  });

  return Array.from(eventMap.values()).sort(sortRoomEvents);
};

export const getRoomCursorAnchor = (
  rawEvent: Partial<IEvent> | CachedRoomEvent | undefined
): CursorAnchor | undefined => {
  if (!rawEvent || typeof rawEvent.event_id !== 'string' || rawEvent.event_id.length === 0) {
    return undefined;
  }
  return {
    eventId: rawEvent.event_id,
    ts: getEventTs(rawEvent),
  };
};

// --- Thread-side helpers (transaction-id dedup + local-echo preference) ---

const getRawTransactionId = (rawEvent: Partial<IEvent>): string | undefined => {
  const txnId =
    typeof rawEvent.txn_id === 'string' && rawEvent.txn_id.length > 0
      ? rawEvent.txn_id
      : typeof rawEvent.unsigned?.transaction_id === 'string' &&
        rawEvent.unsigned.transaction_id.length > 0
      ? rawEvent.unsigned.transaction_id
      : undefined;

  return txnId;
};

const getRawEventKeys = (rawEvent: Partial<IEvent>): string[] => {
  const keys: string[] = [];

  if (typeof rawEvent.event_id === 'string' && rawEvent.event_id.length > 0) {
    keys.push(`event:${rawEvent.event_id}`);
  }
  const txnId = getRawTransactionId(rawEvent);
  if (txnId) {
    keys.push(`txn:${txnId}`);
  }
  return keys;
};

const pickPreferredCachedThreadEvent = (
  existingEvent: CachedThreadEvent,
  incomingEvent: CachedThreadEvent
): CachedThreadEvent => {
  const existingLocalEcho = isRawLocalEchoEvent(existingEvent);
  const incomingLocalEcho = isRawLocalEchoEvent(incomingEvent);
  if (existingLocalEcho !== incomingLocalEcho) {
    return existingLocalEcho ? incomingEvent : existingEvent;
  }
  return incomingEvent;
};

export const filterPageableCachedThreadEvents = (
  rawEvents: CachedThreadEvent[],
  threadId: string
): CachedThreadEvent[] => rawEvents.filter((rawEvent) => rawEvent.event_id !== threadId);

export const normalizeCachedThreadEvents = (
  rawEvents: Partial<IEvent>[],
  rootEvent?: Partial<IEvent>
): CachedThreadEvent[] => {
  const eventMap = new Map<string, CachedThreadEvent>();

  const setEventForKeys = (keys: string[], mEvent: CachedThreadEvent) => {
    keys.forEach((key) => {
      eventMap.set(key, mEvent);
    });
  };

  const findExistingEvent = (keys: string[]): CachedThreadEvent | undefined =>
    keys.map((key) => eventMap.get(key)).find((mEvent): mEvent is CachedThreadEvent => !!mEvent);

  rawEvents.forEach((rawEvent) => {
    const normalized = toCachedThreadEvent(rawEvent);
    if (!normalized) return;
    if (isRawLocalEchoEvent(normalized)) return;
    const incomingKeys = getRawEventKeys(normalized);
    if (incomingKeys.length === 0) return;
    const existingEvent = findExistingEvent(incomingKeys);
    if (!existingEvent) {
      setEventForKeys(incomingKeys, normalized);
      return;
    }
    const preferredEvent = pickPreferredCachedThreadEvent(existingEvent, normalized);
    const mergedKeys = Array.from(new Set([...getRawEventKeys(existingEvent), ...incomingKeys]));
    setEventForKeys(mergedKeys, preferredEvent);
  });

  const normalizedRoot = rootEvent ? toCachedThreadEvent(rootEvent) : undefined;
  if (normalizedRoot && !isRawLocalEchoEvent(normalizedRoot)) {
    const rootKeys = getRawEventKeys(normalizedRoot);
    if (rootKeys.length > 0 && !findExistingEvent(rootKeys)) {
      setEventForKeys(rootKeys, normalizedRoot);
    }
  }

  return Array.from(new Set(eventMap.values())).sort(sortThreadEvents);
};

export const getThreadCursorAnchor = (
  rawEvent: Partial<IEvent> | CachedThreadEvent | undefined
): CursorAnchor | undefined => {
  if (!rawEvent || typeof rawEvent.event_id !== 'string' || rawEvent.event_id.length === 0) {
    return undefined;
  }
  return {
    eventId: rawEvent.event_id,
    ts: getEventTs(rawEvent),
  };
};

/**
 * `undefined` on the next value keeps the current value (retain semantics);
 * `true` and `false` are explicit sets. Used for meta flags that some save
 * call sites don't touch (`snapshotComplete`, `tailLoaded`, etc.).
 *
 * The engine's write-through passes `tailLoaded: undefined` for redaction
 * persists (see engineWriteThrough.ts header); the helper must not
 * downgrade a stored `true` or `false` to `undefined` when the next value
 * is `undefined`. Only an explicit next value replaces the current value.
 */
export const mergeThreadCacheFlag = (
  currentValue: boolean | undefined,
  nextValue: boolean | undefined
): boolean | undefined => (nextValue === undefined ? currentValue : nextValue);

export const normalizeExpectedReplyCount = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * PR #84 review deferral (finding #3): merge policy for
 * `meta.expectedReplyCount`. Background sweep chunks derive the count
 * from the live root's bundled `m.thread.count`, which the SDK never
 * updates as replies arrive and which is stale when the root was
 * restored from the SDK store — an unconditional overwrite let a
 * stale-LOW value replace a fresher count and weaken the reply-count
 * completeness proof the eager-cache open path leans on.
 *
 *   - `snapshotComplete === true` writes that CARRY a count set it
 *     absolutely — the only writers allowed to LOWER the stored value,
 *     because redactions legitimately shrink threads and the drain
 *     observed the real reply set. A count-LESS complete write (e.g.
 *     `refreshLatestThreadSlice`'s persist, which omits
 *     expectedReplyCount) RETAINS the stored value — there is no
 *     incoming observation to prefer.
 *   - All other writes merge monotonically (max of stored/incoming):
 *     a stale-low sweep value can never weaken the proof, while a
 *     fresher higher count still strengthens it.
 */
export const mergeThreadExpectedReplyCount = (
  currentValue: number | undefined,
  nextValue: number | undefined,
  snapshotComplete: boolean | undefined
): number | undefined => {
  if (nextValue === undefined) return currentValue;
  if (snapshotComplete === true) return nextValue;
  return currentValue === undefined ? nextValue : Math.max(currentValue, nextValue);
};

// --- Thread summary helpers ---

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const getCachedThreadSummaryInfoFromRawEvent = (
  rawEvent: Partial<IEvent>
): MindroomThreadSummaryInfo | undefined => {
  const content = rawEvent.content;
  if (!isRecord(content) || !hasMindroomThreadSummary(content)) return undefined;

  return getThreadSummaryEventInfo({
    getContent: () => content,
    getTs: () => rawEvent.origin_server_ts,
    replacingEventDate: () => {
      const timestamp = rawEvent.unsigned?.['m.relations']?.['m.replace']?.origin_server_ts;
      return typeof timestamp === 'number' ? new Date(timestamp) : undefined;
    },
  });
};

export const isRawLocalEchoEventPublic = isRawLocalEchoEvent;
