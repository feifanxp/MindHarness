import { describe, expect, it } from 'vitest';
import {
  describeApprovalChip,
  describeReviewHeader,
  toolTitle,
  describeApprovalHistory,
  describeWaitingApprovals,
} from './approvalLabels';
import type { ApprovalActionState } from './approvalActions';
import type { ThreadApprovalRecord } from './threadApprovalModel';
import type { ToolApprovalData } from './toolApproval';

const record = (overrides: Partial<ToolApprovalData>, eventId = '$one'): ThreadApprovalRecord => {
  const approval = {
    approvalId: eventId,
    toolName: 'read_file',
    agentName: 'research',
    status: 'pending',
    resolvedBy: null,
    scope: null,
    ...overrides,
  } as ToolApprovalData;
  return {
    eventId,
    sender: '@mindroom_research:example.org',
    approval,
    wireStatus: approval.status,
  };
};

describe('describeApprovalHistory', () => {
  it('names one decision by its resolver, using "you" for the viewer', () => {
    expect(
      describeApprovalHistory(
        [record({ status: 'approved', resolvedBy: '@me:example.org' })],
        '@me:example.org'
      )
    ).toEqual({ kind: 'single', status: 'approved', actor: 'you', operation: 'read_file' });
    expect(
      describeApprovalHistory(
        [record({ status: 'denied', toolName: 'run_shell', resolvedBy: '@grace:example.org' })],
        '@me:example.org'
      )
    ).toEqual({
      kind: 'single',
      status: 'denied',
      actor: { userId: '@grace:example.org' },
      operation: 'run_shell',
    });
  });

  it('omits the actor when nobody resolved the call, as with expiry', () => {
    expect(describeApprovalHistory([record({ status: 'expired' })], '@me:example.org')).toEqual({
      kind: 'single',
      status: 'expired',
      actor: null,
      operation: 'read_file',
    });
  });

  it('counts several decisions', () => {
    expect(
      describeApprovalHistory(
        [record({ status: 'approved' }, '$a'), record({ status: 'denied' }, '$b')],
        '@me:example.org'
      )
    ).toEqual({ kind: 'count', total: 2, approved: 1 });
  });
});

describe('describeWaitingApprovals', () => {
  it('names the agent and counts repeated tools', () => {
    expect(
      describeWaitingApprovals([
        [record({ toolName: 'send_email' }, '$a')],
        [record({ toolName: 'send_message' }, '$b'), record({ toolName: 'send_message' }, '$c')],
      ])
    ).toEqual({
      agents: ['research'],
      tools: [
        { operation: 'send_email', count: 1 },
        { operation: 'send_message', count: 2 },
      ],
    });
  });

  it('lists each distinct agent once', () => {
    expect(
      describeWaitingApprovals([
        [record({ agentName: 'research' }, '$a')],
        [record({ agentName: 'planner', toolName: 'create_event' }, '$b')],
      ]).agents
    ).toEqual(['research', 'planner']);
  });
});

describe('describeApprovalChip', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const open = (eventId: string) => record({ expiresAt: '2026-10-13T12:00:00Z' }, eventId);
  const chip = (
    records: ThreadApprovalRecord[],
    states: Record<string, ApprovalActionState['status']> = {},
    canAct = true
  ) =>
    describeApprovalChip(
      records,
      new Map(
        Object.entries(states).map(([eventId, status]) => [eventId, { kind: 'decision', status }])
      ),
      now,
      canAct
    );

  it('asks for attention while a call is open and the viewer can act', () => {
    expect(chip([open('$a')])).toEqual({ label: 'waitingForYou', tone: 'attention' });
    expect(chip([open('$a')], {}, false)).toEqual({ label: 'waitingForApproval', tone: 'neutral' });
    expect(chip([open('$a')], { $a: 'error' })).toEqual({
      label: 'waitingForYou',
      tone: 'attention',
    });
  });

  it('reports sending before submitted, and submitted once every open call was sent', () => {
    expect(chip([open('$a'), open('$b')], { $a: 'sending', $b: 'submitted' })).toEqual({
      label: 'sending',
      tone: 'neutral',
    });
    expect(chip([open('$a'), record({ status: 'approved' }, '$b')], { $a: 'submitted' })).toEqual({
      label: 'submitted',
      tone: 'done',
    });
  });

  it('shows the outcome once the room confirms every call', () => {
    expect(chip([record({ status: 'approved' }, '$a')])).toEqual({
      label: 'approved',
      tone: 'done',
    });
    expect(chip([record({ status: 'denied' }, '$a'), record({ status: 'denied' }, '$b')])).toEqual({
      label: 'denied',
      tone: 'done',
    });
    expect(chip([record({ expiresAt: '2026-10-12T11:00:00Z' }, '$a')])).toEqual({
      label: 'expired',
      tone: 'done',
    });
    expect(
      chip([record({ status: 'approved' }, '$a'), record({ status: 'denied' }, '$b')])
    ).toEqual({ label: 'resolved', tone: 'done' });
  });
});

describe('toolTitle', () => {
  it('reads a tool name as words', () => {
    expect(toolTitle('send_email')).toBe('Send email');
    expect(toolTitle('run-shell-command')).toBe('Run shell command');
    expect(toolTitle('github / create_issue')).toBe('Create issue');
  });
});

describe('describeReviewHeader', () => {
  it('names the one agent, the call count, the requester, and the earliest expiry', () => {
    expect(
      describeReviewHeader(
        [
          record({ requesterId: '@me:example.org', expiresAt: '2026-10-13T12:00:00Z' }, '$a'),
          record({ requesterId: '@me:example.org', expiresAt: '2026-10-13T09:00:00Z' }, '$b'),
        ],
        '@me:example.org'
      )
    ).toEqual({
      agents: ['research'],
      count: 2,
      requester: 'you',
      expiresAt: '2026-10-13T09:00:00Z',
    });
  });

  it('leaves out the requester when calls came from different people', () => {
    expect(
      describeReviewHeader(
        [
          record({ requesterId: '@me:example.org', expiresAt: null }, '$a'),
          record(
            { requesterId: '@grace:example.org', agentName: 'planner', expiresAt: null },
            '$b'
          ),
        ],
        '@me:example.org'
      )
    ).toEqual({ agents: ['research', 'planner'], count: 2, requester: null, expiresAt: null });
  });
});
