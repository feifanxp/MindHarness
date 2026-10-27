import { useTranslation } from 'react-i18next';
import { Box, Text } from 'folds';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import {
  getEffectiveToolApprovalStatus,
  getToolApprovalOperationLabel,
  MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
  parseToolApprovalExpiryTimestamp,
  ToolApprovalData,
} from './toolApproval';
import * as css from './MindroomToolApprovalCard.css';
import { ApprovalReceipt } from './ApprovalReceipt';
import { ApprovalArguments } from './ApprovalArguments';
import { ApprovalSchedule } from './ApprovalSchedule';
import { useThreadApprovals } from './ThreadApprovalProvider';
import { ApprovalReviewGroup } from './ThreadApprovalControls';
import {
  ApprovalResponseContent,
  getApprovalCapabilities,
  getApprovalGrantState,
  isApprovalPending,
} from './approvalActions';
import { useApprovalActions } from './useApprovalActions';
import { ThreadApprovalRecord } from './threadApprovalModel';
import { ApprovalDecisionControls } from './ApprovalDecisionControls';
import { ApprovalGrantStatus } from './ApprovalGrantStatus';
import { useGlassHighlight } from '../../components/glass/liquid/useLiquidGlass';
import { ApprovalMeta, ApprovalSectionHeader } from './ApprovalSection';
import { describeApprovalChip } from './approvalLabels';
import * as sectionCss from './ThreadApprovals.css';
import { useApprovalRoom } from './approvalPeople';

type MindroomToolApprovalCardProps = {
  approval: ToolApprovalData;
  roomId?: string;
  eventId?: string;
  threadId?: string;
};

const getTimestamp = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const MAX_TIMEOUT_DELAY = 2_147_483_647;

export function MindroomToolApprovalCard(props: MindroomToolApprovalCardProps) {
  const { eventId, roomId, approval, threadId } = props;
  const userId = useMatrixClient().getUserId();
  const context = useThreadApprovals();
  if (!context || context.roomId !== roomId || context.threadId !== approval.threadId)
    return (
      <StandaloneToolApprovalCard
        key={`${approval.approvalId}:${eventId ?? ''}:${roomId ?? ''}:${threadId ?? ''}`}
        {...props}
      />
    );
  const record = context.records.find(
    (item) => item.eventId === eventId || item.aliasEventIds?.includes(eventId ?? '')
  );
  if (!record) return null;
  if (context.pendingEventIds.has(record.eventId))
    return <ApprovalReviewGroup records={[record]} />;
  return (
    <ApprovalReceipt approval={record.approval}>
      <ApprovalGrantStatus
        record={record}
        userId={userId}
        action={context.actions.get(record.eventId)}
        now={context.now}
        submit={context.submit}
      />
    </ApprovalReceipt>
  );
}

