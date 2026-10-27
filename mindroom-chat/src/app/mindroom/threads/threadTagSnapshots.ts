import { EventTimeline, type Room, type RoomState } from 'matrix-js-sdk';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import {
  aggregateThreadTagEvents,
  getDisplayTags,
  isThreadResolved,
  MINDROOM_THREAD_TAGS_EVENT,
  type ThreadTagsContent,
} from './threadTags';

export type ThreadTagSnapshot = {
  content: ThreadTagsContent;
  isResolved: boolean;
  displayTags: string[];
};

export const buildThreadTagSnapshot = (content: ThreadTagsContent): ThreadTagSnapshot => ({
  content,
  isResolved: isThreadResolved(content),
  displayTags: getDisplayTags(content),
});

export const buildThreadTagSnapshotMap = (
  events: MatrixEvent[]
): Map<string, ThreadTagSnapshot> => {
  const snapshots = new Map<string, ThreadTagSnapshot>();

  aggregateThreadTagEvents(events).forEach((content, threadRootId) => {
    snapshots.set(threadRootId, buildThreadTagSnapshot(content));
  });

  return snapshots;
};

// RoomState.getStateEvents() returns a new array per call, so the aggregation's
// array-identity cache never hits here. Each room state keeps its last snapshot
// map instead, reused while the same events and content objects come back. A
// redacted event always reads as empty content (a pending local redaction as a
// fresh `{}` per read), so it is compared by its redaction flag.
type RoomTagSnapshotSlot = {
  events: MatrixEvent[];
  contents: unknown[];
  snapshots: ReadonlyMap<string, ThreadTagSnapshot>;
};
const roomTagSnapshotSlots = new WeakMap<RoomState, RoomTagSnapshotSlot>();
const EMPTY_TAG_SNAPSHOTS: ReadonlyMap<string, ThreadTagSnapshot> = new Map();

const getTagEventContentKey = (event: MatrixEvent): unknown =>
  event.isRedacted() ? null : event.getContent();

const slotMatches = (slot: RoomTagSnapshotSlot, events: MatrixEvent[]): boolean =>
  slot.events.length === events.length &&
  events.every(
    (event, index) =>
      slot.events[index] === event && slot.contents[index] === getTagEventContentKey(event)
  );

/** Shared across calls while the room's tag state is unchanged; callers must not mutate it. */
export const getRoomThreadTagSnapshotMap = (room: Room): ReadonlyMap<string, ThreadTagSnapshot> => {
  const roomState = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
  const stateEvents = roomState?.getStateEvents(MINDROOM_THREAD_TAGS_EVENT);
  if (!roomState || !Array.isArray(stateEvents) || stateEvents.length === 0) {
    return EMPTY_TAG_SNAPSHOTS;
  }

  const slot = roomTagSnapshotSlots.get(roomState);
  if (slot && slotMatches(slot, stateEvents)) return slot.snapshots;

  const snapshots = buildThreadTagSnapshotMap(stateEvents);
  roomTagSnapshotSlots.set(roomState, {
    events: stateEvents,
    contents: stateEvents.map(getTagEventContentKey),
    snapshots,
  });
  return snapshots;
};
