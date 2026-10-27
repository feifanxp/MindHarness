import type { TFunction } from 'i18next';
import { truncateRecentThreadSummaryText } from '../recent-threads/recentThreadSummaryUtils';
import type { CommandPaletteThreadViewModel, ThreadRecord } from './types';
import { getThreadPrimarySummaryText } from './threadPresentation';

type BuildCommandPaletteThreadViewModelFromRecordOptions = {
  record: ThreadRecord;
  roomName: string;
  getParticipantName: (userId: string) => string;
  fallbackSummaryText?: string;
  sortRank?: number;
  boost?: number;
  t?: TFunction;
};

const THREAD_FALLBACK = 'Thread';

const getRecordSummaryText = (record: ThreadRecord, t?: TFunction): string | undefined => {
  const { presentation } = record;
  const recent = presentation.recentThreadSummaryText;
  return (
    presentation.summaryText ??
    (recent === presentation.rootPreviewText
      ? getThreadPrimarySummaryText(presentation, t)
      : recent) ??
    getThreadPrimarySummaryText(presentation, t) ??
    presentation.primarySummaryText
  );
};

export const buildCommandPaletteThreadViewModelFromRecord = ({
  record,
  roomName,
  getParticipantName,
  fallbackSummaryText,
  sortRank,
  boost,
  t,
}: BuildCommandPaletteThreadViewModelFromRecordOptions): CommandPaletteThreadViewModel => {
  const participantNames = record.presentation.participantIds.map(getParticipantName);
  const tags = record.status.tags.length > 0 ? record.status.tags : undefined;
  const sourceSummary = getRecordSummaryText(record, t) ?? fallbackSummaryText;
  const summaryText = truncateRecentThreadSummaryText(
    sourceSummary ?? t?.('mindroomUi.recent-threads.summary.thread') ?? THREAD_FALLBACK
  );

  return {
    id: {
      roomId: record.roomId,
      threadRootId: record.threadRootId,
    },
    summaryText,
    isFallbackSummary: sourceSummary === undefined,
    roomName,
    participantNames: participantNames.length > 0 ? participantNames : undefined,
    tags,
    isResolved: record.status.isResolved,
    messageCount: record.presentation.messageCount,
    sortRank: sortRank ?? record.status.lastActivityTs ?? 0,
    boost,
  };
};
