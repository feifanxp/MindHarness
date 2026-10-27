import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { IEncryptedFile } from '../../../types/matrix/common';

export type ToolApprovalScope = {
  id: string;
  entityName: string;
  invokingAgent: string;
  operation: { toolName: string; mcpServerId: string | null; mcpToolName: string | null };
};

export type ToolApprovalScheduledScope = 'exact_arguments' | 'any_arguments';

export type ToolApprovalProvenance =
  | { kind: 'once' }
  | {
      kind: 'timed_grant';
      grantId: string;
      grantCardEventId: string;
      grantedBy: string;
      grantedAt: string | null;
      durationSeconds: ToolApprovalDuration | null;
      expiresAt: string;
    }
  | {
      kind: 'scheduled_approval';
      approvedBy: string;
      approvedAt: string | null;
      scheduledFor: string;
      scope: ToolApprovalScheduledScope;
    };

// A card asking to approve a tool call that a scheduled task will make later.
export type ToolApprovalSchedule = {
  taskId: string;
  scheduledFor: string;
  windowSeconds: number | null;
  scopeOptions: ToolApprovalScheduledScope[];
  approvedScope: ToolApprovalScheduledScope | null;
};

export type ApprovalArgumentSource = { mxcUri: string; encryptedFile?: IEncryptedFile };

export const MINDROOM_TOOL_APPROVAL_EVENT = 'io.mindroom.tool_approval';
export const MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT = 'io.mindroom.tool_approval_response';

export type ToolApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type ToolApprovalDuration = 300 | 600 | 1800;

export interface ToolAutoApprovalData {
  grantId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface ToolApprovalData {
  approvalId: string;
  toolName: string;
  toolCallId: string | null;
  arguments: Record<string, unknown>;
  agentName: string;
  requesterId: string | null;
  approverUserId: string | null;
  approvable: boolean;
  status: ToolApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  threadId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionReason: string | null;
  autoApproveOptions: ToolApprovalDuration[];
  autoApproval: ToolAutoApprovalData | null;
  scope: ToolApprovalScope | null;
  provenance: ToolApprovalProvenance | null;
  responseEventId: string | null;
  argumentsTruncated: boolean;
  fullArguments: Record<string, unknown> | null;
  argumentSource: ApprovalArgumentSource | null;
  schedule: ToolApprovalSchedule | null;
}

type ToolApprovalResponseStatus = 'approved' | 'denied';

type ToolApprovalResponseContent = {
  status: ToolApprovalResponseStatus;
  reason?: string | null;
  auto_approve_seconds?: ToolApprovalDuration;
  scheduled_scope?: ToolApprovalScheduledScope;
  'm.relates_to': {
    rel_type: RelationType.Thread;
    event_id: string;
    is_falling_back: true;
    'm.in_reply_to': {
      event_id: string;
    };
  };
};

type ToolApprovalRevocationContent = {
  action: 'revoke_auto_approval';
  grant_id: string;
  'm.relates_to': ToolApprovalResponseContent['m.relates_to'];
};

const TOOL_APPROVAL_STATUSES = new Set<ToolApprovalStatus>([
  'pending',
  'approved',
  'denied',
  'expired',
]);
const TOOL_APPROVAL_DURATIONS: readonly ToolApprovalDuration[] = [300, 600, 1800];
const TOOL_APPROVAL_SCHEDULED_SCOPES: readonly ToolApprovalScheduledScope[] = [
  'exact_arguments',
  'any_arguments',
];

const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;

export const parseToolApprovalExpiryTimestamp = (value: string): number | undefined => {
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return undefined;

  const [
    ,
    yearValue,
    monthValue,
    dayValue,
    hourValue,
    minuteValue,
    secondValue,
    fractionValue,
    timezoneValue,
    offsetSignValue,
    offsetHourValue,
    offsetMinuteValue,
  ] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  const millisecond = Number((fractionValue ?? '').padEnd(3, '0').slice(0, 3));
  const offsetHour = Number(offsetHourValue ?? 0);
  const offsetMinute = Number(offsetMinuteValue ?? 0);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }

  // Avoid Date.parse because the backend emits sub-millisecond fractions, whose support varies
  // between browser engines.
  const wallClockDate = new Date(0);
  wallClockDate.setUTCFullYear(year, month - 1, day);
  wallClockDate.setUTCHours(hour, minute, second, millisecond);

  if (
    wallClockDate.getUTCFullYear() !== year ||
    wallClockDate.getUTCMonth() !== month - 1 ||
    wallClockDate.getUTCDate() !== day
  ) {
    return undefined;
  }

