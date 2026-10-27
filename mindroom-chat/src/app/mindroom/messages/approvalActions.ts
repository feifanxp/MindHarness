import { approvalGroupKey, isPendingApproval, ThreadApprovalRecord } from './threadApprovalModel';
import {
  buildToolApprovalResponseContent,
  buildToolApprovalRevocationContent,
  parseToolApprovalExpiryTimestamp,
  ToolApprovalDuration,
  ToolApprovalData,
  ToolApprovalScheduledScope,
} from './toolApproval';

export type ApprovalActionState = {
  kind: 'decision' | 'revoke';
  status: 'sending' | 'submitted' | 'error';
  error?: string;
};
export type ApprovalAction =
  | {
      status: 'approved';
      duration?: ToolApprovalDuration;
      scheduledScope?: ToolApprovalScheduledScope;
      reason?: string;
    }
  | { status: 'denied'; reason?: string; duration?: never; scheduledScope?: never }
  | { revoke: true };

export type ApprovalControlProps = {
  record: ThreadApprovalRecord;
  userId: string | null;
  action: ApprovalActionState | undefined;
  submit: (record: ThreadApprovalRecord, action: ApprovalAction) => Promise<void>;
  now: number;
  canSend?: boolean;
};

export const canSubmitApprovalDecision = (
  record: ThreadApprovalRecord,
  userId: string | null,
  state: ApprovalActionState | undefined,
  now = Date.now()
): boolean =>
  isPendingApproval(record, now) &&
  (!record.approval.approverUserId || record.approval.approverUserId === userId) &&
  (!state || state.status === 'error');
export const getApprovalGrantState = (approval: ToolApprovalData, now = Date.now()) => {
  const grant = approval.status === 'approved' ? approval.autoApproval : null;
  if (!grant) return undefined;
  if (grant.revokedAt) return 'revoked';
  return (parseToolApprovalExpiryTimestamp(grant.expiresAt) ?? 0) > now ? 'active' : 'expired';
};

export const isApprovalPending = (
  record: ThreadApprovalRecord,
  state: ApprovalActionState | undefined,
  now = Date.now()
): boolean =>
  isPendingApproval(record, now) ||
  (record.wireStatus === 'pending' && state?.kind === 'decision' && state.status !== 'error');

export const getApprovalCapabilities = (
  record: ThreadApprovalRecord,
  userId: string | null,
  state: ApprovalActionState | undefined,
  now = Date.now()
) => {
  const deny = canSubmitApprovalDecision(record, userId, state, now);
  const approve = deny && record.approval.approvable;
  const originalApprover = !!userId && userId === record.approval.approverUserId;
  return {
    approve,
    deny,
    durations:
      approve && originalApprover && record.approval.threadId && !record.approval.schedule
        ? record.approval.autoApproveOptions
        : [],
    scheduledScopes:
      approve && originalApprover && record.approval.schedule?.windowSeconds
        ? record.approval.schedule.scopeOptions
        : [],
    revoke:
      originalApprover &&
      !!record.approval.threadId &&
      getApprovalGrantState(record.approval, now) === 'active' &&
      (!state || state.status === 'error'),
  };
};

export type ApprovalResponseContent =
  | ReturnType<typeof buildToolApprovalResponseContent>
  | ReturnType<typeof buildToolApprovalRevocationContent>;

export const createApprovalActions = ({
  getRecords,
  getUserId,
  threadId,
  send,
}: {
  getRecords: () => readonly ThreadApprovalRecord[];
  getUserId: () => string | null;
  threadId: string;
  send: (content: ApprovalResponseContent) => Promise<unknown>;
}) => {
  let states = new Map<string, ApprovalActionState>();
  const attempts = new Map<string, symbol>();
  const listeners = new Set<() => void>();
  const publish = () => {
    states = new Map(states);
    listeners.forEach((listener) => listener());
  };
  const relevant = (record: ThreadApprovalRecord, kind: ApprovalActionState['kind']) =>
    kind === 'decision'
      ? record.wireStatus === 'pending'
      : getApprovalGrantState(record.approval) === 'active';
  const reconcile = () => {
    let changed = false;
    states.forEach((state, id) => {
      const record = getRecords().find((item) => item.eventId === id);
      if (!record || !relevant(record, state.kind)) {
        states.delete(id);
        attempts.delete(id);
        changed = true;
      }
    });
    if (changed) publish();
  };
  const submit = async (offered: ThreadApprovalRecord, action: ApprovalAction): Promise<void> => {
    reconcile();
    const records = getRecords();
    const record = records.find((item) => item.eventId === offered.eventId);
    if (!record) return;
    const { approval, eventId } = record;
    const previous = states.get(eventId);
    if (previous && previous.status !== 'error') return;
    const user = getUserId();
    const capabilities = getApprovalCapabilities(record, user, previous);
    const grant = approval.autoApproval;
    const kind = 'revoke' in action ? 'revoke' : 'decision';
    if (!relevant(record, kind)) return;
    if ('revoke' in action) {
      if (!capabilities.revoke) return;
    } else {
      if (!(action.status === 'approved' ? capabilities.approve : capabilities.deny)) return;
      if (action.duration && !capabilities.durations.includes(action.duration)) return;
      if (action.scheduledScope && !capabilities.scheduledScopes.includes(action.scheduledScope))
        return;
      if (action.duration && action.scheduledScope) return;
    }
    const affected =
      'status' in action && action.status === 'approved' && action.duration && approval.scope
        ? records.filter(
            (item) =>
              approvalGroupKey(item) === approvalGroupKey(record) &&
              isPendingApproval(item) &&
              item.approval.approvable &&
              (!states.has(item.eventId) || states.get(item.eventId)?.status === 'error')
          )
        : [record];
    const attempt = Symbol('approval action');
    affected.forEach((item) => {
      attempts.set(item.eventId, attempt);
      states.set(item.eventId, { kind, status: 'sending' });
    });
    publish();
    let result: ApprovalActionState;
    try {
      await send(
        'revoke' in action
          ? buildToolApprovalRevocationContent(grant!.grantId, threadId, eventId)
          : buildToolApprovalResponseContent(
              action.status,
              threadId,
              eventId,
              action.reason,
              action.duration,
              action.scheduledScope
            )
      );
      result = { kind, status: 'submitted' };
    } catch (cause) {
      result = {
        kind,
        status: 'error',
        error: cause instanceof Error ? cause.message : 'Unable to send response. Try again.',
      };
    }
    affected.forEach((item) => {
      if (attempts.get(item.eventId) !== attempt) return;
      const current = getRecords().find((candidate) => candidate.eventId === item.eventId);
      if (current && relevant(current, kind)) states.set(item.eventId, result);
      else {
        states.delete(item.eventId);
        attempts.delete(item.eventId);
      }
    });
    publish();
  };
  return {
    submit,
    reconcile,
    getSnapshot: () => states as ReadonlyMap<string, ApprovalActionState>,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
