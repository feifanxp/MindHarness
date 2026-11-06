// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RouterDebugger, type RouterDebugSnapshot } from './RouterDebugger';
import { discussionFetch } from './discussionSession';

vi.mock('./discussionSession', () => ({ discussionFetch: vi.fn() }));
vi.mock('folds', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
    'aria-expanded': expanded,
  }: {
    children?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    'aria-expanded'?: boolean;
  }) => (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled} aria-expanded={expanded}>
      {children}
    </button>
  ),
}));

let renderer: ReactTestRenderer;
let server: RouterDebugSnapshot;
const response = (value: object, status = 200) =>
  ({ ok: status === 200, status, json: async () => value } as Response);
const button = (text: string) =>
  renderer.root.findAllByType('button').find((item) => item.children.includes(text))!;
const view = () => JSON.stringify(renderer.toJSON());
const change = async () =>
  act(async () => {
    renderer.root
      .findAllByType('input')
      .find((input) => input.props.max === '2')!
      .props.onChange({ target: { value: '1' } });
  });
const submit = async () =>
  act(async () => {
    renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
  });
const toggle = async () =>
  act(async () => {
    renderer.root.findAllByType('button')[0].props.onClick();
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(discussionFetch).mockReset();
  server = {
    session_id: 'initial',
    revision: 0,
    settings: {
      strategy: 'configured',
      model: null,
      prompt_template: null,
      history_messages: 3,
      history_chars: 100,
      timeout_seconds: null,
      retries: 0,
    },
    events: [],
    configured: {
      model: 'default',
      models: ['default'],
      prompt_template: '{agents_info} {message}',
      judgment: null,
      peer_discussion: false,
    },
  };
  vi.mocked(discussionFetch).mockImplementation(async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    server.session_id = payload.session_id;
    if (init?.method === 'PUT')
      server = { ...server, revision: server.revision + 1, settings: payload.settings };
    return response(structuredClone(server));
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
});

async function mount() {
  await act(async () => {
    renderer = create(<RouterDebugger draftId="draft" />);
  });
}

it('does not collect until opened and closes its lease when collapsed', async () => {
  await mount();
  expect(discussionFetch).not.toHaveBeenCalled();
  await toggle();
  expect(view()).toContain('正在记录当前房间');
  expect(JSON.parse(String(vi.mocked(discussionFetch).mock.calls[0][1]?.body)).start).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(discussionFetch).toHaveBeenCalledTimes(2);
  await toggle();
  expect(vi.mocked(discussionFetch).mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
  const count = vi.mocked(discussionFetch).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(discussionFetch).toHaveBeenCalledTimes(count);
});

it('applies parameters only on submit and can restore the existing defaults', async () => {
  await mount();
  await toggle();
  await change();
  expect(discussionFetch).toHaveBeenCalledTimes(1);
  expect(view()).toContain('有未应用修改');
  await submit();
  expect(server.settings.retries).toBe(1);
  expect(view()).not.toContain('有未应用修改');
  await act(async () => {
    button('恢复原配置').props.onClick();
  });
  expect(server.settings.retries).toBe(0);
  expect(server.settings.model).toBe(null);
});

it('retains newer trace stages when the settings response arrives after a poll', async () => {
  await mount();
  await toggle();
  await change();
  let finish!: (value: Response) => void;
  let stale!: RouterDebugSnapshot;
  vi.mocked(discussionFetch).mockImplementation(async (_url, init) => {
    if (init?.method === 'PUT') {
      const payload = JSON.parse(String(init.body));
      server = { ...server, revision: 1, settings: payload.settings };
      stale = structuredClone(server);
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return response(structuredClone(server));
  });
  await submit();
  server.events = [
    {
      sequence: 1,
      timestamp: 1,
      event_id: '$live',
      stage: 'selected',
      detail: 'fresh-result',
      truncated: false,
    },
  ];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(view()).toContain('fresh-result');
  await act(async () => {
    finish(response(stale));
  });
  expect(view()).toContain('fresh-result');
});

it('waits for an in-flight open before closing its lease', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(discussionFetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  await mount();
  await toggle();
  await toggle();
  expect(discussionFetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(response(server));
  });
  expect(vi.mocked(discussionFetch).mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
  expect(view()).not.toContain('正在记录当前房间');
});

it('explains skipped routing and renders provider content as plain text', async () => {
  server.configured.peer_discussion = true;
  server.events = [
    {
      sequence: 1,
      timestamp: 1,
      event_id: '$x',
      stage: 'skipped',
      detail: '"peer_discussion"',
      truncated: false,
    },
    {
      sequence: 2,
      timestamp: 2,
      event_id: '$x',
      stage: 'output',
      detail: '<script>doBadThings()</script>',
      truncated: true,
    },
  ];
  await mount();
  await toggle();
  expect(view()).toContain('由各 Agent 自行判断是否参与');
  expect(view()).toContain('SDK 返回内容');
  expect(renderer.root.findAllByType('script')).toHaveLength(0);
  expect(view()).toContain('显示已截断');
});

it('stops renewal after a session error and requires reopening', async () => {
  await mount();
  await toggle();
  vi.mocked(discussionFetch).mockResolvedValue(response({ detail: '会话已过期' }, 409));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(view()).toContain('会话已过期');
  expect(view()).toContain('调试连接已停止');
  const count = vi.mocked(discussionFetch).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(discussionFetch).toHaveBeenCalledTimes(count);
});
