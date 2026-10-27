import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  daysToMs,
  formatCompactRelativeTime,
  formatRelativeTime,
  hoursToMs,
  minutesToMs,
  secondsToMs,
} from './time';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns now for ages from 0ms through 4999ms', () => {
    const now = Date.now();

    expect(formatRelativeTime(now)).toBe('now');
    expect(formatRelativeTime(now - 4999)).toBe('now');
  });

  it('returns seconds at the 5 second boundary through 59 seconds', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - 5000)).toBe('5s ago');
    expect(formatRelativeTime(now - secondsToMs(59))).toBe('59s ago');
  });

  it('returns minutes from 60 seconds through 59 minutes', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - secondsToMs(60))).toBe('1m ago');
    expect(formatRelativeTime(now - minutesToMs(59))).toBe('59m ago');
  });

  it('spells units out in the long style', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - minutesToMs(2), 'en', 'long')).toBe('2 minutes ago');
    expect(formatRelativeTime(now - minutesToMs(2))).toBe('2m ago');
  });

  it('returns hours from 1 hour through 23 hours', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - hoursToMs(1))).toBe('1h ago');
    expect(formatRelativeTime(now - hoursToMs(23))).toBe('23h ago');
  });

  it('returns days at 1 day and beyond', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - daysToMs(1))).toBe('1d ago');
    expect(formatRelativeTime(now - daysToMs(3))).toBe('3d ago');
  });

  it('clamps future timestamps to now', () => {
    expect(formatRelativeTime(Date.now() + secondsToMs(30))).toBe('now');
  });

  it('uses the selected app language for relative time', () => {
    expect(formatRelativeTime(Date.now() - minutesToMs(1), 'de')).toBe('vor 1 m');
    expect(formatRelativeTime(Date.now() - minutesToMs(1), 'nl')).toBe('1 min. geleden');
    expect(formatRelativeTime(Date.now(), 'de')).toBe('jetzt');
    expect(formatRelativeTime(Date.now(), 'nl')).toBe('nu');
  });
});

describe('formatCompactRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops the suffix and stays at minute granularity below an hour', () => {
    const now = Date.now();

    expect(formatCompactRelativeTime(now)).toBe('now');
    expect(formatCompactRelativeTime(now - secondsToMs(59))).toBe('now');
    expect(formatCompactRelativeTime(now - secondsToMs(60))).toBe('1m');
    expect(formatCompactRelativeTime(now - minutesToMs(59))).toBe('59m');
    expect(formatCompactRelativeTime(now + secondsToMs(30))).toBe('now');
  });

  it('counts hours, then days for the first week', () => {
    const now = Date.now();

    expect(formatCompactRelativeTime(now - hoursToMs(1))).toBe('1h');
    expect(formatCompactRelativeTime(now - hoursToMs(23))).toBe('23h');
    expect(formatCompactRelativeTime(now - daysToMs(1))).toBe('1d');
    expect(formatCompactRelativeTime(now - daysToMs(7) + 1)).toBe('6d');
  });

  // Local noon, so the expected day holds in every timezone.
  it('shows the date after a week, with the year only for earlier years', () => {
    expect(formatCompactRelativeTime(new Date(2026, 2, 1, 12).getTime())).toBe('Mar 1');
    expect(formatCompactRelativeTime(new Date(2025, 10, 20, 12).getTime())).toBe('Nov 20, 2025');
  });

  it('uses the selected app language', () => {
    const now = Date.now();

    expect(formatCompactRelativeTime(now, 'nl')).toBe('nu');
    expect(formatCompactRelativeTime(now - daysToMs(2), 'nl')).toBe('2 d');
    expect(formatCompactRelativeTime(now - hoursToMs(3), 'nl')).toBe('3 u');
    expect(formatCompactRelativeTime(new Date(2026, 2, 1, 12).getTime(), 'nl')).toBe('1 mrt');
  });
});
