import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createEditCompactionScheduler } from './editCompactionScheduler';

describe('editCompactionScheduler (CINNY-207 P1.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires a single trailing upsert per target after the debounce window', () => {
    const scheduler = createEditCompactionScheduler(1000);
    const upsert = vi.fn();

    scheduler.scheduleTargetUpsert('key', upsert);
    expect(upsert).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(upsert).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('coalesces N rapid scheduled upserts to one trailing fire, using the last upsert closure', () => {
    // Streaming scenario: 25 edits arrive within the debounce window. The
    // trailing fire uses the closure passed on the LAST call, so at fire
    // time the write reflects the final edit (each closure reads the
    // current SDK-aggregated target when invoked).
    const scheduler = createEditCompactionScheduler(1000);
    const upserts = Array.from({ length: 25 }, () => vi.fn());

    upserts.forEach((upsert, index) => {
      vi.advanceTimersByTime(10); // still well under 1000 ms
      scheduler.scheduleTargetUpsert('same-key', upsert);
      expect(upsert).not.toHaveBeenCalled();
      expect(scheduler.pendingCount()).toBe(1);
      // Earlier upserts must NOT fire — they are replaced by the newer one.
      if (index > 0) {
        expect(upserts[index - 1]).not.toHaveBeenCalled();
      }
    });

    vi.advanceTimersByTime(1000);

    upserts.slice(0, -1).forEach((upsert) => expect(upsert).not.toHaveBeenCalled());
    expect(upserts[upserts.length - 1]).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('flushAll fires every pending upsert synchronously (visibility-loss / unmount path)', () => {
    const scheduler = createEditCompactionScheduler(1000);
    const upsertA = vi.fn();
    const upsertB = vi.fn();

    scheduler.scheduleTargetUpsert('a', upsertA);
    scheduler.scheduleTargetUpsert('b', upsertB);
    expect(upsertA).not.toHaveBeenCalled();
    expect(upsertB).not.toHaveBeenCalled();

    scheduler.flushAll();

    expect(upsertA).toHaveBeenCalledTimes(1);
    expect(upsertB).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('flushTarget fires only the requested target', () => {
    const scheduler = createEditCompactionScheduler(1000);
    const upsertA = vi.fn();
    const upsertB = vi.fn();

    scheduler.scheduleTargetUpsert('a', upsertA);
    scheduler.scheduleTargetUpsert('b', upsertB);

    scheduler.flushTarget('a');

    expect(upsertA).toHaveBeenCalledTimes(1);
    expect(upsertB).not.toHaveBeenCalled();
    expect(scheduler.pendingCount()).toBe(1);
  });

  it('does not double-fire a flushed target when its timer would later fire', () => {
    const scheduler = createEditCompactionScheduler(1000);
    const upsert = vi.fn();

    scheduler.scheduleTargetUpsert('key', upsert);
    scheduler.flushTarget('key');
    vi.advanceTimersByTime(5000);

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('cancelAll clears pending upserts without firing (hard teardown)', () => {
    const scheduler = createEditCompactionScheduler(1000);
    const upsert = vi.fn();

    scheduler.scheduleTargetUpsert('key', upsert);
    scheduler.cancelAll();
    vi.advanceTimersByTime(5000);

    expect(upsert).not.toHaveBeenCalled();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('swallows upsert exceptions so one bad target cannot poison a flushAll', () => {
    const scheduler = createEditCompactionScheduler(1000);
    const goodUpsert = vi.fn();
    const badUpsert = vi.fn(() => {
      throw new Error('boom');
    });

    scheduler.scheduleTargetUpsert('bad', badUpsert);
    scheduler.scheduleTargetUpsert('good', goodUpsert);

    expect(() => scheduler.flushAll()).not.toThrow();
    expect(badUpsert).toHaveBeenCalledTimes(1);
    expect(goodUpsert).toHaveBeenCalledTimes(1);
  });
});
