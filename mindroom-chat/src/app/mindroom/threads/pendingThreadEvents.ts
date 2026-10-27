import { type MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import { isFailedLocalEchoEvent, isPendingLocalEchoEvent } from '../messages/pendingLocalEcho';

// Chronological SDK rooms keep unsent thread replies outside their timelines.
// Retain the original SDK objects so status changes, retry, and cancellation
// keep working after the thread view unmounts.
const pendingByRoom = new WeakMap<Room, Set<MatrixEvent>>();

export const trackPendingThreadEvent = (event: MatrixEvent, room: Room): void => {
  const pending = pendingByRoom.get(room);
  if (!isPendingLocalEchoEvent(event) && !isFailedLocalEchoEvent(event)) {
    pending?.delete(event);
    return;
  }
  if (event.getRelation()?.rel_type !== RelationType.Thread) return;
  if (pending) pending.add(event);
  else pendingByRoom.set(room, new Set([event]));
};

export const getPendingThreadEvents = (room: Room, threadId: string): MatrixEvent[] =>
  Array.from(pendingByRoom.get(room) ?? []).filter(
    (event) =>
      (isPendingLocalEchoEvent(event) || isFailedLocalEchoEvent(event)) &&
      event.getRelation()?.event_id === threadId
  );
