import type { ApprovalActionState } from './approvalActions';
import type { ThreadApprovalRecord } from './threadApprovalModel';
import {
  getEffectiveToolApprovalStatus,
  getToolApprovalOperationLabel,
  parseToolApprovalExpiryTimestamp,
} from './toolApproval';

export type ApprovalHistorySummary =
  | {
      kind: 'single';
      status: ThreadApprovalRecord['approval']['status'];
      /** Who decided: the viewer, another user, or nobody (expiry). */
      actor: 'you' | { userId: string } | null;
      operation: string;
    }
  | { kind: 'count'; total: number; approved: number };

export const describeApprovalHistory = (
  records: readonly ThreadApprovalRecord[],
  viewerId: string | null
): ApprovalHistorySummary => {
  if (records.length !== 1) {
    return {
      kind: 'count',
      total: records.length,
      approved: records.filter((item) => item.approval.status === 'approved').length,
    };
  }
  const { approval } = records[0];
  const resolver = approval.resolvedBy;
  return {
    kind: 'single',
    status: approval.status,
    actor: !resolver ? null : resolver === viewerId ? 'you' : { userId: resolver },
    operation: getToolApprovalOperationLabel(approval),
  };
};

export type WaitingApprovalsSummary = {
  agents: string[];
  tools: { operation: string; count: number }[];
};

export const describeWaitingApprovals = (
  groups: readonly (readonly ThreadApprovalRecord[])[]
): WaitingApprovalsSummary => {
  const records = groups.flat();
  const tools = new Map<string, number>();
  records.forEach(({ approval }) => {
    const operation = getToolApprovalOperationLabel(approval);
    tools.set(operation, (tools.get(operation) ?? 0) + 1);
  });
  return {
    agents: [...new Set(records.map(({ approval }) => approval.agentName))],
    tools: [...tools].map(([operation, count]) => ({ operation, count })),
  };
};

export type ApprovalChipLabel =
  | 'waitingForYou'
  | 'waitingForApproval'
  | 'sending'
  | 'submitted'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'resolved';

/** Status chip for a request: open, in flight, sent, or the outcome the room confirmed. */
export const describeApprovalChip = (
  records: readonly ThreadApprovalRecord[],
  actions: ReadonlyMap<string, ApprovalActionState>,
  now: number,
  canAct: boolean
): { label: ApprovalChipLabel; tone: 'attention' | 'neutral' | 'done' } => {
  const outcomes = records.map(({ approval }) =>
    getEffectiveToolApprovalStatus(
      approval.status,
      parseToolApprovalExpiryTimestamp(approval.expiresAt),
      now
    )
  );
  const open = records.filter((_, index) => outcomes[index] === 'pending');
  const states = open.map((record) => actions.get(record.eventId)?.status);
  if (states.includes('sending')) return { label: 'sending', tone: 'neutral' };
  if (states.some((status) => status !== 'submitted')) {
    return canAct
      ? { label: 'waitingForYou', tone: 'attention' }
      : { label: 'waitingForApproval', tone: 'neutral' };
  }
  if (open.length > 0) return { label: 'submitted', tone: 'done' };
  const resolved = new Set(outcomes);
  const [only] = resolved;
  return {
    label: resolved.size === 1 && only !== 'pending' ? only : 'resolved',
    tone: 'done',
  };
};

/** "send_email" reads as "Send email"; MCP operations use their tool part. */
export const toolTitle = (operation: string): string => {
  const words = (operation.split('/').pop() ?? operation).replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export type ReviewHeader = {
  agents: string[];
  count: number;
  /** "you", another requester's user ID, or null when the calls came from different people. */
  requester: string | null;
  expiresAt: string | null;
};

/** Who wants what, for the review sheet's title: agents, call count, requester, earliest expiry. */
export const describeReviewHeader = (
  records: readonly ThreadApprovalRecord[],
  viewerId: string | null
): ReviewHeader => {
  const requesters = [...new Set(records.map(({ approval }) => approval.requesterId))];
  const [requester] = requesters;
  const expiries = records
    .map(({ approval }) => approval.expiresAt)
    .filter((value): value is string => !!value)
    .map((value) => ({ value, ts: parseToolApprovalExpiryTimestamp(value) ?? Infinity }))
    .sort((a, b) => a.ts - b.ts);
  return {
    agents: [...new Set(records.map(({ approval }) => approval.agentName))],
    count: records.length,
    requester:
      requesters.length === 1 && requester ? (requester === viewerId ? 'you' : requester) : null,
    expiresAt: expiries[0]?.value ?? null,
  };
};
