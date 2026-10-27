import { useTranslation } from 'react-i18next';
import React from 'react';
import { Button, Text } from 'folds';
import {
  ApprovalControlProps,
  getApprovalCapabilities,
  getApprovalGrantState,
} from './approvalActions';
import { parseToolApprovalExpiryTimestamp } from './toolApproval';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';

export function ApprovalGrantStatus({
  record,
  userId,
  action,
  submit,
  now,
  canSend = true,
}: ApprovalControlProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const grant = record.approval.autoApproval;
  const state = getApprovalGrantState(record.approval, now);
  if (!grant || !state) return null;
  const expiry = parseToolApprovalExpiryTimestamp(grant.expiresAt) ?? 0;
  const canRevoke = canSend && getApprovalCapabilities(record, userId, undefined, now).revoke;
  return (
    <>
      <p>
        {state === 'active'
          ? t('mindroomUi.messages.approvalGrantStatus.autoApprovalActive')
          : state === 'revoked'
          ? t('mindroomUi.messages.approvalGrantStatus.autoApprovalStopped')
          : t('mindroomUi.messages.approvalGrantStatus.autoApprovalExpired')}
        <br />
        {t('mindroomUi.messages.approvalGrantStatus.fixedExpiry', {
          timestamp: new Date(expiry).toLocaleString(language),
        })}
      </p>
      {state === 'active' && (
        <p>
          {t('mindroomUi.messages.approvalGrantStatus.expiresInMinutes', {
            count: Math.max(1, Math.ceil((expiry - now) / 60_000)),
          })}
        </p>
      )}
      <small>{t('mindroomUi.messages.approvalGrantStatus.argumentsMayDifferBetweenCalls')}</small>
      {canRevoke && (
        <Button
          size="300"
          variant="Critical"
          fill="Soft"
          outlined
          disabled={!!action && action.status !== 'error'}
          onClick={() => {
            if (canSend) void submit(record, { revoke: true });
          }}
          radii="300"
        >
          <Text size="B300">{t('mindroomUi.messages.approvalGrantStatus.stopAutoApproval')}</Text>
        </Button>
      )}
      {action?.status === 'submitted' && (
        <p role="status">
          {t('mindroomUi.messages.approvalGrantStatus.submittedWaitingForRoomUpdate')}
        </p>
      )}
      {action?.error && <p role="alert">{action.error}</p>}
    </>
  );
}
