import { MsgType, type IEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import {
  getMindroomThreadSummaryInfo,
  getLatestThreadSummaryInfoFromEventSources,
  pickLatestThreadSummaryInfo,
  isSupportedThreadSummaryTimestamp,
  THREAD_SUMMARY_METADATA_KEY,
} from '../messages/threadSummary';
import { createSessionId } from '../../state/sessions';
import { isMindroomAgentUserId } from '../matrix/agentIdentity';
import { discardFailedLocalEcho } from '../messages/pendingLocalEcho';
import { getMessageRelation } from './composeMessageRelation';
import { getResolvableThreadRootEvent } from './threadResolvableRoot';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import {
  ensureThreadSummaryStateLoaded,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
} from './threadSummaryState';
import { resolveThreadSummaryInfo } from './threadPresentation';
import { loadLatestCachedThreadEvents } from './cacheStore';

export const normalizeSummaryText = (text: string): string => text.replace(/\s+/g, ' ').trim();
export const SUMMARY_MAX_LENGTH = 300;

const sendThreadAction = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  content: RoomMessageEventContent
) => {
  const txnId = mx.makeTxnId();
  try {
    return await mx.sendMessage(room.roomId, threadId, content, txnId);
  } catch (error) {
    discardFailedLocalEcho(mx, room.getEventForTxnId(txnId));
    throw error;
  }
};

export const getThreadSummaryActionError = (
  mx: MatrixClient,
  room: Room,
  threadId: string
): string | undefined => {
  if (!isConfirmedMatrixEventId(threadId) || !getResolvableThreadRootEvent(room, threadId)) {
    return 'A confirmed thread is required.';
  }
  if (
    room.getMyMembership() !== 'join' ||
    !room.currentState.maySendEvent('m.room.message', mx.getSafeUserId())
  ) {
    return 'You cannot send messages in this room.';
  }
  return undefined;
};

const validateTarget = (mx: MatrixClient, room: Room, threadId: string) => {
  const error = getThreadSummaryActionError(mx, room, threadId);
  if (error) throw new Error(error);
};

export const saveThreadSummary = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  text: string
): Promise<void> => {
  validateTarget(mx, room, threadId);
  const summary = normalizeSummaryText(text);
  if (!summary || Array.from(summary).length > SUMMARY_MAX_LENGTH) {
    throw new Error('Summary must contain between 1 and 300 characters.');
  }
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  const [, cachedSummary] = await Promise.all([
    ensureThreadSummaryStateLoaded(sessionId, room.roomId),
    // Overview hydration also reads this cached tail. Include its title before
    // writing so a later cache read cannot restore a clock-skewed predecessor.
    loadLatestCachedThreadEvents(sessionId, room.roomId, threadId, 32)
      .then((page) => {
        const mapper = mx.getEventMapper();
        return getLatestThreadSummaryInfoFromEventSources(
          page.events.map((event) => mapper(event as IEvent))
        );
      })
      .catch(() => undefined),
  ]);
  validateTarget(mx, room, threadId);
  const previous = pickLatestThreadSummaryInfo(
    cachedSummary,
    resolveThreadSummaryInfo({
      preferredSummaryInfo: getThreadSummaryStateSnapshot(sessionId, room.roomId).get(threadId),
      thread: room.getThread(threadId),
    })
  );
  // Summary readers share this clock. Advance it past the title being edited
  // even when that title was authored by a device whose clock runs ahead.
  const generatedTs = Math.max(Date.now(), (previous?.generatedTs ?? 0) + 1);
  if (!isSupportedThreadSummaryTimestamp(generatedTs)) {
    throw new Error('The current summary timestamp cannot be advanced.');
  }
  const content = {
    msgtype: MsgType.Notice,
    body: summary,
    'm.relates_to': getMessageRelation(undefined, undefined, threadId),
    [THREAD_SUMMARY_METADATA_KEY]: {
      version: 1,
      summary,
      generated_at: new Date(generatedTs).toISOString(),
      model: 'manual',
      pinned: true,
    },
  };
  const { event_id: eventId } = await sendThreadAction(
    mx,
    room,
    threadId,
    content as RoomMessageEventContent
  );
  // sendMessage returns only an ID; the SDK local echo retains its send-start
  // timestamp. Fetch server acceptance time so an automatic notice delivered
  // during this send cannot outrank the later accepted manual edit.
  const eventTs = await mx
    .fetchRoomEvent(room.roomId, eventId)
    .then((event) => event.origin_server_ts)
    // The write already succeeded. Sync can enrich chronology after a read
    // failure; reporting a failed save here would invite duplicate writes.
    .catch(() => undefined);
  // A first summary can precede SDK thread hydration. Publish the accepted
  // notice through the same state/cache used by the overview and thread banner.
  storeThreadSummaryInState(sessionId, room.roomId, threadId, {
    ...getMindroomThreadSummaryInfo(content),
    eventId,
    ...(eventTs !== undefined && isSupportedThreadSummaryTimestamp(eventTs) ? { eventTs } : {}),
  });
};

export const requestThreadSummary = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  agentId: string
): Promise<void> => {
  validateTarget(mx, room, threadId);
  if (!isMindroomAgentUserId(agentId) || room.getMember(agentId)?.membership !== 'join') {
    throw new Error('Choose an agent that is joined to this room.');
  }
  await sendThreadAction(mx, room, threadId, {
    msgtype: MsgType.Text,
    body: `${agentId} Please regenerate a concise, plain-text summary of this thread (at most 300 characters). Use set_thread_summary with pin=true to update the thread summary. If that tool is unavailable, tell me.`,
    'm.mentions': { user_ids: [agentId] },
    'm.relates_to': getMessageRelation(undefined, undefined, threadId),
  });
};
