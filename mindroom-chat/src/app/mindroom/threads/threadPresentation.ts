import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { TFunction } from 'i18next';
import {
  getThreadPreviewLocalization,
  localizeThreadPreview,
  type ThreadPreviewLocalization,
} from './threadMessagePreview';
import {
  getThreadSummaryInfosFromEventSources,
  isMindroomThreadSummaryEvent,
  pickLatestThreadSummaryInfo,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import { getMemberDisplayName } from '../../utils/room';
import {
  getCompactThreadRootBodyPreviewText,
  pickPreferredThreadRootPreviewText,
} from './compactThreadRootData';
import {
  getLatestRenderableVisibleThreadReplyEvent,
  getPreferredVisibleThreadReplyEvents,
  getVisibleThreadEventBodyPreviewText,
  getVisibleThreadMessageCount,
  isVisibleThreadReplyEvent,
  type VisibleThreadEventCollectionLike,
} from './threadUtils';

export type ThreadPresentationSnapshot = {
  summaryInfo: MindroomThreadSummaryInfo | undefined;
  summaryText: string | undefined;
  rootPreviewText: string | undefined;
  latestReplyPreviewText: string | undefined;
  rootPreviewLocalization?: ThreadPreviewLocalization;
  latestReplyPreviewLocalization?: ThreadPreviewLocalization;
  lastSenderId: string | undefined;
  lastSenderDisplayName: string | undefined;
  messageCount: number;
};

type ResolveThreadSummaryInfoOptions = {
  preferredSummaryInfo?: MindroomThreadSummaryInfo;
  thread?: VisibleThreadEventCollectionLike | null;
};

export const resolveThreadSummaryInfo = ({
  preferredSummaryInfo,
  thread,
}: ResolveThreadSummaryInfoOptions): MindroomThreadSummaryInfo | undefined =>
  pickLatestThreadSummaryInfo(
    ...getThreadSummaryInfosFromEventSources(
      thread?.replyToEvent && isVisibleThreadReplyEvent(thread.replyToEvent)
        ? [thread.replyToEvent]
        : undefined
    ),
    preferredSummaryInfo,
    ...getThreadSummaryInfosFromEventSources(thread?.events, thread?.timeline)
  );

type ResolveThreadRootPreviewTextOptions = {
  preferredPreviewText?: string;
  room: Room;
  rootEvent?: MatrixEvent;
  threadRootId: string;
};

export const resolveThreadRootPreviewText = ({
  room,
  threadRootId,
  rootEvent,
  preferredPreviewText,
}: ResolveThreadRootPreviewTextOptions): string | undefined =>
  pickPreferredThreadRootPreviewText({
    preferredPreviewText,
    fallbackPreviewText:
      getCompactThreadRootBodyPreviewText(rootEvent, {
        eventId: threadRootId,
        room,
      }) ?? getVisibleThreadEventBodyPreviewText(rootEvent),
  });

type ResolveThreadPresentationSnapshotOptions = {
  fallbackLastSenderDisplayName?: string;
  fallbackLastSenderId?: string;
  fallbackLatestReplyPreviewText?: string;
  fallbackMessageCount?: number;
  fallbackParticipantIds?: string[];
  preferredRootPreviewText?: string;
  preferredSummaryInfo?: MindroomThreadSummaryInfo;
  room: Room;
  rootEvent?: MatrixEvent;
  thread?: VisibleThreadEventCollectionLike | null;
  threadRootId: string;
  visibleReplyEvents?: MatrixEvent[];
};

export const resolveThreadPresentationSnapshot = ({
  room,
  threadRootId,
  thread,
  rootEvent,
  preferredSummaryInfo,
  preferredRootPreviewText,
  fallbackLatestReplyPreviewText,
  fallbackLastSenderId,
  fallbackLastSenderDisplayName,
  fallbackMessageCount,
  fallbackParticipantIds,
  visibleReplyEvents,
}: ResolveThreadPresentationSnapshotOptions): ThreadPresentationSnapshot => {
  const replyEvents = visibleReplyEvents ?? getPreferredVisibleThreadReplyEvents(thread);
  const loadedPreviewEvent = getLatestRenderableVisibleThreadReplyEvent(replyEvents);
  // The SDK restores the bundled reply before loading the thread timeline.
  // Use it for presentation without treating one event as the full reply count.
  const bundledReply = thread?.replyToEvent;
  const latestPreviewEvent =
    !fallbackLatestReplyPreviewText &&
    bundledReply &&
    !isMindroomThreadSummaryEvent(bundledReply) &&
    isVisibleThreadReplyEvent(bundledReply) &&
    getVisibleThreadEventBodyPreviewText(bundledReply) &&
    (!loadedPreviewEvent || bundledReply.getTs() > loadedPreviewEvent.getTs())
      ? bundledReply
      : loadedPreviewEvent;
  const lastEvent = latestPreviewEvent ?? replyEvents[replyEvents.length - 1];
  const lastSenderId =
    lastEvent?.getSender?.() ??
    fallbackLastSenderId ??
    fallbackParticipantIds?.find((candidateId) => !!candidateId);
  const lastSenderDisplayName = lastSenderId
    ? getMemberDisplayName(room, lastSenderId) ?? lastSenderId
    : fallbackLastSenderDisplayName;
  const summaryInfo = resolveThreadSummaryInfo({
    preferredSummaryInfo,
    thread,
  });
  const visibleMessageCount = getVisibleThreadMessageCount(
    thread,
    fallbackMessageCount,
    replyEvents
  );
  const rootPreviewText = resolveThreadRootPreviewText({
    room,
    threadRootId,
    rootEvent,
    preferredPreviewText: preferredRootPreviewText,
  });
  const latestReplyPreviewText =
    getVisibleThreadEventBodyPreviewText(latestPreviewEvent) ?? fallbackLatestReplyPreviewText;
  const rootPreviewLocalization = getThreadPreviewLocalization(
    rootEvent?.getContent?.(),
    rootPreviewText
  );
  const latestReplyPreviewLocalization = getThreadPreviewLocalization(
    latestPreviewEvent?.getContent?.(),
    latestReplyPreviewText
  );

  return {
    summaryInfo,
    summaryText: summaryInfo?.summaryText,
    rootPreviewText,
    latestReplyPreviewText,
    ...(rootPreviewLocalization ? { rootPreviewLocalization } : {}),
    ...(latestReplyPreviewLocalization ? { latestReplyPreviewLocalization } : {}),
    lastSenderId,
    lastSenderDisplayName,
    messageCount:
      typeof summaryInfo?.messageCount === 'number'
        ? Math.max(summaryInfo.messageCount, visibleMessageCount)
        : visibleMessageCount,
  };
};

export const getThreadPrimarySummaryText = (
  {
    summaryText,
    rootPreviewText,
    rootPreviewLocalization,
  }: Pick<
    ThreadPresentationSnapshot,
    'summaryText' | 'rootPreviewText' | 'rootPreviewLocalization'
  >,
  t?: TFunction
): string | undefined =>
  summaryText ?? localizeThreadPreview(rootPreviewText, rootPreviewLocalization, t);
