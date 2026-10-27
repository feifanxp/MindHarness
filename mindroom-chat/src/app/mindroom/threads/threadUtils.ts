import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { MessageEvent, StateEvent } from '../../../types/matrix/room';
import { isMindroomThreadSummaryEvent } from '../messages/threadSummary';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../messages/toolApproval';
import { getThreadMessagePreviewText } from './threadMessagePreview';
import { hasLoadedFirstThreadPage } from './sdk/threadBootstrapSdk';

type ThreadEventLike = {
  getId(): string | undefined;
  threadRootId?: string;
  getSender?(): string | undefined;
  getRelation?(): { rel_type?: string } | null | undefined;
};

type VisibleThreadEventLike = ThreadEventLike & {
  getType?(): string | undefined;
  isRedacted?(): boolean;
  isRedaction?(): boolean;
};

export type VisibleThreadEventCollectionLike = {
  id?: string;
  rootEvent?: MatrixEvent;
  replyToEvent?: MatrixEvent | null;
  length?: number;
  events?: MatrixEvent[];
  timeline?: MatrixEvent[];
  initialEventsFetched?: boolean;
};

const VISIBLE_THREAD_TEXT_MESSAGE_EVENT_TYPES = new Set<string>([
  MessageEvent.RoomMessage,
  MessageEvent.RoomMessageEncrypted,
]);

const VISIBLE_THREAD_REPLY_EVENT_TYPES = new Set<string>([
  ...VISIBLE_THREAD_TEXT_MESSAGE_EVENT_TYPES,
  MessageEvent.Sticker,
  MINDROOM_TOOL_APPROVAL_EVENT,
  StateEvent.RoomMember,
  StateEvent.RoomName,
  StateEvent.RoomTopic,
  StateEvent.RoomAvatar,
]);

const isThreadRelation = (event: ThreadEventLike): boolean => {
  const relationType = event.getRelation?.()?.rel_type;
  return !relationType || relationType === RelationType.Thread;
};

/**
 * A thread root lives in the room timeline or in its own thread.
 * `Room.findEventById` instead scans every thread's timeline when the root is
 * not loaded in the room timeline, which is O(threads) for each root.
 */
export const findThreadRootEvent = (
  room: Pick<Room, 'getUnfilteredTimelineSet' | 'getThread'>,
  threadRootId: string
): MatrixEvent | undefined =>
  room.getUnfilteredTimelineSet().findEventById(threadRootId) ??
  room.getThread(threadRootId)?.findEventById(threadRootId);

export const eventBelongsToThread = (event: ThreadEventLike, threadId: string): boolean =>
  event.getId() === threadId || event.threadRootId === threadId;

export const isThreadReplyEvent = (eventId: string, threadRootId?: string): boolean =>
  !!threadRootId && threadRootId !== eventId;

/**
 * @returns true if the Matrix event TYPE is a renderable message envelope.
 *
 * NOTE: this gates on event TYPE (`m.room.message` / `m.room.encrypted`), NOT
 * on `content.msgtype`. Voice (`m.audio` + `m.voice`), image, video, file,
 * emote, location, and custom MindRoom msgtypes all pass — they are normal
 * `m.room.message` envelopes. The "TextMessage" suffix in this function name
 * is historical and misleading; do NOT introduce a `content.msgtype` allowlist
 * here. See CINNY-088 for the regression that motivated this clarification.
 */
export const isVisibleThreadTextMessageEventType = (eventType: string | undefined): boolean =>
  !!eventType && VISIBLE_THREAD_TEXT_MESSAGE_EVENT_TYPES.has(eventType);

export const isVisibleThreadReplyEventType = (eventType: string | undefined): boolean =>
  !!eventType && VISIBLE_THREAD_REPLY_EVENT_TYPES.has(eventType);

export const isVisibleThreadReplyEvent = (event: VisibleThreadEventLike): boolean => {
  const eventId = event.getId();
  const { threadRootId } = event;
  if (!eventId || !threadRootId || eventId === threadRootId) return false;
  if (!isThreadRelation(event)) return false;
  if (event.isRedacted?.() || event.isRedaction?.()) return false;

  return isVisibleThreadReplyEventType(event.getType?.());
};

