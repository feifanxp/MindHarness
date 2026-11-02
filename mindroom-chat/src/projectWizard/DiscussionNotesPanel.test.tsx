// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiscussionNotesPanel, type DiscussionNotes } from './DiscussionNotesPanel';

vi.mock('folds', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

let renderer: ReactTestRenderer;
const notes: DiscussionNotes = {
  overview: '先验证需求',
  items: [{ id: 'one', category: 'idea', text: '做一次用户访谈', source_event_ids: ['$one'] }],
  updated_at: 1,
  checked_at: 1,
  status: 'ready',
  error: null,
  pending_messages: 0,
};
const response = (value = notes) => ({ ok: true, status: 200, json: async () => value });
const button = () =>
  renderer.root.findAllByType('button').find((item) => item.children.includes('立即整理'))!;
async function mount() {
  await act(async () => {
    renderer = create(
      <MemoryRouter>
        <DiscussionNotesPanel
          draftId="draft"
          sourcePath={(id) => `/discussion/room/${encodeURIComponent(id)}`}
        />
      </MemoryRouter>
    );
  });
}
async function toggle(open: boolean) {
  await act(async () => {
    renderer.root.findByType('details').props.onToggle({ currentTarget: { open } });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('loads on opening, renders categorized notes and deep links, and stops polling when closed', async () => {
  await mount();
  expect(fetch).not.toHaveBeenCalled();
  await toggle(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('做一次用户访谈');
  expect(renderer.root.findByType('a').props.href).toBe('/discussion/room/%24one');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  await toggle(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('refreshes explicitly and preserves previous notes while updating', async () => {
  await mount();
  await toggle(true);
  await act(async () => {
    button().props.onClick();
  });
  expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('/notes'), expect.any(Object));
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([url, options]) => String(url).endsWith('/notes/refresh') && options?.method === 'POST'
      )
  ).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('做一次用户访谈');
  expect(button().props.disabled).toBe(false);
});

it('recovers from a refresh timeout instead of leaving the button disabled', async () => {
  await mount();
  await toggle(true);
  vi.mocked(fetch).mockImplementationOnce(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      })
  );
  await act(async () => {
    button().props.onClick();
  });
  expect(button().props.disabled).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(130_000);
  });
  expect(button().props.disabled).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).toContain('做一次用户访谈');
});

it('shows recoverable errors while keeping already loaded results', async () => {
  await mount();
  await toggle(true);
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('登录已过期');
  expect(JSON.stringify(renderer.toJSON())).toContain('做一次用户访谈');
});

it('handles an empty result without inventing content', async () => {
  vi.mocked(fetch).mockResolvedValue(
    response({ ...notes, items: [], overview: '', updated_at: null }) as Response
  );
  await mount();
  await toggle(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('暂时没有摘录');
  expect(renderer.root.findAllByType('a')).toHaveLength(0);
});
