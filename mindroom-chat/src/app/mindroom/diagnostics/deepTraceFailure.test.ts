// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { unwrap } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openDB: vi.fn(),
}));

vi.mock('idb', async () => {
  const actual = await vi.importActual<typeof import('idb')>('idb');
  return {
    ...actual,
    openDB: mocks.openDB,
  };
});

describe('deep diagnostic trace storage failure', () => {
  let trace: typeof import('./deepTrace');

  beforeEach(async () => {
    vi.resetModules();
    const actual = await vi.importActual<typeof import('idb')>('idb');
    mocks.openDB.mockReset().mockImplementation(actual.openDB);
    trace = await import('./deepTrace');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['recording', 'remove'],
    ['memory-only', 'remove'],
    ['starting', 'remove'],
    ['recording', 'clear'],
    ['memory-only', 'clear'],
    ['starting', 'clear'],
  ])("honors another tab's opt-out while %s (%s)", async (mode, change) => {
    let rejectOpen: ((error: Error) => void) | undefined;
    if (mode === 'memory-only') mocks.openDB.mockRejectedValueOnce(new Error('storage failed'));
    if (mode === 'starting')
      mocks.openDB.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectOpen = reject;
        })
      );
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    const enabling = trace.setDeepTraceEnabled(true, storage);
    if (mode !== 'starting') await enabling;
    try {
      window.dispatchEvent(
        new StorageEvent('storage', {
          storageArea: window.sessionStorage,
          key: trace.DEEP_TRACE_ENABLED_KEY,
          newValue: null,
        })
      );
      window.dispatchEvent(
        new StorageEvent('storage', { storageArea: storage, key: 'unrelated', newValue: null })
      );
      window.dispatchEvent(
        new StorageEvent('storage', {
          storageArea: storage,
          key: trace.DEEP_TRACE_ENABLED_KEY,
          newValue: '1',
        })
      );
      expect(trace.getDeepTraceRuntimeStatus()).toBe(mode);
      if (change === 'clear') storage.clear();
      else storage.removeItem(trace.DEEP_TRACE_ENABLED_KEY);
      window.dispatchEvent(
        new StorageEvent('storage', {
          storageArea: storage,
          key: change === 'clear' ? null : trace.DEEP_TRACE_ENABLED_KEY,
          newValue: null,
        })
      );
      expect(trace.getDeepTraceRuntimeStatus()).toBe('disabled');
      const stopped = trace.readDeepTraceMemorySnapshot();
      trace.recordDeepTraceEvent('test.after_remote_opt_out');
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(trace.readDeepTraceMemorySnapshot().events).toEqual(stopped.events);
      rejectOpen?.(new Error('stale activation failed'));
      if (mode === 'starting') expect(await enabling).toBe(false);
      expect(trace.getDeepTraceRuntimeStatus()).toBe('disabled');
    } finally {
      rejectOpen?.(new Error('cleanup'));
      await enabling;
      await trace.setDeepTraceEnabled(false, storage);
      dispose();
    }
  });

  it('records in memory after an IndexedDB open failure and retries after reinitialization', async () => {
    mocks.openDB.mockRejectedValueOnce(new Error('IndexedDB open blocked'));
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    const statuses: string[] = [];
    const unsubscribe = trace.subscribeDeepTraceStatus((status) => statuses.push(status));

    expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBe('1');
    expect(trace.getDeepTraceRuntimeStatus()).toBe('memory-only');
    expect(statuses).toEqual(expect.arrayContaining(['starting', 'memory-only']));
    trace.recordDeepTraceEvent('test.after_open_failure');
    expect(trace.readDeepTraceMemorySnapshot().events.map((event) => event.name)).toContain(
      'test.after_open_failure'
    );
    expect(await trace.readDeepTraceSnapshot()).toMatchObject({
      enabled: true,
      status: 'unavailable',
    });

    dispose();
    const restartedDispose = trace.initializeDeepTraceRecorder(storage);
    await vi.waitFor(() => expect(trace.getDeepTraceRuntimeStatus()).toBe('recording'));
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBe('1');

    unsubscribe();
    await trace.setDeepTraceEnabled(false, storage);
    restartedDispose();
  });

  it('ignores an old open failure after disable and re-enable', async () => {
    let rejectOpen: ((reason: Error) => void) | undefined;
    const delayedOpen = new Promise<never>((_resolve, reject) => {
      rejectOpen = reject;
    });
    mocks.openDB.mockReturnValueOnce(delayedOpen);
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    const statuses: string[] = [];
    const unsubscribe = trace.subscribeDeepTraceStatus((status) => statuses.push(status));

    const firstEnable = trace.setDeepTraceEnabled(true, storage);
    await vi.waitFor(() => expect(mocks.openDB).toHaveBeenCalledTimes(1));
    const disable = trace.setDeepTraceEnabled(false, storage);
    const secondEnable = trace.setDeepTraceEnabled(true, storage);
    rejectOpen?.(new Error('Old IndexedDB open failed'));

    expect(await firstEnable).toBe(false);
    expect(await disable).toBe(true);
    expect(await secondEnable).toBe(true);
    expect(trace.getDeepTraceRuntimeStatus()).toBe('recording');
    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toBeNull();
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBe('1');
    expect(statuses).not.toContain('unavailable');

    unsubscribe();
    await trace.setDeepTraceEnabled(false, storage);
    dispose();
  });

  it('captures memory evidence while database activation is stalled and honors opt-out', async () => {
    let rejectOpen!: (error: Error) => void;
    mocks.openDB.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOpen = reject;
      })
    );
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    try {
      const enabling = trace.setDeepTraceEnabled(true, storage);
      trace.recordDeepTraceEvent('test.during_stalled_activation');
      expect(trace.readDeepTraceMemorySnapshot().events.map((event) => event.name)).toContain(
        'test.during_stalled_activation'
      );
      await trace.setDeepTraceEnabled(false, storage);
      trace.recordDeepTraceEvent('test.after_disable');
      rejectOpen(new Error('old open failed'));
      expect(await enabling).toBe(false);
      expect(trace.readDeepTraceMemorySnapshot().events.map((event) => event.name)).not.toContain(
        'test.after_disable'
      );
      expect(trace.getDeepTraceRuntimeStatus()).toBe('disabled');
    } finally {
      dispose();
    }
  });

  it('retains a sanitized flush failure through recorder reinitialization until clearing', async () => {
    const actual = await vi.importActual<typeof import('idb')>('idb');
    let database: Awaited<ReturnType<typeof actual.openDB>> | undefined;
    mocks.openDB.mockImplementation(async (...args: Parameters<typeof actual.openDB>) => {
      database = await actual.openDB(...args);
      return database;
    });
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);

    expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
    database?.close();
    trace.recordDeepTraceEvent('test.closed_database', undefined, { flush: true });
    await vi.waitFor(() => expect(trace.getDeepTraceHealthSnapshot().lastFailure).not.toBeNull());

    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toMatchObject({
      stage: 'flush',
      errorName: 'InvalidStateError',
    });
    expect(trace.getDeepTraceHealthSnapshot().lastFailure).not.toHaveProperty('message');

    dispose();
    vi.resetModules();
    trace = await import('./deepTrace');
    const restartedDispose = trace.initializeDeepTraceRecorder(storage);
    await vi.waitFor(() => expect(trace.getDeepTraceRuntimeStatus()).toBe('recording'));
    expect(trace.getDeepTraceHealthSnapshot()).toMatchObject({
      status: 'recording',
      pendingEventCount: expect.any(Number),
      pendingBytes: expect.any(Number),
      flushing: expect.any(Boolean),
      lastFailure: {
        stage: 'flush',
        errorName: 'InvalidStateError',
      },
    });

    await trace.clearDeepTrace();
    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toBeNull();

    await trace.setDeepTraceEnabled(false, storage);
    restartedDispose();
  });

  it('normalizes an untrusted persisted failure marker before exposing it', () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem(
      trace.DEEP_TRACE_FAILURE_KEY,
      JSON.stringify({
        at: 123,
        stage: 'activation',
        errorName: 'SecretProviderError',
        message: 'room=!secret:example.org',
      })
    );
    const dispose = trace.initializeDeepTraceRecorder(storage);

    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toEqual({
      at: 123,
      stage: 'activation',
      errorName: 'UnknownError',
    });
    expect(JSON.stringify(trace.getDeepTraceHealthSnapshot())).not.toContain('secret');

    dispose();
  });

  it('keeps failed-batch, network, and interaction evidence after a real database close', async () => {
    const actual = await vi.importActual<typeof import('idb')>('idb');
    let database: Awaited<ReturnType<typeof actual.openDB>> | undefined;
    mocks.openDB.mockImplementation(async (...args: Parameters<typeof actual.openDB>) => {
      database = await actual.openDB(...args);
      return database;
    });
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    try {
      await trace.setDeepTraceEnabled(true, storage);
      // Hold the delayed retry so it cannot reopen the database during the checks.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      database!.close();
      trace.recordDeepTraceEvent('test.failed_batch', undefined, { flush: true });
      await vi.waitFor(() => expect(trace.getDeepTraceHealthSnapshot().lastFailure).not.toBeNull());

      const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      await trace.traceDeepDiagnosticFetch(
        fetch,
        'https://private.test/_matrix/client/v3/rooms/secret/relations/root'
      );
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      trace.recordDeepTraceEvent('test.after_failure', {
        reply_count: 4,
        private_text: 'secret' as never,
      });

      const snapshot = trace.readDeepTraceMemorySnapshot();
      expect(snapshot.events.map((event) => event.name)).toEqual(
        expect.arrayContaining([
          'test.failed_batch',
          'test.after_failure',
          'network.matrix.relations.get.start',
          'network.matrix.relations.get.complete',
          'interaction.pointer.other.document',
        ])
      );
      expect(snapshot.storage).toBe('memory');
      expect(JSON.stringify(snapshot)).not.toContain('secret');
      expect(mocks.openDB).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledOnce();

      await trace.setDeepTraceEnabled(false, storage);
      trace.recordDeepTraceEvent('test.after_opt_out');
      expect(trace.readDeepTraceMemorySnapshot().events.map((event) => event.name)).not.toContain(
        'test.after_opt_out'
      );
      expect(trace.readDeepTraceMemorySnapshot().events.map((event) => event.name)).toContain(
        'test.after_failure'
      );
      await trace.clearDeepTrace();
      expect(trace.readDeepTraceMemorySnapshot().events).toEqual([]);
    } finally {
      dispose();
    }
  });

  it.each([
    ['aborts a write in flight', 'UnknownError'],
    ['closes the connection', 'InvalidStateError'],
  ] as const)(
    'writes the failed batch once on a new connection after IndexedDB %s',
    async (loss, errorName) => {
      const actual = await vi.importActual<typeof import('idb')>('idb');
      let database: Awaited<ReturnType<typeof actual.openDB>> | undefined;
      mocks.openDB.mockImplementation(async (...args: Parameters<typeof actual.openDB>) => {
        database = await actual.openDB(...args);
        return database;
      });
      const storage = window.localStorage;
      storage.clear();
      const dispose = trace.initializeDeepTraceRecorder(storage);
      try {
        expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
        await trace.clearDeepTrace();
        let abortWrite: ((error: Error) => void) | undefined;
        if (loss === 'aborts a write in flight') {
          // WebKit aborts writes in flight when it suspends the app; the error arrives on resume.
          const writing = new Promise<never>((_resolve, reject) => {
            abortWrite = reject;
          });
          vi.spyOn(database!, 'transaction').mockReturnValueOnce({
            objectStore: (name: string) =>
              name === 'events' ? { add: () => writing } : { get: async () => undefined },
            done: Promise.resolve(),
          } as never);
        } else {
          // fake-indexeddb 6.2 declares a constructor here but accepts a connection.
          forceCloseDatabase(unwrap(database!) as never);
        }
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        trace.recordDeepTraceEvent('test.failed_batch', undefined, { flush: true });
        // Recorded while that write is in flight, with and without an immediate flush.
        trace.recordDeepTraceEvent('test.during_write', undefined, { flush: true });
        trace.recordDeepTraceEvent('test.queued_during_write');
        abortWrite?.(new DOMException('private failure detail', 'UnknownError'));
        // Polling every 1 ms keeps the fake clock, which `waitFor` advances, near the failure.
        await vi.waitFor(
          () =>
            expect(trace.getDeepTraceHealthSnapshot()).toMatchObject({
              flushing: false,
              lastFailure: { stage: 'flush', errorName },
            }),
          { interval: 1 }
        );
        // Nothing is stored yet: the failed batch is pending again with the events queued meanwhile.
        const unsaved = trace.readDeepTraceMemorySnapshot().events;
        expect(trace.getDeepTraceHealthSnapshot()).toMatchObject({
          pendingEventCount: unsaved.length,
          pendingBytes: unsaved.reduce((total, event) => total + JSON.stringify(event).length, 0),
        });
        trace.recordDeepTraceEvent('test.after_failure', undefined, { flush: true });
        // No flush, requested during the write or after it, retries before the delay.
        await vi.advanceTimersByTimeAsync(500);
        expect(mocks.openDB).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(500);
        await vi.waitFor(() =>
          expect(trace.getDeepTraceHealthSnapshot()).toMatchObject({
            pendingEventCount: 0,
            flushing: false,
          })
        );
        expect(mocks.openDB).toHaveBeenCalledTimes(2);
        // After a successful write, an immediate flush starts at once again.
        trace.recordDeepTraceEvent('test.after_recovery', undefined, { flush: true });
        expect(trace.getDeepTraceHealthSnapshot().pendingEventCount).toBe(0);
        vi.useRealTimers();

        const { events } = await trace.readDeepTraceSnapshot();
        expect(
          events.map((event) => event.name).filter((name) => name.startsWith('test.'))
        ).toEqual([
          'test.failed_batch',
          'test.during_write',
          'test.queued_during_write',
          'test.after_failure',
          'test.after_recovery',
        ]);
        expect(trace.getDeepTraceHealthSnapshot()).toMatchObject({
          status: 'recording',
          lastFailure: { stage: 'flush', errorName },
        });
      } finally {
        vi.useRealTimers();
        await trace.setDeepTraceEnabled(false, storage);
        dispose();
      }
    }
  );

  it('writes a failed batch at once for an export that waited on it', async () => {
    const actual = await vi.importActual<typeof import('idb')>('idb');
    let database: Awaited<ReturnType<typeof actual.openDB>> | undefined;
    mocks.openDB.mockImplementation(async (...args: Parameters<typeof actual.openDB>) => {
      database = await actual.openDB(...args);
      return database;
    });
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    try {
      expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
      await trace.clearDeepTrace();
      let abortWrite!: (error: Error) => void;
      const writing = new Promise<never>((_resolve, reject) => {
        abortWrite = reject;
      });
      vi.spyOn(database!, 'transaction').mockReturnValueOnce({
        objectStore: (name: string) =>
          name === 'events' ? { add: () => writing } : { get: async () => undefined },
        done: Promise.resolve(),
      } as never);

      trace.recordDeepTraceEvent('test.failed_batch', undefined, { flush: true });
      const reading = trace.readDeepTraceSnapshot();
      abortWrite(new DOMException('private failure detail', 'UnknownError'));

      const { events } = await reading;
      expect(events.filter((event) => event.name === 'test.failed_batch')).toHaveLength(1);
      expect(trace.getDeepTraceHealthSnapshot()).toMatchObject({
        status: 'recording',
        pendingEventCount: 0,
        lastFailure: { stage: 'flush', errorName: 'UnknownError' },
      });
    } finally {
      await trace.setDeepTraceEnabled(false, storage);
      dispose();
    }
  });

  it('stops retrying and records in memory while IndexedDB stays unavailable', async () => {
    const actual = await vi.importActual<typeof import('idb')>('idb');
    let database: Awaited<ReturnType<typeof actual.openDB>> | undefined;
    mocks.openDB.mockImplementation(async (...args: Parameters<typeof actual.openDB>) => {
      database = await actual.openDB(...args);
      return database;
    });
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    try {
      expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
      mocks.openDB.mockRejectedValue(new DOMException('private open failure', 'UnknownError'));
      forceCloseDatabase(unwrap(database!) as never);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      trace.recordDeepTraceEvent('test.failed_batch', undefined, { flush: true });
      await vi.waitFor(
        () => expect(trace.getDeepTraceHealthSnapshot().lastFailure).not.toBeNull(),
        { interval: 1 }
      );
      for (const [delay, opens] of [
        [1_000, 2],
        [2_000, 3],
        [4_000, 4],
      ]) {
        expect(trace.getDeepTraceRuntimeStatus()).toBe('recording');
        await vi.advanceTimersByTimeAsync(delay - 50);
        expect(mocks.openDB).toHaveBeenCalledTimes(opens - 1);
        await vi.advanceTimersByTimeAsync(50);
        await vi.waitFor(() => expect(mocks.openDB).toHaveBeenCalledTimes(opens), { interval: 1 });
      }
      await vi.waitFor(() => expect(trace.getDeepTraceRuntimeStatus()).toBe('memory-only'));

      trace.recordDeepTraceEvent('test.after_giving_up', undefined, { flush: true });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.openDB).toHaveBeenCalledTimes(4);
      expect(trace.readDeepTraceMemorySnapshot().events.map((event) => event.name)).toEqual(
        expect.arrayContaining(['test.failed_batch', 'test.after_giving_up'])
      );
      expect(trace.getDeepTraceHealthSnapshot()).toMatchObject({
        pendingEventCount: 0,
        lastFailure: { stage: 'flush', errorName: 'UnknownError' },
      });
    } finally {
      dispose();
    }
  });

  it.each([false, true])(
    'bounds the memory tail and reports eviction (large metadata: %s)',
    async (large) => {
      mocks.openDB.mockRejectedValue(new DOMException('private storage failure', 'UnknownError'));
      const storage = window.localStorage;
      storage.clear();
      const dispose = trace.initializeDeepTraceRecorder(storage);
      try {
        await trace.setDeepTraceEnabled(true, storage);
        const data = large
          ? Object.fromEntries(
              Array.from({ length: 16 }, (_, i) => [
                `metric_${i}_${'x'.repeat(25)}`,
                Number.MAX_VALUE,
              ])
            )
          : {};
        for (let i = 0; i < 1200; i += 1)
          trace.recordDeepTraceEvent('test.bounded', { ...data, index: i });
        const snapshot = trace.readDeepTraceMemorySnapshot();
        expect(snapshot.events.length).toBeGreaterThan(0);
        expect(snapshot.events.length).toBeLessThanOrEqual(1000);
        expect(snapshot.stats.byteCount).toBeLessThanOrEqual(256 * 1024);
        expect(snapshot.stats.eventCount).toBe(snapshot.events.length);
        expect(snapshot.stats.byteCount).toBe(
          snapshot.events.reduce((total, event) => total + JSON.stringify(event).length, 0)
        );
        expect(snapshot.stats.droppedEventCount).toBeGreaterThan(0);
        expect(snapshot.events.at(-1)?.sequence).toBe(1202);
        expect(snapshot.stats.oldestAt).toBe(snapshot.events[0].at);
        expect(snapshot.stats.newestAt).toBe(snapshot.events.at(-1)?.at);
        expect(mocks.openDB).toHaveBeenCalledTimes(1);
      } finally {
        dispose();
      }
    }
  );

  it('does not restore a failure marker when an in-flight flush rejects during clearing', async () => {
    const actual = await vi.importActual<typeof import('idb')>('idb');
    let database: Awaited<ReturnType<typeof actual.openDB>> | undefined;
    mocks.openDB.mockImplementation(async (...args: Parameters<typeof actual.openDB>) => {
      database = await actual.openDB(...args);
      return database;
    });
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);

    let rejectAppend: ((reason: Error) => void) | undefined;
    const append = new Promise<never>((_resolve, reject) => {
      rejectAppend = reject;
    });
    const transaction = {
      objectStore: (name: string) =>
        name === 'events' ? { add: () => append } : { get: async () => undefined },
      done: Promise.resolve(),
    };
    vi.spyOn(database!, 'transaction').mockReturnValueOnce(transaction as never);
    trace.recordDeepTraceEvent('test.clear_race', undefined, { flush: true });
    await vi.waitFor(() => expect(trace.getDeepTraceHealthSnapshot().flushing).toBe(true));

    const clearing = trace.clearDeepTrace();
    trace.recordDeepTraceEvent('test.after_clear_boundary');
    rejectAppend?.(new DOMException('private failure detail', 'InvalidStateError'));
    await clearing;

    expect(trace.readDeepTraceMemorySnapshot().events.map((event) => event.name)).toEqual([
      'test.after_clear_boundary',
    ]);

    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toBeNull();
    expect(storage.getItem(trace.DEEP_TRACE_FAILURE_KEY)).toBeNull();
    // Clearing wrote to storage, so the next flush does not wait for a retry.
    trace.recordDeepTraceEvent('test.after_clear', undefined, { flush: true });
    expect(trace.getDeepTraceHealthSnapshot().pendingEventCount).toBe(0);

    await trace.setDeepTraceEnabled(false, storage);
    dispose();
  });

  it('retains failure evidence when clearing a closed IndexedDB connection fails', async () => {
    const actual = await vi.importActual<typeof import('idb')>('idb');
    let database: Awaited<ReturnType<typeof actual.openDB>> | undefined;
    mocks.openDB.mockImplementation(async (...args: Parameters<typeof actual.openDB>) => {
      database = await actual.openDB(...args);
      return database;
    });
    const storage = window.localStorage;
    storage.clear();
    const failure = {
      at: 123,
      stage: 'flush',
      errorName: 'InvalidStateError',
    };
    storage.setItem(trace.DEEP_TRACE_FAILURE_KEY, JSON.stringify(failure));
    const dispose = trace.initializeDeepTraceRecorder(storage);

    expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
    database?.close();

    await expect(trace.clearDeepTrace()).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toEqual(failure);
    expect(storage.getItem(trace.DEEP_TRACE_FAILURE_KEY)).toBe(JSON.stringify(failure));

    await trace.setDeepTraceEnabled(false, storage);
    dispose();
  });

  it('stays disabled if its final stop-marker flush fails after opt-out', async () => {
    const actual = await vi.importActual<typeof import('idb')>('idb');
    let database: Awaited<ReturnType<typeof actual.openDB>> | undefined;
    mocks.openDB.mockImplementation(async (...args: Parameters<typeof actual.openDB>) => {
      database = await actual.openDB(...args);
      return database;
    });
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    try {
      await trace.setDeepTraceEnabled(true, storage);
      let rejectWrite!: (error: Error) => void;
      const writing = new Promise((_resolve, reject) => {
        rejectWrite = reject;
      });
      vi.spyOn(database!, 'transaction').mockReturnValueOnce({
        objectStore: (name: string) =>
          name === 'events' ? { add: () => writing } : { get: async () => undefined },
        done: Promise.resolve(),
      } as never);
      await trace.setDeepTraceEnabled(false, storage);
      rejectWrite(new DOMException('private stop failure', 'UnknownError'));
      await vi.waitFor(() => expect(trace.getDeepTraceHealthSnapshot().flushing).toBe(false));
      expect(trace.getDeepTraceRuntimeStatus()).toBe('disabled');
      expect(trace.getDeepTraceHealthSnapshot().lastFailure).toBeNull();
      trace.recordDeepTraceEvent('test.after_failed_stop');
      expect(trace.readDeepTraceMemorySnapshot().events.map((event) => event.name)).not.toContain(
        'test.after_failed_stop'
      );
      expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
      expect(trace.getDeepTraceRuntimeStatus()).toBe('recording');
    } finally {
      dispose();
    }
  });

  it('returns an independent memory snapshot with the current capture status', async () => {
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    try {
      await trace.setDeepTraceEnabled(true, storage);
      trace.recordDeepTraceEvent('test.snapshot', { count: 1 });
      const snapshot = trace.readDeepTraceMemorySnapshot();
      expect(snapshot.status).toBe('recording');
      snapshot.events.at(-1)!.data!.count = 99;
      expect(trace.readDeepTraceMemorySnapshot().events.at(-1)?.data?.count).toBe(1);
    } finally {
      dispose();
    }
  });
});
