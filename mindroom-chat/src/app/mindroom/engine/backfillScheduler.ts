/**
 * CINNY-207 P4.1: BackfillScheduler.
 *
 * A single client-scoped queue that serializes every backfill-shaped
 * network fetch the app initiates: gap fills for the sync tail
 * discontinuities Phase 3 detected, thread-open backfills, thread-seed
 * warm-ups, and the room's own deep-history sweep. The scheduler
 * enforces two invariants that Phase 3 could not:
 *
 *   AC8: no duplicate in-flight jobs per (roomId, threadId, kind).
 *        Enqueuing while a job for the same key is queued or running
 *        returns the same promise identity — the caller gets the
 *        outcome of the in-flight job for free and never fires a
 *        second `/relations` or `/messages` request.
 *
 *   Priority + cap: bands 0-4 (0 = current-room / current-thread
 *        opened; 1 = my-server gap-fills on other rooms; 2 = recently-
 *        active my-server tails; 3 = thread inventory prewarm; 4 =
 *        current-room deep history sweep). Within a band, sort by
 *        `room.getLastActiveTimestamp()` descending so the most
 *        recently active work runs first. At most
 *        `MAX_CONCURRENT_BACKFILL_JOBS` (2) jobs run concurrently.
 *
 * The scheduler is purely a queue + dedup + cap; it does NOT know how
 * to fetch anything. Callers register executor functions when they
 * enqueue (the executor gets an AbortSignal for cooperative teardown)
 * and the scheduler drives them. That way P4.1 lands the invariant
 * before P4.2 wires the first real fetch path.
 *
 * Executors must check cancellation between batches and pass the signal
 * to requests that support it. Reconciliation uses the patched
 * `mx.fetchRelations` transport cancellation; `mx.createMessagesRequest`
 * still cancels cooperatively between pages. A running slot stays owned
 * until its executor settles, including the underlying HTTP request.
 *
 * The observability counters (`schedulerEnqueued`, `schedulerDeduped`,
 * `schedulerAborted`, `schedulerCompleted`, `schedulerFailed`) on
 * `window.__MINDROOM_CACHE_PROBE__` are the AC8 evidence handle. A
 * non-abort executor rejection increments `schedulerFailed` — added in
 * the P4 gate fix so a silent job failure is visible from a probe
 * snapshot rather than requiring log spelunking.
 */

import type { MatrixClient, Room } from 'matrix-js-sdk';
import { countCacheProbe } from '../threads/cacheProbe';

/**
 * Job kinds recognized by the scheduler. Priority and dedup logic key
 * off this union so any addition needs a deliberate policy call.
 *
 * `'reconcile'` (CINNY-207 P5.1): every room/thread open schedules one
 * of these to check the cache against server truth (D7 SWR rule).
 * Runs at band 0 (freshest user attention). Kind participates in the
 * AC8 dedup key alongside (roomId, threadId), so a reconcile and a
 * `'thread-backfill'` on the same thread coexist by design — they do
 * different things (backfill fetches older history; reconcile checks
 * the tail for divergence).
 */
export type BackfillJobKind =
  | 'gap-fill'
  | 'room-deep-history'
  | 'room-attachments'
  | 'thread-backfill'
  | 'thread-approvals'
  | 'thread-seed'
  | 'reconcile';

/**
 * Priority bands (see module header). Lower number runs first. Within
 * a band, jobs are ordered by `room.getLastActiveTimestamp()`
 * descending — most recently active work first. When a room reference
 * cannot be resolved (room left, id typo) the activity tiebreaker
 * defaults to 0.
 */
export type BackfillJobPriority = 0 | 1 | 2 | 3 | 4;

export const MAX_CONCURRENT_BACKFILL_JOBS = 2;

/**
 * Executor callback the caller supplies at enqueue time. Receives the
 * scheduler's AbortSignal for cooperative cancellation between batches.
 * Return value flows through to the caller's awaited promise.
 */
export type BackfillJobExecutor<T = void> = (signal: AbortSignal) => Promise<T>;

/**
 * Public shape of an enqueued job. `signal` is exposed so the executor
 * or a test can observe abort state; callers should not construct this
 * type directly — use `enqueue()`.
 */
