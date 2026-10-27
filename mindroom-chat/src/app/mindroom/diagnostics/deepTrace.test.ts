// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logTimelineDebug } from '../threads/timelineDebug';
import { SCHEDULER_WAKEUP_REPLACED_EVENT } from './schedulerWakeup';
import { THREAD_TRACE_PHASES } from './threadTraceSchema';
import {
  classifyDeepTraceNetworkRequest,
  clearDeepTrace,
  DEEP_TRACE_DB_NAME,
  DEEP_TRACE_ENABLED_KEY,
  DEEP_TRACE_MAX_EVENTS,
  DEEP_TRACE_MAX_PENDING_EVENTS,
  getDeepTraceEnabled,
  initializeDeepTraceRecorder,
  isDeepTraceRecording,
  readDeepTraceSnapshot,
  recordDeepTraceEvent,
  setDeepTraceEnabled,
  traceDeepDiagnosticFetch,
} from './deepTrace';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('opt-in deep diagnostic trace', () => {
  let storage: MemoryStorage;
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    storage = new MemoryStorage();
    dispose = initializeDeepTraceRecorder(storage);
    await clearDeepTrace();
  });

  afterEach(async () => {
    await setDeepTraceEnabled(false, storage);
    dispose?.();
    dispose = undefined;
    await clearDeepTrace();
    vi.restoreAllMocks();
  });

  it('records nothing until the device-local preference is enabled', async () => {
    recordDeepTraceEvent('test.before_enable', { count: 1 });

    expect(getDeepTraceEnabled(storage)).toBe(false);
    expect((await readDeepTraceSnapshot()).events).toEqual([]);

    expect(await setDeepTraceEnabled(true, storage)).toBe(true);
    recordDeepTraceEvent('test.after_enable', { count: 2, ready: true });

    const snapshot = await readDeepTraceSnapshot();
    expect(storage.getItem(DEEP_TRACE_ENABLED_KEY)).toBe('1');
    expect(snapshot.status).toBe('recording');
    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'trace.session.start' }),
        expect.objectContaining({
          name: 'test.after_enable',
          data: { count: 2, ready: true },
        }),
      ])
    );
    expect(snapshot.events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'test.before_enable' })])
    );
  });

  it('stops capture immediately while retaining the bounded trace for export', async () => {
    await setDeepTraceEnabled(true, storage);
    recordDeepTraceEvent('test.before_disable');
    await setDeepTraceEnabled(false, storage);
    recordDeepTraceEvent('test.after_disable');

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.events.map((event) => event.name)).toContain('test.before_disable');
    expect(snapshot.events.map((event) => event.name)).toContain('trace.session.stop');
    expect(snapshot.events.map((event) => event.name)).not.toContain('test.after_disable');
  });

  it('persists a clean stop marker when the recorder is disposed', async () => {
    await setDeepTraceEnabled(true, storage);

    dispose?.();
    dispose = undefined;

    expect((await readDeepTraceSnapshot()).events.map((event) => event.name)).toContain(
      'trace.session.stop'
    );
  });

  it('keeps dynamic metadata numeric and rejects unsafe event names', async () => {
    await setDeepTraceEnabled(true, storage);
    recordDeepTraceEvent('test.safe', {
      count: 3,
      finite: Number.POSITIVE_INFINITY,
      // Runtime validation protects the export even if an unchecked caller bypasses TypeScript.
      private_text: 'secret message' as never,
    });
    recordDeepTraceEvent('secret room/id');
    recordDeepTraceEvent('interaction.open.private-room');

    const json = JSON.stringify(await readDeepTraceSnapshot());
    expect(json).not.toContain('secret message');
    expect(json).not.toContain('secret room');
    expect(json).not.toContain('private-room');
    expect(json).not.toContain('finite');
    expect(json).toContain('"count":3');
  });

  it('retains every metric declared by the thread trace schema', async () => {
    await setDeepTraceEnabled(true, storage);
    for (const [phase, [, fields]] of Object.entries(THREAD_TRACE_PHASES)) {
      const payload = Object.fromEntries(fields.map((field, index) => [field, index + 100]));
      logTimelineDebug('thread-open#7#synthetic', phase, payload);
    }
    const snapshot = await readDeepTraceSnapshot();
    for (const [name, fields] of Object.values(THREAD_TRACE_PHASES)) {
      const event = snapshot.events.find((entry) => entry.name === name);
      expect(event?.data?.trace_id).toBe(7);
      expect(Object.values(event?.data ?? {}).sort((a, b) => Number(a) - Number(b))).toEqual([
        7,
        ...fields.map((_, index) => index + 100),
      ]);
    }
  });

  it('exports attempted and committed thread state without identifiers or message text', async () => {
    await setDeepTraceEnabled(true, storage);
    logTimelineDebug('thread-open#7#private-room#private-thread', 'thread-render-snapshot', {
      eventCount: 0,
      modelEventCount: 3,
      modelReplyCount: 2,
      loadedReplyCount: 0,
      renderableReplyCount: 0,
      mountedReplyCount: 0,
      expectedReplyCount: 2,
      rootMounted: false,
      virtualItemCount: 0,
      cacheHydrated: false,
      sdkReady: false,
      loading: false,
      loadError: false,
      renderAttemptCount: 3,
      commitCount: 1,
      attemptedEventCount: 3,
      attemptedSdkReady: true,
      attemptedCacheHydrated: true,
      body: 'private message',
    });
    const snapshot = await readDeepTraceSnapshot();
    const event = snapshot.events.find((entry) => entry.name === 'thread.render');
    expect(event?.data).toMatchObject({
      trace_id: 7,
      event_count: 0,
      render_attempt_count: 3,
      commit_count: 1,
      attempted_event_count: 3,
      attempted_sdk_ready: true,
      attempted_cache_hydrated: true,
    });
    expect(JSON.stringify(event)).not.toContain('private');
    logTimelineDebug('thread-open#7#private-room', 'thread-render-scheduler', {
      source: 3,
      delayMs: 50,
      visible: true,
    });
    expect((await readDeepTraceSnapshot()).events).toContainEqual(
      expect.objectContaining({
        name: 'thread.scheduler',
        data: { trace_id: 7, source: 3, delay_ms: 50, visible: true },
      })
    );
  });

  it('records React Scheduler wakeup replacements with only their delay', async () => {
    await setDeepTraceEnabled(true, storage);

    window.dispatchEvent(
      new CustomEvent(SCHEDULER_WAKEUP_REPLACED_EVENT, { detail: { elapsedMs: 251.37 } })
    );
    window.dispatchEvent(
      new CustomEvent(SCHEDULER_WAKEUP_REPLACED_EVENT, { detail: { elapsedMs: 'private' } })
    );

    const snapshot = await readDeepTraceSnapshot();
    const replacements = snapshot.events.filter(
      (event) => event.name === 'performance.scheduler_wakeup_replaced'
    );
    expect(replacements.map((event) => event.data)).toEqual([{ elapsed_ms: 251.4 }, undefined]);
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });

  it('records an IndexedDB loss recovery reload with its age', async () => {
    await setDeepTraceEnabled(true, storage);

    recordDeepTraceEvent('storage.indexeddb_loss_reload', { reload_ms_ago: 1_500 });

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        name: 'storage.indexeddb_loss_reload',
        data: { reload_ms_ago: 1_500 },
      })
    );
  });

  it('records cache database stalls', async () => {
    expect(isDeepTraceRecording()).toBe(false);
    await setDeepTraceEnabled(true, storage);
    expect(isDeepTraceRecording()).toBe(true);
    const names = [
      'storage.cache.close',
      'storage.cache.eviction',
      'storage.cache.open_settled',
      'storage.cache.open_stalled',
      'storage.cache.transaction_settled',
      'storage.cache.transaction_stalled',
    ];
    names.forEach((name) => recordDeepTraceEvent(name, { readwrite: true, events: true }));

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events.filter((event) => names.includes(event.name))).toHaveLength(6);
  });

  it('captures JavaScriptCore stack locations without retaining stack text', async () => {
    await setDeepTraceEnabled(true, storage);
    const reason = new TypeError('private rejection message');
    reason.stack =
      'loadThreads@https://cdn.private.test/app.js:42:7\n' +
      `global code@${window.location.origin}/index.js:8:3`;
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: reason });

    window.dispatchEvent(rejection);

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'error.unhandled_rejection',
          data: expect.objectContaining({
            error_code: 7,
            source_code: 2,
            line: 42,
            column: 7,
          }),
        }),
      ])
    );
    expect(JSON.stringify(snapshot)).not.toContain('private rejection message');
    expect(JSON.stringify(snapshot)).not.toContain('cdn.private.test');
  });

  it('ignores coordinate-like error text and classifies a bare async V8 frame', async () => {
    await setDeepTraceEnabled(true, storage);
    const reason = new TypeError(
      'contact user@private.test:77:2 (https://private.test/fake.js:99:4)'
    );
    reason.stack = `${reason.name}: ${reason.message}\n    at async https://cdn.private.test/app.js:12:5`;
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: reason });

    window.dispatchEvent(rejection);

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'error.unhandled_rejection',
          data: expect.objectContaining({
            source_code: 2,
            line: 12,
            column: 5,
          }),
        }),
      ])
    );
    expect(JSON.stringify(snapshot)).not.toContain('private.test');
    expect(JSON.stringify(snapshot)).not.toContain('fake.js');
  });

  it('captures range-control interactions through the categorical allowlist', async () => {
    await setDeepTraceEnabled(true, storage);
    const range = document.createElement('input');
    range.type = 'range';
    document.body.append(range);

    range.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect((await readDeepTraceSnapshot()).events.map((event) => event.name)).toContain(
      'interaction.pointer.range.app'
    );
    range.remove();
  });

  it('classifies network requests without retaining homeserver, room, or event identifiers', () => {
    const secret = '!private-room:secret.test';
    const cases = [
      [`https://matrix.secret.test/_matrix/client/v3/sync?since=${secret}`, 'matrix.sync'],
      [
        `https://matrix.secret.test/_matrix/client/v1/rooms/${secret}/relations/$event`,
        'matrix.relations',
      ],
      [`https://matrix.secret.test/_matrix/client/v3/rooms/${secret}/messages`, 'matrix.messages'],
      [`https://matrix.secret.test/_matrix/media/v3/download/secret/id`, 'matrix.media'],
      [`https://matrix.secret.test/_matrix/client/v3/rooms/${secret}/send`, 'matrix.client'],
      [`${window.location.origin}/config.json`, 'app'],
      ['https://third-party.secret.test/path', 'external'],
    ] as const;

    const results = cases.map(([url, expected]) => {
      const classification = classifyDeepTraceNetworkRequest(url);
      expect(classification).toBe(expected);
      return classification;
    });
    expect(JSON.stringify(results)).not.toContain('secret');
  });

  it('traces through a captured Matrix fetch delegate only while enabled', async () => {
    const baseFetch = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-length': '2' } }));
    const capturedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
      traceDeepDiagnosticFetch(baseFetch, input, init);
    const syncUrl = 'https://matrix.example.test/_matrix/client/v3/sync?since=private';

    await capturedFetch(syncUrl);
    await setDeepTraceEnabled(true, storage);
    await capturedFetch(syncUrl);
    await setDeepTraceEnabled(false, storage);
    await capturedFetch(syncUrl);

    expect(baseFetch).toHaveBeenCalledTimes(3);
    const events = (await readDeepTraceSnapshot()).events;
    expect(events.filter((event) => event.name === 'network.matrix.sync.get.start')).toHaveLength(
      1
    );
    expect(
      events.filter((event) => event.name === 'network.matrix.sync.get.complete')
    ).toHaveLength(1);
  });

  it('persists a Matrix request start before the request settles', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const baseFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const readStoredNames = () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open(DEEP_TRACE_DB_NAME);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const all = database.transaction('events', 'readonly').objectStore('events').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            database.close();
            resolve(all.result.map((event) => String(event.name)));
          };
        };
      });
    await setDeepTraceEnabled(true, storage);

    const pending = traceDeepDiagnosticFetch(
      baseFetch,
      'https://matrix.example.test/_matrix/client/v3/sync'
    );

    await vi.waitFor(async () => {
      expect(await readStoredNames()).toContain('network.matrix.sync.get.start');
    });
    expect(baseFetch).toHaveBeenCalledOnce();

    resolveFetch?.(new Response('{}', { status: 200 }));
    await pending;
  });

  it('distinguishes an unknown response size from a zero-byte response', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await setDeepTraceEnabled(true, storage);

    await traceDeepDiagnosticFetch(baseFetch, `${window.location.origin}/config.json`);

    const completion = (await readDeepTraceSnapshot()).events.find(
      (event) => event.name === 'network.app.get.complete'
    );
    expect(completion?.data?.content_bytes).toBeNull();
  });

  it('caps the persisted ring by event count and keeps the newest evidence', async () => {
    await setDeepTraceEnabled(true, storage);
    for (let start = 0; start < DEEP_TRACE_MAX_EVENTS + 5; start += 200) {
      const end = Math.min(start + 200, DEEP_TRACE_MAX_EVENTS + 5);
      for (let index = start; index < end; index += 1) {
        recordDeepTraceEvent('test.ring', { index });
      }
      await readDeepTraceSnapshot();
    }

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toHaveLength(DEEP_TRACE_MAX_EVENTS);
    expect(snapshot.stats.eventCount).toBe(DEEP_TRACE_MAX_EVENTS);
    expect(snapshot.events.at(-1)).toMatchObject({
      name: 'test.ring',
      data: { index: DEEP_TRACE_MAX_EVENTS + 4 },
    });
    expect(snapshot.events.find((event) => event.data?.index === 0)).toBeUndefined();
  });

  it('clears retained events without changing the opt-in preference', async () => {
    await setDeepTraceEnabled(true, storage);
    recordDeepTraceEvent('test.to_clear');
    await readDeepTraceSnapshot();

    await clearDeepTrace();

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.stats.eventCount).toBe(0);
    expect(getDeepTraceEnabled(storage)).toBe(true);
  });

  it('bounds a burst while storage is busy and reports dropped pending evidence', async () => {
    await setDeepTraceEnabled(true, storage);
    for (let index = 0; index < DEEP_TRACE_MAX_PENDING_EVENTS * 4; index += 1) {
      recordDeepTraceEvent('test.burst', { index });
    }

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.stats.droppedEventCount).toBeGreaterThan(0);
    expect(snapshot.events.at(-1)).toMatchObject({
      name: 'test.burst',
      data: { index: DEEP_TRACE_MAX_PENDING_EVENTS * 4 - 1 },
    });
  });

  it('stops capture even when the disabled preference cannot be removed', async () => {
    await setDeepTraceEnabled(true, storage);
    const removeItem = storage.removeItem.bind(storage);
    vi.spyOn(storage, 'removeItem').mockImplementation((key) => {
      if (key === DEEP_TRACE_ENABLED_KEY) throw new Error('localStorage blocked');
      removeItem(key);
    });

    expect(await setDeepTraceEnabled(false, storage)).toBe(false);
    recordDeepTraceEvent('test.after_failed_disable');

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.events.map((event) => event.name)).not.toContain('test.after_failed_disable');
    expect(storage.getItem(DEEP_TRACE_ENABLED_KEY)).toBe('1');
  });

  it('honors a new enable after an in-flight activation is disabled', async () => {
    const firstEnable = setDeepTraceEnabled(true, storage);
    const disable = setDeepTraceEnabled(false, storage);
    const secondEnable = setDeepTraceEnabled(true, storage);

    expect(await firstEnable).toBe(false);
    expect(await disable).toBe(true);
    expect(await secondEnable).toBe(true);
    expect((await readDeepTraceSnapshot()).status).toBe('recording');
    expect(storage.getItem(DEEP_TRACE_ENABLED_KEY)).toBe('1');
  });
});
