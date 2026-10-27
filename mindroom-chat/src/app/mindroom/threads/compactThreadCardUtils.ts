const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const isSameCalendarDay = (leftTs: number, rightTs: number): boolean => {
  const left = new Date(leftTs);
  const right = new Date(rightTs);

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
};

const formatRelativeDelay = (deltaMs: number, t?: TFunction): string => {
  const totalSeconds = Math.max(1, Math.round(deltaMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 1)
    return (
      t?.('mindroomUi.threads.compactThreadCardUtils.inSeconds', { count: totalSeconds }) ??
      `in ${totalSeconds}s`
    );

  if (totalMinutes < 60) {
    if (totalMinutes < 10 && seconds > 0)
      return (
        t?.('mindroomUi.threads.compactThreadCardUtils.inMinutesSeconds', {
          minutes: totalMinutes,
          seconds,
        }) ?? `in ${totalMinutes}m ${seconds}s`
      );
    return (
      t?.('mindroomUi.threads.compactThreadCardUtils.inMinutes', { count: totalMinutes }) ??
      `in ${totalMinutes}m`
    );
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0)
    return (
      t?.('mindroomUi.threads.compactThreadCardUtils.inHours', { count: hours }) ?? `in ${hours}h`
    );
  return (
    t?.('mindroomUi.threads.compactThreadCardUtils.inHoursMinutes', { hours, minutes }) ??
    `in ${hours}h ${minutes}m`
  );
};

export const formatScheduledTime = (ts: number, t?: TFunction, locale?: string): string => {
  const now = Date.now();
  const deltaMs = ts - now;

  if (deltaMs < SIX_HOURS_MS) return formatRelativeDelay(deltaMs, t);

  if (isSameCalendarDay(now, ts)) {
    const time = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(ts);
    return t?.('mindroomUi.threads.compactThreadCardUtils.atTime', { time }) ?? `at ${time}`;
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ts);
};

export const getThreadScheduledDisplayText = (
  scheduledTaskCount: number,
  nextScheduledTs: number | undefined,
  cronDescription?: string,
  t?: TFunction,
  locale?: string
): string | undefined => {
  if (nextScheduledTs !== undefined) return formatScheduledTime(nextScheduledTs, t, locale);
  if (scheduledTaskCount === 1 && cronDescription) return cronDescription;
  if (scheduledTaskCount <= 0) return undefined;
  return (
    t?.('mindroomUi.threads.compactThreadCardUtils.scheduledTasks', {
      count: scheduledTaskCount,
    }) ?? `${scheduledTaskCount} scheduled ${scheduledTaskCount === 1 ? 'task' : 'tasks'}`
  );
};

export const getThreadScheduledLabel = (
  scheduledTaskCount: number,
  nextScheduledTs: number | undefined,
  cronDescription: string | undefined,
  scheduledDisplayText: string | undefined,
  t?: TFunction
): string | undefined => {
  if (scheduledTaskCount <= 0) return undefined;

  const hasScheduleDetail =
    nextScheduledTs !== undefined || (scheduledTaskCount === 1 && !!cronDescription);
  const taskCopy =
    t?.('mindroomUi.threads.compactThreadCardUtils.pendingScheduledTasks', {
      count: scheduledTaskCount,
    }) ?? `${scheduledTaskCount} pending scheduled ${scheduledTaskCount === 1 ? 'task' : 'tasks'}`;
  return hasScheduleDetail && scheduledDisplayText
    ? t?.('mindroomUi.threads.compactThreadCardUtils.scheduledTasksWithDetail', {
        tasks: taskCopy,
        detail: scheduledDisplayText,
      }) ?? `${taskCopy}, ${scheduledDisplayText}`
    : taskCopy;
};

export const getScheduledTimeUpdateInterval = (ts: number, now = Date.now()): number => {
  const deltaMs = ts - now;

  if (deltaMs <= 0) return -1;
  if (deltaMs < TEN_MINUTES_MS) return 1000;
  if (deltaMs < SIX_HOURS_MS) return 60 * 1000;
  if (deltaMs < ONE_HOUR_MS * 24) return FIFTEEN_MINUTES_MS;
  return ONE_HOUR_MS;
};
import type { TFunction } from 'i18next';