export type BackfillJob<T = unknown> = {
  readonly roomId: string;
  readonly threadId?: string;
  readonly kind: BackfillJobKind;
  readonly priority: BackfillJobPriority;
  readonly key: string;
  readonly promise: Promise<T>;
  readonly signal: AbortSignal;
};

export type EnqueueJobArgs<T = void> = {
  readonly roomId: string;
  readonly threadId?: string;
  readonly kind: BackfillJobKind;
  readonly priority: BackfillJobPriority;
  readonly execute: BackfillJobExecutor<T>;
};

export type BackfillScheduler = {
  /**
   * Enqueue a job. If a job with the same (roomId, threadId, kind) key
   * is already queued or in-flight, the existing promise is returned
   * unchanged — the executor supplied here is discarded. The dedup
   * counter (`schedulerDeduped`) is bumped on that path.
   *
   * The returned promise type is the intersection of what the executor
   * resolves; if the caller receives a deduped existing job they get
   * that job's resolved value, so callers relying on the return value
   * must be tolerant of "same value from earlier fetch".
   */
  enqueue<T>(args: EnqueueJobArgs<T>): Promise<T>;
  /**
   * Cancel a specific in-flight/queued job by key. Aborts the signal.
   * The executor's returned promise rejects with the abort reason once
   * it observes `signal.aborted` (or immediately if it hasn't started
   * running yet). Returns true when a matching job existed.
   */
  abort(roomId: string, threadId: string | undefined, kind: BackfillJobKind): boolean;
  /**
   * Cancel every queued and in-flight job. Used on engine `stop()` to
   * make sure no orphan fetches survive account switch / logout.
   */
  abortAll(): void;
  /**
   * Snapshot of scheduler state for tests and observability. Order is
   * not guaranteed except that queued jobs come before running jobs.
   */
  pendingJobs(): readonly BackfillJob[];
  /**
   * Test-only reset — clears jobs without dispatching aborts. Use
   * `abortAll()` in production teardown.
   */
  reset(): void;
};

/**
 * Compose the dedup key. Kept out of `enqueue` so the abort path can
 * reuse the exact same normalization.
 */
export const buildBackfillJobKey = (
  roomId: string,
  threadId: string | undefined,
  kind: BackfillJobKind
): string => `${roomId}|${threadId ?? ''}|${kind}`;

type QueueEntry<T = unknown> = {
  args: EnqueueJobArgs<T>;
  key: string;
  /**
   * Effective priority band. Initialized from `args.priority`, but a
   * deduped enqueue with a MORE urgent band lowers it in place while
   * the entry is still queued (PR #84 review deferral) — e.g. a user
   * open (band 0) coalescing onto a queued prewarm job (band 3) must
   * not wait behind band-1/2 work. Running entries are unaffected.
   */
  priority: BackfillJobPriority;
  controller: AbortController;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  promise: Promise<T>;
};

type RunningEntry<T = unknown> = QueueEntry<T> & {
  runPromise: Promise<void>;
};

export type CreateBackfillSchedulerOptions = {
  /**
   * Optional Matrix client — required for the room activity tiebreaker
   * lookup. Tests can omit it, in which case within-band ordering
   * falls back to enqueue order.
   */
  mx?: MatrixClient;
  /**
   * Override the concurrency cap. Production always uses
   * `MAX_CONCURRENT_BACKFILL_JOBS`.
   */
  maxConcurrent?: number;
};

const resolveRoomActivityTs = (mx: MatrixClient | undefined, roomId: string): number => {
  if (!mx) return 0;
  const room: Room | null | undefined = mx.getRoom?.(roomId);
  if (!room) return 0;
  const ts = room.getLastActiveTimestamp?.();
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : 0;
};