  const offsetDirection = offsetSignValue === '-' ? -1 : 1;
  const offsetMilliseconds =
    timezoneValue === 'Z' ? 0 : offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  return wallClockDate.getTime() - offsetMilliseconds;
};

export const getEffectiveToolApprovalStatus = (
  status: ToolApprovalStatus,
  expiresTs: number | undefined,
  currentTime = Date.now()
): ToolApprovalStatus => {
  if (status !== 'pending') return status;
  if (expiresTs === undefined) return status;

  return expiresTs <= currentTime ? 'expired' : status;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getApprovalCandidates = (content: Record<string, unknown>): Record<string, unknown>[] => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  return newContent ? [newContent, content] : [content];
};

const immutableRequestFields = new Set([
  'approval_id',
  'tool_name',
  'tool_call_id',
  'arguments',
  'agent_name',
  'requester_id',
  'approver_user_id',
  'approvable',
  'auto_approve_options',
  'requested_at',
  'created_at',
  'expires_at',
  'thread_id',
  'approval_scope',
  'response_event_id',
  'arguments_truncated',
  'full_arguments',
  'full_arguments_file',
  'full_arguments_url',
  'full_arguments_info',
  'approval_target',
  'scheduled_task_id',
  'scheduled_for',
  'scheduled_window_seconds',
  'scheduled_scope_options',
]);

const pickCandidateValue = (content: Record<string, unknown>, key: string): unknown | undefined => {
  // A decision updates status and grant state, never the exact request being reviewed.
  if (immutableRequestFields.has(key) && content[key] !== undefined) return content[key];
  const candidates = getApprovalCandidates(content);

  for (let i = 0; i < candidates.length; i += 1) {
    const value = candidates[i][key];
    if (value !== undefined) return value;
  }

  return undefined;
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const asNullableString = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  return asString(value);
};

const asStatus = (value: unknown): ToolApprovalStatus | undefined => {
  if (typeof value !== 'string') return undefined;
  return TOOL_APPROVAL_STATUSES.has(value as ToolApprovalStatus)
    ? (value as ToolApprovalStatus)
    : undefined;
};

const asArguments = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  return value;
};

const asApprovable = (value: unknown): boolean => {
  if (value === undefined) return true;
  return typeof value === 'boolean' ? value : false;
};

const asAutoApproveOptions = (value: unknown): ToolApprovalDuration[] => {
  if (!Array.isArray(value) || value.length !== TOOL_APPROVAL_DURATIONS.length) return [];
  if (!TOOL_APPROVAL_DURATIONS.every((duration, index) => value[index] === duration)) return [];
  return [...TOOL_APPROVAL_DURATIONS];
};

const asAutoApproval = (value: unknown): ToolAutoApprovalData | null => {
  if (!isRecord(value)) return null;

  const grantId = asString(value.grant_id);
  const expiresAt = asString(value.expires_at);
  const revokedAt = asNullableString(value.revoked_at);
  if (
    !grantId ||
    !expiresAt ||
    parseToolApprovalExpiryTimestamp(expiresAt) === undefined ||
    revokedAt === undefined ||
    (revokedAt !== null && parseToolApprovalExpiryTimestamp(revokedAt) === undefined)
  ) {
    return null;
  }

  return { grantId, expiresAt, revokedAt };
};

const asScope = (value: unknown): ToolApprovalScope | null => {
  if (!isRecord(value) || !isRecord(value.operation)) return null;
  const id = asString(value.id);
  const entityName = asString(value.entity_name);
  const invokingAgent = asString(value.invoking_agent);
  const toolName = asString(value.operation.tool_name);
  const mcpServerId = asNullableString(value.operation.mcp_server_id) ?? null;
  const mcpToolName = asNullableString(value.operation.mcp_tool_name) ?? null;
  if (!id || !entityName || !invokingAgent || !toolName || !!mcpServerId !== !!mcpToolName)
    return null;
  return { id, entityName, invokingAgent, operation: { toolName, mcpServerId, mcpToolName } };
};

const isTimestamp = (value: string | undefined): value is string =>
  !!value && parseToolApprovalExpiryTimestamp(value) !== undefined;

const asScheduledScope = (value: unknown): ToolApprovalScheduledScope | null =>
  TOOL_APPROVAL_SCHEDULED_SCOPES.includes(value as ToolApprovalScheduledScope)
    ? (value as ToolApprovalScheduledScope)
    : null;

