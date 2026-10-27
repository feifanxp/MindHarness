import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';
import { useThreadScheduledTasks } from './useThreadScheduledTasks';
import { useStateEvents } from './useStateEvents';

vi.mock('./useStateEvents', () => ({
  useStateEvents: vi.fn(),
}));

vi.mock('../../hooks/useInterval', () => ({
  useInterval: vi.fn(),
}));

const mockedUseStateEvents = vi.mocked(useStateEvents);

const makeScheduledTaskEvent = (
  {
    status = 'pending',
    threadId,
    newThread = false,
  }: {
    status?: string;
    threadId?: string | null;
    newThread?: boolean;
  },
  stateKey: string,
  sender = '@mindroom_router:example.org'
) =>
  new MatrixEvent({
    content: {
      status,
      workflow: JSON.stringify({
        thread_id: threadId,
        new_thread: newThread,
      }),
    },
    event_id: `$${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender,
    state_key: stateKey,
    type: MINDROOM_SCHEDULED_TASK_EVENT,
  });

type HarnessProps = {
  room: Room;
  threadRootId?: string;
  onRender: (value: number) => void;
};

function Harness({ room, threadRootId, onRender }: HarnessProps) {
  onRender(useThreadScheduledTasks(room, threadRootId));
  return null;
}

const renderHookHarness = (
  room: Room,
  threadRootId: string | undefined,
  getEvents: () => MatrixEvent[]
): {
  getSnapshot: () => number;
  update: () => void;
  renderer: ReactTestRenderer;
} => {
  let latestSnapshot: number | undefined;
  mockedUseStateEvents.mockImplementation(() => getEvents());

  const onRender = (value: number) => {
    latestSnapshot = value;
  };

  const renderer = create(React.createElement(Harness, { room, threadRootId, onRender }));

  return {
    getSnapshot: () => {
      if (latestSnapshot === undefined) {
        throw new Error('Hook snapshot was not captured');
      }
      return latestSnapshot;
    },
    update: () => {
      act(() => {
        renderer.update(React.createElement(Harness, { room, threadRootId, onRender }));
      });
    },
    renderer,
  };
};

describe('useThreadScheduledTasks', () => {
  it('returns an empty map for rooms without scheduled tasks', () => {
    const room = { myUserId: '@alice:example.org' } as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => []);

    expect(getSnapshot()).toBe(0);
    expect(mockedUseStateEvents).toHaveBeenCalledWith(room, MINDROOM_SCHEDULED_TASK_EVENT);

    renderer.unmount();
  });

  it('counts one pending thread-targeted scheduled task', () => {
    const room = { myUserId: '@alice:example.org' } as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-1'),
    ]);

    expect(getSnapshot()).toBe(1);

    renderer.unmount();
  });

  it('filters out non-pending task statuses', () => {
    const room = { myUserId: '@alice:example.org' } as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ status: 'completed', threadId: '$thread-1' }, 'task-1'),
      makeScheduledTaskEvent({ status: 'cancelled', threadId: '$thread-1' }, 'task-2'),
      makeScheduledTaskEvent({ status: 'failed', threadId: '$thread-1' }, 'task-3'),
      makeScheduledTaskEvent({ status: 'expired', threadId: '$thread-1' }, 'task-4'),
    ]);

    expect(getSnapshot()).toBe(0);

    renderer.unmount();
  });

  it('filters out tasks without a thread id', () => {
    const room = { myUserId: '@alice:example.org' } as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ threadId: null }, 'task-1'),
    ]);

    expect(getSnapshot()).toBe(0);

    renderer.unmount();
  });

  it('filters out tasks that create a new thread', () => {
    const room = { myUserId: '@alice:example.org' } as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ threadId: '$thread-1', newThread: true }, 'task-1'),
    ]);

    expect(getSnapshot()).toBe(0);

    renderer.unmount();
  });

  it('aggregates multiple pending tasks for the same thread', () => {
    const room = { myUserId: '@alice:example.org' } as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-1'),
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-2'),
      makeScheduledTaskEvent({ threadId: '$thread-2' }, 'task-3'),
    ]);

    expect(getSnapshot()).toBe(2);

    renderer.unmount();
  });

  it('ignores tasks written by accounts that are not MindRoom accounts on the viewer homeserver', () => {
    const room = { myUserId: '@alice:example.org' } as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-1'),
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-2', '@mallory:example.org'),
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-3', '@mindroom_router:other.example'),
    ]);

    expect(getSnapshot()).toBe(1);

    renderer.unmount();
  });

  it('returns zero when thread root id is missing', () => {
    const room = { myUserId: '@alice:example.org' } as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, undefined, () => [
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-1'),
    ]);

    expect(getSnapshot()).toBe(0);

    renderer.unmount();
  });

  it('recomputes when the scheduled-task event list changes', () => {
    const room = { myUserId: '@alice:example.org' } as Room;
    let events = [makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-1')];
    const { getSnapshot, update, renderer } = renderHookHarness(room, '$thread-1', () => events);

    const initialCount = getSnapshot();
    expect(initialCount).toBe(1);

    events = [
      ...events,
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-2'),
      makeScheduledTaskEvent({ threadId: '$thread-2' }, 'task-3'),
    ];

    update();

    expect(getSnapshot()).not.toBe(initialCount);
    expect(getSnapshot()).toBe(2);

    renderer.unmount();
  });
});