export const createBackfillScheduler = (
  options: CreateBackfillSchedulerOptions = {}
): BackfillScheduler => {
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_BACKFILL_JOBS;
  const mx = options.mx;

  // Active jobs normally remain in byKey for queued/running dedup. An
  // explicitly aborted running job is detached from byKey immediately,
  // allowing one replacement to queue while `running` still accounts
  // for the non-cancellable SDK request.
  const byKey = new Map<string, QueueEntry>();
  const queue: QueueEntry[] = [];
  const running = new Map<string, RunningEntry>();

  const pickNextIndex = (): number => {
    if (queue.length === 0) return -1;
    let bestIndex = -1;
    let bestPriority: BackfillJobPriority | undefined;
    let bestActivity = 0;
    for (let i = 0; i < queue.length; i += 1) {
      const entry = queue[i];
      // A replacement for an aborting/running request must not overlap the
      // SDK request it supersedes. It becomes eligible in finally.
      if (running.has(entry.key)) continue;
      if (bestPriority === undefined) {
        bestIndex = i;
        bestPriority = entry.priority;
        bestActivity = resolveRoomActivityTs(mx, entry.args.roomId);
        continue;
      }
      if (entry.priority < bestPriority) {
        bestIndex = i;
        bestPriority = entry.priority;
        bestActivity = resolveRoomActivityTs(mx, entry.args.roomId);
        continue;
      }
      if (entry.priority > bestPriority) continue;
      const activity = resolveRoomActivityTs(mx, entry.args.roomId);
      if (activity > bestActivity) {
        bestIndex = i;
        bestActivity = activity;
      }
    }
    return bestIndex;
  };

  const drain = (): void => {
    while (running.size < maxConcurrent && queue.length > 0) {
      const index = pickNextIndex();
      if (index < 0) return;
      const entry = queue.splice(index, 1)[0];
      // Queued aborts (`abort()`/`abortAll()`) settle the caller promise and
      // splice the entry out of `queue` synchronously, so an aborted entry
      // can never reach this point via a supported code path.

      // CINNY-207 P5 review (gemini PR #70 critical): register the
      // running entry BEFORE invoking the executor. An async IIFE that
      // wraps `await entry.args.execute(signal)` catches a synchronous
      // throw from the executor and runs its `finally` block
      // synchronously within the IIFE's initial evaluation — before
      // control returns to this scope to `running.set(...)`. That
      // ordering would delete-before-set, leaving the failed job in
      // `running` forever and leaking a concurrency slot.
      //
      // Fix: set the running entry with a placeholder promise first,
      // then patch in the real runPromise. The `finally` block's
      // `running.delete` now always runs AFTER the corresponding set,
      // regardless of whether the executor throws synchronously, runs
      // to completion synchronously, or actually awaits.
      const runningEntry: RunningEntry = { ...entry, runPromise: Promise.resolve() };
      running.set(entry.key, runningEntry);

      const runPromise = (async () => {
        try {
          const value = await entry.args.execute(entry.controller.signal);
          entry.resolve(value);
          if (entry.controller.signal.aborted) {
            countCacheProbe('schedulerAborted');
          } else {
            countCacheProbe('schedulerCompleted');
          }
        } catch (error) {
          entry.reject(error);
          if (entry.controller.signal.aborted) {
            countCacheProbe('schedulerAborted');
          } else {
            // P4 gate fix: previously we counted nothing on non-abort
            // errors, which made a silent createMessagesRequest /
            // saveRoomEventsToCache reject impossible to distinguish
            // from "job never ran" in an AC13 probe snapshot.
            countCacheProbe('schedulerFailed');
          }
        } finally {
          running.delete(entry.key);
          if (byKey.get(entry.key) === entry) {
            byKey.delete(entry.key);
          }
          // Recurse via macrotask so a synchronous resolve doesn't
          // grow the stack when many jobs settle in a burst.
          Promise.resolve().then(drain);
        }
      })();

      runningEntry.runPromise = runPromise;
    }
  };

  const makeEntry = <T>(args: EnqueueJobArgs<T>, key: string): QueueEntry<T> => {
    const controller = new AbortController();
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      args,
      key,
      priority: args.priority,
      controller,
      resolve,
      reject,
      promise,
    };
  };

  const enqueue = <T>(args: EnqueueJobArgs<T>): Promise<T> => {
    const key = buildBackfillJobKey(args.roomId, args.threadId, args.kind);
    const existing = byKey.get(key);
    if (existing) {
      countCacheProbe('schedulerDeduped');
      // PR #84 review deferral: adopt the more urgent band. Priority
      // was fixed at enqueue time, so a priority-0 open coalescing
      // onto a QUEUED band-3 prewarm job inherited band 3 and waited
      // behind all queued band-1/2 work. Mutating the queued entry's
      // effective priority is picked up by the next drain pass. The
      // `!running.has(key)` guard makes "already-running entries are
      // unaffected (nothing to reorder)" structural (PR #86 review):
      // without it the invariant only held because `drain` spread-
      // copies the entry into `running`, an implicit coupling that a
      // future refactor could silently break.
      if (args.priority < existing.priority && !running.has(key)) {
        existing.priority = args.priority;
      }
      return existing.promise as Promise<T>;
    }

    const entry = makeEntry(args, key);
    byKey.set(key, entry as QueueEntry);
    queue.push(entry as QueueEntry);
    countCacheProbe('schedulerEnqueued');
    // Kick the drain on a microtask so callers can await the promise
    // without racing sync errors from the executor.
    Promise.resolve().then(drain);
    return entry.promise;
  };

  const abort = (roomId: string, threadId: string | undefined, kind: BackfillJobKind): boolean => {
    const key = buildBackfillJobKey(roomId, threadId, kind);
    const entry = byKey.get(key);
    if (!entry) return false;
    if (!entry.controller.signal.aborted) {
      entry.controller.abort(new DOMException('backfill aborted', 'AbortError'));
    }
    const runningEntry = running.get(key);
    if (runningEntry?.controller === entry.controller) {
      // Detach immediately so a replacement enqueue gets a fresh
      // promise. pickNextIndex keeps that replacement behind this
      // still-running SDK request until its executor settles.
      if (byKey.get(key) === entry) byKey.delete(key);
      return true;
    }

    const queueIndex = queue.indexOf(entry);
    if (queueIndex >= 0) queue.splice(queueIndex, 1);
    entry.reject(entry.controller.signal.reason ?? new Error('backfill aborted'));
    if (byKey.get(key) === entry) byKey.delete(key);
    countCacheProbe('schedulerAborted');
    return true;
  };

  const abortAll = (): void => {
    // CINNY-207 P5 review (greptile PR #70 P1: queued aborts stay
    // pending): aborting only the signals relies on the drain loop to
    // eventually reject queued jobs — but the drain loop is triggered
    // by a running job's `finally` block. If every running executor
    // is stuck inside an SDK request that never observes the signal,
    // no drain fires, and queued entries stay pending in `byKey`
    // forever. A follow-up enqueue on the same key would then dedup
    // to that dangling promise.
    //
    // Fix: for queued (not-yet-running) entries, actively reject the
    // caller's promise and remove them from `byKey` here. Running
    // entries still cooperate through the AbortSignal — the executor
    // that DOES observe the signal completes normally via its
    // finally block (which also removes from `byKey`); the ones that
    // DON'T remain in `running` until they eventually settle, but no
    // longer block queued work from being cleared and no longer
    // trap same-key follow-up enqueues.
    const queuedEntries = [...queue];
    queue.length = 0;
    queuedEntries.forEach((entry) => {
      if (!entry.controller.signal.aborted) {
        entry.controller.abort(new Error('backfill scheduler stopped'));
      }
      countCacheProbe('schedulerAborted');
      entry.reject(entry.controller.signal.reason ?? new Error('backfill scheduler stopped'));
      if (byKey.get(entry.key) === entry) byKey.delete(entry.key);
    });
    running.forEach((entry, key) => {
      if (!entry.controller.signal.aborted) {
        entry.controller.abort(new Error('backfill scheduler stopped'));
      }
      // `running` holds a reporting copy of the queue entry, so compare
      // the shared controller rather than object identity.
      if (byKey.get(key)?.controller === entry.controller) byKey.delete(key);
    });
  };

  const pendingJobs = (): readonly BackfillJob[] => {
    const toJob = (entry: QueueEntry): BackfillJob => ({
      roomId: entry.args.roomId,
      threadId: entry.args.threadId,
      kind: entry.args.kind,
      priority: entry.priority,
      key: entry.key,
      promise: entry.promise,
      signal: entry.controller.signal,
    });
    return [...queue.map(toJob), ...Array.from(running.values()).map(toJob)];
  };

  const reset = (): void => {
    byKey.clear();
    queue.length = 0;
    running.clear();
  };

  return {
    enqueue,
    abort,
    abortAll,
    pendingJobs,
    reset,
  };
};
