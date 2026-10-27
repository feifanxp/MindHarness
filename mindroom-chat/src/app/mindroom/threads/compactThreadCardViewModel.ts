import { useMemo, useRef } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { MatrixClient } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { getThreadScheduledDisplayText, getThreadScheduledLabel } from './compactThreadCardUtils';
import { getThreadPrimarySummaryText } from './threadPresentation';
import {
  localizeThreadPreview,
  replaceMatrixUserIdsWithDisplayNames,
} from './threadMessagePreview';
import type {
  CompactThreadAttentionState,
  CompactThreadCardViewModel,
  ThreadRecord,
  ThreadParticipantViewModel,
} from './types';
import { getThreadResolverDisplayName } from './threadResolutionAttribution';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';

const TITLE_TEXT_LIMIT = 160;
const PREVIEW_TEXT_LIMIT = 96;

// Share the active locale's formatter across new cards and changed message counts.
let countFormatter: { locale: string | undefined; value: Intl.NumberFormat } | undefined;

const truncateText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 3).trimEnd()}...`;

export const formatCompactThreadMessageCount = (messageCount: number, locale?: string): string => {
  if (!countFormatter || countFormatter.locale !== locale) {
    countFormatter = { locale, value: new Intl.NumberFormat(locale) };
  }
  return countFormatter.value.format(messageCount);
};

export const getCompactThreadMessageCountLabel = (
  messageCount: number,
  t?: TFunction,
  locale?: string
): string => {
  if (messageCount === 0)
    return t?.('mindroomUi.threads.compactThreadCardViewModel.noReplies') ?? '0 replies';

  const formattedCount = formatCompactThreadMessageCount(messageCount, locale);
  return (
    t?.('mindroomUi.threads.compactThreadCardViewModel.messageCount', {
      count: messageCount,
      formattedCount,
    }) ?? `${formattedCount} ${messageCount === 1 ? 'msg' : 'msgs'}`
  );
};

export const getCompactThreadAttentionState = ({
  isResolved,
  isStreaming,
  lastSenderId,
  currentUserId,
}: {
  isResolved: boolean;
  isStreaming: boolean;
  lastSenderId: string | undefined;
  currentUserId: string | undefined;
}): CompactThreadAttentionState => {
  if (isStreaming) return 'streaming';
  if (isResolved) return 'resolved';
  if (!lastSenderId) return 'idle';
  if (currentUserId && lastSenderId === currentUserId) return 'waiting';
  return 'needs-attention';
};

export const getCompactThreadAttentionStatusText = (
  attentionState: CompactThreadAttentionState,
  t?: TFunction
): string => {
  switch (attentionState) {
    case 'needs-attention':
      return (
        t?.('mindroomUi.threads.compactThreadCardViewModel.needsAttention') ?? 'Needs attention'
      );
    case 'waiting':
      return (
        t?.('mindroomUi.threads.compactThreadCardViewModel.waitingOnResponse') ??
        'Waiting on response'
      );
    case 'streaming':
      return (
        t?.('mindroomUi.threads.compactThreadCardViewModel.agentStreaming') ?? 'Agent streaming'
      );
    case 'resolved':
      return t?.('mindroomUi.threads.compactThreadCardViewModel.resolved') ?? 'Resolved';
    case 'idle':
    default:
      return t?.('mindroomUi.threads.compactThreadCardViewModel.idle') ?? 'Idle';
  }
};

const getCompactThreadParticipants = ({
  room,
  mx,
  useAuthentication,
  participantIds,
}: {
  room: Room;
  mx: MatrixClient;
  useAuthentication: boolean;
  participantIds: string[];
}): ThreadParticipantViewModel[] =>
  participantIds.map((userId) => {
    const displayName = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
    const avatarMxc = getMemberAvatarMxc(room, userId);

    return {
      userId,
      displayName,
      avatarUrl: avatarMxc
        ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 32, 32, 'crop') ?? undefined
        : undefined,
    };
  });

type BuildCompactThreadCardViewModelFromRecordOptions = {
  record: ThreadRecord;
  room: Room;
  currentUserId?: string;
  mx: MatrixClient;
  useAuthentication: boolean;
  t?: TFunction;
  locale?: string;
};

export const buildCompactThreadCardViewModelFromRecord = ({
  record,
  room,
  currentUserId,
  mx,
  useAuthentication,
  t,
  locale,
}: BuildCompactThreadCardViewModelFromRecordOptions): CompactThreadCardViewModel => {
  const { presentation, status } = record;
  const titleText = replaceMatrixUserIdsWithDisplayNames(
    room,
    getThreadPrimarySummaryText(presentation, t) ??
      t?.('mindroomUi.threads.compactThreadCardViewModel.threadStarted') ??
      'Thread started'
  );
  const latestPreviewText = replaceMatrixUserIdsWithDisplayNames(
    room,
    localizeThreadPreview(
      presentation.latestReplyPreviewText,
      presentation.latestReplyPreviewLocalization,
      t
    ) ??
      localizeThreadPreview(
        presentation.rootPreviewText,
        presentation.rootPreviewLocalization,
        t
      ) ??
      (presentation.messageCount > 0
        ? titleText
        : t?.('mindroomUi.threads.compactThreadCardViewModel.noRepliesYet') ?? 'No replies yet')
  );
  const lastSenderId = presentation.lastSenderId;
  const lastSenderName =
    (lastSenderId ? getMemberDisplayName(room, lastSenderId) : undefined) ??
    (presentation.lastSenderDisplayName
      ? lastSenderId
        ? presentation.lastSenderDisplayName
        : replaceMatrixUserIdsWithDisplayNames(room, presentation.lastSenderDisplayName)
      : undefined) ??
    (lastSenderId ? getMxIdLocalPart(lastSenderId) ?? lastSenderId : undefined);
  const previewText = lastSenderName
    ? `${lastSenderName}: ${truncateText(latestPreviewText, PREVIEW_TEXT_LIMIT)}`
    : truncateText(latestPreviewText, PREVIEW_TEXT_LIMIT);
  const attentionState = getCompactThreadAttentionState({
    isResolved: status.isResolved,
    isStreaming: status.isStreaming,
    lastSenderId,
    currentUserId,
  });
  const scheduledDisplayText = getThreadScheduledDisplayText(
    status.scheduledTaskCount,
    status.nextScheduledTs,
    status.cronDescription,
    t,
    locale
  );
  const scheduledTaskLabel = getThreadScheduledLabel(
    status.scheduledTaskCount,
    status.nextScheduledTs,
    status.cronDescription,
    scheduledDisplayText,
    t
  );
  const resolvedByDisplayName = getThreadResolverDisplayName(room, status.resolvedByUserId);

  return {
    id: {
      roomId: record.roomId,
      threadRootId: record.threadRootId,
    },
    titleText,
    displayTitleText: truncateText(titleText, TITLE_TEXT_LIMIT),
    previewText,
    primarySummaryText: getThreadPrimarySummaryText(presentation),
    recentThreadSummaryText: presentation.recentThreadSummaryText,
    messageCount: presentation.messageCount,
    messageCountLabel: getCompactThreadMessageCountLabel(presentation.messageCount, t, locale),
    messageCountText: formatCompactThreadMessageCount(presentation.messageCount, locale),
    attentionState,
    attentionStatusText: getCompactThreadAttentionStatusText(attentionState, t),
    participants: getCompactThreadParticipants({
      room,
      mx,
      useAuthentication,
      participantIds: presentation.participantIds,
    }),
    tags: status.tags,
    isResolved: status.isResolved,
    resolvedByDisplayName,
    isUnread: status.isUnread,
    isStreaming: status.isStreaming,
    hasPendingSend: status.hasPendingSend === true,
    hasFailedSend: status.hasFailedSend === true,
    scheduledDisplayText,
    scheduledTaskLabel,
    lastActivityTs: status.lastActivityTs,
    lastActivityTitle:
      status.lastActivityTs !== undefined
        ? new Date(status.lastActivityTs).toLocaleString(locale)
        : undefined,
  };
};

type UseCompactThreadCardViewModelsOptions = {
  room: Room;
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
};

type CachedCardViewModel = {
  inputSignature: string;
  outputSignature: string;
  viewModel: CompactThreadCardViewModel;
};

export const useCompactThreadCardViewModels = ({
  room,
  threadRootIds,
  threadRecordMap,
}: UseCompactThreadCardViewModelsOptions): CompactThreadCardViewModel[] => {
  const mx = useMatrixClient();
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const useAuthentication = useMediaAuthentication();
  const currentUserId = mx.getUserId() ?? undefined;
  // Records are rebuilt on every index refresh. Snapshot their values before
  // formatting so an unrelated streaming edit does not rebuild every card.
  const viewModelCacheRef = useRef<{
    mx: MatrixClient;
    room: Room;
    t: TFunction;
    contextSignature: string;
    models: Map<string, CachedCardViewModel>;
  }>();

  return useMemo(() => {
    const previousCache = viewModelCacheRef.current;
    // SDK member objects mutate in place. Include all members because titles
    // and previews can mention people outside the thread's participant list.
    const contextSignature = JSON.stringify([
      currentUserId,
      language,
      useAuthentication,
      mx.getHomeserverUrl(),
      useAuthentication &&
      typeof window !== 'undefined' &&
      window.location?.protocol === 'capacitor:'
        ? mx.getAccessToken()
        : undefined,
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
      room
        .getMembers()
        .map((member) => [member.userId, member.rawDisplayName, member.getMxcAvatarUrl()]),
    ]);
    const canReuseInputs =
      previousCache?.mx === mx &&
      previousCache.room === room &&
      previousCache.t === t &&
      previousCache.contextSignature === contextSignature;
    const nextCache = new Map<string, CachedCardViewModel>();
    const viewModels: CompactThreadCardViewModel[] = [];

    threadRootIds.forEach((threadRootId) => {
      const record = threadRecordMap.get(threadRootId);
      if (!record) return;

      const inputSignature = JSON.stringify([
        record.roomId,
        record.threadRootId,
        record.presentation,
        record.status,
      ]);
      const cached = previousCache?.models.get(threadRootId);
      // Scheduled labels read the clock; keep their existing refresh cadence.
      if (
        canReuseInputs &&
        cached?.inputSignature === inputSignature &&
        record.status.nextScheduledTs === undefined
      ) {
        nextCache.set(threadRootId, cached);
        viewModels.push(cached.viewModel);
        return;
      }

      const freshViewModel = buildCompactThreadCardViewModelFromRecord({
        record,
        room,
        currentUserId,
        mx,
        useAuthentication,
        t,
        locale: language,
      });
      const outputSignature = JSON.stringify(freshViewModel);
      const viewModel =
        cached?.outputSignature === outputSignature ? cached.viewModel : freshViewModel;
      nextCache.set(threadRootId, { inputSignature, outputSignature, viewModel });
      viewModels.push(viewModel);
    });

    viewModelCacheRef.current = { mx, room, t, contextSignature, models: nextCache };
    return viewModels;
  }, [currentUserId, language, mx, room, t, threadRecordMap, threadRootIds, useAuthentication]);
};
