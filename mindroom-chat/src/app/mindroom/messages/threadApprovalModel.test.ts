import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { collectThreadApprovals, groupApprovalRecords } from './threadApprovalModel';

const make = (id: string, scope = 'scope', operation = 'invite') =>
  new MatrixEvent({
    type: 'io.mindroom.tool_approval',
    event_id: id,
    room_id: '!room:example.org',
    sender: '@router:example.org',
    origin_server_ts: 1,
    content: {
      approval_id: id,
      tool_name: 'account_call_tool',
      agent_name: 'assistant',
      arguments: { target: id },
      status: 'pending',
      requested_at: '2026-09-12T12:00:00Z',
      expires_at: '2999-09-12T12:00:00Z',
      thread_id: '$thread',
      approval_scope: {
        id: scope,
        entity_name: 'assistant',
        invoking_agent: 'assistant',
        operation: {
          tool_name: 'account_call_tool',
          mcp_server_id: 'account',
          mcp_tool_name: operation,
        },
      },
    },
  });

describe('thread approval collection', () => {
  it('uses the newest same-sender decision even when it arrives before the original', () => {
    const original = make('$one');
    const edit = (id: string, ts: number, status: string, sender = original.getSender()) =>
      new MatrixEvent({
        type: original.getType(),
        event_id: id,
        room_id: original.getRoomId(),
        sender,
        origin_server_ts: ts,
        content: {
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$one' },
          'm.new_content': { ...original.getContent(), status },
        },
      });
    const result = collectThreadApprovals(
      [
        edit('$new', 3, 'approved'),
        edit('$stale', 2, 'pending'),
        edit('$forged', 4, 'denied', '@mallory:example.org'),
        original,
      ],
      '!room:example.org',
      '$thread'
    );
    expect(result).toHaveLength(1);
    expect(result[0].approval.status).toBe('approved');
  });
  it('groups only the same canonical permission and keeps exact individual targets', () => {
    const records = collectThreadApprovals(
      [make('$one'), make('$two'), make('$three', 'different'), make('$four', 'scope', 'delete')],
      '!room:example.org',
      '$thread'
    );
    expect(
      groupApprovalRecords(records).map((group) =>
        group.map((item) => item.approval.arguments.target)
      )
    ).toEqual([['$four'], ['$one', '$two'], ['$three']]);
    expect(collectThreadApprovals([make('$one')], '!other:example.org', '$thread')).toEqual([]);
  });
});

it('deduplicates republished automatic receipts while retaining alias event IDs', () => {
  const first = make('$first');
  Object.assign(first.event.content, {
    status: 'approved',
    approvable: false,
    approval_id: 'shared',
    tool_call_id: 'call',
  });
  const alias = new MatrixEvent({ ...first.event, event_id: '$alias' });
  const records = collectThreadApprovals([first, alias], '!room:example.org', '$thread');
  expect(records).toHaveLength(1);
  expect(records[0].aliasEventIds).toEqual(['$alias']);
});

it('orders requests chronologically across different timezone offsets', () => {
  const first = make('$first');
  const second = make('$second');
  first.event.content!.requested_at = '2026-09-12T09:00:00-07:00';
  second.event.content!.requested_at = '2026-09-12T10:00:00Z';
  expect(
    collectThreadApprovals([first, second], '!room:example.org', '$thread').map(
      (record) => record.eventId
    )
  ).toEqual(['$second', '$first']);
});
