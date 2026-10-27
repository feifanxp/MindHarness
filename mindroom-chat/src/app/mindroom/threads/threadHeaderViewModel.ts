import type { TFunction } from 'i18next';
import type { ThreadHeaderViewModel, ThreadRecord } from './types';
import { getThreadScheduledLabel } from './compactThreadCardUtils';

type BuildThreadHeaderViewModelOptions = {
  record: ThreadRecord;
  scheduledDisplayText?: string;
  canEdit: boolean;
  availableTags: string[];
  pickerDisabled: boolean;
  t?: TFunction;
};

const getBannerScheduledText = (
  summaryText: string | undefined,
  nextScheduledTs: number | undefined,
  scheduledDisplayText: string | undefined,
  t?: TFunction
): string | undefined => {
  if (!scheduledDisplayText) return undefined;
  if (summaryText || nextScheduledTs === undefined) return scheduledDisplayText;
  return (
    t?.('mindroomUi.threads.threadHeaderViewModel.nextTask', {
      schedule: scheduledDisplayText,
    }) ?? `Next task ${scheduledDisplayText}`
  );
};

export const buildThreadHeaderViewModelFromRecord = ({
  record,
  scheduledDisplayText,
  canEdit,
  availableTags,
  pickerDisabled,
  t,
}: BuildThreadHeaderViewModelOptions): ThreadHeaderViewModel => {
  const { scheduledTaskCount, nextScheduledTs, cronDescription } = record.status;
  const summaryText = record.presentation.summaryText;

  return {
    summaryText,
    displayTags: record.status.tags,
    isResolved: record.status.isResolved,
    canEdit,
    availableTags,
    pickerDisabled,
    scheduledTaskCount,
    nextScheduledTs,
    scheduledDisplayText,
    scheduledLabel: getThreadScheduledLabel(
      scheduledTaskCount,
      nextScheduledTs,
      cronDescription,
      scheduledDisplayText,
      t
    ),
    bannerScheduledText: getBannerScheduledText(
      summaryText,
      nextScheduledTs,
      scheduledDisplayText,
      t
    ),
  };
};
