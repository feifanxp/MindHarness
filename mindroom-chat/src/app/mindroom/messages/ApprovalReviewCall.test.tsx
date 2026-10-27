// @vitest-environment jsdom
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createRoot, Root } from 'react-dom/client';
import { act as domAct } from 'react-dom/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ApprovalReviewCall } from './ApprovalReviewCall';
import { parseToolApprovalContent } from './toolApproval';
import { ThreadApprovalRecord } from './threadApprovalModel';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  actions: new Map(),
}));
vi.mock('./ApprovalArguments', () => ({ ApprovalArguments: () => null }));
vi.mock('./ThreadApprovals.css', () => ({
  Call: 'Call',
  Actions: 'Actions',
  Stack: 'Stack',
  Section: 'Section',
  SectionHeader: 'SectionHeader',
  SectionIcon: 'SectionIcon',
  SectionTitle: 'SectionTitle',
  SectionCount: 'SectionCount',
  SectionMeta: 'SectionMeta',
  StatusChip: 'StatusChip',
  StatusChipAttention: 'StatusChipAttention',
  StatusChipDone: 'StatusChipDone',
  Durations: 'Durations',
  DurationRow: 'DurationRow',
  Segmented: 'Segmented',
  Segment: 'Segment',
  SingleCall: 'SingleCall',
  CallsToggle: 'CallsToggle',
  DenyRow: 'DenyRow',
  SectionBody: 'SectionBody',
  SectionTool: 'SectionTool',
  BarTitle: 'BarTitle',
  DialogHeading: 'DialogHeading',
  BarDetail: 'BarDetail',
}));
vi.mock('folds', () => ({
  Button: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    // The prop-types rule cannot infer native props on this typed test double.
    // eslint-disable-next-line react/prop-types
    ({ type, onClick, disabled, children }, ref) => (
      <button ref={ref} type={type ?? 'button'} onClick={onClick} disabled={disabled}>
        {children}
      </button>
    )
  ),
  Input: 'input',
  Text: 'span',
}));
const record = (id: string): ThreadApprovalRecord => ({
  eventId: id,
  sender: '@router:example.org',
  wireStatus: 'pending',
  approval: parseToolApprovalContent('io.mindroom.tool_approval', {
    approval_id: id,
    tool_name: 'invite',
    agent_name: 'assistant',
    arguments: { user: id },
    status: 'pending',
    requested_at: '2026-09-12T12:00:00Z',
    expires_at: '2999-09-12T12:00:00Z',
    approver_user_id: '@alice:example.org',
  })!,
});
let renderer: ReactTestRenderer;
let domRoot: Root | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  domAct(() => domRoot?.unmount());
  domRoot = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  mocks.submit.mockReset();
  mocks.actions.clear();
});

it('moves focus into the denial reason and restores the Deny trigger on cancel', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  domRoot = createRoot(container);
  domAct(() =>
    domRoot!.render(
      <ApprovalReviewCall
        record={record('$one')}
        index={0}
        userId="@alice:example.org"
        action={mocks.actions.get('$one')}
        now={Date.now()}
        submit={mocks.submit}
      />
    )
  );
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
  button('Deny').focus();
  domAct(() => button('Deny').click());
  expect(document.activeElement).toBe(container.querySelector('input'));
  button('Cancel').focus();
  domAct(() => button('Cancel').click());
  expect(document.activeElement).toBe(button('Deny'));
});
it('lets the same review approve one call and deny another with its own reason', () => {
  const one = record('$one');
  const two = record('$two');
  act(() => {
    renderer = create(
      <>
        <ApprovalReviewCall
          record={one}
          index={0}
          userId="@alice:example.org"
          action={mocks.actions.get('$one')}
          now={Date.now()}
          submit={mocks.submit}
        />
        <ApprovalReviewCall
          record={two}
          index={1}
          userId="@alice:example.org"
          action={mocks.actions.get('$two')}
          now={Date.now()}
          submit={mocks.submit}
        />
      </>
    );
  });
  const first = renderer.root.findByProps({ 'data-approval-id': '$one' });
  const second = renderer.root.findByProps({ 'data-approval-id': '$two' });
  act(() => {
    first.findAllByType('button')[0].props.onClick();
  });
  expect(mocks.submit).toHaveBeenNthCalledWith(1, one, { status: 'approved' });
  act(() => {
    second.findAllByType('button')[1].props.onClick();
  });
  act(() => {
    second.findByType('input').props.onChange({ currentTarget: { value: 'Wrong workspace' } });
  });
  act(() => {
    second.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(mocks.submit).toHaveBeenNthCalledWith(2, two, {
    status: 'denied',
    reason: 'Wrong workspace',
  });
});
it('removes individual actions while the submitted call awaits its Matrix decision', () => {
  mocks.actions.set('$one', { kind: 'decision', status: 'submitted' });
  act(() => {
    renderer = create(
      <ApprovalReviewCall
        record={record('$one')}
        index={0}
        userId="@alice:example.org"
        action={mocks.actions.get('$one')}
        now={Date.now()}
        submit={mocks.submit}
      />
    );
  });
  expect(renderer.root.findAllByType('button')).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('Submitted');
});
it('offers exact and any-arguments approval for a scheduled call', () => {
  const scheduled: ThreadApprovalRecord = {
    ...record('$scheduled'),
    approval: parseToolApprovalContent('io.mindroom.tool_approval', {
      approval_id: 'scheduled-approval:task-1',
      tool_name: 'post_slack_message',
      agent_name: 'assistant',
      arguments: { channel: 'U123' },
      status: 'pending',
      requested_at: '2026-10-03T22:00:00Z',
      expires_at: '2999-10-04T13:00:00Z',
      approver_user_id: '@alice:example.org',
      approval_target: 'scheduled_call',
      scheduled_task_id: 'task-1',
      scheduled_for: '2999-10-04T13:00:00+00:00',
      scheduled_window_seconds: 900,
      scheduled_scope_options: ['exact_arguments', 'any_arguments'],
    })!,
  };
  act(() => {
    renderer = create(
      <ApprovalReviewCall
        record={scheduled}
        index={0}
        userId="@alice:example.org"
        action={undefined}
        now={Date.now()}
        submit={mocks.submit}
      />
    );
  });
  const text = (node: { children: unknown[] }): string =>
    node.children
      .map((child) => (typeof child === 'string' ? child : text(child as never)))
      .join('');
  const buttons = renderer.root.findAllByType('button');
  expect(buttons.map((button) => text(button))).toEqual([
    'Approve this exact call',
    'Deny',
    'Approve any arguments',
  ]);
  act(() => buttons[0].props.onClick());
  act(() => buttons[2].props.onClick());
  expect(mocks.submit.mock.calls).toEqual([
    [scheduled, { status: 'approved', scheduledScope: 'exact_arguments' }],
    [scheduled, { status: 'approved', scheduledScope: 'any_arguments' }],
  ]);
});