function StandaloneToolApprovalCard({
  approval,
  roomId,
  eventId,
  threadId,
}: MindroomToolApprovalCardProps) {
  const glassRef = useGlassHighlight<HTMLDivElement>();
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const room = useApprovalRoom(roomId);
  const requestedTs = getTimestamp(approval.requestedAt);
  const expiresTs = parseToolApprovalExpiryTimestamp(approval.expiresAt);
  const requestedRelative = useRelativeTime(requestedTs);
  const [clockTick, setClockTick] = useState(0);
  const now = Date.now();
  const responseThreadId = threadId ?? approval.threadId ?? eventId;
  const canonicalThreadId = threadId ?? approval.threadId;
  const canSendResponse = !!roomId && !!eventId && !!responseThreadId;
  const currentUserId = mx.getUserId();
  const record = useMemo<ThreadApprovalRecord>(
    () => ({
      eventId: eventId ?? '',
      sender: '',
      wireStatus: approval.status,
      approval: { ...approval, threadId: canonicalThreadId ?? null },
    }),
    [approval, eventId, canonicalThreadId]
  );
  const records = useMemo(() => [record], [record]);
  const send = useCallback(
    (content: ApprovalResponseContent) => {
      if (!roomId || !eventId || !responseThreadId)
        throw new Error('Approval responses are unavailable here.');
      return mx.sendEvent(roomId, MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT as any, content);
    },
    [mx, roomId, eventId, responseThreadId]
  );
  const { actions, submit } = useApprovalActions(records, responseThreadId ?? '', now, send);
  const action = actions.get(record.eventId);
  const pending = isApprovalPending(record, action, now);
  const effectiveStatus = pending
    ? 'pending'
    : getEffectiveToolApprovalStatus(approval.status, expiresTs, now);
  const canUseTimedApproval =
    canSendResponse &&
    getApprovalCapabilities(record, currentUserId, undefined, now).durations.length > 0;
  const grant = approval.status === 'approved' ? approval.autoApproval : null;
  const grantState = getApprovalGrantState(record.approval, now);
  const grantExpiresTs = grant ? parseToolApprovalExpiryTimestamp(grant.expiresAt) : undefined;
  const controls = {
    record,
    userId: currentUserId,
    action,
    submit,
    now,
    canSend: canSendResponse,
  };

  useEffect(() => {
    const pendingDeadline = approval.status === 'pending' ? expiresTs : undefined;
    const grantDeadline = grantState === 'active' ? grantExpiresTs : undefined;
    const nextDeadline = [pendingDeadline, grantDeadline]
      .filter((deadline): deadline is number => deadline !== undefined)
      .sort((left, right) => left - right)[0];
    if (nextDeadline === undefined) return undefined;

    const timeUntilExpiry = nextDeadline - Date.now();
    if (timeUntilExpiry <= 0) return undefined;

    const timeoutId = setTimeout(
      () => setClockTick((tick) => tick + 1),
      Math.min(
        timeUntilExpiry,
        grantDeadline === undefined ? MAX_TIMEOUT_DELAY : timeUntilExpiry % 60_000 || 60_000
      )
    );

    return () => clearTimeout(timeoutId);
  }, [approval.status, expiresTs, clockTick, grantExpiresTs, grantState]);

  if (effectiveStatus !== 'pending') {
    return (
      <ApprovalReceipt approval={{ ...approval, status: effectiveStatus }}>
        <ApprovalGrantStatus {...controls} />
      </ApprovalReceipt>
    );
  }

  return (
    <Box
      ref={glassRef}
      className={css.Card}
      direction="Column"
      gap="200"
      aria-label={t('mindroomUi.messages.mindroomToolApprovalCard.toolApprovalRequest')}
    >
      <ApprovalSectionHeader
        operation={getToolApprovalOperationLabel(approval)}
        count={1}
        chip={describeApprovalChip(
          [record],
          new Map(action ? [[record.eventId, action]] : []),
          now,
          getApprovalCapabilities(record, currentUserId, action, now).deny
        )}
      />
      <div className={sectionCss.SectionBody}>
        <ApprovalMeta approval={approval} room={room} viewerId={currentUserId} />
        {requestedRelative && (
          <Text size="T200" className={css.MetaDot}>
            {requestedRelative}
          </Text>
        )}

        {canUseTimedApproval && (
          <Box className={css.Scope} direction="Column" gap="100">
            <Text size="T200">
              {t(
                'mindroomUi.messages.mindroomToolApprovalCard.autoApprovalAppliesToThisThreadRequesterAgentAndTool'
              )}
            </Text>
            <Text size="T200">
              {t('mindroomUi.messages.mindroomToolApprovalCard.argumentsMayDifferBetweenCalls')}
            </Text>
          </Box>
        )}

        <ApprovalSchedule approval={approval} />
        <ApprovalArguments approval={approval} />
        <ApprovalDecisionControls {...controls} showDurations />
      </div>
    </Box>
  );
}
