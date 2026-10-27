import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { resolveThreadRootPreviewText } from '../threads/threadPresentation';

export const RECENT_THREAD_SUMMARY_LIMIT = 120;

export const truncateRecentThreadSummaryText = (value: string): string =>
  value.length <= RECENT_THREAD_SUMMARY_LIMIT
    ? value
    : `${value.slice(0, RECENT_THREAD_SUMMARY_LIMIT - 3).trimEnd()}...`;

export const getResolvedRecentThreadRootId = (room: Room, threadId: string): string => {
  if (room.getThread(threadId)) return threadId;

  const event = room.findEventById(threadId);
  const rootId = event?.threadRootId;
  if (rootId && rootId !== threadId) return rootId;

  return threadId;
};

export const getRecentThreadFallbackSummary = (
  room: Room,
  roomName: string,
  t?: TFunction
): string => {
  if (room.hasEncryptionStateEvent())
    return t?.('mindroomUi.recent-threads.summary.encryptedThread') ?? 'Encrypted thread';
  if (roomName.trim().length > 0)
    return (
      t?.('mindroomUi.recent-threads.summary.threadInRoom', { roomName }) ?? `Thread in ${roomName}`
    );
  return t?.('mindroomUi.recent-threads.summary.thread') ?? 'Thread';
};

export const shouldPersistRecentThreadSummaryText = (
  room: Room,
  roomName: string,
  summaryText: string | undefined,
  t?: TFunction
): summaryText is string => {
  if (typeof summaryText !== 'string') return false;
  const trimmedSummaryText = summaryText.trim();
  if (trimmedSummaryText.length === 0) return false;

  return trimmedSummaryText !== getRecentThreadFallbackSummary(room, roomName, t);
};

export const getRecentThreadRootPreviewText = (
  room: Room,
  threadRootId: string,
  rootEvent: MatrixEvent | undefined
): string | undefined => {
  const previewText = resolveThreadRootPreviewText({
    room,
    threadRootId,
    rootEvent,
  });

  return previewText ? truncateRecentThreadSummaryText(previewText) : undefined;
};

type ResolveRecentThreadSummaryTextOptions = {
  room: Room;
  threadRootId: string;
  rootEvent?: MatrixEvent;
  summaryInfo?: MindroomThreadSummaryInfo;
  fallbackSummaryText?: string;
  roomName?: string;
  t?: TFunction;
};

export const resolveRecentThreadSummaryText = ({
  room,
  threadRootId,
  rootEvent,
  summaryInfo,
  fallbackSummaryText,
  roomName,
  t,
}: ResolveRecentThreadSummaryTextOptions): string | undefined =>
  (summaryInfo?.summaryText && truncateRecentThreadSummaryText(summaryInfo.summaryText)) ||
  getRecentThreadRootPreviewText(room, threadRootId, rootEvent) ||
  (fallbackSummaryText && truncateRecentThreadSummaryText(fallbackSummaryText)) ||
  (roomName ? getRecentThreadFallbackSummary(room, roomName, t) : undefined);
