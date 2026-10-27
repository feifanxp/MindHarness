import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useTranslation } from 'react-i18next';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { getThreadScheduledDisplayText } from './compactThreadCardUtils';
import { useThreadRootEvent } from './useThreadRootEvent';
import { useThreadScheduledStatus } from './useThreadScheduledStatus';

export type ThreadHeaderInfo = {
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  cronDescription?: string;
  scheduledDisplayText?: string;
};

export const useThreadHeaderInfo = (room: Room, threadId: string | undefined): ThreadHeaderInfo => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const threadRootId = useThreadRootEvent(room, threadId);
  const scheduledStatus = useThreadScheduledStatus(room, threadRootId);
  const { scheduledTaskCount, nextScheduledTs } = scheduledStatus;
  const scheduledDisplayText = getThreadScheduledDisplayText(
    scheduledTaskCount,
    nextScheduledTs,
    scheduledStatus.cronDescription,
    t,
    language
  );

  return {
    scheduledTaskCount,
    nextScheduledTs,
    cronDescription: scheduledStatus.cronDescription,
    scheduledDisplayText,
  };
};
