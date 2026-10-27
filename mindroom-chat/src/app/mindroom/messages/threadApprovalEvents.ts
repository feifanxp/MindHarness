import { MatrixEvent, Room } from 'matrix-js-sdk';
import { applyCachedRedactions, hydrateCachedEvents } from '../threads/eventCacheEditUtils';
import { mergeSameIdEventRevision, withoutRawReplacement } from '../threads/eventRevision';
import { getSerializedReplacementEvent } from '../../utils/editEvent';
import { isUndecryptedApprovalCandidate, MINDROOM_TOOL_APPROVAL_EVENT } from './toolApproval';

export type ThreadApprovalEvents = {
  events: ReadonlyMap<string, MatrixEvent>;
  // Redactions can precede their targets; only known thread identities may be cached.
  scopedEventIds: ReadonlySet<string>;
};

/** Unpack SDK and cached bundles once; all replacement evidence follows the same path. */
const withAttachedReplacements = (
  incoming: readonly MatrixEvent[],
  retained: ThreadApprovalEvents
): MatrixEvent[] =>
  incoming.flatMap((event) => {
    const id = event.getId();
    // Ordinary chat edits cannot decide approvals. Keep the original observation
    // for tombstones, and keep former ciphertext candidates on the full path.
    if (
      event.getType() === 'm.room.message' &&
      !isUndecryptedApprovalCandidate(event) &&
      !(id && (retained.events.has(id) || retained.scopedEventIds.has(id)))
    )
      return [event];
    const attached = [event.replacingEvent(), getSerializedReplacementEvent(event)].filter(
      (replacement): replacement is MatrixEvent =>
        !!replacement &&
        replacement.getRelation()?.rel_type === 'm.replace' &&
        replacement.getRelation()?.event_id === event.getId()
    );
    return [
      event,
      ...attached.map((replacement) =>
        replacement.getRoomId()
          ? replacement
          : new MatrixEvent({ ...replacement.event, room_id: event.getRoomId() })
      ),
    ];
  });

const removeUnreadableReplacement = (event: MatrixEvent): void => {
  const bundled = getSerializedReplacementEvent(event);
  if (bundled && isUndecryptedApprovalCandidate(bundled))
    event.setUnsigned(withoutRawReplacement(event.event).unsigned ?? {});
  const attached = event.replacingEvent();
  if (attached && isUndecryptedApprovalCandidate(attached)) event.makeReplaced();
};

/** Apply retained evidence to the exact objects currently rendered by cache-first timelines. */
export const hydrateThreadApprovalEvents = (
  room: Room,
  retained: ThreadApprovalEvents,
  rendered: readonly MatrixEvent[]
): MatrixEvent[] => {
  const canonical = new Map(
    [...retained.events].filter(
      ([id, event]) =>
        retained.scopedEventIds.has(id) ||
        (event.isRedaction() &&
          !!event.getAssociatedId() &&
          retained.scopedEventIds.has(event.getAssociatedId()!))
    )
  );
  // Tombstones must reach retained evidence before choosing between readable
  // evidence and a same-ID ciphertext copy currently rendered by the timeline.
  applyCachedRedactions(room, [...canonical.values()]);
  // Ciphertext stays in retained evidence for keys; generic cache hydration must
  // only see readable replacements, including those bundled in unsigned data.
  canonical.forEach(removeUnreadableReplacement);
  rendered.forEach((target) => {
    const id = target.getId();
    const evidence = id ? canonical.get(id) : undefined;
    if (!id || !evidence || target === evidence) return;
    removeUnreadableReplacement(target);
    // Keep a decrypted original authoritative while a cached copy still awaits keys.
    if (
      !evidence.isRedacted() &&
      isUndecryptedApprovalCandidate(target) &&
      !isUndecryptedApprovalCandidate(evidence)
    )
      return;
    mergeSameIdEventRevision({
      room,
      liveEvent: target,
      rawEvent: evidence.event,
      mapEvent: (raw) => new MatrixEvent(raw),
    });
    canonical.set(id, target);
  });
  // Unreadable relations remain retained for late keys, but cannot replace a
  // reviewed original or be bundled as a decision by cache serialization.
  const events = [...canonical.values()].filter((event) => !isUndecryptedApprovalCandidate(event));
  hydrateCachedEvents({ room, events });
  return events;
};

export const mergeThreadApprovalEvents = (
  old: ThreadApprovalEvents,
  incoming: readonly MatrixEvent[],
  roomId: string,
  threadId: string,
  fromBackfill = false
): ThreadApprovalEvents => {
  const observations = withAttachedReplacements(incoming, old);
  let changed = false;
  const next = new Map(old.events);
  const scopedIds = new Set(old.scopedEventIds);
  const scopedOriginal = (event: MatrixEvent) =>
    event.getRelation()?.rel_type !== 'm.replace' &&
    ((event.getType() === MINDROOM_TOOL_APPROVAL_EVENT &&
      event.getOriginalContent().thread_id === threadId) ||
      (isUndecryptedApprovalCandidate(event) &&
        (event.getRelation()?.rel_type === 'm.thread'
          ? event.getRelation()?.event_id === threadId
          : fromBackfill)));
  // Origins may follow their edits in a cached batch. Establish their scope first.
  observations.forEach((event) => {
    const id = event.getId();
    if (id && event.getRoomId() === roomId && scopedOriginal(event)) scopedIds.add(id);
  });
  observations.forEach((event) => {
    const id = event.getId();
    const relation = event.getRelation();
    if (
      id &&
      event.getRoomId() === roomId &&
      relation?.rel_type === 'm.replace' &&
      relation.event_id &&
      scopedIds.has(relation.event_id)
    )
      scopedIds.add(id);
  });
  observations.forEach((event) => {
    const id = event.getId();
    if (!id || event.getRoomId() !== roomId) return;
    const existing = next.get(id);
    if (existing?.isRedacted() && !event.isRedacted()) return;
    const relation = event.getRelation();
    const scopedEdit =
      relation?.rel_type === 'm.replace' && !!relation.event_id && scopedIds.has(relation.event_id);
    const relevant =
      event.isRedacted() ||
      scopedOriginal(event) ||
      (scopedEdit &&
        (event.getType() === MINDROOM_TOOL_APPROVAL_EVENT ||
          isUndecryptedApprovalCandidate(event))) ||
      event.isRedaction();
    if (!relevant) {
      changed = next.delete(id) || changed;
      return;
    }
    changed = true;
    // Keep SDK objects with newer replacements, and never resurrect a redaction.
    if (
      !existing ||
      event.isRedacted() ||
      (isUndecryptedApprovalCandidate(existing) && !isUndecryptedApprovalCandidate(event))
    ) {
      next.set(id, event);
    }
  });
  return changed || scopedIds.size !== old.scopedEventIds.size
    ? { events: next, scopedEventIds: scopedIds }
    : old;
};
