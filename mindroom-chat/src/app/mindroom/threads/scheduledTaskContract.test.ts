import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_SCHEDULED_TASK_EVENT,
  parseScheduledTaskStateEvent,
} from './scheduledTaskContract';

const makeScheduledTaskEvent = (content: Record<string, unknown>, stateKey = 'task-1') =>
  new MatrixEvent({
    content,
    event_id: `$${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: MINDROOM_SCHEDULED_TASK_EVENT,
  });

describe('parseScheduledTaskStateEvent', () => {
  it.each([null, 0, 12])('preserves history limit %s', (historyLimit) => {
    const task = parseScheduledTaskStateEvent(
      makeScheduledTaskEvent({
        status: 'pending',
        workflow: { history_limit: historyLimit },
      })
    );
    expect(task?.historyLimit).toBe(historyLimit);
  });

  it.each([true, false])('reads schedule details from workflow JSON or an object (%s)', (json) => {
    const workflow = {
      schedule_type: 'cron',
      cron_schedule: { minute: '30', hour: '9', weekday: '1-5' },
      message: 'Check the inbox.\nSummarize urgent messages.',
      description: 'Morning inbox',
      model: 'cheap',
      created_by: '@alice:example.org',
      thread_id: '$thread',
      silent: true,
      is_conditional: true,
      history_limit: 0,
    };
    const task = parseScheduledTaskStateEvent(
      makeScheduledTaskEvent({
        status: 'pending',
        created_at: '2026-09-15T12:00:00Z',
        updated_at: '2026-09-16T12:00:00Z',
        workflow: json ? JSON.stringify(workflow) : workflow,
      })
    );
    expect(task).toMatchObject({
      scheduleType: 'cron',
      cronExpression: '30 9 * * 1-5',
      message: 'Check the inbox.\nSummarize urgent messages.',
      description: 'Morning inbox',
      createdBy: '@alice:example.org',
      createdAt: '2026-09-15T12:00:00Z',
      updatedAt: '2026-09-16T12:00:00Z',
      model: 'cheap',
      silent: true,
      isConditional: true,
      historyLimit: 0,
    });
  });

  it.each([
    { model: ' premium ', expected: 'premium' },
    { model: null, expected: null },
    { model: ' ', expected: null },
    { model: 42, expected: 'cheap' },
  ])('resolves the top-level model choice $model over workflow data', ({ model, expected }) => {
    const task = parseScheduledTaskStateEvent(
      makeScheduledTaskEvent({ status: 'pending', model, workflow: { model: 'cheap' } })
    );
    expect(task?.model).toBe(expected);
  });

  it('uses normalized details before workflow values and rejects malformed optional fields', () => {
    const task = parseScheduledTaskStateEvent(
      makeScheduledTaskEvent({
        status: 'pending',
        message: 'Updated prompt',
        silent: false,
        workflow: {
          message: 'Old prompt',
          silent: true,
          schedule_type: 'unsupported',
          cron_schedule: [],
          description: { bad: true },
          history_limit: -1,
          model: { bad: true },
          updated_at: 123,
          created_by: 42,
        },
      })
    );
    expect(task).toMatchObject({ message: 'Updated prompt', silent: false });
    expect(task?.scheduleType).toBeUndefined();
    expect(task?.cronExpression).toBeUndefined();
    expect(task?.description).toBeUndefined();
    expect(task?.historyLimit).toBeUndefined();
    expect(task?.model).toBeUndefined();
    expect(task?.updatedAt).toBeUndefined();
    expect(task?.createdBy).toBeUndefined();
  });

  it('parses normalized top-level thread fields', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: false,
      workflow: JSON.stringify({
        thread_id: '$legacy-thread',
        new_thread: true,
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      threadId: '$thread',
      newThread: false,
      executeAt: null,
    });
  });

  it.each([true, false])('keeps an explicit room destination over workflow data (%s)', (json) => {
    const workflow = { thread_id: '$legacy-thread', new_thread: false };
    const task = parseScheduledTaskStateEvent(
      makeScheduledTaskEvent({
        status: 'pending',
        thread_id: null,
        workflow: json ? JSON.stringify(workflow) : workflow,
      })
    );

    expect(task?.threadId).toBeNull();
    expect(task?.newThread).toBe(false);
  });

  it('parses the backend-owned cron description', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: false,
      cron_description: '  At 09:00  ',
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      threadId: '$thread',
      newThread: false,
      executeAt: null,
      cronDescription: 'At 09:00',
    });
  });

  it('falls back to legacy workflow JSON when top-level fields are missing', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      workflow: JSON.stringify({
        thread_id: '$thread',
        new_thread: false,
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      threadId: '$thread',
      newThread: false,
      executeAt: null,
    });
  });

  it('accepts scheduled_at at the top level and normalizes it to executeAt', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: false,
      scheduled_at: '2026-04-04T18:30:00.000Z',
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      threadId: '$thread',
      newThread: false,
      executeAt: '2026-04-04T18:30:00.000Z',
    });
  });

  it('accepts scheduled_at in workflow JSON when top-level timing is missing', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      workflow: JSON.stringify({
        thread_id: '$thread',
        new_thread: false,
        scheduled_at: '2026-04-04T18:45:00.000Z',
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      threadId: '$thread',
      newThread: false,
      executeAt: '2026-04-04T18:45:00.000Z',
    });
  });

  it('returns null when legacy workflow JSON is malformed and fallback is required', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      workflow: '{bad json',
    });

    expect(parseScheduledTaskStateEvent(event)).toBeNull();
  });

  it('returns a room-level task shape when thread fields are missing', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      threadId: null,
      newThread: false,
      executeAt: null,
    });
  });

  it('returns null when required fields are missing', () => {
    const event = makeScheduledTaskEvent({
      workflow: JSON.stringify({
        thread_id: '$thread',
        new_thread: false,
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toBeNull();
  });
});
