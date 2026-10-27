// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import type { BackgroundJob } from './backgroundJobsContract';
import { BackgroundJobsBar } from './BackgroundJobsBar';
import { keepCancelsOf } from './sentCancels';

const state = vi.hoisted(() => ({ jobs: [] as BackgroundJob[], send: vi.fn() }));
vi.mock('./useRoomBackgroundJobs', () => ({ useRoomBackgroundJobs: () => state.jobs }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ sendEvent: state.send, makeTxnId: () => 'txn' }),
}));
vi.mock('./backgroundJobsBar.css', () => ({
  Anchor: 'Anchor',
  Bar: 'Bar',
  Toggle: 'Toggle',
  Chevron: 'Chevron',
  Status: 'Status',
  Jobs: 'Jobs',
  Job: 'Job',
  Label: 'Label',
  Muted: 'Muted',
  Stopping: 'Stopping',
  Action: 'Action',
  Plain: 'Plain',
  Alert: 'Alert',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values ? JSON.stringify(values) : ''}`,
  }),
}));

const job = (jobId: string, overrides: Partial<BackgroundJob> = {}): BackgroundJob => ({
  jobId,
  threadId: '$thread',
  kind: 'tool',
  tool: `tool_${jobId}`,
  status: 'running',
  startedAt: '2026-10-11T00:00:00+00:00',
  ...overrides,
});

const room = { roomId: '!room:example.org', getEventForTxnId: () => undefined } as unknown as Room;
let container: HTMLDivElement;
let root: Root;

const render = (threadId: string | null = '$thread', canCancel = true) =>
  act(() => {
    root.render(<BackgroundJobsBar room={room} threadId={threadId} canCancel={canCancel} />);
  });
const cancelA = 'mindroomUi.backgroundJobs.stopJob{"tool":"tool_a"}';
const cancelB = 'mindroomUi.backgroundJobs.stopJob{"tool":"tool_b"}';
const stoppingA = 'mindroomUi.backgroundJobs.stoppingJob{"tool":"tool_a"}';
const title = () => container.querySelector('[role="region"]')?.getAttribute('aria-label');
const click = (label: string) =>
  act(async () => {
    button(label)?.click();
  });
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent === label
  );
const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]');
const expand = () =>
  act(() => {
    toggle()?.click();
  });
// jsdom has no PointerEvent; React reads the pointer type from the native event.
const pointer = (
  type: 'pointerover' | 'pointerout' | 'pointerdown',
  pointerType: string,
  target: Element | null = container.querySelector('[role="region"]'),
  relatedTarget: Element | null = null
) =>
  act(() => {
    const event = new MouseEvent(type, { bubbles: true, relatedTarget });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    target?.dispatchEvent(event);
  });

beforeEach(() => {
  keepCancelsOf(room.roomId, new Set());
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.jobs = [];
  state.send = vi.fn().mockResolvedValue({ event_id: '$sent' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('renders nothing without jobs', () => {
  render();
  expect(container.innerHTML).toBe('');
});

it('names one job in the title, with Stop and no list', () => {
  state.jobs = [job('a')];
  render();
  expect(title()).toBe('mindroomUi.backgroundJobs.running{"tool":"tool_a"}');
  expect(container.querySelector('.Jobs')).toBeNull();
  expect(button(cancelA)?.textContent).toBe('mindroomUi.backgroundJobs.stop');
});

it('shows several jobs on one line, and lists them while the title is pressed', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  expect(container.querySelector('ul')).toBeNull();
  expect(button('mindroomUi.backgroundJobs.stopAll')).toBeDefined();
  expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
  expand();
  expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelectorAll('li')).toHaveLength(2);
  // A mouse leaving does not close a list the title opened.
  pointer('pointerout', 'mouse');
  expect(container.querySelector('ul')).not.toBeNull();
  expand();
  expect(container.querySelector('ul')).toBeNull();
});

it('closes the list on Escape, back on the title, and on a press outside', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  expand();
  button(cancelA)?.focus();
  const roomEscape = vi.fn();
  window.addEventListener('keydown', roomEscape);
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
  });
  window.removeEventListener('keydown', roomEscape);
  expect(container.querySelector('ul')).toBeNull();
  expect(document.activeElement).toBe(toggle());
  // The room's own Escape (to the composer) does not take focus from the title.
  expect(roomEscape).not.toHaveBeenCalled();
  // Escape with focus elsewhere closes the list too.
  expand();
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(container.querySelector('ul')).toBeNull();
  expand();
  act(() => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
  expect(container.querySelector('ul')).toBeNull();
});

it('lists several jobs while a mouse rests on the title, not for a passing pointer or a touch', () => {
  vi.useFakeTimers();
  try {
    state.jobs = [job('a'), job('b')];
    render();
    const listed = () => container.querySelector('ul') !== null;
    // Not from the rest of the bar, such as Stop all.
    pointer('pointerover', 'mouse', button('mindroomUi.backgroundJobs.stopAll') ?? null);
    act(() => vi.advanceTimersByTime(500));
    expect(listed()).toBe(false);
    pointer('pointerout', 'mouse');
    pointer('pointerover', 'mouse', toggle());
    pointer('pointerout', 'mouse');
    act(() => vi.advanceTimersByTime(500));
    expect(listed()).toBe(false);
    // Nor for one passing over the title to Stop all.
    const stopAll = button('mindroomUi.backgroundJobs.stopAll') ?? null;
    pointer('pointerover', 'mouse', toggle());
    pointer('pointerout', 'mouse', toggle(), stopAll);
    pointer('pointerover', 'mouse', stopAll, toggle());
    act(() => vi.advanceTimersByTime(500));
    expect(listed()).toBe(false);
    pointer('pointerout', 'mouse');
    pointer('pointerover', 'touch', toggle());
    act(() => vi.advanceTimersByTime(500));
    expect(listed()).toBe(false);
    pointer('pointerover', 'mouse', toggle());
    act(() => vi.advanceTimersByTime(100));
    expect(listed()).toBe(false);
    act(() => vi.advanceTimersByTime(60));
    expect(listed()).toBe(true);
    // A press inside the bar keeps the list.
    pointer('pointerdown', 'mouse', container.querySelector('li'));
    expect(listed()).toBe(true);
    pointer('pointerout', 'mouse');
    expect(listed()).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps the jobs listed once focus is in the list, and closes them when focus leaves the bar', () => {
  vi.useFakeTimers();
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  try {
    state.jobs = [job('a'), job('b')];
    render();
    pointer('pointerover', 'mouse', toggle());
    act(() => vi.advanceTimersByTime(200));
    act(() => button(cancelA)?.focus());
    pointer('pointerout', 'mouse');
    expect(container.querySelector('ul')).not.toBeNull();
    act(() => outside.focus());
    expect(container.querySelector('ul')).toBeNull();
  } finally {
    outside.remove();
    vi.useRealTimers();
  }
});

it('shows Stopping until the job leaves the state', async () => {
  state.jobs = [job('a')];
  render();
  await click(cancelA);
  state.jobs = [job('a')];
  render();
  expect(button(cancelA)).toBeUndefined();
  // The bar's title and region name say so, not that the job is running.
  expect(title()).toBe(stoppingA);
  state.jobs = [];
  render();
  expect(container.innerHTML).toBe('');
});

it('keeps a sent cancel stopping when a later Stop all fails', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  expand();
  await click(cancelA);
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(button(cancelA)).toBeUndefined();
  expect(button(cancelB)).toBeDefined();
});

it('keeps a job stopping when Stop all reached it, though its own earlier cancel then fails', async () => {
  state.jobs = [job('a'), job('b')];
  let failSingle: (error: Error) => void = () => undefined;
  state.send = vi.fn().mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failSingle = reject;
      })
  );
  render();
  expand();
  await click(cancelA);
  state.send.mockResolvedValue({ event_id: '$all' });
  render();
  await click('mindroomUi.backgroundJobs.stopAll');
  await act(async () => failSingle(new Error('offline')));
  expect(button(cancelA)).toBeUndefined();
  expect(button(cancelB)).toBeUndefined();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('lists jobs without cancel controls for a viewer who may not cancel', () => {
  state.jobs = [job('a'), job('b')];
  render('$thread', false);
  expand();
  expect(container.textContent).toContain('tool_a');
  // Only the title, which lists the jobs, is a button.
  expect([...container.querySelectorAll('button')]).toEqual([toggle()]);
});

it('keeps a cancel stopping across a switch to another thread and back', async () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  render('$thread');
  await click(cancelA);
  render('$other');
  render('$thread');
  expect(title()).toBe(stoppingA);
  expect(button(cancelA)).toBeUndefined();
});

it('drops the error of a failed cancel once the job is cancelled from elsewhere', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click(cancelA);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  state.jobs = [job('a', { status: 'cancel_requested' })];
  render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('keeps the error of a job still listed when a cancel of a job that ended fails later', async () => {
  state.jobs = [job('a'), job('b')];
  const fails: Array<(error: Error) => void> = [];
  state.send = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        fails.push(reject);
      })
  );
  render();
  expand();
  await click(cancelA);
  await click(cancelB);
  await act(async () => fails[1](new Error('offline')));
  state.jobs = [job('b')];
  render();
  await act(async () => fails[0](new Error('offline')));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('"tool":"tool_b"');
});

it('leaves a failed cancel behind when the view moves to another thread', async () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render(null);
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  render('$thread');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('keeps a late cancel failure out of the thread the view moved to', async () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  let fail: (error: Error) => void = () => undefined;
  state.send = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  render(null);
  await click('mindroomUi.backgroundJobs.stopAll');
  render('$thread');
  await act(async () => fail(new Error('offline')));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button(cancelA)).toBeDefined();
});

it('keeps a sent cancel stopping after the bar is unmounted and shown again', async () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a')];
  render();
  await click(cancelA);
  act(() => root.unmount());
  root = createRoot(container);
  render();
  expect(title()).toBe(stoppingA);
  expect(button(cancelA)).toBeUndefined();
});

it('moves keyboard focus to the next cancel button, and to the bar after Stop all', async () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a'), job('b'), job('c')];
  render();
  expand();
  button(cancelA)?.focus();
  await click(cancelA);
  expect(document.activeElement).toBe(button(cancelB));
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
});

it('keeps keyboard focus in the bar when two jobs become one, and one becomes two', async () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a'), job('b')];
  render();
  expand();
  button(cancelA)?.focus();
  await click(cancelA);
  expect(document.activeElement).toBe(button(cancelB));
  state.jobs = [job('b')];
  render();
  const region = container.querySelector('[role="region"]');
  expect(document.activeElement).toBe(region);
  // One job's focused Stop does not turn into Stop all under the pointer or keyboard.
  button(cancelB)?.focus();
  state.jobs = [job('b'), job('c')];
  render();
  expect(document.activeElement).toBe(region);
});

it('keeps focus in the bar when its one job is replaced by another', async () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a')];
  render();
  button(cancelA)?.focus();
  state.jobs = [job('b')];
  render();
  expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
});

it('does not take focus for a new job after the bar went away with focus in it', () => {
  state.send = vi.fn(() => new Promise<never>(() => {}));
  state.jobs = [job('a')];
  render();
  act(() => button(cancelA)?.click());
  expect(document.activeElement).toBe(container.querySelector('[role="region"]'));
  state.jobs = [];
  render();
  state.jobs = [job('b')];
  render();
  expect(document.activeElement).toBe(document.body);
});

it('leaves focus where the person moved it when the jobs change later', async () => {
  state.jobs = [job('a')];
  render();
  await act(async () => {
    const stop = button(cancelA);
    stop?.focus();
    // A browser blurs with no related target when focus goes to the page; jsdom names the
    // document instead, so the browser's event comes first.
    stop?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    stop?.blur();
  });
  state.jobs = [job('a'), job('b')];
  render();
  expect(document.activeElement).toBe(document.body);
});

it('says in its row that a job waits for approval, until it is stopping', () => {
  state.jobs = [job('a'), job('b', { status: 'awaiting_approval' })];
  render();
  expand();
  const rows = [...container.querySelectorAll('li')];
  expect(rows.map((row) => row.textContent?.includes('backgroundJobs.waiting'))).toEqual([
    false,
    true,
  ]);
  state.jobs = [job('a'), job('b', { status: 'cancel_requested' })];
  render();
  expect(container.textContent).not.toContain('backgroundJobs.waiting');
});

it('shows a failed cancel again in the view it was sent from', async () => {
  state.jobs = [job('a'), job('b', { threadId: '$other' })];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render(null);
  await click('mindroomUi.backgroundJobs.stopAll');
  render('$thread');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  render(null);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'mindroomUi.backgroundJobs.stopAllFailed'
  );
});

it('shows a failed cancel only while its job is listed', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click(cancelA);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  state.jobs = [job('b')];
  render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('shows Stopping without a cancel button for a job cancelled elsewhere', () => {
  state.jobs = [job('a', { status: 'cancel_requested' }), job('b', { status: 'cancel_requested' })];
  render();
  expand();
  expect(container.textContent).toContain('mindroomUi.backgroundJobs.stopping');
  expect([...container.querySelectorAll('button')]).toEqual([toggle()]);
});

it('restores the button and shows an error when the send fails', async () => {
  state.jobs = [job('a')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await act(async () => {
    button('mindroomUi.backgroundJobs.stopJob{"tool":"tool_a"}')?.click();
  });
  expect(container.textContent).not.toContain('mindroomUi.backgroundJobs.stopping');
  expect(button('mindroomUi.backgroundJobs.stopJob{"tool":"tool_a"}')).toBeDefined();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('stopFailed');
});

it('says the jobs could not be stopped when Stop all fails', async () => {
  state.jobs = [job('a'), job('b')];
  state.send = vi.fn().mockRejectedValue(new Error('offline'));
  render();
  await click('mindroomUi.backgroundJobs.stopAll');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'mindroomUi.backgroundJobs.stopAllFailed'
  );
});

it('stop all sends one event for the view and marks every job stopping', async () => {
  state.jobs = [job('a'), job('b')];
  render();
  await act(async () => {
    button('mindroomUi.backgroundJobs.stopAll')?.click();
  });
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(
    container.querySelectorAll('button[aria-label^="mindroomUi.backgroundJobs.stopJob"]')
  ).toHaveLength(0);
});
