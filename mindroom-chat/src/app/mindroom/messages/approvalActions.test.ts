import { describe, expect, it } from 'vitest';
import { createApprovalActions } from './approvalActions';
import { parseToolApprovalContent } from './toolApproval';
import { ThreadApprovalRecord } from './threadApprovalModel';

const record = (id: string): ThreadApprovalRecord => ({
  eventId: id,
  sender: '@router:example.org',
  wireStatus: 'pending',
  approval: parseToolApprovalContent('io.mindroom.tool_approval', {
    approval_id: id,
    tool_name: 'shell',
    arguments: { command: id },
    agent_name: 'assistant',
    approver_user_id: '@alice:example.org',
    requester_id: '@alice:example.org',
    status: 'pending',
    thread_id: '$thread',
    requested_at: '2026-09-12T12:00:00Z',
    expires_at: '2999-09-12T12:30:00Z',
    auto_approve_options: [300, 600, 1800],
    approval_scope: {
      id: 'scope',
      entity_name: 'assistant',
      invoking_agent: 'assistant',
      operation: { tool_name: 'shell' },
    },
  })!,
});

describe('approval action ownership', () => {
  it('does not resurrect a submitted decision after an early acknowledgement or overwrite a revoke', async () => {
    let current = record('$one');
    let finish!: () => void;
    const sent: unknown[] = [];
    const actions = createApprovalActions({
      getRecords: () => [current],
      getUserId: () => '@alice:example.org',
      threadId: '$thread',
      send: (content) => {
        sent.push(content);
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    });
    const decision = actions.submit(current, { status: 'approved', duration: 600 });
    const finishDecision = finish;
    current = {
      ...current,
      wireStatus: 'approved',
      approval: {
        ...current.approval,
        status: 'approved',
        autoApproval: { grantId: 'grant', expiresAt: '2999-09-12T12:30:00Z', revokedAt: null },
      },
    };
    actions.reconcile();
    const revoke = actions.submit(current, { revoke: true });
    finishDecision();
    await decision;
    expect(actions.getSnapshot().get('$one')).toMatchObject({ kind: 'revoke', status: 'sending' });
    finish();
    await revoke;
    expect(sent).toHaveLength(2);
    expect(actions.getSnapshot().get('$one')).toMatchObject({
      kind: 'revoke',
      status: 'submitted',
    });
  });
  it('blocks repeated submits until acknowledgement, while retrying only failed batch members', async () => {
    const records = [record('$one'), record('$two')];
    const sent: string[] = [];
    let fail = true;
    const actions = createApprovalActions({
      getRecords: () => records,
      getUserId: () => '@alice:example.org',
      threadId: '$thread',
      send: async (content) => {
        const id = content['m.relates_to']['m.in_reply_to'].event_id;
        sent.push(id);
        if (id === '$two' && fail) throw new Error('Offline');
      },
    });
    await Promise.all(records.map((item) => actions.submit(item, { status: 'approved' })));
    expect(actions.getSnapshot().get('$one')?.status).toBe('submitted');
    expect(actions.getSnapshot().get('$two')?.status).toBe('error');
    fail = false;
    await Promise.all(records.map((item) => actions.submit(item, { status: 'approved' })));
    expect(sent).toEqual(['$one', '$two', '$two']);
  });
});

it('limits a denial to its exact call even if an untyped caller supplies a duration', async () => {
  const records = [record('$one'), record('$two')];
  const actions = createApprovalActions({
    getRecords: () => records,
    getUserId: () => '@alice:example.org',
    threadId: '$thread',
    send: async () => undefined,
  });
  // @ts-expect-error Denials cannot carry timed approval capabilities.
  await actions.submit(records[0], { status: 'denied', duration: 300 });
  expect([...actions.getSnapshot().keys()]).toEqual(['$one']);
});