export const getVisibleThreadEventBodyPreviewText = (
  event: MatrixEvent | undefined
): string | undefined => {
  const content =
    event && typeof event.getContent === 'function'
      ? (event.getContent() as Record<string, unknown> | null | undefined)
      : undefined;
  return getThreadMessagePreviewText(content);
};

export const getLatestRenderableVisibleThreadReplyEvent = (
  replyEvents: MatrixEvent[]
): MatrixEvent | undefined => {
  let summaryFallback: MatrixEvent | undefined;

  for (let i = replyEvents.length - 1; i >= 0; i -= 1) {
    const event = replyEvents[i];
    if (!getVisibleThreadEventBodyPreviewText(event)) continue;

    if (isMindroomThreadSummaryEvent(event)) {
      summaryFallback ??= event;
      continue;
    }

    return event;
  }

  return summaryFallback;
};

export const getPreferredVisibleThreadReplyEvents = (
  thread: VisibleThreadEventCollectionLike | null | undefined
): MatrixEvent[] => {
  const replyEvents = thread?.events?.length
    ? thread.events
    : thread?.timeline?.length
    ? thread.timeline
    : thread?.events ?? thread?.timeline ?? [];
  return replyEvents.filter(isVisibleThreadReplyEvent);
};

export const hasLoadedThreadReplyEvents = (
  thread: Pick<VisibleThreadEventCollectionLike, 'events' | 'timeline'> | null | undefined
): boolean => {
  if (thread?.events && thread.events.length > 0) return true;
  return !!thread?.timeline && thread.timeline.length > 0;
};

/**
 * The SDK puts the root first once back-pagination reaches the thread's start,
 * but the live timeline can still have a hole: the app moves the backward token
 * to its cache's cursor without adding the cached replies, and after a sync gap
 * older replies can stay in another segment. So it must also hold as many
 * thread replies as the SDK counts; its edits and reactions are not replies.
 */
const hasLoadedEveryThreadReply = (
  thread: VisibleThreadEventCollectionLike | null | undefined
): boolean =>
  !!thread?.id &&
  !!thread.events &&
  thread.events[0]?.getId() === thread.id &&
  hasLoadedFirstThreadPage(thread) &&
  getThreadReplyEventsForRoot(thread.events, thread.id).length >= (thread.length ?? 0);

/**
 * A fully loaded thread is counted exactly, so redacting a reply lowers its count.
 * Otherwise the loaded replies may be only the newest part of the thread, so the
 * largest of their number, the SDK's count (from the server's `m.thread` count)
 * and the caller's count is shown.
 */
export const getVisibleThreadMessageCount = (
  thread: VisibleThreadEventCollectionLike | null | undefined,
  fallbackMessageCount?: number,
  replyEvents = getPreferredVisibleThreadReplyEvents(thread)
): number => {
  if (hasLoadedEveryThreadReply(thread)) return replyEvents.length;

  return Math.max(replyEvents.length, thread?.length ?? 0, fallbackMessageCount ?? 0);
};

export const getVisibleThreadParticipantIds = (
  thread: VisibleThreadEventCollectionLike | null | undefined,
  threadRootEvent: MatrixEvent | undefined,
  maxParticipants = 3,
  replyEvents = getPreferredVisibleThreadReplyEvents(thread)
): string[] => {
  const participantIds: string[] = [];
  const seenParticipantIds = new Set<string>();

  for (let i = replyEvents.length - 1; i >= 0 && participantIds.length < maxParticipants; i -= 1) {
    const senderId = replyEvents[i].getSender?.();
    if (!senderId || seenParticipantIds.has(senderId)) continue;

    seenParticipantIds.add(senderId);
    participantIds.push(senderId);
  }

  const rootSenderId = threadRootEvent?.getSender?.();
  if (
    participantIds.length < maxParticipants &&
    rootSenderId &&
    !seenParticipantIds.has(rootSenderId)
  ) {
    participantIds.push(rootSenderId);
  }

  return participantIds;
};

