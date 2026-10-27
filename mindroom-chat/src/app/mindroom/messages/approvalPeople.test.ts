import { describe, expect, it, vi } from 'vitest';
import { agentDisplayName } from './approvalPeople';

vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('./ThreadApprovalProvider', () => ({ useThreadApprovals: () => null }));

const roomWith = (members: { userId: string; name: string }[]) => ({
  getMember: () => null,
  getJoinedMembers: () => members,
});

describe('agentDisplayName', () => {
  it('matches the agent account exactly, not another agent whose name starts the same', () => {
    expect(
      agentDisplayName(
        roomWith([
          { userId: '@mindroom_assistant_pro_ns1234:example.org', name: 'Assistant Pro' },
          { userId: '@mindroom_assistant_ns1234:example.org', name: 'Assistant' },
        ]),
        'assistant'
      )
    ).toBe('Assistant');
    expect(
      agentDisplayName(
        roomWith([
          { userId: '@mindroom_assistant_pro:example.org', name: 'Assistant Pro' },
          { userId: '@mindroom_assistant:example.org', name: 'Assistant' },
        ]),
        'assistant'
      )
    ).toBe('Assistant');
  });

  it('falls back to the agent name when no member matches', () => {
    expect(
      agentDisplayName(
        roomWith([{ userId: '@mindroom_assistant_pro:example.org', name: 'Assistant Pro' }]),
        'assistant'
      )
    ).toBe('assistant');
  });
});
