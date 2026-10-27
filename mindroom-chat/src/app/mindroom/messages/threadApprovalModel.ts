import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { getLatestEdit } from '../../utils/room';
import {
  getEffectiveToolApprovalStatus,
  getToolApprovalRenderContent,
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApprovalContent,
  parseToolApprovalExpiryTimestamp,
  ToolApprovalData,
} from './toolApproval';

export type ThreadApprovalRecord = {
  eventId: string;
  sender: string;
  approval: ToolApprovalData;
  wireStatus: ToolApprovalData['status'];
  aliasEventIds?: string[];
};

export const collectThreadApprovals = (
  events: readonly MatrixEvent[],
  roomId: string,
  threadId: string,
  now = Date.now()
): ThreadApprovalRecord[] => {
  const redacted = new Set(
    events.flatMap((event) =>
      event.isRedaction() ? [event.getAssociatedId()] : event.isRedacted() ? [event.getId()] : []
    )
  );
  const origins = new Map<string, MatrixEvent>();
  const edits = new Map<string, MatrixEvent[]>();
  events.forEach((event) => {
    const id = event.getId();
    if (
      !id ||
      event.getRoomId() !== roomId ||
      event.isRedacted() ||
      redacted.has(id) ||
      event.getType() !== MINDROOM_TOOL_APPROVAL_EVENT
    )
      return;
    const relation = event.getRelation();
    if (relation?.rel_type === RelationType.Replace && relation.event_id) {
      const candidates = edits.get(relation.event_id) ?? [];
      candidates.push(event);
      edits.set(relation.event_id, candidates);
    } else origins.set(id, event);
  });
  const records: ThreadApprovalRecord[] = [];
  const seenReceipts = new Map<string, ThreadApprovalRecord>();
  origins.forEach((event, eventId) => {
    const candidates = [...(edits.get(eventId) ?? [])];
    const replacement = event.replacingEvent();
    if (
      replacement?.getType() === MINDROOM_TOOL_APPROVAL_EVENT &&
      !redacted.has(replacement.getId())
    )
      candidates.push(replacement);
    const latest = getLatestEdit(event, candidates);
    const approval = parseToolApprovalContent(
      event.getType(),
      getToolApprovalRenderContent(event.getOriginalContent(), latest?.getContent())
    );
    if (!approval || approval.threadId !== threadId) return;
    const sender = event.getSender() ?? '';
    const record = {
      eventId,
      sender,
      wireStatus: approval.status,
      approval: {
        ...approval,
        status: getEffectiveToolApprovalStatus(
          approval.status,
          parseToolApprovalExpiryTimestamp(approval.expiresAt),
          now
        ),
      },
      aliasEventIds: [] as string[],
    };
    // Recovery may republish a non-actionable receipt after a device change.
    // Exact call identity prevents duplicate history without merging actionable cards.
    if (approval.status === 'approved' && !approval.approvable) {
      const identity = JSON.stringify([sender, approval.approvalId, approval.toolCallId]);
      const duplicate = seenReceipts.get(identity);
      if (duplicate) {
        duplicate.aliasEventIds?.push(eventId);
        return;
      }
      seenReceipts.set(identity, record);
    }
    records.push(record);
  });
  return records.sort((a, b) => {
    const left = Date.parse(a.approval.requestedAt);
    const right = Date.parse(b.approval.requestedAt);
    return (
      (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0) ||
      a.eventId.localeCompare(b.eventId)
    );
  });
};

export const isPendingApproval = (record: ThreadApprovalRecord, now = Date.now()): boolean =>
  getEffectiveToolApprovalStatus(
    record.approval.status,
    parseToolApprovalExpiryTimestamp(record.approval.expiresAt),
    now
  ) === 'pending';

export const approvalGroupKey = ({ eventId, sender, approval }: ThreadApprovalRecord): string =>
  JSON.stringify([
    sender,
    approval.threadId,
    approval.requesterId,
    approval.approverUserId,
    approval.scope ?? eventId,
  ]);

export const groupApprovalRecords = (
  records: readonly ThreadApprovalRecord[]
): ThreadApprovalRecord[][] => {
  const groups = new Map<string, ThreadApprovalRecord[]>();
  records.forEach((record) => {
    const key = approvalGroupKey(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  });
  return [...groups.values()];
};
