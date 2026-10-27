import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { collectThreadApprovals } from '../messages/threadApprovalModel';
import { planThreadApprovalTimeline } from './threadApprovalTimeline';

const receipt = (id: string) =>
  new MatrixEvent({
    type: 'io.mindroom.tool_approval',
    event_id: id,
    room_id: '!room:example.org',
    sender: '@router:example.org',
    content: {
      approval_id: id,
      tool_name: 'shell',
      arguments: { command: id },
      agent_name: 'assistant',
      status: 'approved',
      thread_id: '$thread',
      response_event_id: '$response',
      requested_at: '2026-09-12T12:00:00Z',
      expires_at: '2026-09-12T12:30:00Z',
    },
  });
const response = new MatrixEvent({
  type: 'm.room.message',
  event_id: '$response',
  room_id: '!room:example.org',
  sender: '@assistant:example.org',
  content: { body: 'Done', msgtype: 'm.text' },
});
describe('approval timeline projection', () => {
  it('hides a stale cached approval absent from the authoritative thread records', () => {
    const plan = planThreadApprovalTimeline(
      [],
      [receipt('$a'), response],
      new Set(['$a']),
      new Set(),
      '$thread'
    );
    expect([...plan.hiddenEventIds]).toEqual(['$a']);
    expect(plan.historyByResponseId.size).toBe(0);
    expect(plan.fallbackGroupsByEventId.size).toBe(0);
  });
  it('preserves standalone rows when there is no thread approval owner', () => {
    const plan = planThreadApprovalTimeline(
      undefined,
      [receipt('$a')],
      new Set(),
      new Set(),
      '$thread'
    );
    expect(plan.hiddenEventIds.size).toBe(0);
  });
  it('groups receipts beside the loaded response and preserves a directly focused original', () => {
    const events = [receipt('$a'), response, receipt('$b')];
    const records = collectThreadApprovals(events, '!room:example.org', '$thread');
    const plan = planThreadApprovalTimeline(records, events, new Set(['$b']), new Set(), '$thread');
    expect([...plan.hiddenEventIds]).toEqual(['$a']);
    expect(plan.historyByResponseId.get('$response')?.map((record) => record.eventId)).toEqual([
      '$a',
      '$b',
    ]);
  });
  it('uses a visible fallback when the response is absent or redacted', () => {
    const events = [receipt('$a'), receipt('$b')];
    const plan = planThreadApprovalTimeline(
      collectThreadApprovals(events, '!room:example.org', '$thread'),
      events,
      new Set(),
      new Set(),
      '$thread'
    );
    expect([...plan.hiddenEventIds]).toEqual(['$b']);
    expect(plan.fallbackGroupsByEventId.get('$a')).toHaveLength(2);
  });
});
