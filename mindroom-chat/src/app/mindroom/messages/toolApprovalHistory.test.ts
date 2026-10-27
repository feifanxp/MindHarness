import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  getToolApprovalOperationLabel,
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApproval,
} from './toolApproval';

const original = {
  approval_id: 'approval',
  tool_name: 'account_call_tool',
  agent_name: 'assistant',
  arguments: { command: 'preview' },
  arguments_truncated: true,
  full_arguments: { command: 'the exact command' },
  status: 'pending',
  requested_at: '2026-09-12T12:00:00Z',
  expires_at: '2026-09-12T12:30:00Z',
  thread_id: '$thread',
  response_event_id: '$response',
  approval_scope: {
    id: 'scope',
    entity_name: 'assistant',
    invoking_agent: 'assistant',
    operation: {
      tool_name: 'account_call_tool',
      mcp_server_id: 'account',
      mcp_tool_name: 'matrix_invite_user',
    },
  },
};

describe('approval history', () => {
  it('distinguishes identically named tools and arguments on different MCP servers', () => {
    const labels = ['personal', 'company'].map((server) => {
      const event = new MatrixEvent({
        type: MINDROOM_TOOL_APPROVAL_EVENT,
        content: {
          ...original,
          arguments: { query: 'project' },
          approval_scope: {
            ...original.approval_scope,
            operation: {
              tool_name: `${server}_call_tool`,
              mcp_server_id: server,
              mcp_tool_name: 'search',
            },
          },
        },
      });
      return getToolApprovalOperationLabel(parseToolApproval(event)!);
    });
    expect(labels).toEqual(['personal / search', 'company / search']);
  });

  it('keeps complete original arguments when an SDK replacement contains only a preview', () => {
    const event = new MatrixEvent({
      type: MINDROOM_TOOL_APPROVAL_EVENT,
      event_id: '$approval',
      sender: '@router:example.org',
      content: original,
    });
    event.makeReplaced(
      new MatrixEvent({
        type: MINDROOM_TOOL_APPROVAL_EVENT,
        event_id: '$edit',
        sender: '@router:example.org',
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
          'm.new_content': {
            ...original,
            full_arguments: undefined,
            status: 'approved',
            approval_provenance: {
              kind: 'timed_grant',
              grant_id: 'grant',
              grant_card_event_id: '$approval',
              granted_by: '@alice:example.org',
              granted_at: '2026-09-12T12:01:00Z',
              duration_seconds: 600,
              expires_at: '2026-09-12T12:11:00Z',
            },
            auto_approval: {
              grant_id: 'grant',
              expires_at: '2026-09-12T12:11:00Z',
              revoked_at: '2026-09-12T12:02:00Z',
            },
          },
        },
      })
    );
    const approval = parseToolApproval(event);
    expect(approval?.status).toBe('approved');
    expect(approval?.fullArguments).toEqual({ command: 'the exact command' });
    expect(approval?.scope?.operation.mcpToolName).toBe('matrix_invite_user');
    expect(approval?.responseEventId).toBe('$response');
    expect(approval?.provenance).toMatchObject({
      kind: 'timed_grant',
      expiresAt: '2026-09-12T12:11:00Z',
      durationSeconds: 600,
    });
  });
});

it('does not expand the original call’s approval capabilities through a replacement', () => {
  const event = new MatrixEvent({
    type: MINDROOM_TOOL_APPROVAL_EVENT,
    event_id: '$approval',
    sender: '@router:example.org',
    content: { ...original, approvable: false, auto_approve_options: [] },
  });
  event.makeReplaced(
    new MatrixEvent({
      type: event.getType(),
      event_id: '$edit',
      sender: event.getSender(),
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
        'm.new_content': { ...original, approvable: true, auto_approve_options: [600] },
      },
    })
  );
  expect(parseToolApproval(event)).toMatchObject({ approvable: false, autoApproveOptions: [] });
});
