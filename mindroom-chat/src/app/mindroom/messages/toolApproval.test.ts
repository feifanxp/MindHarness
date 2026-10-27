import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildToolApprovalResponseContent,
  getEffectiveToolApprovalStatus,
  getToolApprovalRenderContent,
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApproval,
  parseToolApprovalContent,
  parseToolApprovalExpiryTimestamp,
} from './toolApproval';

const makeApprovalEvent = (content: Record<string, unknown>, type = MINDROOM_TOOL_APPROVAL_EVENT) =>
  new MatrixEvent({
    content,
    event_id: '$approval',
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type,
  });

describe('parseToolApprovalExpiryTimestamp', () => {
  it('parses sub-millisecond fractions and numeric offsets deterministically', () => {
    const expected = Date.UTC(2026, 3, 26, 2, 46, 29, 899);

    expect(parseToolApprovalExpiryTimestamp('2026-04-26T02:46:29.899252+00:00')).toBe(expected);
    expect(parseToolApprovalExpiryTimestamp('2026-04-26T04:16:29.899252+01:30')).toBe(expected);
    expect(parseToolApprovalExpiryTimestamp('2026-04-25T21:16:29.899252-05:30')).toBe(expected);
    expect(parseToolApprovalExpiryTimestamp('2026-04-26T02:46:29.8Z')).toBe(
      Date.UTC(2026, 3, 26, 2, 46, 29, 800)
    );
  });

  it('accepts leap-day timestamps only in leap years', () => {
    expect(parseToolApprovalExpiryTimestamp('2028-02-29T12:00:00Z')).toBe(
      Date.UTC(2028, 1, 29, 12, 0, 0)
    );
    expect(parseToolApprovalExpiryTimestamp('2000-02-29T12:00:00Z')).toBe(
      Date.UTC(2000, 1, 29, 12, 0, 0)
    );
    expect(parseToolApprovalExpiryTimestamp('2026-02-29T12:00:00Z')).toBeUndefined();
    expect(parseToolApprovalExpiryTimestamp('1900-02-29T12:00:00Z')).toBeUndefined();
  });

  it('rejects invalid calendar and offset values', () => {
    [
      'not-a-timestamp',
      '0',
      '2026-02-30T12:00:00Z',
      '2026-04-31T12:00:00Z',
      '2026-04-26T02:46:29',
      '2026-04-26T02:46:29+24:00',
      '2026-04-26T02:46:29+00:60',
    ].forEach((value) => {
      expect(parseToolApprovalExpiryTimestamp(value)).toBeUndefined();
    });
  });
});

describe('getEffectiveToolApprovalStatus', () => {
  it('expires a pending approval exactly at its deadline', () => {
    expect(getEffectiveToolApprovalStatus('pending', 1_000, 999)).toBe('pending');
    expect(getEffectiveToolApprovalStatus('pending', 1_000, 1_000)).toBe('expired');
    expect(getEffectiveToolApprovalStatus('pending', 1_000, 1_001)).toBe('expired');
  });

  it('keeps a pending approval without a parsed deadline pending', () => {
    expect(getEffectiveToolApprovalStatus('pending', undefined, 1_000)).toBe('pending');
  });

  it('passes terminal statuses through regardless of the deadline', () => {
    (['approved', 'denied', 'expired'] as const).forEach((status) => {
      expect(getEffectiveToolApprovalStatus(status, 1_000, 2_000)).toBe(status);
      expect(getEffectiveToolApprovalStatus(status, 2_000, 1_000)).toBe(status);
    });
  });
});

