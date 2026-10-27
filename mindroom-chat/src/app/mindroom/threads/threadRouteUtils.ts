import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { buildResolveConfirmedEventId } from './threadRenderUtils';

export const isLocalEchoEventId = (eventId: string | undefined): boolean =>
  typeof eventId === 'string' && eventId.startsWith('~');

export const isConfirmedMatrixEventId = (eventId: unknown): eventId is string =>
  typeof eventId === 'string' && eventId.startsWith('$');

/** Check availability without selecting between loaded event copies. */
export const isThreadRouteReady = (
  room: Pick<Room, 'getThread' | 'findEventById'>,
  threadId: string | undefined
): boolean => !threadId || !!room.getThread(threadId)?.rootEvent || !!room.findEventById(threadId);

const getEventTxnId = (
  event: Pick<MatrixEvent, 'getTxnId' | 'getUnsigned'>
): string | undefined => {
  const txnId = event.getTxnId?.() ?? event.getUnsigned()?.transaction_id;
  return typeof txnId === 'string' && txnId.length > 0 ? txnId : undefined;
};

const getTxnIdFromLocalEchoEventId = (
  room: Pick<Room, 'roomId'>,
  eventId: string | undefined
): string | undefined => {
  if (!isLocalEchoEventId(eventId)) return undefined;

  const prefix = `~${room.roomId}:`;
  if (!eventId?.startsWith(prefix)) return undefined;

  const txnId = eventId.slice(prefix.length);
  return txnId.length > 0 ? txnId : undefined;
};

const resolveConfirmedEventIdByTxnId = (room: Room, txnId: string): string | undefined => {
  const txnEvent = room.getEventForTxnId?.(txnId);
  const txnEventId = txnEvent?.getId();
  if (txnEventId && !isLocalEchoEventId(txnEventId)) {
    return txnEventId;
  }

  const resolveConfirmedId = buildResolveConfirmedEventId(room, room.getLiveTimeline().getEvents());
  return resolveConfirmedId(txnId);
};

export const isPendingLocalEchoThreadRootEvent = (
  event:
    | (Pick<MatrixEvent, 'getId' | 'isSending'> & {
        threadRootId?: string;
      })
    | undefined
): boolean => {
  if (!event) return false;
  const eventId = event?.getId();
  if (!eventId) return false;
  if (event.threadRootId && event.threadRootId !== eventId) return false;

  return isLocalEchoEventId(eventId) || event.isSending?.() === true;
};

export const getEffectiveThreadRootActivityTs = (
  event:
    | (Pick<MatrixEvent, 'getId' | 'getTs' | 'isSending'> & {
        threadRootId?: string;
      })
    | undefined,
  now = Date.now()
): number => {
  if (!event) return 0;

  const ts = event.getTs?.() ?? 0;
  if (isPendingLocalEchoThreadRootEvent(event)) {
    return ts > 0 ? ts : now;
  }

  return ts;
};

const resolveConfirmedEventId = (
  room: Room,
  event: Pick<MatrixEvent, 'getId' | 'getTxnId' | 'getUnsigned' | 'isSending'>
): string | undefined => {
  const eventId = event.getId();
  if (!isLocalEchoEventId(eventId) && !event.isSending?.()) {
    return undefined;
  }

  const txnId = getEventTxnId(event);
  if (!txnId) return undefined;

  const resolveConfirmedId = buildResolveConfirmedEventId(room, room.getLiveTimeline().getEvents());
  return resolveConfirmedId(txnId);
};

export const resolveCanonicalThreadRootId = (
  room: Room,
  threadId: string | undefined
): string | undefined => {
  if (!threadId) return undefined;

  const thread = room.getThread(threadId);
  const threadRootId = thread?.rootEvent?.getId();
  if (threadRootId) return threadRootId;

  const event = room.findEventById(threadId);
  if (!event) {
    const txnId = getTxnIdFromLocalEchoEventId(room, threadId);
    if (!txnId) return threadId;

    return resolveConfirmedEventIdByTxnId(room, txnId) ?? threadId;
  }

  const eventId = event.getId();
  const rootId = event.threadRootId;

  if (rootId && rootId !== eventId) {
    return rootId;
  }

  return resolveConfirmedEventId(room, event) ?? eventId ?? threadId;
};

export const isPendingLocalEchoThreadRoot = (room: Room, threadId: string | undefined): boolean => {
  if (!threadId) return false;

  const event = room.findEventById(threadId);
  if (!event) {
    return isLocalEchoEventId(threadId);
  }

  return isPendingLocalEchoThreadRootEvent(event);
};
