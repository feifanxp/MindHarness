import { useTranslation } from 'react-i18next';
import React from 'react';
import { Text } from 'folds';
import { ToolApprovalData } from './toolApproval';
import { formatApprovalTime, scheduledScopeLabelKey } from './approvalScheduleText';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';

// When a scheduled tool call will run, and which scope its requester approved.
export function ApprovalSchedule({ approval }: { approval: ToolApprovalData }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { schedule } = approval;
  if (!schedule) return null;
  return (
    <>
      <Text size="T200">
        {t('mindroomUi.messages.approvalSchedule.scheduledFor', {
          timestamp: formatApprovalTime(schedule.scheduledFor, language),
        })}
      </Text>
      {schedule.approvedScope && (
        <Text size="T200">{t(scheduledScopeLabelKey(schedule.approvedScope))}</Text>
      )}
    </>
  );
}
