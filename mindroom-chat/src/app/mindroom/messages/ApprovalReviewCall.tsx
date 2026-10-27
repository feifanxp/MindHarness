import { useTranslation } from 'react-i18next';
import React from 'react';
import { ApprovalArguments } from './ApprovalArguments';
import { ApprovalDecisionControls } from './ApprovalDecisionControls';
import { ApprovalSchedule } from './ApprovalSchedule';
import { ApprovalControlProps, isApprovalPending } from './approvalActions';
import * as css from './ThreadApprovals.css';

export function ApprovalReviewCall({
  index,
  single = false,
  offersDurations = false,
  ...controls
}: ApprovalControlProps & { index: number; single?: boolean; offersDurations?: boolean }) {
  const { t } = useTranslation();
  const { record, action, now } = controls;
  const pending = isApprovalPending(record, action, now);
  const status = pending ? action?.status ?? 'pending' : record.approval.status;
  const statusLabel = t(`mindroomUi.messages.approvalReviewCall.status.${status}`);
  return (
    <div className={single ? css.SingleCall : css.Call} data-approval-id={record.eventId}>
      {!single && (
        <small>
          {t('mindroomUi.messages.approvalReviewCall.callStatus', {
            number: index + 1,
            status: statusLabel,
          })}
        </small>
      )}
      <ApprovalSchedule approval={record.approval} />
      <ApprovalArguments approval={record.approval} />
      <ApprovalDecisionControls {...controls} index={index} offersDurations={offersDurations} />
    </div>
  );
}
