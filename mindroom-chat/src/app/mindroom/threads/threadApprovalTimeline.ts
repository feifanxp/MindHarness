import { MatrixEvent } from 'matrix-js-sdk';
import { ThreadApprovalRecord, isPendingApproval } from '../messages/threadApprovalModel';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../messages/toolApproval';

export const planThreadApprovalTimeline = (
  records: readonly ThreadApprovalRecord[] | undefined,
  events: readonly MatrixEvent[],
  revealed: ReadonlySet<string>,
  ignored: ReadonlySet<string>,
  threadId?: string,
  now = Date.now(),
  pendingEventIds?: ReadonlySet<string>
) => {
  const hiddenEventIds = new Set<string>();
  const historyByResponseId = new Map<string, ThreadApprovalRecord[]>();
  const fallbackGroupsByEventId = new Map<string, ThreadApprovalRecord[]>();
  if (!records) return { hiddenEventIds, historyByResponseId, fallbackGroupsByEventId };
  const recordIds = new Set(
    records.flatMap((record) => [record.eventId, ...(record.aliasEventIds ?? [])])
  );
  // Cached timeline copies cannot restore approvals absent from the thread owner.
  events.forEach((event) => {
    const id = event.getId();
    if (
      id &&
      id !== threadId &&
      event.getType() === MINDROOM_TOOL_APPROVAL_EVENT &&
      !recordIds.has(id)
    )
      hiddenEventIds.add(id);
  });
  const loaded = new Map(
    events
      .filter((event) => !event.isRedacted() && !ignored.has(event.getSender() ?? ''))
      .map((event) => [event.getId(), event])
  );
  const fallbacks = new Map<string, ThreadApprovalRecord[]>();
  records.forEach((record) => {
    if (record.eventId === threadId || ignored.has(record.sender)) return;
    record.aliasEventIds?.forEach((id) => {
      if (!revealed.has(id)) hiddenEventIds.add(id);
    });
    if (pendingEventIds ? pendingEventIds.has(record.eventId) : isPendingApproval(record, now)) {
      if (!revealed.has(record.eventId)) hiddenEventIds.add(record.eventId);
      return;
    }
    const responseId = record.approval.responseEventId;
    const response = responseId ? loaded.get(responseId) : undefined;
    if (response && response.getType() === 'm.room.message') {
      const group = historyByResponseId.get(responseId!) ?? [];
      group.push(record);
      historyByResponseId.set(responseId!, group);
      if (!revealed.has(record.eventId)) hiddenEventIds.add(record.eventId);
    } else {
      const key = responseId ?? 'unanchored';
      const group = fallbacks.get(key) ?? [];
      group.push(record);
      fallbacks.set(key, group);
    }
  });
  fallbacks.forEach((recordsForResponse) => {
    const anchor = recordsForResponse.find(
      (record) => loaded.has(record.eventId) || record.aliasEventIds?.some((id) => loaded.has(id))
    );
    if (!anchor) return;
    const anchorId = loaded.has(anchor.eventId)
      ? anchor.eventId
      : anchor.aliasEventIds!.find((id) => loaded.has(id))!;
    hiddenEventIds.delete(anchorId);
    fallbackGroupsByEventId.set(anchorId, recordsForResponse);
    recordsForResponse.forEach((record) => {
      if (record !== anchor && !revealed.has(record.eventId)) hiddenEventIds.add(record.eventId);
    });
  });
  return { hiddenEventIds, historyByResponseId, fallbackGroupsByEventId };
};
