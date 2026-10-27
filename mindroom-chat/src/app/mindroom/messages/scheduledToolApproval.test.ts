import { describe, expect, it } from 'vitest';
import { createApprovalActions, getApprovalCapabilities } from './approvalActions';
import { buildToolApprovalResponseContent, parseToolApprovalContent } from './toolApproval';
import { ThreadApprovalRecord } from './threadApprovalModel';
import { formatApprovalTime, scheduledScopeLabelKey } from './approvalScheduleText';

const scheduledCard = (extra: Record<string, unknown> = {}) =>
  parseToolApprovalContent('io.mindroom.tool_approval', {
    approval_id: 'scheduled-approval:task-1',
    tool_name: 'post_slack_message',
    arguments: { channel: 'U123', text: 'Good morning!' },
    agent_name: 'assistant',
    approver_user_id: '@alice:example.org',
    requester_id: '@alice:example.org',
    status: 'pending',
    thread_id: '$thread',
    requested_at: '2026-10-03T22:00:00Z',
    expires_at: '2999-10-04T13:00:00Z',
    approval_target: 'scheduled_call',
    scheduled_task_id: 'task-1',
    scheduled_for: '2999-10-04T13:00:00+00:00',
    scheduled_window_seconds: 900,
    scheduled_scope_options: ['exact_arguments', 'any_arguments'],
    ...extra,
  })!;

const record = (approval = scheduledCard()): ThreadApprovalRecord => ({
  eventId: '$card',
  sender: '@router:example.org',
  wireStatus: 'pending',
  approval,
});

describe('scheduled tool-call approval cards', () => {
  it('parses the send time, window, and offered scopes', () => {
    expect(scheduledCard().schedule).toEqual({
      taskId: 'task-1',
      scheduledFor: '2999-10-04T13:00:00+00:00',
      windowSeconds: 900,
      scopeOptions: ['exact_arguments', 'any_arguments'],
      approvedScope: null,
    });
  });

  it('offers no broader scope unless the card lists both scopes in order', () => {
    expect(
      scheduledCard({ scheduled_scope_options: ['any_arguments'] }).schedule?.scopeOptions
    ).toEqual([]);
    expect(scheduledCard({ scheduled_scope_options: undefined }).schedule?.scopeOptions).toEqual(
      []
    );
  });

  it('ignores schedule fields on ordinary approval cards', () => {
    expect(scheduledCard({ approval_target: undefined }).schedule).toBeNull();
    expect(scheduledCard({ scheduled_for: 'tomorrow' }).schedule).toBeNull();
  });

  it('reads the approved scope from the card edit', () => {
    const approved = parseToolApprovalContent('io.mindroom.tool_approval', {
      approval_id: 'scheduled-approval:task-1',
      'm.new_content': {
        status: 'approved',
        resolved_by: '@alice:example.org',
        scheduled_scope: 'any_arguments',
      },
      tool_name: 'post_slack_message',
      arguments: { channel: 'U123' },
      agent_name: 'assistant',
      status: 'pending',
      requested_at: '2026-10-03T22:00:00Z',
      expires_at: '2999-10-04T13:00:00Z',
      approval_target: 'scheduled_call',
      scheduled_task_id: 'task-1',
      scheduled_for: '2999-10-04T13:00:00+00:00',
    })!;

    expect(approved.status).toBe('approved');
    expect(approved.schedule?.approvedScope).toBe('any_arguments');
  });

  it('parses the scheduled approval provenance on a send-time receipt', () => {
    const receipt = parseToolApprovalContent('io.mindroom.tool_approval', {
      approval_id: 'card-first',
      tool_name: 'post_slack_message',
      arguments: { channel: 'U123' },
      agent_name: 'assistant',
      status: 'approved',
      requested_at: '2026-10-04T13:00:00Z',
      expires_at: '2999-10-04T13:00:00Z',
      approval_provenance: {
        kind: 'scheduled_approval',
        task_id: 'task-1',
        approved_by: '@alice:example.org',
        approved_at: '2026-10-03T22:01:00+00:00',
        scheduled_for: '2026-10-04T13:00:00+00:00',
        scope: 'exact_arguments',
        arguments_digest: 'abc',
      },
    })!;

    expect(receipt.provenance).toEqual({
      kind: 'scheduled_approval',
      approvedBy: '@alice:example.org',
      approvedAt: '2026-10-03T22:01:00+00:00',
      scheduledFor: '2026-10-04T13:00:00+00:00',
      scope: 'exact_arguments',
    });
  });

  it('sends the chosen scope only with an approval', () => {
    expect(
      buildToolApprovalResponseContent(
        'approved',
        '$thread',
        '$card',
        undefined,
        undefined,
        'any_arguments'
      )
    ).toMatchObject({ status: 'approved', scheduled_scope: 'any_arguments' });
    expect(
      buildToolApprovalResponseContent(
        'denied',
        '$thread',
        '$card',
        'no',
        undefined,
        'any_arguments'
      )
    ).not.toHaveProperty('scheduled_scope');
  });

  it('lets only the named approver choose a scope that the card offered', async () => {
    const offered = record();
    expect(
      getApprovalCapabilities(offered, '@alice:example.org', undefined).scheduledScopes
    ).toEqual(['exact_arguments', 'any_arguments']);
    expect(
      getApprovalCapabilities(offered, '@mallory:example.org', undefined).scheduledScopes
    ).toEqual([]);

    const sent: unknown[] = [];
    let current = record(scheduledCard({ scheduled_scope_options: undefined }));
    const actions = createApprovalActions({
      getRecords: () => [current],
      getUserId: () => '@alice:example.org',
      threadId: '$thread',
      send: async (content) => {
        sent.push(content);
      },
    });
    await actions.submit(current, { status: 'approved', scheduledScope: 'any_arguments' });
    expect(sent).toEqual([]);

    current = offered;
    await actions.submit(current, { status: 'approved', scheduledScope: 'any_arguments' });
    expect(sent).toEqual([
      expect.objectContaining({ status: 'approved', scheduled_scope: 'any_arguments' }),
    ]);
  });
});

describe('scheduled card edge cases', () => {
  it('offers no broader scope when the card does not state a whole-minute window', () => {
    for (const window of [undefined, 30, 0, 90.5]) {
      const approval = scheduledCard({ scheduled_window_seconds: window });
      expect(approval.schedule?.windowSeconds).toBeNull();
      expect(
        getApprovalCapabilities(record(approval), '@alice:example.org', undefined).scheduledScopes
      ).toEqual([]);
    }
  });

  it('never offers timed auto-approval on a scheduling card', () => {
    const approval = scheduledCard({ auto_approve_options: [300, 600, 1800] });
    expect(approval.autoApproveOptions).toEqual([300, 600, 1800]);
    expect(
      getApprovalCapabilities(record(approval), '@alice:example.org', undefined).durations
    ).toEqual([]);
  });

  it('formats backend timestamps with sub-millisecond fractions', () => {
    expect(formatApprovalTime('2026-10-04T13:00:00.123456+00:00', 'en')).toBe(
      new Date(Date.UTC(2026, 9, 4, 13, 0, 0, 123)).toLocaleString('en')
    );
    expect(formatApprovalTime('not a time', 'en')).toBe('not a time');
  });

  it('labels each scope with one shared message', () => {
    expect(scheduledScopeLabelKey('any_arguments')).toBe(
      'mindroomUi.messages.approvalSchedule.approvedAnyArguments'
    );
    expect(scheduledScopeLabelKey('exact_arguments')).toBe(
      'mindroomUi.messages.approvalSchedule.approvedExactArguments'
    );
  });
});