const forEachThreadReplyEvent = <T extends ThreadEventLike>(
  events: readonly T[],
  visit: (event: T, threadRootId: string) => void
): void => {
  const seenEventIds = new Set<string>();

  events.forEach((event) => {
    const eventId = event.getId();
    const { threadRootId } = event;
    if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
      return;
    }
    seenEventIds.add(eventId);

    if (!isThreadRelation(event)) return;
    visit(event, threadRootId);
  });
};

export const getThreadReplyEventsForRoot = <T extends ThreadEventLike>(
  events: readonly T[],
  threadId: string
): T[] => {
  const replies: T[] = [];
  forEachThreadReplyEvent(events, (event, rootId) => {
    if (rootId === threadId) replies.push(event);
  });
  return replies;
};

export const buildThreadReplyCountMap = (events: ThreadEventLike[]): Map<string, number> => {
  const counts = new Map<string, number>();
  forEachThreadReplyEvent(events, (_event, threadRootId) => {
    counts.set(threadRootId, (counts.get(threadRootId) ?? 0) + 1);
  });

  return counts;
};

export const buildVisibleThreadReplyCountMap = (
  events: VisibleThreadEventLike[]
): Map<string, number> => {
  const seenEventIds = new Set<string>();
  const counts = new Map<string, number>();

  events.forEach((event) => {
    const eventId = event.getId();
    const { threadRootId } = event;
    if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
      return;
    }
    seenEventIds.add(eventId);

    if (!isVisibleThreadReplyEvent(event)) return;

    counts.set(threadRootId, (counts.get(threadRootId) ?? 0) + 1);
  });

  return counts;
};

export const buildThreadParticipantMap = (
  events: ThreadEventLike[],
  maxParticipants = 3
): Map<string, string[]> => {
  const seenEventIds = new Set<string>();
  const participants = new Map<string, string[]>();
  const participantSets = new Map<string, Set<string>>();

  [...events].reverse().forEach((event) => {
    const eventId = event.getId();
    const { threadRootId } = event;
    if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
      return;
    }
    seenEventIds.add(eventId);

    if (!isThreadRelation(event)) return;

    const senderId = event.getSender?.();
    if (!senderId) return;

    const threadParticipants = participants.get(threadRootId) ?? [];
    if (threadParticipants.length >= maxParticipants) return;

    const threadParticipantSet = participantSets.get(threadRootId) ?? new Set<string>();
    if (threadParticipantSet.has(senderId)) return;

    threadParticipantSet.add(senderId);
    participantSets.set(threadRootId, threadParticipantSet);
    participants.set(threadRootId, [...threadParticipants, senderId]);
  });

  return participants;
};

export const buildVisibleThreadParticipantMap = (
  events: VisibleThreadEventLike[],
  maxParticipants = 3
): Map<string, string[]> => {
  const seenEventIds = new Set<string>();
  const participants = new Map<string, string[]>();
  const participantSets = new Map<string, Set<string>>();

  [...events].reverse().forEach((event) => {
    const eventId = event.getId();
    const { threadRootId } = event;
    if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
      return;
    }
    seenEventIds.add(eventId);

    if (!isVisibleThreadReplyEvent(event)) return;

    const senderId = event.getSender?.();
    if (!senderId) return;

    const threadParticipants = participants.get(threadRootId) ?? [];
    if (threadParticipants.length >= maxParticipants) return;

    const threadParticipantSet = participantSets.get(threadRootId) ?? new Set<string>();
    if (threadParticipantSet.has(senderId)) return;

    threadParticipantSet.add(senderId);
    participantSets.set(threadRootId, threadParticipantSet);
    participants.set(threadRootId, [...threadParticipants, senderId]);
  });

  return participants;
};

export const getValidThreadRootEvent = (
  room: Pick<Room, 'findEventById' | 'getThread'>,
  threadRootId?: string
): MatrixEvent | undefined => {
  if (!threadRootId) return undefined;

  const candidateThreadRoot =
    room.getThread(threadRootId)?.rootEvent ?? room.findEventById(threadRootId);

  if (!candidateThreadRoot || candidateThreadRoot.getId() !== threadRootId) {
    return undefined;
  }

  return candidateThreadRoot.isThreadRoot ? candidateThreadRoot : undefined;
};
