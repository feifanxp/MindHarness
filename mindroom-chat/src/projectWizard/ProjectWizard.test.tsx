// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProjectWizard from './ProjectWizard';
import type { WizardState } from './api';

let renderer: ReactTestRenderer;
const saved = (): WizardState => ({
  draft_id: 'draft-1',
  revision: 1,
  status: 'proposal_ready',
  test_mode: false,
  pending_message_id: null,
  error: null,
  progress: null,
  config_installed: true,
  owner_user_id: '@owner:example.org',
  confirmation_key: null,
  confirmed_revision: null,
  messages: [{ id: 'u', role: 'user', content: '讨论' }],
  draft: {
    draft_id: 'draft-1',
    revision: 1,
    status: 'proposal_ready',
    project: {
      name: '项目',
      goal: '目标',
      expected_outcomes: ['成果'],
      constraints: [],
      open_questions: [],
    },
    collaboration: { mode: 'parallel', rationale: '多角度' },
    agents: [{ name: '专家', responsibility: '研究', behavior: '求证' }],
  },
  result: null,
});
const response = (body: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => body } as Response);
const findButton = (text: string) =>
  renderer.root
    .findAllByType('button')
    .find((b) => b.children.filter((c) => typeof c === 'string').join('') === text);
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('crypto', { randomUUID: () => 'id-1' });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
async function mount(value: WizardState | null) {
  vi.mocked(fetch).mockResolvedValueOnce(response(value));
  await act(async () => {
    renderer = create(<ProjectWizard />);
  });
}
it('restores a saved real project draft', async () => {
  await mount(saved());
  expect(renderer.root.findByProps({ id: 'wizard-project-name' }).props.value).toBe('项目');
  expect(findButton('确认创建')).toBeTruthy();
});
it('shows confirmation before the real create request', async () => {
  await mount(saved());
  await act(async () => findButton('确认创建')!.props.onClick());
  expect(renderer.root.findByProps({ 'aria-label': '确认摘要' })).toBeTruthy();
  expect(findButton('确认创建聊天室')).toBeTruthy();
});
it('shows a real room result with a start-chat link after confirmation', async () => {
  await mount(saved());
  await act(async () => findButton('确认创建')!.props.onClick());
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      ...saved(),
      status: 'created',
      confirmation_key: 'id-1',
      confirmed_revision: 1,
      result: {
        test_mode: false,
        project_id: 'draft-1',
        room_id: '!room:example.org',
        homeserver_url: 'http://localhost:8008',
        team_user_id: '@team:example.org',
        sender_user_id: '@user:example.org',
        members: [],
      },
    })
  );
  await act(async () => findButton('确认创建聊天室')!.props.onClick());
  expect(findButton('开始聊天')).toBeTruthy();
});
it('keeps pending model messages retryable after refresh', async () => {
  const pending = {
    ...saved(),
    status: 'revising' as const,
    pending_message_id: 'm1',
    error: '超时',
    messages: [{ id: 'm1', role: 'user' as const, content: '重试' }],
  };
  await mount(pending);
  expect(findButton('重试')).toBeTruthy();
});
it('keeps initial recovery failure from creating a new draft', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    renderer = create(<ProjectWizard />);
  });
  expect(renderer.root.findByType('textarea').props.disabled).toBe(true);
});

it('keeps a chat handoff failure visible even when the project is already created', async () => {
  const created = saved();
  created.status = 'created';
  created.confirmation_key = 'id-1';
  created.confirmed_revision = 1;
  created.result = {
    test_mode: false,
    project_id: 'draft-1',
    room_id: '!room:example.org',
    homeserver_url: 'http://localhost:8008',
    team_user_id: '@team:example.org',
    sender_user_id: '@owner:example.org',
    members: [],
  };
  await mount(created);
  vi.mocked(fetch)
    .mockRejectedValueOnce(new Error('聊天登录失败'))
    .mockResolvedValueOnce(response(created));
  await act(async () => findButton('开始聊天')!.props.onClick());
  expect(
    renderer.root.findByProps({ role: 'alert' }).findByType('span').children.join('')
  ).toContain('聊天登录失败');
  expect(findButton('开始聊天')).toBeTruthy();
});

it('starts an independent project after completion and restores it after refresh', async () => {
  const previous = saved();
  previous.status = 'created';
  await mount(previous);
  expect(renderer.root.findByType('textarea').props.disabled).toBe(true);
  const fresh = {
    ...saved(),
    draft_id: 'draft-2',
    revision: 0,
    status: 'empty' as const,
    messages: [],
    draft: null,
    config_installed: false,
  };
  vi.mocked(fetch).mockResolvedValueOnce(response(fresh));
  await act(async () => findButton('新建项目')!.props.onClick());
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/project-wizard/drafts',
    expect.objectContaining({ method: 'POST' })
  );
  expect(renderer.root.findByType('h1').children.join('')).toBe('你想创建一个什么样的项目？');
  expect(renderer.root.findAllByType('article')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ 'aria-label': '项目方案预览' })).toHaveLength(0);
  expect(renderer.root.findByType('textarea').props.disabled).toBe(false);
  expect(window.location.search).toBe('?draft=draft-2');
  expect(previous.status).toBe('created');
  expect(previous.draft?.project.name).toBe('项目');
  act(() => renderer.unmount());
  await mount(fresh);
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/project-wizard/drafts/draft-2',
    expect.objectContaining({ method: 'GET' })
  );
  expect(renderer.root.findByType('textarea').props.disabled).toBe(false);
});

it('preserves the previous project if creating the new draft fails', async () => {
  const previous = saved();
  previous.status = 'created';
  await mount(previous);
  vi.mocked(fetch)
    .mockRejectedValueOnce(new Error('新草稿创建失败'))
    .mockResolvedValueOnce(response(previous));
  await act(async () => findButton('新建项目')!.props.onClick());
  expect(renderer.root.findByProps({ id: 'wizard-project-name' }).props.value).toBe('项目');
  expect(window.location.search).toBe('?draft=draft-1');
  expect(
    renderer.root.findByProps({ role: 'alert' }).findByType('span').children.join('')
  ).toContain('新草稿创建失败');
});

it('blocks duplicate new-project clicks while creating a draft', async () => {
  await mount(saved());
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  act(() => {
    const click = findButton('新建项目')!.props.onClick;
    click();
    click();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(findButton('新建项目')!.props.disabled).toBe(true);
  await act(async () =>
    finish(
      response({
        ...saved(),
        draft_id: 'draft-2',
        revision: 0,
        status: 'empty',
        draft: null,
        messages: [],
      })
    )
  );
  expect(window.location.search).toBe('?draft=draft-2');
});

it('restores the explicitly linked project instead of replacing it with the newest draft', async () => {
  window.history.replaceState(null, '', '/?draft=draft-1');
  await mount(saved());
  expect(fetch).toHaveBeenCalledWith(
    '/api/project-wizard/drafts/draft-1',
    expect.objectContaining({ method: 'GET' })
  );
});
