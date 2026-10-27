import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';

dayjs.extend(isToday);
dayjs.extend(isYesterday);

export const today = (ts: number): boolean => dayjs(ts).isToday();

export const yesterday = (ts: number): boolean => dayjs(ts).isYesterday();

export const timeHour = (ts: number, hour24Clock: boolean): string =>
  dayjs(ts).format(hour24Clock ? 'HH' : 'hh');
export const timeMinute = (ts: number): string => dayjs(ts).format('mm');
export const timeAmPm = (ts: number): string => dayjs(ts).format('A');
export const timeDay = (ts: number): string => dayjs(ts).format('D');
export const timeMon = (ts: number): string => dayjs(ts).format('MMM');
export const timeMonth = (ts: number): string => dayjs(ts).format('MMMM');
export const timeYear = (ts: number): string => dayjs(ts).format('YYYY');

export const timeHourMinute = (ts: number, hour24Clock: boolean): string =>
  dayjs(ts).format(hour24Clock ? 'HH:mm' : 'hh:mm A');

export const timeDayMonYear = (ts: number, dateFormatString: string): string =>
  dayjs(ts).format(dateFormatString);

export const timeDayMonthYear = (ts: number): string => dayjs(ts).format('D MMMM YYYY');

export const daysInMonth = (month: number, year: number): number =>
  dayjs(`${year}-${month}-1`).daysInMonth();

export const dateFor = (year: number, month: number, day: number): number =>
  dayjs(`${year}-${month}-${day}`).valueOf();

export const inSameDay = (ts1: number, ts2: number): boolean => {
  const dt1 = new Date(ts1);
  const dt2 = new Date(ts2);
  return (
    dt2.getFullYear() === dt1.getFullYear() &&
    dt2.getMonth() === dt1.getMonth() &&
    dt2.getDate() === dt1.getDate()
  );
};

export const minuteDifference = (ts1: number, ts2: number): number => {
  const dt1 = new Date(ts1);
  const dt2 = new Date(ts2);

  let diff = (dt2.getTime() - dt1.getTime()) / 1000;
  diff /= 60;
  return Math.abs(Math.round(diff));
};

export const hour24to12 = (hour24: number): number => {
  const h = hour24 % 12;

  if (h === 0) return 12;
  return h;
};

export const hour12to24 = (hour: number, pm: boolean): number => {
  if (hour === 12) {
    return pm ? 12 : 0;
  }
  return pm ? hour + 12 : hour;
};

export const secondsToMs = (seconds: number) => seconds * 1000;

export const minutesToMs = (minutes: number) => minutes * secondsToMs(60);

export const hoursToMs = (hour: number) => hour * minutesToMs(60);

export const daysToMs = (days: number) => days * hoursToMs(24);

// useRelativeTime re-invokes formatRelativeTime every second per visible thread
// card; caching the Intl.RelativeTimeFormat variants avoids constructing
// them on every tick.
const relativeTimeFormatterCache = new Map<string, Intl.RelativeTimeFormat>();

const getRelativeTimeFormatter = (
  language: string,
  numeric: 'always' | 'auto',
  style: Intl.RelativeTimeFormatStyle
): Intl.RelativeTimeFormat => {
  const cacheKey = `${language}:${numeric}:${style}`;
  const cached = relativeTimeFormatterCache.get(cacheKey);
  if (cached) return cached;
  const formatter = new Intl.RelativeTimeFormat(language, { numeric, style });
  relativeTimeFormatterCache.set(cacheKey, formatter);
  return formatter;
};

export const formatRelativeTime = (
  ts: number,
  language = 'en',
  style: Intl.RelativeTimeFormatStyle = 'narrow'
): string => {
  const ageMs = Math.max(0, Date.now() - ts);

  if (ageMs < 5000) {
    return getRelativeTimeFormatter(language, 'auto', style).format(0, 'second');
  }

  const relativeTime = getRelativeTimeFormatter(language, 'always', style);

  const ageSeconds = Math.floor(ageMs / 1000);
  if (ageSeconds < 60) return relativeTime.format(-ageSeconds, 'second');

  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return relativeTime.format(-ageMinutes, 'minute');

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return relativeTime.format(-ageHours, 'hour');

  const ageDays = Math.floor(ageHours / 24);
  return relativeTime.format(-ageDays, 'day');
};

const compactFormatterCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

const getCompactUnitFormatter = (language: string, unit: 'minute' | 'hour' | 'day') => {
  const cacheKey = `${language}:unit:${unit}`;
  const cached = compactFormatterCache.get(cacheKey);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat(language, {
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  });
  compactFormatterCache.set(cacheKey, formatter);
  return formatter;
};

const getCompactDateFormatter = (language: string, withYear: boolean) => {
  const cacheKey = `${language}:date:${withYear}`;
  const cached = compactFormatterCache.get(cacheKey);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
  });
  compactFormatterCache.set(cacheKey, formatter);
  return formatter;
};

/**
 * Age without the "ago" suffix, for dense lists: "now", "5m", "3h", "2d", then
 * the date ("Sep 28" in English) after a week, with the year once it is not this year.
 */
export const formatCompactRelativeTime = (ts: number, language = 'en'): string => {
  const nowTs = Date.now();
  const ageMs = Math.max(0, nowTs - ts);

  if (ageMs < minutesToMs(1)) {
    return getRelativeTimeFormatter(language, 'auto', 'narrow').format(0, 'second');
  }
  if (ageMs < hoursToMs(1)) {
    return getCompactUnitFormatter(language, 'minute').format(Math.floor(ageMs / minutesToMs(1)));
  }
  if (ageMs < daysToMs(1)) {
    return getCompactUnitFormatter(language, 'hour').format(Math.floor(ageMs / hoursToMs(1)));
  }
  if (ageMs < daysToMs(7)) {
    return getCompactUnitFormatter(language, 'day').format(Math.floor(ageMs / daysToMs(1)));
  }
  const withYear = new Date(ts).getFullYear() !== new Date(nowTs).getFullYear();
  return getCompactDateFormatter(language, withYear).format(ts);
};

export const getToday = () => {
  const nowTs = Date.now();
  const date = dayjs(nowTs);
  return dateFor(date.year(), date.month() + 1, date.date());
};

export const getYesterday = () => {
  const nowTs = Date.now() - daysToMs(1);
  const date = dayjs(nowTs);
  return dateFor(date.year(), date.month() + 1, date.date());
};
