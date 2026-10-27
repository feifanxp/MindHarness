import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatScheduledTime, getScheduledTimeUpdateInterval } from './compactThreadCardUtils';

describe('formatScheduledTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders short-term tasks as relative delays', () => {
    expect(formatScheduledTime(Date.now() + 3 * 60 * 1000 + 45 * 1000)).toBe('in 3m 45s');
    expect(formatScheduledTime(Date.now() + 2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe(
      'in 2h 15m'
    );
  });

  it('renders same-day tasks beyond six hours as a clock time', () => {
    expect(formatScheduledTime(Date.now() + 8 * 60 * 60 * 1000)).toMatch(/^at /);
  });

  it('renders future-day tasks as a short date plus time', () => {
    expect(formatScheduledTime(Date.now() + 26 * 60 * 60 * 1000)).toMatch(/^Mar \d{1,2},? /);
  });

  it('uses adaptive refresh cadence for countdown updates', () => {
    expect(getScheduledTimeUpdateInterval(Date.now() + 3 * 60 * 1000)).toBe(1000);
    expect(getScheduledTimeUpdateInterval(Date.now() + 45 * 60 * 1000)).toBe(60 * 1000);
    expect(getScheduledTimeUpdateInterval(Date.now() + 8 * 60 * 60 * 1000)).toBe(
      15 * 60 * 1000
    );
    expect(getScheduledTimeUpdateInterval(Date.now() + 30 * 60 * 60 * 1000)).toBe(
      60 * 60 * 1000
    );
  });
});
