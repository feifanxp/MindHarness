import type { MatrixEvent } from 'matrix-js-sdk';
import {
  parseScheduleTimestamp,
  parseScheduledTaskStateEvent,
  type ParsedScheduledTask,
} from '../threads/scheduledTaskContract';

export const getScheduleTimestamp = (task: ParsedScheduledTask): number | undefined =>
  task.scheduleType === 'cron' ? undefined : parseScheduleTimestamp(task.executeAt);

export const getPendingRoomSchedules = (events: readonly MatrixEvent[]): ParsedScheduledTask[] =>
  events
    .map(parseScheduledTaskStateEvent)
    .filter((task): task is ParsedScheduledTask => task !== null && task.status === 'pending')
    .map((task) => (task.threadId === 'main' ? { ...task, threadId: null } : task))
    .sort((left, right) => {
      const leftTime = getScheduleTimestamp(left) ?? Infinity;
      const rightTime = getScheduleTimestamp(right) ?? Infinity;
      return leftTime === rightTime
        ? left.taskId.localeCompare(right.taskId)
        : leftTime - rightTime;
    });
