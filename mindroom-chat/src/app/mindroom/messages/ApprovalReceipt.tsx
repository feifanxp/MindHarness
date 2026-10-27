import { useTranslation } from 'react-i18next';
import React from 'react';
import { Icon, Icons } from 'folds';
import { ApprovalArguments } from './ApprovalArguments';
import { ApprovalSchedule } from './ApprovalSchedule';
import { formatApprovalTime, scheduledScopeLabelKey } from './approvalScheduleText';
import { getToolApprovalOperationLabel, ToolApprovalData } from './toolApproval';
import * as css from './ThreadApprovals.css';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useGlassHighlight } from '../../components/glass/liquid/useLiquidGlass';

export function ApprovalReceipt({
  approval,
  children,
  nested = false,
}: {
  approval: ToolApprovalData;
  children?: React.ReactNode;
  nested?: boolean;
}) {
  const glassRef = useGlassHighlight<HTMLDetailsElement>(undefined, !nested);
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const provenance = approval.provenance;
  const statusLabel =
    approval.status === 'expired'
      ? t('mindroomUi.messages.approvalReceipt.statusExpired')
      : approval.status === 'approved'
      ? t('mindroomUi.messages.approvalReceipt.statusApproved')
      : t('mindroomUi.messages.approvalReceipt.statusDenied');
  return (
    <details
      ref={glassRef}
      className={css.Receipt}
      aria-label={t('mindroomUi.messages.approvalReceipt.resolvedToolApprovalRequest')}
    >
      <summary className={css.ReceiptHeader}>
        <span className={css.ReceiptTool}>
          {approval.status === 'approved' ? '✓' : '–'} {getToolApprovalOperationLabel(approval)}
        </span>
        <span className={css.ReceiptMeta}>{statusLabel}</span>
        <Icon src={Icons.ChevronBottom} size="50" className={css.ReceiptChevron} aria-hidden />
      </summary>
      <div className={css.ReceiptBody}>
        <p>
          {t('mindroomUi.messages.approvalReceipt.requestedBy', {
            agent: approval.agentName,
            requester: approval.requesterId ?? t('mindroomUi.messages.approvalReceipt.unknown'),
          })}
        </p>
        <p>
          {approval.resolvedBy && approval.resolvedAt
            ? t('mindroomUi.messages.approvalReceipt.resolvedByAt', {
                status: statusLabel,
                resolver: approval.resolvedBy,
                timestamp: new Date(approval.resolvedAt).toLocaleString(language),
              })
            : approval.resolvedBy
            ? t('mindroomUi.messages.approvalReceipt.resolvedBy', {
                status: statusLabel,
                resolver: approval.resolvedBy,
              })
            : approval.resolvedAt
            ? t('mindroomUi.messages.approvalReceipt.resolvedAt', {
                status: statusLabel,
                timestamp: new Date(approval.resolvedAt).toLocaleString(language),
              })
            : statusLabel}
        </p>
        <ApprovalSchedule approval={approval} />
        {provenance?.kind === 'scheduled_approval' ? (
          <p>
            {provenance.approvedAt
              ? t('mindroomUi.messages.approvalReceipt.approvedWhenScheduledByAt', {
                  approver: provenance.approvedBy,
                  timestamp: formatApprovalTime(provenance.approvedAt, language),
                })
              : t('mindroomUi.messages.approvalReceipt.approvedWhenScheduledBy', {
                  approver: provenance.approvedBy,
                })}
            <br />
            {t('mindroomUi.messages.approvalSchedule.scheduledFor', {
              timestamp: formatApprovalTime(provenance.scheduledFor, language),
            })}
            <br />
            {t(scheduledScopeLabelKey(provenance.scope))}
          </p>
        ) : provenance?.kind === 'timed_grant' ? (
          <p>
            {provenance.durationSeconds
              ? t('mindroomUi.messages.approvalReceipt.timedPermissionMinutes', {
                  count: provenance.durationSeconds / 60,
                })
              : t('mindroomUi.messages.approvalReceipt.timedPermission')}
            <br />
            {provenance.grantedAt
              ? t('mindroomUi.messages.approvalReceipt.grantedByAt', {
                  grantor: provenance.grantedBy,
                  timestamp: new Date(provenance.grantedAt).toLocaleString(language),
                })
              : t('mindroomUi.messages.approvalReceipt.grantedBy', {
                  grantor: provenance.grantedBy,
                })}
            <br />
            {t('mindroomUi.messages.approvalReceipt.originalFixedExpiry', {
              timestamp: new Date(provenance.expiresAt).toLocaleString(language),
            })}
          </p>
        ) : (
          <p>
            {provenance?.kind === 'once'
              ? t('mindroomUi.messages.approvalReceipt.approvedOnce')
              : t('mindroomUi.messages.approvalReceipt.decisionRecordedForThisCall')}
          </p>
        )}
        {approval.scope && (
          <p>
            {approval.scope.operation.mcpServerId
              ? t('mindroomUi.messages.approvalReceipt.toolAndServer', {
                  tool: approval.scope.operation.toolName,
                  server: approval.scope.operation.mcpServerId,
                })
              : t('mindroomUi.messages.approvalReceipt.tool', {
                  tool: approval.scope.operation.toolName,
                })}
          </p>
        )}
        {approval.resolutionReason && (
          <p>
            {t('mindroomUi.messages.approvalReceipt.reason', {
              reason: approval.resolutionReason,
            })}
          </p>
        )}
        <ApprovalArguments approval={approval} />
        {children}
      </div>
    </details>
  );
}