const asSchedule = (content: Record<string, unknown>): ToolApprovalSchedule | null => {
  if (pickCandidateValue(content, 'approval_target') !== 'scheduled_call') return null;
  const taskId = asString(pickCandidateValue(content, 'scheduled_task_id'));
  const scheduledFor = asString(pickCandidateValue(content, 'scheduled_for'));
  if (!taskId || !isTimestamp(scheduledFor)) return null;
  const windowSeconds = pickCandidateValue(content, 'scheduled_window_seconds');
  const scopeOptions = pickCandidateValue(content, 'scheduled_scope_options');
  return {
    taskId,
    scheduledFor,
    // The approver is told the window in whole minutes, so only such a window is usable.
    windowSeconds:
      typeof windowSeconds === 'number' &&
      Number.isInteger(windowSeconds) &&
      windowSeconds > 0 &&
      windowSeconds % 60 === 0
        ? windowSeconds
        : null,
    scopeOptions:
      Array.isArray(scopeOptions) &&
      scopeOptions.length === TOOL_APPROVAL_SCHEDULED_SCOPES.length &&
      TOOL_APPROVAL_SCHEDULED_SCOPES.every((scope, index) => scopeOptions[index] === scope)
        ? [...TOOL_APPROVAL_SCHEDULED_SCOPES]
        : [],
    approvedScope: asScheduledScope(pickCandidateValue(content, 'scheduled_scope')),
  };
};

const asProvenance = (value: unknown): ToolApprovalProvenance | null => {
  if (!isRecord(value)) return null;
  if (value.kind === 'once') return { kind: 'once' };
  if (value.kind === 'scheduled_approval') {
    const approvedBy = asString(value.approved_by);
    const approvedAt = asString(value.approved_at);
    const scheduledFor = asString(value.scheduled_for);
    const scope = asScheduledScope(value.scope);
    if (!approvedBy || !isTimestamp(scheduledFor) || !scope) return null;
    return {
      kind: 'scheduled_approval',
      approvedBy,
      approvedAt: isTimestamp(approvedAt) ? approvedAt : null,
      scheduledFor,
      scope,
    };
  }
  const grantId = asString(value.grant_id);
  const grantCardEventId = asString(value.grant_card_event_id);
  const grantedBy = asString(value.granted_by);
  const grantedAt = asString(value.granted_at);
  const expiresAt = asString(value.expires_at);
  if (
    value.kind !== 'timed_grant' ||
    !grantId ||
    !grantCardEventId ||
    !grantedBy ||
    !expiresAt ||
    parseToolApprovalExpiryTimestamp(expiresAt) === undefined
  )
    return null;
  return {
    kind: 'timed_grant',
    grantId,
    grantCardEventId,
    grantedBy,
    grantedAt:
      grantedAt && parseToolApprovalExpiryTimestamp(grantedAt) !== undefined ? grantedAt : null,
    expiresAt,
    durationSeconds: TOOL_APPROVAL_DURATIONS.includes(
      value.duration_seconds as ToolApprovalDuration
    )
      ? (value.duration_seconds as ToolApprovalDuration)
      : null,
  };
};

const asArgumentSource = (content: Record<string, unknown>): ApprovalArgumentSource | null => {
  const file = pickCandidateValue(content, 'full_arguments_file');
  if (
    isRecord(file) &&
    typeof file.url === 'string' &&
    file.url.startsWith('mxc://') &&
    isRecord(file.key) &&
    typeof file.iv === 'string' &&
    isRecord(file.hashes) &&
    typeof file.hashes.sha256 === 'string' &&
    file.v === 'v2'
  ) {
    return { mxcUri: file.url, encryptedFile: file as unknown as IEncryptedFile };
  }
  const url = pickCandidateValue(content, 'full_arguments_url');
  return typeof url === 'string' && url.startsWith('mxc://') ? { mxcUri: url } : null;
};

export const getToolApprovalOperationLabel = (approval: ToolApprovalData): string => {
  const operation = approval.scope?.operation;
  return operation?.mcpServerId && operation.mcpToolName
    ? `${operation.mcpServerId} / ${operation.mcpToolName}`
    : approval.toolName;
};

