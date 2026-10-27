import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  buildBackfillJobKey,
  createBackfillScheduler,
  type BackfillJobKind,
} from '../backfillScheduler';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';

/**
 * The scheduler is a pure queue + dedup + cap; these tests exercise the
 * three invariants that matter (AC8 dedup, priority + activity
 * ordering, concurrency cap) plus abort semantics. No real MatrixClient
 * is instantiated — a stub with `getRoom → getLastActiveTimestamp`
 * covers everything the scheduler reads.
 */

type MockClient = MatrixClient & {
  __setRoomActivity(roomId: string, ts: number): void;
};

const createMockClient = (): MockClient => {
  const activityByRoom = new Map<string, number>();
  const makeRoom = (roomId: string): Room =>
    ({
      roomId,
      getLastActiveTimestamp: () => activityByRoom.get(roomId) ?? 0,
    }) as unknown as Room;

  const client = {
    getRoom: (roomId: string) => makeRoom(roomId),
    __setRoomActivity(roomId: string, ts: number) {
      activityByRoom.set(roomId, ts);
    },
  } as unknown as MockClient;

  return client;
};

const flushMicrotasks = async (): Promise<void> => {
  // Drain the microtask queue a few times so scheduler.drain (which
  // reschedules itself via Promise.resolve().then(...)) settles fully.
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

describe('BackfillScheduler (CINNY-207 P4.1)', () => {
  beforeEach(() => {
    resetCacheProbe();
  });
  afterEach(() => {
    resetCacheProbe();
  });

  describe('buildBackfillJobKey', () => {
    it('normalizes undefined thread id to empty segment', () => {
      expect(buildBackfillJobKey('!r', undefined, 'gap-fill')).toBe('!r||gap-fill');
      expect(buildBackfillJobKey('!r', '$t', 'thread-backfill')).toBe('!r|$t|thread-backfill');
    });
  });

  describe('enqueue + dedup (AC8)', () => {
    it('returns the same promise identity for a duplicate key while the first job is queued', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 0 });

      const execA = vi.fn().mockResolvedValue('A');
      const execB = vi.fn().mockResolvedValue('B');
      const first = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: execA,
      });
      const second = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: execB,
      });
      expect(second).toBe(first);
      // The deduped executor is never even referenced.
      expect(execB).not.toHaveBeenCalled();
      const probe = getCacheProbeSnapshot();
      expect(probe.schedulerEnqueued).toBe(1);
      expect(probe.schedulerDeduped).toBe(1);
    });

    it('returns the same promise identity for a duplicate key while the first job is running', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx });
      let resolveA: (value: string) => void = () => undefined;
      const execA = vi.fn().mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveA = resolve;
          })
      );
      const first = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: execA,
      });
      await flushMicrotasks();
      expect(execA).toHaveBeenCalledTimes(1);

      const second = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: vi.fn().mockResolvedValue('B'),
      });
      expect(second).toBe(first);

      resolveA('A');
      await expect(first).resolves.toBe('A');
      await expect(second).resolves.toBe('A');
      expect(getCacheProbeSnapshot().schedulerDeduped).toBe(1);
      expect(getCacheProbeSnapshot().schedulerCompleted).toBe(1);
    });

    it('treats different kinds on the same room+thread as distinct jobs', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx });
      const kinds: BackfillJobKind[] = [
        'gap-fill',
        'room-deep-history',
        'thread-backfill',
        'thread-seed',
      ];
      const results = await Promise.all(
        kinds.map((kind) =>
          scheduler.enqueue({
            roomId: '!r1',
            threadId: '$t',
            kind,
            priority: 3,
            execute: () => Promise.resolve(kind),
          })
        )
      );
      expect(results).toEqual(kinds);
      expect(getCacheProbeSnapshot().schedulerEnqueued).toBe(4);
      expect(getCacheProbeSnapshot().schedulerDeduped).toBe(0);
    });

    it('allows re-enqueue after the previous job completed', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx });
      const first = await scheduler.enqueue({
        roomId: '!r1',
        kind: 'thread-seed',
        priority: 3,
        execute: () => Promise.resolve('first'),
      });
      expect(first).toBe('first');

      // Same key, but the first has settled — must not be deduped.
      const second = await scheduler.enqueue({
        roomId: '!r1',
        kind: 'thread-seed',
        priority: 3,
        execute: () => Promise.resolve('second'),
      });
      expect(second).toBe('second');
      expect(getCacheProbeSnapshot().schedulerDeduped).toBe(0);
    });
  });

  describe('priority + activity ordering', () => {
    it('drains lower priority-band jobs first regardless of enqueue order', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });
      const order: string[] = [];
      const push = (label: string) => async () => {
        order.push(label);
      };

      // Enqueue high-band first so we prove it doesn't run first.
      scheduler.enqueue({
        roomId: '!r-band4',
        kind: 'room-deep-history',
        priority: 4,
        execute: push('band4'),
      });
      scheduler.enqueue({
        roomId: '!r-band0',
        kind: 'gap-fill',
        priority: 0,
        execute: push('band0'),
      });
      scheduler.enqueue({
        roomId: '!r-band2',
        kind: 'gap-fill',
        priority: 2,
        execute: push('band2'),
      });

      await flushMicrotasks();
      // Give the async chain a chance to drain fully — three
      // one-tick jobs with maxConcurrent=1.
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
      }
      expect(order).toEqual(['band0', 'band2', 'band4']);
    });

    it('a deduped enqueue with a more urgent band raises the queued job (PR #84 review deferral)', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });
      const order: string[] = [];
      let releaseBlocker!: () => void;
      const blocked = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });

      // Occupy the single slot so the following enqueues stay QUEUED.
      const blockerPromise = scheduler.enqueue({
        roomId: '!blocker',
        kind: 'gap-fill',
        priority: 0,
        execute: async () => {
          await blocked;
        },
      });
      await flushMicrotasks();

      // Prewarm-shaped band-3 thread job, then unrelated band-2 work.
      const prewarmPromise = scheduler.enqueue({
        roomId: '!room',
        threadId: '$t',
        kind: 'thread-backfill',
        priority: 3,
        execute: async () => {
          order.push('thread-backfill');
        },
      });
      scheduler.enqueue({
        roomId: '!other',
        kind: 'gap-fill',
        priority: 2,
        execute: async () => {
          order.push('band2');
        },
      });

      // A user OPEN coalesces onto the queued prewarm job at band 0.
      // The dedup must adopt the more urgent band — otherwise the
      // open's paint waits behind every queued band-1/2 job.
      const openPromise = scheduler.enqueue({
        roomId: '!room',
        threadId: '$t',
        kind: 'thread-backfill',
        priority: 0,
        execute: async () => {
          order.push('should-not-run');
        },
      });
      expect(openPromise).toBe(prewarmPromise);

      releaseBlocker();
      await blockerPromise;
      for (let i = 0; i < 8; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
      }
      expect(order).toEqual(['thread-backfill', 'band2']);
    });

    // Self-review honesty note: this documents the PUBLIC contract —
    // it held even before the explicit `!running.has(key)` guard,
    // because drain() spread-copies the entry into `running` and
    // pendingJobs() reports the copy. The guard in enqueue() makes the
    // intent structural (no dead write on the byKey original); it is
    // not independently observable through the public API, so this
    // test cannot distinguish guard-present from guard-absent.
    it('a deduped enqueue onto a RUNNING job leaves its reported priority untouched (public contract)', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });
      let releaseRunning!: () => void;
      const runningGate = new Promise<void>((resolve) => {
        releaseRunning = resolve;
      });

      const runningPromise = scheduler.enqueue({
        roomId: '!room',
        threadId: '$t',
        kind: 'thread-backfill',
        priority: 3,
        execute: async () => {
          await runningGate;
        },
      });
      await flushMicrotasks();

      // Dedup onto the RUNNING entry — nothing to reorder; the
      // reported priority must stay at the enqueue-time band.
      const dedupedPromise = scheduler.enqueue({
        roomId: '!room',
        threadId: '$t',
        kind: 'thread-backfill',
        priority: 0,
        execute: async () => undefined,
      });
      expect(dedupedPromise).toBe(runningPromise);
      const runningJob = scheduler
        .pendingJobs()
        .find((job) => job.kind === 'thread-backfill' && job.threadId === '$t');
      expect(runningJob?.priority).toBe(3);

      releaseRunning();
      await runningPromise;
    });

    it('breaks ties within a band by room.getLastActiveTimestamp desc', async () => {
      const mx = createMockClient();
      mx.__setRoomActivity('!old', 100);
      mx.__setRoomActivity('!new', 500);
      mx.__setRoomActivity('!mid', 300);
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });
      const order: string[] = [];
      const push = (roomId: string) => async () => {
        order.push(roomId);
      };
      scheduler.enqueue({ roomId: '!old', kind: 'gap-fill', priority: 2, execute: push('!old') });
      scheduler.enqueue({ roomId: '!new', kind: 'gap-fill', priority: 2, execute: push('!new') });
      scheduler.enqueue({ roomId: '!mid', kind: 'gap-fill', priority: 2, execute: push('!mid') });

      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
      }
      expect(order).toEqual(['!new', '!mid', '!old']);
    });
  });

  describe('concurrency cap', () => {
    it('never runs more than MAX_CONCURRENT_BACKFILL_JOBS at once', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 2 });
      let inFlight = 0;
      let peak = 0;
      const resolvers: Array<() => void> = [];
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 5; i += 1) {
        promises.push(
          scheduler.enqueue({
            roomId: `!r${i}`,
            kind: 'gap-fill',
            priority: 1,
            execute: () =>
              new Promise<void>((resolve) => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                resolvers.push(() => {
                  inFlight -= 1;
                  resolve();
                });
              }),
          })
        );
      }
      await flushMicrotasks();
      expect(inFlight).toBe(2);

      // Release two — the next two should start; peak must stay at 2.
      resolvers[0]();
      resolvers[1]();
      await flushMicrotasks();
      expect(inFlight).toBe(2);
      resolvers[2]();
      resolvers[3]();
      await flushMicrotasks();
      resolvers[4]();
      await Promise.all(promises);
      expect(peak).toBe(2);
    });
  });

  describe('abort semantics', () => {
    it('abort() signals the in-flight job and lets the executor bail cooperatively', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx });
      let observedAbort = false;
      const promise = scheduler.enqueue({
        roomId: '!r1',
        kind: 'thread-backfill',
        priority: 3,
        execute: (signal) =>
          new Promise<string>((resolve, reject) => {
            signal.addEventListener('abort', () => {
              observedAbort = true;
              reject(signal.reason);
            });
          }),
      });
      await flushMicrotasks();
      expect(scheduler.abort('!r1', undefined, 'thread-backfill')).toBe(true);
      await expect(promise).rejects.toThrow('backfill aborted');
      expect(observedAbort).toBe(true);
      expect(getCacheProbeSnapshot().schedulerAborted).toBeGreaterThanOrEqual(1);
    });

    it('abort() on a queued (not-yet-running) job rejects with the abort reason and never runs the executor', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 0 });
      const execute = vi.fn();
      const promise = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute,
      });
      expect(scheduler.abort('!r1', undefined, 'gap-fill')).toBe(true);
      await expect(promise).rejects.toThrow('backfill aborted');
      expect(execute).not.toHaveBeenCalled();
      expect(scheduler.pendingJobs()).toEqual([]);
    });

    it('an immediate re-enqueue after abort waits for the old request and then runs fresh work', async () => {
      const scheduler = createBackfillScheduler({ mx: createMockClient(), maxConcurrent: 2 });
      let settleAborted!: () => void;
      const firstExecute = vi.fn(
        (signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            settleAborted = () => reject(signal.reason);
          })
      );
      const secondExecute = vi.fn().mockResolvedValue('fresh');

      const first = scheduler.enqueue({
        roomId: '!room',
        threadId: '$thread',
        kind: 'thread-backfill',
        priority: 0,
        execute: firstExecute,
      });
      await flushMicrotasks();

      expect(scheduler.abort('!room', '$thread', 'thread-backfill')).toBe(true);
      const second = scheduler.enqueue({
        roomId: '!room',
        threadId: '$thread',
        kind: 'thread-backfill',
        priority: 0,
        execute: secondExecute,
      });

      expect(second).not.toBe(first);
      await flushMicrotasks();
      expect(secondExecute).not.toHaveBeenCalled();

      settleAborted();
      await expect(first).rejects.toThrow('backfill aborted');
      await expect(second).resolves.toBe('fresh');
      expect(secondExecute).toHaveBeenCalledTimes(1);
    });

    it('rejects an aborted queued replacement without waiting for the old request', async () => {
      const scheduler = createBackfillScheduler({ mx: createMockClient(), maxConcurrent: 2 });
      let settleFirst!: () => void;
      const first = scheduler.enqueue({
        roomId: '!room',
        threadId: '$thread',
        kind: 'thread-backfill',
        priority: 0,
        execute: (signal) =>
          new Promise<void>((_resolve, reject) => {
            // Model an SDK request that cannot observe abort until it returns.
            settleFirst = () => reject(signal.reason);
          }),
      });
      await flushMicrotasks();

      expect(scheduler.abort('!room', '$thread', 'thread-backfill')).toBe(true);
      const replacementExecute = vi.fn().mockResolvedValue('stale replacement');
      const replacement = scheduler.enqueue({
        roomId: '!room',
        threadId: '$thread',
        kind: 'thread-backfill',
        priority: 0,
        execute: replacementExecute,
      });

      // The same key is still present in `running`, but it belongs to the old
      // detached entry. This abort targets the queued replacement and must
      // reject it immediately rather than waiting for the SDK request above.
      expect(scheduler.abort('!room', '$thread', 'thread-backfill')).toBe(true);
      await expect(replacement).rejects.toThrow('backfill aborted');
      expect(replacementExecute).not.toHaveBeenCalled();

      const freshExecute = vi.fn().mockResolvedValue('fresh');
      const fresh = scheduler.enqueue({
        roomId: '!room',
        threadId: '$thread',
        kind: 'thread-backfill',
        priority: 0,
        execute: freshExecute,
      });
      await flushMicrotasks();
      expect(freshExecute).not.toHaveBeenCalled();

      settleFirst();
      await expect(first).rejects.toThrow('backfill aborted');
      await expect(fresh).resolves.toBe('fresh');
      expect(freshExecute).toHaveBeenCalledTimes(1);
    });

    it('abortAll() cancels every queued and in-flight job (engine.stop() contract)', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });

      let releaseFirst: () => void = () => undefined;
      const first = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: (signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
            releaseFirst = () => reject(new Error('unreached'));
          }),
      });
      const second = scheduler.enqueue({
        roomId: '!r2',
        kind: 'gap-fill',
        priority: 1,
        execute: () => Promise.reject(new Error('should not run')),
      });

      await flushMicrotasks();
      scheduler.abortAll();
      await expect(first).rejects.toThrow('backfill scheduler stopped');
      // The second job was queued, not running — but abortAll set its
      // abort signal. When drain picks it up (freed slot from first),
      // the aborted-before-pickup branch rejects it.
      await expect(second).rejects.toThrow(/backfill/i);
      // Keep releaseFirst referenced so lint doesn't complain.
      expect(typeof releaseFirst).toBe('function');
    });

    it('abort() on an unknown key returns false', () => {
      const scheduler = createBackfillScheduler();
      expect(scheduler.abort('!nope', undefined, 'gap-fill')).toBe(false);
    });

    it('abortAll() rejects queued jobs synchronously even when running executors never observe the signal (greptile PR #70 P1)', async () => {
      // Greptile: if every running job is stuck inside an SDK request
      // that never observes the AbortSignal, the drain loop never
      // fires again — so queued jobs stay pending in `byKey` forever.
      // A follow-up enqueue on the same key would then dedup to that
      // dangling promise. abortAll() must clean queued entries out
      // synchronously, regardless of whether the running executors
      // ever cooperate with the abort.
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });

      // First job: never observes the signal — sits pending forever.
      let firstResolve: (() => void) | undefined;
      const first = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: () =>
          new Promise<void>((resolve) => {
            firstResolve = resolve;
          }),
      });
      // Second job: queued behind the first. Never runs.
      const second = scheduler.enqueue({
        roomId: '!r2',
        kind: 'gap-fill',
        priority: 1,
        execute: () => Promise.reject(new Error('should not run')),
      });
      // Silence the first promise for the linter — we intentionally
      // never observe its resolution here.
      first.catch(() => undefined);

      await flushMicrotasks();
      scheduler.abortAll();
      // The queued second job must reject WITHOUT needing the first
      // one to complete — running executors don't cooperate.
      await expect(second).rejects.toThrow(/backfill scheduler stopped/i);

      // A follow-up enqueue on the same key must NOT dedup to a
      // dangling entry — the queued key was cleaned out of byKey by
      // abortAll. It goes on the queue as a fresh promise and drains
      // once the still-running first slot frees up.
      let followUpRan = false;
      const followUp = scheduler.enqueue({
        roomId: '!r2',
        kind: 'gap-fill',
        priority: 1,
        execute: async () => {
          followUpRan = true;
        },
      });
      // Release the first (stuck) job so drain can pick up the follow-up.
      if (firstResolve) firstResolve();
      // Second run must be a fresh promise, not the aborted one.
      await expect(followUp).resolves.toBeUndefined();
      expect(followUpRan).toBe(true);
    });
  });

  describe('pendingJobs snapshot', () => {
    it('lists queued jobs before running jobs and exposes stable keys', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });

      let releaseR1: () => void = () => undefined;
      scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: () =>
          new Promise<void>((resolve) => {
            releaseR1 = resolve;
          }),
      });
      scheduler.enqueue({
        roomId: '!r2',
        kind: 'gap-fill',
        priority: 1,
        execute: () => Promise.resolve(),
      });
      await flushMicrotasks();
      const snapshot = scheduler.pendingJobs();
      expect(snapshot.map((job) => job.key)).toEqual([
        '!r2||gap-fill', // queued
        '!r1||gap-fill', // running
      ]);
      releaseR1();
      await flushMicrotasks();
    });
  });

  describe('executor error handling', () => {
    it('propagates executor rejections through the returned promise and still frees the slot', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });

      const failing = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: () => Promise.reject(new Error('boom')),
      });
      await expect(failing).rejects.toThrow('boom');

      // Slot must be free — a follow-up enqueue drains without waiting.
      let ran = false;
      await scheduler.enqueue({
        roomId: '!r2',
        kind: 'gap-fill',
        priority: 1,
        execute: async () => {
          ran = true;
        },
      });
      expect(ran).toBe(true);
    });

    it('counts non-abort executor rejections on the schedulerFailed probe (P4 gate fix)', async () => {
      // AC13 debugging in the docker gate would have been impossible if
      // `schedulerCompleted=0, schedulerAborted=0, schedulerFailed=0`
      // was the only signal — that snapshot is ambiguous between "job
      // never ran" and "job rejected silently". This test locks in the
      // third counter so the failure mode is visible from a snapshot.
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });

      const failing = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: () => Promise.reject(new Error('network down')),
      });
      await expect(failing).rejects.toThrow('network down');
      await flushMicrotasks();

      const snapshot = getCacheProbeSnapshot();
      expect(snapshot.schedulerEnqueued).toBe(1);
      expect(snapshot.schedulerFailed).toBe(1);
      expect(snapshot.schedulerCompleted).toBe(0);
      expect(snapshot.schedulerAborted).toBe(0);
    });

    it('a synchronously-thrown non-async executor does not leak a running slot (gemini PR #70 critical)', async () => {
      // Gemini claim: if the executor throws synchronously (before
      // returning a promise), the `finally` block runs `running.delete`
      // before `running.set` — leaking a slot forever. This is not
      // possible with the current shape because `execute` is called
      // via `await` inside an `async` IIFE: async functions convert
      // sync throws in their body into promise rejections that are
      // processed as microtasks AFTER the IIFE has synchronously
      // returned and `running.set(...)` has run. Locking that
      // invariant with a test so a future refactor that inlines the
      // executor call outside the async body can't reintroduce the
      // leak.
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });

      const failing = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        // Non-async, throws synchronously — the exact shape gemini
        // called out. Note: the executor signature returns
        // `Promise<T>`, but a synchronous throw is still allowed here
        // because the caller uses `await execute(...)`; the throw is
        // caught by the async IIFE's own try/catch.
        execute: (() => {
          throw new Error('sync boom');
        }) as unknown as () => Promise<void>,
      });
      await expect(failing).rejects.toThrow('sync boom');
      await flushMicrotasks();

      // Slot must be free — a follow-up enqueue on the same key runs.
      let ran = false;
      await scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: async () => {
          ran = true;
        },
      });
      expect(ran).toBe(true);

      const snapshot = getCacheProbeSnapshot();
      expect(snapshot.schedulerEnqueued).toBe(2);
      expect(snapshot.schedulerFailed).toBe(1);
      expect(snapshot.schedulerCompleted).toBe(1);
      expect(snapshot.schedulerAborted).toBe(0);
    });

    it('an executor rejection that WAS caused by an abort counts as schedulerAborted, not schedulerFailed', async () => {
      const mx = createMockClient();
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });

      const running = scheduler.enqueue({
        roomId: '!r1',
        kind: 'gap-fill',
        priority: 1,
        execute: (signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
          }),
      });
      await flushMicrotasks();
      scheduler.abort('!r1', undefined, 'gap-fill');
      await expect(running).rejects.toThrow(/backfill/i);
      await flushMicrotasks();

      const snapshot = getCacheProbeSnapshot();
      expect(snapshot.schedulerAborted).toBeGreaterThanOrEqual(1);
      expect(snapshot.schedulerFailed).toBe(0);
    });
  });
});