describe('parseToolApproval', () => {
  it('parses a pending approval event', () => {
    const event = makeApprovalEvent({
      approval_id: 'approval-1',
      tool_name: 'web_search',
      tool_call_id: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agent_name: 'research',
      requester_id: '@alice:example.org',
      status: 'pending',
      requested_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      thread_id: '$thread-root',
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
    });

    expect(parseToolApproval(event)).toEqual({
      approvalId: 'approval-1',
      toolName: 'web_search',
      toolCallId: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agentName: 'research',
      requesterId: '@alice:example.org',
      approverUserId: null,
      approvable: true,
      status: 'pending',
      requestedAt: '2026-04-10T12:00:00Z',
      expiresAt: '2026-04-17T12:00:00Z',
      threadId: '$thread-root',
      resolvedAt: null,
      resolvedBy: null,
      resolutionReason: null,
      autoApproveOptions: [],
      autoApproval: null,
      scope: null,
      provenance: null,
      responseEventId: null,
      argumentsTruncated: false,
      fullArguments: null,
      argumentSource: null,
      schedule: null,
    });
  });

  it('parses only the exact timed approval capability and a valid grant acknowledgement', () => {
    const baseContent = {
      approval_id: 'approval-1',
      tool_name: 'web_search',
      tool_call_id: 'approval-1',
      arguments: { query: 'release date' },
      agent_name: 'research',
      requester_id: '@alice:example.org',
      approver_user_id: '@alice:example.org',
      status: 'approved',
      requested_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      thread_id: '$thread-root',
      resolved_at: '2026-04-10T12:01:00Z',
      resolved_by: '@alice:example.org',
      resolution_reason: null,
    };

    expect(
      parseToolApprovalContent(MINDROOM_TOOL_APPROVAL_EVENT, {
        ...baseContent,
        auto_approve_options: [300, 600, 1800],
        auto_approval: {
          grant_id: 'grant-1',
          expires_at: '2026-04-10T12:11:00Z',
          revoked_at: null,
        },
      })
    ).toMatchObject({
      approverUserId: '@alice:example.org',
      autoApproveOptions: [300, 600, 1800],
      autoApproval: {
        grantId: 'grant-1',
        expiresAt: '2026-04-10T12:11:00Z',
        revokedAt: null,
      },
    });

    expect(
      parseToolApprovalContent(MINDROOM_TOOL_APPROVAL_EVENT, {
        ...baseContent,
        auto_approve_options: [300, 600],
        auto_approval: {
          grant_id: 'grant-1',
          expires_at: 'not-a-timestamp',
          revoked_at: null,
        },
      })
    ).toMatchObject({
      autoApproveOptions: [],
      autoApproval: null,
      scope: null,
      provenance: null,
      responseEventId: null,
      argumentsTruncated: false,
      fullArguments: null,
      argumentSource: null,
      schedule: null,
    });
  });

  it('preserves an explicit non-approvable card while rejecting malformed capability flags', () => {
    const baseContent = {
      approval_id: 'approval-1',
      tool_name: 'web_search',
      tool_call_id: 'approval-1',
      arguments: { query: 'release date' },
      agent_name: 'research',
      requester_id: '@alice:example.org',
      approver_user_id: '@alice:example.org',
      status: 'pending',
      requested_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      thread_id: '$thread-root',
      auto_approve_options: [300, 600, 1800],
    };

    expect(
      parseToolApprovalContent(MINDROOM_TOOL_APPROVAL_EVENT, {
        ...baseContent,
        approvable: false,
      })
    ).toMatchObject({ approvable: false });
    expect(
      parseToolApprovalContent(MINDROOM_TOOL_APPROVAL_EVENT, {
        ...baseContent,
        approvable: 'yes',
      })
    ).toMatchObject({ approvable: false });
  });

  it('prefers m.new_content but falls back to original fields omitted by the edit wrapper', () => {
    const event = makeApprovalEvent({
      approval_id: 'approval-1',
      tool_name: 'web_search',
      tool_call_id: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agent_name: 'research',
      requester_id: '@alice:example.org',
      status: 'pending',
      requested_at: '2026-04-10T12:00:00Z',
      expires_at: '2026-04-17T12:00:00Z',
      thread_id: '$thread-root',
      resolved_at: null,
      resolved_by: null,
      resolution_reason: null,
      'm.new_content': {
        status: 'approved',
        resolved_at: '2026-04-10T12:05:00Z',
        resolved_by: '@bob:example.org',
      },
    });

    expect(parseToolApproval(event)).toEqual({
      approvalId: 'approval-1',
      toolName: 'web_search',
      toolCallId: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agentName: 'research',
      requesterId: '@alice:example.org',
      approverUserId: null,
      approvable: true,
      status: 'approved',
      requestedAt: '2026-04-10T12:00:00Z',
      expiresAt: '2026-04-17T12:00:00Z',
      threadId: '$thread-root',
      resolvedAt: '2026-04-10T12:05:00Z',
      resolvedBy: '@bob:example.org',
      resolutionReason: null,
      autoApproveOptions: [],
      autoApproval: null,
      scope: null,
      provenance: null,
      responseEventId: null,
      argumentsTruncated: false,
      fullArguments: null,
      argumentSource: null,
      schedule: null,
    });
  });

  it('preserves original fields when building render content for partial edits', () => {
    expect(
      parseToolApprovalContent(
        MINDROOM_TOOL_APPROVAL_EVENT,
        getToolApprovalRenderContent(
          {
            approval_id: 'approval-1',
            tool_name: 'web_search',
            tool_call_id: 'approval-1',
            arguments: { query: 'NixOS 26.05 release date' },
            agent_name: 'research',
            requester_id: '@alice:example.org',
            status: 'pending',
            requested_at: '2026-04-10T12:00:00Z',
            expires_at: '2026-04-17T12:00:00Z',
            thread_id: '$thread-root',
            resolved_at: null,
            resolved_by: null,
            resolution_reason: null,
          },
          {
            'm.new_content': {
              status: 'denied',
              resolved_at: '2026-04-10T12:05:00Z',
              resolved_by: '@bob:example.org',
              resolution_reason: 'Missing justification',
            },
          }
        )
      )
    ).toEqual({
      approvalId: 'approval-1',
      toolName: 'web_search',
      toolCallId: 'approval-1',
      arguments: { query: 'NixOS 26.05 release date' },
      agentName: 'research',
      requesterId: '@alice:example.org',
      approverUserId: null,
      approvable: true,
      status: 'denied',
      requestedAt: '2026-04-10T12:00:00Z',
      expiresAt: '2026-04-17T12:00:00Z',
      threadId: '$thread-root',
      resolvedAt: '2026-04-10T12:05:00Z',
      resolvedBy: '@bob:example.org',
      resolutionReason: 'Missing justification',
      autoApproveOptions: [],
      autoApproval: null,
      scope: null,
      provenance: null,
      responseEventId: null,
      argumentsTruncated: false,
      fullArguments: null,
      argumentSource: null,
      schedule: null,
    });
  });

  it('applies grant metadata from a partial edit while preserving the original capability', () => {
    const approval = parseToolApprovalContent(
      MINDROOM_TOOL_APPROVAL_EVENT,
      getToolApprovalRenderContent(
        {
          approval_id: 'approval-1',
          tool_name: 'web_search',
          tool_call_id: 'approval-1',
          arguments: { query: 'release date' },
          agent_name: 'research',
          requester_id: '@alice:example.org',
          approver_user_id: '@alice:example.org',
          status: 'pending',
          requested_at: '2026-04-10T12:00:00Z',
          expires_at: '2026-04-17T12:00:00Z',
          thread_id: '$thread-root',
          auto_approve_options: [300, 600, 1800],
        },
        {
          'm.new_content': {
            status: 'approved',
            resolved_at: '2026-04-10T12:01:00Z',
            resolved_by: '@alice:example.org',
            auto_approval: {
              grant_id: 'grant-1',
              expires_at: '2026-04-10T12:11:00Z',
              revoked_at: null,
            },
          },
        }
      )
    );

    expect(approval).toMatchObject({
      status: 'approved',
      autoApproveOptions: [300, 600, 1800],
      autoApproval: {
        grantId: 'grant-1',
        expiresAt: '2026-04-10T12:11:00Z',
        revokedAt: null,
      },
    });
  });

  it('parses the live backend approval payload', () => {
    const event = new MatrixEvent({
      content: {
        agent_name: 'research',
        approval_id: '55f1497940554e32bb0aa7e4362180c2',
        arguments: {
          max_results: 5,
          query: 'Python 3.14 release notes',
        },
        body: '\ud83d\udd12 Approval required: web_search',
        expires_at: '2026-04-26T02:46:29.899252+00:00',
        'm.relates_to': {
          event_id: '$TgMFGURQ4fakEK0OeY3-dxXaEjuMGPWqdfe2T4njWMs',
          is_falling_back: true,
          'm.in_reply_to': {
            event_id: '$TgMFGURQ4fakEK0OeY3-dxXaEjuMGPWqdfe2T4njWMs',
          },
          rel_type: 'm.thread',
        },
        msgtype: 'io.mindroom.tool_approval',
        requested_at: '2026-04-19T02:46:29.899252+00:00',
        requester_id: '@e2e-test-bot:mindroom.lab.mindroom.chat',
        status: 'pending',
        thread_id: '$TgMFGURQ4fakEK0OeY3-dxXaEjuMGPWqdfe2T4njWMs',
        tool_call_id: '55f1497940554e32bb0aa7e4362180c2',
        tool_name: 'web_search',
      },
      event_id: '$eOCPvb7zqpxBrpb7Mbx5K0K19wHnmJIsLJkqs4jGViY',
      origin_server_ts: 1776566789914,
      room_id: '!XOnr2BckWWezk7JpEv:mindroom.lab.mindroom.chat',
      sender: '@mindroom_research_adb4d443:mindroom.lab.mindroom.chat',
      type: 'io.mindroom.tool_approval',
      unsigned: {
        age: 365890,
        transaction_id: '53c35778-e55c-4636-aa7e-2ccdd2c3b013',
      },
    });

    expect(parseToolApproval(event)).toEqual({
      approvalId: '55f1497940554e32bb0aa7e4362180c2',
      toolName: 'web_search',
      toolCallId: '55f1497940554e32bb0aa7e4362180c2',
      arguments: {
        max_results: 5,
        query: 'Python 3.14 release notes',
      },
      agentName: 'research',
      requesterId: '@e2e-test-bot:mindroom.lab.mindroom.chat',
      approverUserId: null,
      approvable: true,
      status: 'pending',
      requestedAt: '2026-04-19T02:46:29.899252+00:00',
      expiresAt: '2026-04-26T02:46:29.899252+00:00',
      threadId: '$TgMFGURQ4fakEK0OeY3-dxXaEjuMGPWqdfe2T4njWMs',
      resolvedAt: null,
      resolvedBy: null,
      resolutionReason: null,
      autoApproveOptions: [],
      autoApproval: null,
      scope: null,
      provenance: null,
      responseEventId: null,
      argumentsTruncated: false,
      fullArguments: null,
      argumentSource: null,
      schedule: null,
    });
  });

  it('builds Matrix approval response content with thread reply metadata', () => {
    expect(
      buildToolApprovalResponseContent('denied', '$thread-root', '$approval', 'Needs human review')
    ).toEqual({
      status: 'denied',
      reason: 'Needs human review',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$thread-root',
        is_falling_back: true,
        'm.in_reply_to': {
          event_id: '$approval',
        },
      },
    });
  });

  it('adds the literal duration only to an approved timed response', () => {
    expect(
      buildToolApprovalResponseContent('approved', '$thread-root', '$approval', undefined, 600)
    ).toEqual({
      status: 'approved',
      auto_approve_seconds: 600,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$thread-root',
        is_falling_back: true,
        'm.in_reply_to': {
          event_id: '$approval',
        },
      },
    });
  });

  it('returns null for invalid event types and malformed content', () => {
    expect(
      parseToolApproval(
        makeApprovalEvent(
          {
            approval_id: 'approval-1',
          },
          'm.room.message'
        )
      )
    ).toBeNull();

    expect(
      parseToolApprovalContent(MINDROOM_TOOL_APPROVAL_EVENT, {
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: [],
        agent_name: 'research',
        status: 'pending',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
      })
    ).toBeNull();
  });
});
