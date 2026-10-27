import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { MINDROOM_SCHEDULED_TASK_EVENT } from '../threads/scheduledTaskContract';
import { getPendingRoomSchedules, getScheduleTimestamp } from './roomSchedules';

const event = (taskId: string, workflow: Record<string, unknown>, status = 'pending') =>
  new MatrixEvent({
    type: MINDROOM_SCHEDULED_TASK_EVENT,
    state_key: taskId,
    content: { status, workflow: JSON.stringify(workflow) },
  });

describe('pending room schedules', () => {
  it('includes all destinations and overdue tasks, sorted by time before undated tasks', () => {
    const events = [
      event('recurring', { schedule_type: 'cron', thread_id: '$thread-2' }),
      event('new-thread', { new_thread: true, execute_at: '2099-01-01T12:00:00Z' }),
      event('overdue', { thread_id: '$thread-1', execute_at: '2000-01-01T12:00:00Z' }),
      event('room', { execute_at: '2099-01-01T10:00:00Z' }),
      event('completed', {}, 'completed'),
      event('cancelled', {}, 'cancelled'),
      event('failed', {}, 'failed'),
      new MatrixEvent({ type: MINDROOM_SCHEDULED_TASK_EVENT, state_key: 'redacted', content: {} }),
    ];
    expect(getPendingRoomSchedules(events).map((task) => task.taskId)).toEqual([
      'overdue',
      'room',
      'new-thread',
      'recurring',
    ]);
  });

  it('keeps unknown times visible and does not interpret a cron execute_at as the next run', () => {
    const tasks = getPendingRoomSchedules([
      event('bad-time', { execute_at: 'not a date' }),
      event('cron', { schedule_type: 'cron', execute_at: '2000-01-01T12:00:00Z' }),
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => getScheduleTimestamp(task))).toEqual([undefined, undefined]);
  });

  it.each(['2026-09-16T09:30:00', '2026-09-16 09:30:00'])(
    'treats %s as UTC without an offset',
    (executeAt) => {
      const [task] = getPendingRoomSchedules([event('naive', { execute_at: executeAt })]);
      expect(getScheduleTimestamp(task)).toBe(1789551000000);
    }
  );

  it('recognizes the legacy main destination as the room timeline', () => {
    const [task] = getPendingRoomSchedules([event('main', { thread_id: 'main' })]);
    expect(task.threadId).toBeNull();
  });
});
