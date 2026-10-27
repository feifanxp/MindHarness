import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { parseScheduleTimestamp, parseScheduledTaskStateEvent } from './scheduledTaskContract';

export type ThreadScheduledStatus = {
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  cronDescription?: string;
};

export const EMPTY_THREAD_SCHEDULED_STATUS: ThreadScheduledStatus = Object.freeze({
  scheduledTaskCount: 0,
});

export const buildRoomThreadScheduledStatusMap = (
  scheduledTaskEvents: readonly MatrixEvent[],
  now = Date.now()
): Map<string, ThreadScheduledStatus> => {
  const statusMap = new Map<string, ThreadScheduledStatus>();
  const completeTimestampThreads = new Set<string>();

  scheduledTaskEvents.forEach((event) => {
    const parsedTask = parseScheduledTaskStateEvent(event);
    if (!parsedTask) return;
    if (parsedTask.status !== 'pending') return;
    if (parsedTask.newThread) return;
    if (!parsedTask.threadId) return;

    const executeAtTs = parseScheduleTimestamp(parsedTask.executeAt);
    if (executeAtTs !== undefined && executeAtTs <= now) return;

    const current = statusMap.get(parsedTask.threadId) ?? EMPTY_THREAD_SCHEDULED_STATUS;
    const previousTimestampsComplete =
      current.scheduledTaskCount === 0 || completeTimestampThreads.has(parsedTask.threadId);
    const allTasksHaveTimestamps = executeAtTs !== undefined && previousTimestampsComplete;
    if (allTasksHaveTimestamps) {
      completeTimestampThreads.add(parsedTask.threadId);
    } else {
      completeTimestampThreads.delete(parsedTask.threadId);
    }
    const nextScheduledTs =
      executeAtTs === undefined || !previousTimestampsComplete
        ? undefined
        : current.nextScheduledTs === undefined || executeAtTs < current.nextScheduledTs
        ? executeAtTs
        : current.nextScheduledTs;
    const cronDescription =
      current.scheduledTaskCount === 0 && executeAtTs === undefined
        ? parsedTask.cronDescription
        : undefined;

    statusMap.set(parsedTask.threadId, {
      scheduledTaskCount: current.scheduledTaskCount + 1,
      nextScheduledTs,
      ...(cronDescription ? { cronDescription } : {}),
    });
  });

  return statusMap;
};

export const getThreadScheduledStatus = (
  scheduledStatusMap: ReadonlyMap<string, ThreadScheduledStatus>,
  threadRootId: string | undefined
): ThreadScheduledStatus =>
  threadRootId
    ? scheduledStatusMap.get(threadRootId) ?? EMPTY_THREAD_SCHEDULED_STATUS
    : EMPTY_THREAD_SCHEDULED_STATUS;

export const getRoomScheduledTaskCounts = (
  scheduledTaskEvents: readonly MatrixEvent[],
  now = Date.now()
): Map<string, number> => {
  const counts = new Map<string, number>();
  buildRoomThreadScheduledStatusMap(scheduledTaskEvents, now).forEach((status, threadRootId) => {
    counts.set(threadRootId, status.scheduledTaskCount);
  });
  return counts;
};

export const getNextThreadScheduledTs = (
  scheduledTaskEvents: readonly MatrixEvent[],
  threadRootId: string | undefined,
  now = Date.now()
): number | undefined =>
  getThreadScheduledStatus(
    buildRoomThreadScheduledStatusMap(scheduledTaskEvents, now),
    threadRootId
  ).nextScheduledTs;