export const parseToolApprovalContent = (
  eventType: string,
  content: Record<string, unknown>
): ToolApprovalData | null => {
  if (eventType !== MINDROOM_TOOL_APPROVAL_EVENT) return null;

  const approvalId = asString(pickCandidateValue(content, 'approval_id'));
  const toolName = asString(pickCandidateValue(content, 'tool_name'));
  const toolCallId = asNullableString(pickCandidateValue(content, 'tool_call_id'));
  const toolArguments = asArguments(pickCandidateValue(content, 'arguments'));
  const agentName = asString(pickCandidateValue(content, 'agent_name'));
  const requesterId = asNullableString(pickCandidateValue(content, 'requester_id'));
  const approverUserId = asNullableString(pickCandidateValue(content, 'approver_user_id'));
  const approvable = asApprovable(pickCandidateValue(content, 'approvable'));
  const status = asStatus(pickCandidateValue(content, 'status'));
  const requestedAt =
    asString(pickCandidateValue(content, 'requested_at')) ??
    asString(pickCandidateValue(content, 'created_at'));
  const expiresAt = asString(pickCandidateValue(content, 'expires_at'));
  const threadId = asNullableString(pickCandidateValue(content, 'thread_id'));
  const resolvedAt = asNullableString(pickCandidateValue(content, 'resolved_at'));
  const resolvedBy = asNullableString(pickCandidateValue(content, 'resolved_by'));
  const resolutionReason = asNullableString(pickCandidateValue(content, 'resolution_reason'));
  const autoApproveOptions = asAutoApproveOptions(
    pickCandidateValue(content, 'auto_approve_options')
  );
  const autoApproval = asAutoApproval(pickCandidateValue(content, 'auto_approval'));

  if (
    !approvalId ||
    !toolName ||
    !toolArguments ||
    !agentName ||
    !status ||
    !requestedAt ||
    !expiresAt
  ) {
    return null;
  }

  return {
    approvalId,
    toolName,
    toolCallId: toolCallId ?? null,
    arguments: toolArguments,
    agentName,
    requesterId: requesterId ?? null,
    approverUserId: approverUserId ?? null,
    approvable,
    status,
    requestedAt,
    expiresAt,
    threadId: threadId ?? null,
    resolvedAt: resolvedAt ?? null,
    resolvedBy: resolvedBy ?? null,
    resolutionReason: resolutionReason ?? null,
    autoApproveOptions,
    autoApproval,
    scope: asScope(pickCandidateValue(content, 'approval_scope')),
    provenance: asProvenance(pickCandidateValue(content, 'approval_provenance')),
    responseEventId: asString(pickCandidateValue(content, 'response_event_id')) ?? null,
    argumentsTruncated: pickCandidateValue(content, 'arguments_truncated') === true,
    fullArguments: asArguments(pickCandidateValue(content, 'full_arguments')) ?? null,
    argumentSource: asArgumentSource(content),
    schedule: asSchedule(content),
  };
};

export const getToolApprovalRenderContent = (
  content: Record<string, unknown>,
  editedContent?: Record<string, unknown>
): Record<string, unknown> => {
  if (!editedContent) return content;

  const newContent = isRecord(editedContent['m.new_content'])
    ? (editedContent['m.new_content'] as Record<string, unknown>)
    : editedContent;

  return {
    ...content,
    'm.new_content': newContent,
  };
};

const buildToolApprovalRelation = (
  threadId: string,
  eventId: string
): ToolApprovalResponseContent['m.relates_to'] => ({
  rel_type: RelationType.Thread,
  event_id: threadId,
  is_falling_back: true,
  'm.in_reply_to': {
    event_id: eventId,
  },
});

export const buildToolApprovalResponseContent = (
  status: ToolApprovalResponseStatus,
  threadId: string,
  eventId: string,
  reason?: string,
  autoApproveSeconds?: ToolApprovalDuration,
  scheduledScope?: ToolApprovalScheduledScope
): ToolApprovalResponseContent => ({
  status,
  ...(status === 'denied' ? { reason: reason?.trim() ? reason.trim() : null } : {}),
  ...(status === 'approved' && autoApproveSeconds !== undefined
    ? { auto_approve_seconds: autoApproveSeconds }
    : {}),
  ...(status === 'approved' && scheduledScope !== undefined
    ? { scheduled_scope: scheduledScope }
    : {}),
  'm.relates_to': buildToolApprovalRelation(threadId, eventId),
});

export const buildToolApprovalRevocationContent = (
  grantId: string,
  threadId: string,
  eventId: string
): ToolApprovalRevocationContent => ({
  action: 'revoke_auto_approval',
  grant_id: grantId,
  'm.relates_to': buildToolApprovalRelation(threadId, eventId),
});

export function parseToolApproval(event: MatrixEvent): ToolApprovalData | null {
  if (event.isRedacted()) return null;
  const original = event.getOriginalContent();
  const replacement = event.replacingEvent();
  return parseToolApprovalContent(
    event.getType(),
    getToolApprovalRenderContent(
      original,
      replacement?.getSender() === event.getSender() && !replacement?.isRedacted()
        ? replacement?.getContent()
        : undefined
    )
  );
}

// Failed SDK decryption presents as m.room.message / m.bad.encrypted until keys arrive.
export const isUndecryptedApprovalCandidate = (event: MatrixEvent): boolean =>
  !event.isRedacted() && (event.getType() === 'm.room.encrypted' || event.isDecryptionFailure());
