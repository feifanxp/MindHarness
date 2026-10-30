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
    agents: ['林悦', '陈墨', '苏青', '周衡'].map((name, index) => ({
      name,
      responsibility: '产品研究',
      behavior: '理性、善于求证',
      recommendation: '帮你验证核心需求',
      avatar_id: index,
      selected: index < 3,
    })),
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
  expect(findButton('组队，开始聊')).toBeTruthy();
});
it('confirms the selected team in one click and shows the room result', async () => {
  await mount(saved());
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      ...saved(),
      status: 'created',
      owner_user_id: null,
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
  await act(async () => findButton('组队，开始聊')!.props.onClick());
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/project-wizard/drafts/draft-1/confirm',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ revision: 1, idempotency_key: 'id-1' }),
    })
  );
  expect(findButton('开始聊天')).toBeTruthy();
  expect(renderer.root.findAllByProps({ 'aria-label': '确认摘要' })).toHaveLength(0);
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

it('opens reauthentication when the chat handoff session has expired', async () => {
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
  vi.mocked(fetch).mockResolvedValueOnce(response({ detail: '登录已过期，请重新登录。' }, 401));
  await act(async () => findButton('开始聊天')!.props.onClick());
  expect(renderer.root.findByProps({ className: 'wizard-login' })).toBeTruthy();
  expect(renderer.root.findByProps({ id: 'wizard-api-key' }).props.type).toBe('password');
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
  await act(async () => findButton('开始新讨论')!.props.onClick());
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/project-wizard/drafts',
    expect.objectContaining({ method: 'POST' })
  );
  expect(renderer.root.findByType('h1').children.join('')).toBe('今天想聊点什么？');
  expect(renderer.root.findAllByType('article')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ 'aria-label': '讨论提纲预览' })).toHaveLength(0);
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
  await act(async () => findButton('开始新讨论')!.props.onClick());
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
    const click = findButton('开始新讨论')!.props.onClick;
    click();
    click();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(findButton('开始新讨论')!.props.disabled).toBe(true);
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

it('shows candidate identities, portraits and three initial selections', async () => {
  await mount(saved());
  const choices = renderer.root.findAllByProps({ type: 'checkbox' });
  expect(choices).toHaveLength(4);
  expect(choices.filter((choice) => choice.props.checked)).toHaveLength(3);
  expect(renderer.root.findAllByType('img').map((img) => img.props.src)).toEqual(
    [0, 1, 2, 3].map((index) => `/api/project-wizard/avatars/${index}`)
  );
  expect(JSON.stringify(renderer.toJSON())).toContain('帮你验证核心需求');
});

it('saves the selected subset and keeps it after refresh', async () => {
  await mount(saved());
  const updated = saved();
  updated.revision = 2;
  updated.draft!.revision = 2;
  updated.draft!.agents[2].selected = false;
  vi.mocked(fetch).mockResolvedValueOnce(response(updated));
  await act(async () => renderer.root.findByProps({ 'aria-label': '选择 苏青' }).props.onChange());
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/project-wizard/drafts/draft-1/members',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ revision: 1, names: ['林悦', '陈墨'] }),
    })
  );
  expect(renderer.root.findByProps({ 'aria-label': '选择 苏青' }).props.checked).toBe(false);
  act(() => renderer.unmount());
  await mount(updated);
  expect(renderer.root.findByProps({ 'aria-label': '选择 苏青' }).props.checked).toBe(false);
});

it('requires at least one selected teammate', async () => {
  const emptyTeam = saved();
  emptyTeam.draft!.agents.forEach((agent) => {
    agent.selected = false;
  });
  await mount(emptyTeam);
  expect(findButton('组队，开始聊')!.props.disabled).toBe(true);
  expect(renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(4);
});

it('keeps selection failures retryable without losing the previous choices', async () => {
  await mount(saved());
  vi.mocked(fetch)
    .mockRejectedValueOnce(new Error('保存失败'))
    .mockResolvedValueOnce(response(saved()));
  await act(async () => renderer.root.findByProps({ 'aria-label': '选择 苏青' }).props.onChange());
  expect(renderer.root.findByProps({ 'aria-label': '选择 苏青' }).props.checked).toBe(true);
  expect(findButton('重试')).toBeTruthy();
  const updated = saved();
  updated.revision = 2;
  updated.draft!.agents[2].selected = false;
  vi.mocked(fetch).mockResolvedValueOnce(response(updated));
  await act(async () => findButton('重试')!.props.onClick());
  expect(renderer.root.findByProps({ 'aria-label': '选择 苏青' }).props.checked).toBe(false);
});

it('freezes selected teammates after confirmation', async () => {
  const frozen = saved();
  frozen.status = 'provision_failed';
  frozen.error = '请重试';
  await mount(frozen);
  expect(renderer.root.findByType('fieldset').props.disabled).toBe(true);
  expect(renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(3);
  expect(findButton('组队，开始聊')).toBeUndefined();
});

it('automatically starts the chat handoff and exposes handoff failures', async () => {
  await mount(saved());
  const created = {
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
      sender_user_id: '@owner:example.org',
      members: [],
    },
  };
  vi.mocked(fetch)
    .mockResolvedValueOnce(response(created))
    .mockRejectedValueOnce(new Error('聊天登录失败'))
    .mockResolvedValueOnce(response(created));
  await act(async () => findButton('组队，开始聊')!.props.onClick());
  expect(fetch).toHaveBeenCalledWith(
    '/api/project-wizard/drafts/draft-1/chat-session',
    expect.objectContaining({ method: 'POST' })
  );
  expect(
    renderer.root.findByProps({ role: 'alert' }).findByType('span').children.join('')
  ).toContain('聊天登录失败');
  expect(findButton('开始聊天')).toBeTruthy();
});

it('shows matching progress during the first request before messages arrive', async () => {
  await mount(null);
  const empty = { ...saved(), revision: 0, status: 'empty', draft: null, messages: [] };
  let finish!: (value: Response) => void;
  vi.mocked(fetch)
    .mockResolvedValueOnce(response(empty))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  act(() =>
    renderer.root.findByType('textarea').props.onChange({ target: { value: '帮我规划一个产品' } })
  );
  await act(async () => {
    renderer.root.findByType('form').props.onSubmit({ preventDefault: () => {} });
  });
  expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('匹配 AI 队友');
  await act(async () => finish(response(saved())));
  expect(renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(4);
});

it('keeps automatic chat handoff when provisioning succeeds through the generic retry', async () => {
  await mount(saved());
  vi.mocked(fetch)
    .mockResolvedValueOnce(response({ detail: '服务未就绪' }, 503))
    .mockResolvedValueOnce(response(saved()));
  await act(async () => findButton('组队，开始聊')!.props.onClick());
  const created = {
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
      sender_user_id: '@owner:example.org',
      members: [],
    },
  };
  vi.mocked(fetch)
    .mockResolvedValueOnce(response(created))
    .mockRejectedValueOnce(new Error('登录暂不可用'))
    .mockResolvedValueOnce(response(created));
  await act(async () => findButton('重试')!.props.onClick());
  expect(fetch).toHaveBeenCalledWith(
    '/api/project-wizard/drafts/draft-1/chat-session',
    expect.objectContaining({ method: 'POST' })
  );
  expect(
    renderer.root.findByProps({ role: 'alert' }).findByType('span').children.join('')
  ).toContain('登录暂不可用');
});
