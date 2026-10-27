/**
 * CINNY-207 P1.4: per-target trailing debounce for edit-compaction upserts.
 *
 * Finding F5 / decision D5: MindRoom streams AI messages via many `m.replace`
 * edits per second. The old cache path persisted each replace as its own
 * record (a message with N edits produced ~N+1 records). This scheduler
 * coalesces the writes: an incoming edit schedules an upsert of the TARGET's
 * cached record (with the latest edit bundled into
 * `unsigned['m.relations']['m.replace']`, the representation
 * `serializeEventsForCache` already emits for targets), and further edits to
 * the same target within the debounce window replace the pending upsert
 * function without firing a write. When the stream ends, the trailing timer
 * fires once with the final content.
 *
 * `flushTarget` and `flushAll` fire pending upserts synchronously — used at
 * unmount, visibility-loss (pagehide/visibilitychange hidden), and any other
 * point where losing the pending write would matter more than the batching.
 *
 * The scheduler is intentionally state-free about *what* to upsert: callers
 * pass a fresh closure each time that reads the current target instance from
 * the SDK at fire time, so the write always reflects the very latest bundled
 * edit even if additional edits landed after the timer was armed.
 */

type UpsertFn = () => void;

type PendingUpsert = {
  upsert: UpsertFn;
  timer: ReturnType<typeof setTimeout>;
};

export type EditCompactionScheduler = {
  /**
   * Arm (or re-arm) a trailing-debounced upsert for a given target key.
   * Successive calls with the same key replace the pending upsert function
   * and reset the timer. `key` should uniquely identify the cache record
   * (e.g. `${roomId}|${threadId}|${targetEventId}` for thread records,
   * `${roomId}|${targetEventId}` for room records).
   */
  scheduleTargetUpsert: (key: string, upsert: UpsertFn) => void;
  /** Fire the pending upsert for a specific key immediately, if any. */
  flushTarget: (key: string) => void;
  /** Fire every pending upsert immediately (unmount / visibility-loss). */
  flushAll: () => void;
  /** Cancel every pending upsert without firing. Used on hard teardown. */
  cancelAll: () => void;
  /** For test/observability only. */
  pendingCount: () => number;
};

export const createEditCompactionScheduler = (
  debounceMs: number
): EditCompactionScheduler => {
  const pending = new Map<string, PendingUpsert>();

  const runUpsert = (key: string) => {
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    clearTimeout(entry.timer);
    try {
      entry.upsert();
    } catch {
      // Upsert closures already handle persistence errors via
      // countCacheProbe('writeErrors'); swallow anything unexpected so one
      // bad target cannot poison the flush of the rest.
    }
  };

  return {
    scheduleTargetUpsert: (key, upsert) => {
      const existing = pending.get(key);
      if (existing) {
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(() => runUpsert(key), debounceMs);
      pending.set(key, { upsert, timer });
    },
    flushTarget: (key) => runUpsert(key),
    flushAll: () => {
      // Copy keys first because runUpsert mutates the map.
      const keys = Array.from(pending.keys());
      keys.forEach(runUpsert);
    },
    cancelAll: () => {
      pending.forEach((entry) => clearTimeout(entry.timer));
      pending.clear();
    },
    pendingCount: () => pending.size,
  };
};
