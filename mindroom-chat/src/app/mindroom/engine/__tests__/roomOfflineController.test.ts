import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { EventEmitter } from 'node:events';
import {
  MatrixEvent,
  MatrixEventEvent,
  RoomEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveAttachmentOwner } from '../../threads/__tests__/attachmentFixtures';
import { createMindroomSyncEngine } from '../mindroomSyncEngine';
import { createSessionId } from '../../../state/sessions';
import { createRoomOfflineController } from '../roomOffline';
import { createBackfillScheduler } from '../backfillScheduler';
import { resolvePrefetchConfig } from '../prefetchPolicy';
import {
  loadCachedRoomEvent,
  loadRoomTailDiscontinuity,
  loadLatestCachedThreadEvents,
  resetCacheStoreForTesting,
} from '../../threads/cacheStore';
import {
  __setCacheStoreByteBudgetForTests,
  __resetEvictionForTests,
  clearRoomCachedContent,
  noteRoomOpened,
  runCacheEvictionIfOverBudget,
  saveRoomEventsToCacheCommitted,
} from '../../threads/cacheStore';
import { reportCacheWriteError, resetCacheHealthForTesting } from '../../threads/cacheHealth';
import { persistRoomChunkWithPreferLive } from '../../threads/eventRepository';
import {
  readRoomOfflineProgress,
  updateRoomOfflineProgress,
} from '../../threads/cacheStore/cacheStoreMeta';

const roomId = '!opened:test';
const raw = (id: string) => ({
  event_id: id,
  room_id: roomId,
  sender: '@alice:test',
  type: 'm.room.message',
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body: id },
});
const engines: ReturnType<typeof createMindroomSyncEngine>[] = [];
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
  __resetEvictionForTests();
});
afterEach(() => {
  engines.forEach((engine) => engine.stop());
  engines.length = 0;
  vi.unstubAllGlobals();
  __setCacheStoreByteBudgetForTests(undefined);
  resetCacheHealthForTesting();
});
const fixture = (request = vi.fn().mockResolvedValue({ chunk: [] })) => {
  const timelineSet = {};
  const room = {
    getUnfilteredTimelineSet: () => timelineSet,
    roomId,
    findEventById: () => undefined,
    getThread: () => undefined,
    getLiveTimeline: () => ({
      getEvents: () => [],
      getPaginationToken: () => null,
      getState: () => ({ getStateEvents: () => undefined }),
    }),
    getLastActiveTimestamp: () => 0,
  } as unknown as Room;
  const emitter = new EventEmitter();
  const mx = Object.assign(emitter, {
    getHomeserverUrl: () => 'https://test',
    getSafeUserId: () => '@alice:test',
    getRoom: (id: string) => ({ ...room, roomId: id }),
    getRooms: () => [room, { ...room, roomId: '!unopened:test' }],
    getSyncState: () => 'SYNCING',
    getEventMapper: () => (event: object) => new MatrixEvent(event),
    decryptEventIfNeeded: async () => undefined,
    createMessagesRequest: request,
    getVersions: async () => ({ versions: ['v1.11'] }),
    getDomain: () => 'test',
    getAccessToken: () => 'test-token',
    mxcUrlToHttp: () => 'https://test/_matrix/client/v1/media/download/test/body',
  }) as unknown as MatrixClient;
  let network = { connected: true, unmetered: true };
  const listeners = new Set<() => void>();
  const connection = {
    getSnapshot: () => network,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const make = (realGap = false) => {
    const engine = createMindroomSyncEngine({
      mx,
      connection,
      gapTracker: realGap
        ? undefined
        : ({
            stop: () => undefined,
            handleSyncPrepared: async () => undefined,
            handleTimelineReset: () => undefined,
          } as never),
    });
    engines.push(engine);
    engine.start();
    return engine;
  };
  return {
    make,
    request,
    mx,
    room,
    timelineSet,
    setNetwork: (next: typeof network) => {
      network = next;
      listeners.forEach((fn) => fn());
    },
  };
};

it('new engine resumes committed history without fetching unopened rooms', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ chunk: [raw('$one')], end: 'older-1' })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ chunk: [] });
  const f = fixture(request);
  const first = f.make();
  expect(first.offline).toBeDefined();
  first.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(first.offline.getSnapshot(roomId).status).toBe('error'));
  expect(await loadCachedRoomEvent(first.sessionId, roomId, '$one')).toBeDefined();
  first.stop();
  resetCacheStoreForTesting();
  const next = f.make();
  next.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(next.offline.getSnapshot(roomId).historyExhausted).toBe(true));
  expect(request.mock.calls.map((call) => call[1])).toEqual([null, 'older-1', 'older-1']);
  expect(request.mock.calls.every((call) => call[0] === roomId)).toBe(true);
});

it('clear rejects pending event and cursor writes', async () => {
  let resolve!: (value: unknown) => void;
  const f = fixture(
    vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    )
  );
  const engine = f.make();
  expect(engine.offline).toBeDefined();
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
  await engine.offline.clear(roomId);
  resolve({ chunk: [raw('$late')], end: 'late-token' });
  await vi.waitFor(() => expect(engine.scheduler.pendingJobs()).toHaveLength(0));
  expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$late')).toBeUndefined();
  expect(await readRoomOfflineProgress(engine.sessionId, roomId)).toEqual({});
  expect(engine.offline.getSnapshot(roomId).status).toBe('idle');
});

it('unknown connections stop after 200 events; explicit download continues', async () => {
  const f = fixture(
    vi
      .fn()
      .mockResolvedValueOnce({
        chunk: Array.from({ length: 200 }, (_, i) => raw('$' + i)),
        end: 'older',
      })
      .mockResolvedValue({ chunk: [] })
  );
  f.setNetwork({ connected: true, unmetered: false });
  const engine = f.make();
  expect(engine.offline).toBeDefined();
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('limited'));
  expect(f.request).toHaveBeenCalledOnce();
  engine.offline.download(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).historyExhausted).toBe(true));
  expect(f.request.mock.calls.map((call) => call[1])).toEqual([null, 'older']);
});

it('offline pauses and reconnect resumes focused intent', async () => {
  const f = fixture();
  f.setNetwork({ connected: false, unmetered: false });
  const engine = f.make();
  expect(engine.offline).toBeDefined();
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('offline'));
  expect(f.request).not.toHaveBeenCalled();
  f.setNetwork({ connected: true, unmetered: true });
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).historyExhausted).toBe(true));
});

it.each(['offline', 'hidden'] as const)(
  'keeps the %s pause when queued history is canceled',
  async (pause) => {
    const document = new EventTarget();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    vi.stubGlobal('document', document);
    const f = fixture();
    const engine = f.make();
    const releases: Array<() => void> = [];
    const blockers = [0, 1].map((i) =>
      engine.scheduler.enqueue({
        roomId,
        threadId: '$block-' + i,
        kind: 'thread-backfill',
        priority: 0,
        execute: () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
      })
    );
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(2));
      engine.noteRoomFocused(roomId);
      await vi.waitFor(() =>
        expect(engine.scheduler.pendingJobs().some((job) => job.kind === 'room-deep-history')).toBe(
          true
        )
      );
      if (pause === 'offline') f.setNetwork({ connected: false, unmetered: true });
      else {
        Object.assign(document, { visibilityState: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      expect(engine.offline.getSnapshot(roomId).status).toBe(pause);
      expect(f.request).not.toHaveBeenCalled();
    } finally {
      releases.forEach((release) => release());
      await Promise.all(blockers);
    }
  }
);

it('saves ordinary history without scheduling attachment work', async () => {
  const f = fixture(vi.fn().mockResolvedValue({ chunk: [raw('$plain')] }));
  const engine = f.make();
  const enqueue = vi.spyOn(engine.scheduler, 'enqueue');
  try {
    engine.noteRoomFocused(roomId);
    await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('ready'));
    expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$plain')).toBeDefined();
    expect(enqueue.mock.calls.filter(([job]) => job.kind === 'room-attachments')).toHaveLength(0);
  } finally {
    enqueue.mockRestore();
  }
});

it('keeps failed body coverage separate and retries it after history exhaustion', async () => {
  const message = {
    ...raw('$body'),
    content: {
      msgtype: 'm.text',
      body: 'preview',
      url: 'mxc://test/body',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  };
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementation(
      async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'complete saved body' }))
    );
  vi.stubGlobal('fetch', fetch);
  const f = fixture(vi.fn().mockResolvedValue({ chunk: [message] }));
  const first = f.make();
  first.noteRoomFocused(roomId);
  await vi.waitFor(() =>
    expect(first.offline.getSnapshot(roomId)).toMatchObject({
      historyExhausted: true,
      missingEssential: 1,
    })
  );
  first.stop();
  resetCacheStoreForTesting();
  const next = f.make();
  next.noteRoomFocused(roomId);
  await vi.waitFor(() =>
    expect(next.offline.getSnapshot(roomId)).toMatchObject({
      historyExhausted: true,
      missingEssential: 0,
      saved: 1,
    })
  );
  expect(f.request).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('awaits SDK decryption before grouping and retains ciphertext for late keys', async () => {
  const encrypted = {
    ...raw('$encrypted'),
    type: 'm.room.encrypted',
    content: {
      ciphertext: 'ciphertext-at-rest',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    },
  };
  const f = fixture(vi.fn().mockResolvedValue({ chunk: [encrypted] }));
  let observed: MatrixEvent | undefined;
  f.mx.decryptEventIfNeeded = async (event) => {
    observed = event;
  };
  const engine = f.make();
  engine.offline.subscribe(roomId, () => {});
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() =>
    expect(engine.offline.getSnapshot(roomId)).toMatchObject({
      historyExhausted: true,
      undecryptedEvents: 1,
    })
  );
  expect(
    (await loadLatestCachedThreadEvents(engine.sessionId, roomId, '$root', 10)).events[0]?.content
  ).toMatchObject({ ciphertext: 'ciphertext-at-rest' });
  observed!.setClearData({
    clearEvent: { type: 'm.room.message', content: { msgtype: 'm.text', body: 'decoded' } },
  });
  f.mx.emit(MatrixEventEvent.Decrypted, observed!);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).undecryptedEvents).toBe(0));
  const page = await loadLatestCachedThreadEvents(engine.sessionId, roomId, '$root', 10);
  expect(page.events[0]).toMatchObject({
    event_id: '$encrypted',
    type: 'm.room.encrypted',
    content: { ciphertext: 'ciphertext-at-rest' },
  });
});

it('releases a scheduler slot for foreground work between two explicit downloads', async () => {
  const resolvers: Array<(value: object) => void> = [];
  const order: string[] = [];
  const f = fixture(
    vi.fn(() => {
      order.push('history');
      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    })
  );
  const engine = f.make();
  engine.offline.download(roomId);
  engine.offline.download('!second:test');
  await vi.waitFor(() => expect(resolvers).toHaveLength(2));
  const foreground = engine.scheduler.enqueue({
    roomId,
    kind: 'reconcile',
    priority: 0,
    execute: async () => {
      order.push('foreground');
    },
  });
  resolvers[0]({ chunk: [raw('$first')], end: 'next' });
  await foreground;
  expect(order.slice(0, 3)).toEqual(['history', 'history', 'foreground']);
  engine.offline.cancel(roomId);
  engine.offline.cancel('!second:test');
  resolvers.forEach((resolve) => resolve({ chunk: [] }));
});

it('distinguishes unread, unopened, and unavailable storage from known zero counts', async () => {
  const f = fixture();
  const engine = f.make();
  expect(engine.offline.getSnapshot(roomId)).toMatchObject({ loaded: false, opened: false });
  const stop = engine.offline.subscribe(roomId, () => undefined);
  await vi.waitFor(() =>
    expect(engine.offline.getSnapshot(roomId)).toMatchObject({
      loaded: true,
      opened: false,
      storageAvailable: true,
      missingEssential: 0,
    })
  );
  stop();
  engine.stop();
  resetCacheStoreForTesting();
  vi.stubGlobal('indexedDB', undefined);
  const next = f.make();
  const unsubscribe = next.offline.subscribe(roomId, () => undefined);
  await vi.waitFor(() =>
    expect(next.offline.getSnapshot(roomId)).toMatchObject({
      loaded: true,
      storageAvailable: false,
    })
  );
  unsubscribe();
});

it('shares the 200-event allowance with a concurrent limited-sync gap', async () => {
  let resolve!: (response: object) => void;
  const f = fixture(
    vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    )
  );
  f.setNetwork({ connected: true, unmetered: false });
  const engine = f.make(true);
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
  f.mx.emit(RoomEvent.TimelineReset, f.room, f.timelineSet as never, false);
  await vi.waitFor(() =>
    expect(engine.scheduler.pendingJobs().filter((job) => job.kind === 'gap-fill')).toHaveLength(0)
  );
  resolve({ chunk: Array.from({ length: 200 }, (_, i) => raw('$budget' + i)), end: 'older' });
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('limited'));
  expect(f.request).toHaveBeenCalledOnce();
  engine.clearRoomFocus(roomId);
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
  engine.offline.cancel(roomId);
  resolve({ chunk: [] });
});

it.each(['failed', 'recovered', 'empty', 'offline', 'canceled', 'cleared'] as const)(
  'settles saving after a shared gap is %s without replacing its active status',
  async (outcome) => {
    let resolve!: (value: object) => void;
    let reject!: (error: Error) => void;
    const f = fixture(
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((done, fail) => {
              resolve = done;
              reject = fail;
            })
        )
        .mockResolvedValue({ chunk: [] })
    );
    f.setNetwork({ connected: true, unmetered: false });
    const engine = f.make(true);
    const enqueue = vi.spyOn(engine.scheduler, 'enqueue');
    try {
      engine.noteRoomFocused(roomId);
      f.mx.emit(RoomEvent.TimelineReset, f.room, f.timelineSet as never, false);
      await vi.waitFor(() => {
        expect(enqueue.mock.calls.some(([job]) => job.kind === 'room-deep-history')).toBe(true);
        expect(engine.scheduler.pendingJobs().map((job) => job.kind)).toEqual(['gap-fill']);
      });
      expect(engine.offline.getSnapshot(roomId).status).toBe('saving');
      const recovered = outcome === 'recovered' || outcome === 'empty';
      if (outcome === 'offline') f.setNetwork({ connected: false, unmetered: false });
      if (outcome === 'canceled') engine.offline.cancel(roomId);
      if (outcome === 'cleared') await engine.offline.clear(roomId);
      if (recovered) resolve({ chunk: outcome === 'empty' ? [] : [raw('$gap-filled')] });
      else reject(new Error('network unavailable'));
      await vi.waitFor(() => expect(engine.scheduler.pendingJobs()).toHaveLength(0));
      await vi.waitFor(() =>
        expect(engine.offline.getSnapshot(roomId).status).toBe(
          recovered ? 'ready' : outcome === 'offline' ? 'offline' : 'idle'
        )
      );
      expect(engine.offline.getSnapshot(roomId).historyExhausted).toBe(recovered);
      if (outcome === 'cleared')
        expect(await readRoomOfflineProgress(engine.sessionId, roomId)).toEqual({});
    } finally {
      resolve?.({ chunk: [] });
      enqueue.mockRestore();
    }
  }
);

it.each(['recovered', 'failed'] as const)(
  'keeps saving across an empty shared-gap page until its successor is %s',
  async (outcome) => {
    const pending: Array<{ resolve: (value: object) => void; reject: (error: Error) => void }> = [];
    const f = fixture(
      vi.fn(() =>
        pending.length < 2
          ? new Promise((resolve, reject) => {
              pending.push({ resolve, reject });
            })
          : Promise.resolve({ chunk: [] })
      )
    );
    f.setNetwork({ connected: true, unmetered: false });
    const engine = f.make(true);
    const enqueue = vi.spyOn(engine.scheduler, 'enqueue');
    try {
      engine.noteRoomFocused(roomId);
      f.mx.emit(RoomEvent.TimelineReset, f.room, f.timelineSet as never, false);
      await vi.waitFor(() => {
        expect(enqueue.mock.calls.some(([job]) => job.kind === 'room-deep-history')).toBe(true);
        expect(engine.scheduler.pendingJobs().map((job) => job.kind)).toEqual(['gap-fill']);
      });
      pending[0].resolve({ chunk: [], end: 'older' });
      await vi.waitFor(() => expect(pending).toHaveLength(2));
      expect(f.request.mock.calls[1][1]).toBe('older');
      await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('saving'));
      if (outcome === 'recovered') pending[1].resolve({ chunk: [] });
      else pending[1].reject(new Error('successor unavailable'));
      await vi.waitFor(() => expect(engine.scheduler.pendingJobs()).toHaveLength(0));
      await vi.waitFor(() =>
        expect(engine.offline.getSnapshot(roomId).status).toBe(
          outcome === 'recovered' ? 'ready' : 'idle'
        )
      );
      expect(engine.offline.getSnapshot(roomId).historyExhausted).toBe(outcome === 'recovered');
    } finally {
      pending.forEach(({ resolve }) => resolve({ chunk: [] }));
      enqueue.mockRestore();
    }
  }
);

it.each([10 * 1024 * 1024, undefined])(
  'skips ineligible media jobs on automatic visits and downloads on request (size: %s)',
  async (size) => {
    const media = {
      ...raw('$large-image'),
      content: {
        msgtype: 'm.image',
        body: 'large',
        url: 'mxc://test/large',
        info: { size },
      },
    };
    const f = fixture(vi.fn().mockResolvedValue({ chunk: [media] }));
    const fetch = vi.fn(async () => new Response('media bytes'));
    vi.stubGlobal('fetch', fetch);
    const engine = f.make();
    const enqueue = vi.spyOn(engine.scheduler, 'enqueue');
    try {
      engine.noteRoomFocused(roomId);
      await vi.waitFor(() =>
        expect(engine.offline.getSnapshot(roomId)).toMatchObject({ status: 'ready', missing: 1 })
      );
      engine.clearRoomFocus(roomId);
      engine.noteRoomFocused(roomId);
      await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('ready'));
      expect(engine.offline.getSnapshot(roomId).missing).toBe(1);
      expect(enqueue.mock.calls.filter(([job]) => job.kind === 'room-attachments')).toHaveLength(0);
      expect(fetch).not.toHaveBeenCalled();
      engine.offline.download(roomId, { includeAllMedia: true });
      await vi.waitFor(() =>
        expect(engine.offline.getSnapshot(roomId)).toMatchObject({
          status: 'ready',
          saved: 1,
          missing: 0,
        })
      );
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      enqueue.mockRestore();
    }
  }
);

it('cancel rejects a pending page and a later intent can retry', async () => {
  let resolve!: (response: object) => void;
  const f = fixture(
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      )
      .mockResolvedValue({ chunk: [] })
  );
  f.setNetwork({ connected: true, unmetered: false });
  const engine = f.make();
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
  engine.offline.cancel(roomId);
  resolve({ chunk: [raw('$canceled')], end: 'wrong' });
  await vi.waitFor(() => expect(engine.scheduler.pendingJobs()).toHaveLength(0));
  expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$canceled')).toBeUndefined();
  engine.offline.download(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).historyExhausted).toBe(true));
  await engine.offline.setPinned(roomId, true);
  expect(engine.offline.getSnapshot(roomId).pinned).toBe(true);
  await engine.offline.clear(roomId);
  expect(engine.offline.getSnapshot(roomId).pinned).toBe(false);
});

it('releases failed-page allowance and resumes on connection change', async () => {
  const f = fixture(
    vi.fn().mockRejectedValueOnce(new Error('transport')).mockResolvedValue({ chunk: [] })
  );
  f.setNetwork({ connected: true, unmetered: false });
  const engine = f.make();
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('error'));
  f.setNetwork({ connected: false, unmetered: false });
  f.setNetwork({ connected: true, unmetered: false });
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).historyExhausted).toBe(true));
  expect(f.request).toHaveBeenCalledTimes(2);
});
it('saves the live tail again when a room returns after its cache was evicted', async () => {
  const f = fixture();
  const live = [new MatrixEvent(raw('$live'))];
  const liveTimeline = { ...f.room.getLiveTimeline(), getEvents: () => live };
  Object.assign(f.mx, {
    getRoom: (id: string) => ({ ...f.room, roomId: id, getLiveTimeline: () => liveTimeline }),
  });
  const engine = f.make();
  engine.noteRoomFocused(roomId);
  await vi.waitFor(async () =>
    expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$live')).toBeDefined()
  );
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).not.toBe('saving'));
  engine.clearRoomFocus(roomId);
  // Eviction removes a room that was not opened for a day, which a long-lived
  // session may have warmed before.
  await clearRoomCachedContent(engine.sessionId, roomId);
  engine.noteRoomFocused(roomId);
  await vi.waitFor(async () =>
    expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$live')).toBeDefined()
  );
});

it("keeps a cold room's cache while its explicit download runs under pressure", async () => {
  const f = fixture();
  const engine = f.make();
  await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [raw('$retained')]);
  __setCacheStoreByteBudgetForTests(1);
  engine.offline.download(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('space'));
  expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$retained')).toBeDefined();
  engine.offline.cancel(roomId);
  expect(await runCacheEvictionIfOverBudget(engine.sessionId)).toMatchObject({
    evictedRoomIds: [roomId],
    underPressure: false,
  });
});

it('stops protecting a room once its download finishes or the engine stops', async () => {
  const f = fixture();
  const engine = f.make();
  engine.offline.download(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('ready'));
  await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [raw('$finished')]);
  // Let the check the save scheduled settle under the default budget.
  await runCacheEvictionIfOverBudget(engine.sessionId);
  __setCacheStoreByteBudgetForTests(1);
  expect(await runCacheEvictionIfOverBudget(engine.sessionId)).toMatchObject({
    evictedRoomIds: [roomId],
  });
  await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [raw('$stopped')]);
  engine.offline.download(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('space'));
  engine.stop();
  expect(await runCacheEvictionIfOverBudget(engine.sessionId)).toMatchObject({
    evictedRoomIds: [roomId],
  });
});

it('protects a running download again after the engine restarts', async () => {
  const f = fixture();
  const engine = f.make();
  await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [raw('$kept')]);
  __setCacheStoreByteBudgetForTests(1);
  engine.offline.download(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('space'));
  engine.stop();
  engine.start();
  expect(await runCacheEvictionIfOverBudget(engine.sessionId)).toMatchObject({
    evictedRoomIds: [],
  });
  expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$kept')).toBeDefined();
});

it('retains text and distinguishes soft pressure from quota read-only', async () => {
  const f = fixture();
  const engine = f.make();
  await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [raw('$retained')]);
  __setCacheStoreByteBudgetForTests(1);
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('space'));
  expect(f.request).not.toHaveBeenCalled();
  expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$retained')).toBeDefined();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    reportCacheWriteError('test', new DOMException('quota', 'QuotaExceededError'));
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain('cache degraded to read-only');
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
  engine.offline.download(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('read-only'));
  await engine.offline.clear(roomId);
  engine.offline.download(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('read-only'));
});
it('hidden pages pause and logout revokes a pending page', async () => {
  const document = new EventTarget();
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
  vi.stubGlobal('document', document);
  let resolve!: (response: object) => void;
  const f = fixture(
    vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    )
  );
  const engine = f.make();
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('hidden'));
  expect(f.request).not.toHaveBeenCalled();
  Object.assign(document, { visibilityState: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
  engine.stop();
  resolve({ chunk: [raw('$after-stop')], end: 'late' });
  await vi.waitFor(() => expect(engine.scheduler.pendingJobs()).toHaveLength(0));
  expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$after-stop')).toBeUndefined();
});

it('attachment turns yield to foreground work with two downloads active', async () => {
  const bodies: Array<(response: Response) => void> = [];
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        bodies.push(resolve);
      })
  );
  vi.stubGlobal('fetch', fetch);
  const f = fixture(
    vi.fn(async (id: string) => ({
      chunk: [0, 1].map((i) => ({
        ...raw(id + i),
        room_id: id,
        content: {
          msgtype: 'm.text',
          body: 'preview',
          url: 'mxc://test/' + encodeURIComponent(id + i),
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        },
      })),
    }))
  );
  const engine = f.make();
  engine.offline.download(roomId);
  engine.offline.download('!second:test');
  await vi.waitFor(() => expect(bodies).toHaveLength(2));
  let foregroundRan = false;
  const foreground = engine.scheduler.enqueue({
    roomId,
    kind: 'reconcile',
    priority: 0,
    execute: async () => {
      foregroundRan = true;
    },
  });
  bodies[0](new Response(JSON.stringify({ msgtype: 'm.text', body: 'saved' })));
  await foreground;
  expect(foregroundRan).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  engine.offline.cancel(roomId);
  engine.offline.cancel('!second:test');
  bodies.forEach((resolve) => resolve(new Response('{}')));
});

it.each([false, true])(
  'does not revive an old decrypted event after clear (reopened: %s)',
  async (reopen) => {
    let old!: MatrixEvent;
    const encrypted = {
      ...raw('$old-key'),
      type: 'm.room.encrypted',
      content: { ciphertext: 'old cipher' },
    };
    const f = fixture(
      vi
        .fn()
        .mockResolvedValueOnce({ chunk: [encrypted] })
        .mockResolvedValue({ chunk: [] })
    );
    f.mx.decryptEventIfNeeded = async (event) => {
      old = event;
    };
    const engine = f.make();
    engine.noteRoomFocused(roomId);
    await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).historyExhausted).toBe(true));
    await engine.offline.clear(roomId);
    if (reopen) {
      engine.offline.download(roomId);
      await vi.waitFor(() =>
        expect(engine.offline.getSnapshot(roomId).historyExhausted).toBe(true)
      );
    }
    old.setClearData({
      clearEvent: { type: 'm.room.message', content: { msgtype: 'm.text', body: 'late decoded' } },
    });
    f.mx.emit(MatrixEventEvent.Decrypted, old);
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    expect(await loadCachedRoomEvent(engine.sessionId, roomId, '$old-key')).toBeUndefined();
  }
);

it('checkpoint retains missing keys added while its history request is pending', async () => {
  let release!: (response: object) => void;
  const f = fixture(
    vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    )
  );
  const engine = f.make();
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
  await persistRoomChunkWithPreferLive({
    mx: f.mx,
    sessionId: engine.sessionId,
    room: f.room,
    chunk: [{ ...raw('$live-key'), type: 'm.room.encrypted', content: { ciphertext: 'live' } }],
  });
  release({ chunk: [raw('$plain')] });
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).historyExhausted).toBe(true));
  expect((await readRoomOfflineProgress(engine.sessionId, roomId)).undecryptedEventIds).toContain(
    '$live-key'
  );
});

it('concurrent repository coverage additions preserve each other', async () => {
  const f = fixture();
  const engine = f.make();
  await Promise.all(
    ['a', 'b'].map((id) =>
      persistRoomChunkWithPreferLive({
        mx: f.mx,
        sessionId: engine.sessionId,
        room: f.room,
        chunk: [
          { ...raw('$key-' + id), type: 'm.room.encrypted', content: { ciphertext: id } },
          {
            ...raw('$relation-' + id),
            type: 'm.reaction',
            content: {
              'm.relates_to': { rel_type: 'm.annotation', event_id: '$missing-' + id, key: 'x' },
            },
          },
        ],
      })
    )
  );
  const progress = await readRoomOfflineProgress(engine.sessionId, roomId);
  expect(progress.undecryptedEventIds?.sort()).toEqual(['$key-a', '$key-b']);
  expect(Object.keys(progress.unresolvedRelations ?? {}).sort()).toEqual([
    '$relation-a',
    '$relation-b',
  ]);
});

it('bounded automatic body retries advance past a failed prefix and survive restart', async () => {
  const f = fixture();
  f.setNetwork({ connected: true, unmetered: false });
  const first = f.make();
  const body = {
    ...raw('$z-body'),
    content: {
      msgtype: 'm.text',
      body: 'preview',
      url: 'mxc://test/body',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  };
  await saveRoomEventsToCacheCommitted(first.sessionId, roomId, [
    ...Array.from({ length: 200 }, (_, i) => ({
      ...raw('$a' + String(i).padStart(3, '0')),
      type: 'm.room.encrypted',
      content: { ciphertext: 'unavailable' },
    })),
    body,
  ]);
  await saveAttachmentOwner(first.sessionId, roomId, '$z-body', 1, [
    { mxcUri: 'mxc://test/body', essential: true },
  ]);
  await updateRoomOfflineProgress(first.sessionId, roomId, {
    opened: true,
    exhausted: true,
    undecryptedEventIds: Array.from({ length: 200 }, (_, i) => '$a' + String(i).padStart(3, '0')),
  });
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error('body transport'))
    .mockImplementation(
      async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'saved' }))
    );
  vi.stubGlobal('fetch', fetch);
  first.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(first.offline.getSnapshot(roomId).status).toBe('ready'));
  expect(fetch).not.toHaveBeenCalled();
  first.stop();
  resetCacheStoreForTesting();
  const next = f.make();
  next.noteRoomFocused(roomId);
  await vi.waitFor(() =>
    expect(next.offline.getSnapshot(roomId)).toMatchObject({ status: 'ready', missingEssential: 1 })
  );
  expect(fetch).toHaveBeenCalledOnce();
  next.clearRoomFocus(roomId);
  next.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(next.offline.getSnapshot(roomId).status).toBe('ready'));
  next.clearRoomFocus(roomId);
  next.noteRoomFocused(roomId);
  await vi.waitFor(() =>
    expect(next.offline.getSnapshot(roomId)).toMatchObject({
      status: 'ready',
      saved: 1,
      missingEssential: 0,
    })
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('concurrent coverage repairs remove only processed IDs and retain newer additions', async () => {
  const f = fixture();
  const engine = f.make();
  const key = (id: string) => ({
    ...raw(id),
    type: 'm.room.encrypted',
    content: { ciphertext: id },
  });
  const relation = (id: string, target: string) => ({
    ...raw(id),
    type: 'm.reaction',
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: target, key: 'x' } },
  });
  const persist = (chunk: object[]) =>
    persistRoomChunkWithPreferLive({ mx: f.mx, sessionId: engine.sessionId, room: f.room, chunk });
  await persist([
    key('$key-remove'),
    key('$key-keep'),
    relation('$rel-remove', '$target'),
    relation('$rel-keep', '$unavailable'),
  ]);
  await Promise.all([
    (() => {
      const decrypted = new MatrixEvent(key('$key-remove'));
      decrypted.setClearData({
        clearEvent: { type: 'm.room.message', content: { msgtype: 'm.text', body: 'clear' } },
      });
      return persistRoomChunkWithPreferLive({
        mx: f.mx,
        sessionId: engine.sessionId,
        room: f.room,
        chunk: [decrypted.event, raw('$target')],
        mappedEvents: [decrypted, new MatrixEvent(raw('$target'))],
      });
    })(),
    persist([key('$key-new'), relation('$rel-new', '$absent')]),
  ]);
  const progress = await readRoomOfflineProgress(engine.sessionId, roomId);
  expect(progress.undecryptedEventIds?.sort()).toEqual(['$key-keep', '$key-new']);
  expect(Object.keys(progress.unresolvedRelations ?? {}).sort()).toEqual(['$rel-keep', '$rel-new']);
});

it('explicit download wakes deferred gaps and keeps pages running away from focus', async () => {
  let release!: (response: object) => void;
  const f = fixture(
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue({ chunk: [] })
  );
  const engine = f.make(true);
  await updateRoomOfflineProgress(engine.sessionId, roomId, { opened: true, exhausted: true });
  f.mx.emit(RoomEvent.TimelineReset, f.room, f.timelineSet as never, false);
  await vi.waitFor(async () =>
    expect(await loadRoomTailDiscontinuity(engine.sessionId, roomId)).toBeDefined()
  );
  await vi.waitFor(() => expect(engine.scheduler.pendingJobs()).toHaveLength(0));
  expect(f.request).not.toHaveBeenCalled();
  engine.offline.download(roomId);
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
  await vi.waitFor(() =>
    expect(engine.offline.getSnapshot(roomId)).toMatchObject({
      historyExhausted: true,
      downloading: true,
    })
  );
  release({ chunk: [raw('$gap')], end: 'next-gap' });
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(engine.offline.getSnapshot(roomId)).toMatchObject({
      historyComplete: true,
      downloading: false,
    })
  );
  expect(await loadRoomTailDiscontinuity(engine.sessionId, roomId)).toBeUndefined();
});

it.each([true, false])(
  'explicit download includes retained prefix before retry cursor (essential: %s)',
  async (essential) => {
    const f = fixture();
    f.setNetwork({ connected: true, unmetered: false });
    const engine = f.make();
    const prefix = {
      ...raw('$a-prefix'),
      content: essential
        ? {
            msgtype: 'm.text',
            body: 'preview',
            url: 'mxc://test/prefix',
            'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
          }
        : { msgtype: 'm.file', body: 'file', url: 'mxc://test/prefix' },
    };
    await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [prefix, raw('$z-plain')]);
    await saveAttachmentOwner(engine.sessionId, roomId, '$a-prefix', 1, [
      { mxcUri: 'mxc://test/prefix', essential },
    ]);
    await updateRoomOfflineProgress(engine.sessionId, roomId, {
      opened: true,
      exhausted: true,
      retryAfterEventId: '$a-prefix',
    });
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'full body' }))
    );
    vi.stubGlobal('fetch', fetch);
    engine.offline.download(roomId, { includeAllMedia: !essential });
    await vi.waitFor(() =>
      expect(engine.offline.getSnapshot(roomId)).toMatchObject({
        status: 'ready',
        downloading: false,
        saved: 1,
        missing: 0,
      })
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(f.request).not.toHaveBeenCalled();
    expect((await readRoomOfflineProgress(engine.sessionId, roomId)).retryAfterEventId).toBeNull();
  }
);

it('promotion of a running automatic scan completes a full include-all pass after navigation', async () => {
  const f = fixture();
  f.setNetwork({ connected: true, unmetered: false });
  const engine = f.make();
  await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [
    { ...raw('$a-prefix'), content: { msgtype: 'm.file', body: 'file', url: 'mxc://test/prefix' } },
    {
      ...raw('$z-held'),
      content: {
        msgtype: 'm.text',
        body: 'preview',
        url: 'mxc://test/held',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
    },
  ]);
  await saveAttachmentOwner(engine.sessionId, roomId, '$a-prefix', 1, [
    { mxcUri: 'mxc://test/prefix', essential: false },
  ]);
  await updateRoomOfflineProgress(engine.sessionId, roomId, {
    opened: true,
    exhausted: true,
    retryAfterEventId: '$a-prefix',
  });
  await saveAttachmentOwner(engine.sessionId, roomId, '$z-held', 1, [
    { mxcUri: 'mxc://test/held', essential: true },
  ]);
  let release!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    )
    .mockImplementation(async () => new Response('optional file'));
  vi.stubGlobal('fetch', fetch);
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  engine.offline.download(roomId, { includeAllMedia: true });
  engine.clearRoomFocus(roomId);
  release(new Response(JSON.stringify({ msgtype: 'm.text', body: 'full held body' })));
  await vi.waitFor(() =>
    expect(engine.offline.getSnapshot(roomId)).toMatchObject({
      status: 'ready',
      downloading: false,
      saved: 2,
      missing: 0,
    })
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(f.request).not.toHaveBeenCalled();
});

it('does not download retained bodies while protected storage already exceeds budget', async () => {
  const f = fixture();
  const engine = f.make();
  const body = {
    ...raw('$body'),
    content: {
      msgtype: 'm.text',
      body: 'preview',
      url: 'mxc://test/body',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  };
  await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [body]);
  await saveAttachmentOwner(engine.sessionId, roomId, '$body', 1, [
    { mxcUri: 'mxc://test/body', essential: true },
  ]);
  __setCacheStoreByteBudgetForTests(1);
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'full body' }))
  );
  vi.stubGlobal('fetch', fetch);
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('space'));
  expect(f.request).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('pauses between retained body downloads when essential bytes cross the budget', async () => {
  const f = fixture();
  const engine = f.make();
  const bodies = ['$first', '$second'].map((id) => ({
    ...raw(id),
    content: {
      msgtype: 'm.text',
      body: 'preview',
      url: 'mxc://test/' + id,
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  }));
  await persistRoomChunkWithPreferLive({
    mx: f.mx,
    sessionId: engine.sessionId,
    room: f.room,
    chunk: bodies,
  });
  await Promise.all(
    bodies.map((body) =>
      saveAttachmentOwner(engine.sessionId, roomId, body.event_id, 1, [
        { mxcUri: body.content.url, essential: true },
      ])
    )
  );
  __setCacheStoreByteBudgetForTests(2000);
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'x'.repeat(3000) }))
  );
  vi.stubGlobal('fetch', fetch);
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('space'));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(f.request).not.toHaveBeenCalled();
});

it('preserves the storage pause after a live observed body is refused', async () => {
  const f = fixture();
  const engine = f.make();
  await updateRoomOfflineProgress(engine.sessionId, roomId, { opened: true, exhausted: true });
  // Recently opened, so eviction keeps the room and the pressure stays.
  await noteRoomOpened(engine.sessionId, roomId);
  __setCacheStoreByteBudgetForTests(1);
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'full body' }))
  );
  vi.stubGlobal('fetch', fetch);
  const event = new MatrixEvent({
    ...raw('$live-body'),
    content: {
      msgtype: 'm.text',
      body: 'preview',
      url: 'mxc://test/live-body',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  });
  const { createRoomOfflineController } = await import('../roomOffline');
  const control = createRoomOfflineController({
    mx: f.mx,
    sessionId: engine.sessionId,
    scheduler: engine.scheduler,
    connection: {
      getSnapshot: () => ({ connected: true, unmetered: true }),
      subscribe: () => () => {},
    },
    getPrefetchConfig: () => ({ scope: 'all-rooms' }),
    onChanged: () => {},
  });
  control.start();
  const unsubscribe = control.controller.subscribe(roomId, () => {});
  try {
    await persistRoomChunkWithPreferLive({
      mx: f.mx,
      sessionId: engine.sessionId,
      room: f.room,
      chunk: [event.event],
      mappedEvents: [event],
    });
    await control.observe([event], roomId);
    expect(control.controller.getSnapshot(roomId)).toMatchObject({
      status: 'space',
      missingEssential: 1,
    });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    control.stop();
  }
});

it('second idle focus does not rewrite complete retained history or attachment bytes', async () => {
  const body = {
    ...raw('$saved-body'),
    content: {
      msgtype: 'm.text',
      body: 'preview',
      url: 'mxc://test/saved-body',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  };
  const f = fixture();
  const timeline = f.room.getLiveTimeline();
  f.room.getLiveTimeline = () =>
    ({ ...timeline, getEvents: () => [new MatrixEvent(body)] } as never);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'saved full body' })))
  );
  const engine = f.make();
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() =>
    expect(engine.offline.getSnapshot(roomId)).toMatchObject({ status: 'ready', saved: 1 })
  );
  const writes: string[] = [];
  const original = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function countWrites(value, key) {
      writes.push(this.name);
      return original.call(this, value, key);
    });
  try {
    engine.clearRoomFocus(roomId);
    engine.noteRoomFocused(roomId);
    await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('ready'));
    expect(writes.filter((name) => ['events', 'attachments'].includes(name))).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

it('streamed replacements persist and hydrate only the latest compacted body', async () => {
  const f = fixture();
  const engine = f.make();
  engine.offline.subscribe(roomId, () => {});
  const root = new MatrixEvent(raw('$stream'));
  f.room.findEventById = (id) => (id === '$stream' ? root : undefined);
  await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [root.event]);
  engine.noteRoomFocused(roomId);
  await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('ready'));
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'latest full body' }))
  );
  vi.stubGlobal('fetch', fetch);
  const writes: string[] = [];
  const original = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function countWrites(value, key) {
      writes.push(this.name);
      return original.call(this, value, key);
    });
  const scans: string[] = [];
  const originalGetAll = IDBIndex.prototype.getAll;
  const scan = vi
    .spyOn(IDBIndex.prototype, 'getAll')
    .mockImplementation(function countReads(...args) {
      if (this.objectStore.name === 'attachment_references') scans.push(this.name);
      return originalGetAll.apply(this, args);
    });
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (let i = 1; i <= 20; i += 1) {
      const content = {
        msgtype: 'm.text',
        body: 'preview ' + i,
        url: 'mxc://test/revision-' + i,
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      };
      const edit = new MatrixEvent({
        ...raw('$edit-' + i),
        origin_server_ts: i + 1,
        content: {
          ...content,
          'm.new_content': content,
          'm.relates_to': { rel_type: 'm.replace', event_id: '$stream' },
        },
      });
      root.makeReplaced(edit);
      f.mx.emit(RoomEvent.Timeline, edit, f.room, false, false, { liveEvent: true } as never);
    }
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await vi.waitFor(async () => {
      const { getCachedAttachmentMetadata } = await import('../../threads/cacheStore');
      expect(
        (await getCachedAttachmentMetadata(engine.sessionId, 'mxc://test/revision-20'))
          ?.references[0]?.status
      ).toBe('cached');
    });
    await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).saved).toBe(1));
    expect(scans.filter((name) => name === 'by_room')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(writes.filter((name) => name === 'events')).toHaveLength(1);
    const cached = await loadCachedRoomEvent(engine.sessionId, roomId, '$stream');
    expect(JSON.stringify(cached)).toContain('revision-20');
  } finally {
    vi.useRealTimers();
    spy.mockRestore();
    scan.mockRestore();
  }
});

it.each(['attachment', 'inline'] as const)(
  'keeps the latest streamed %s revision when an older body download finishes last',
  async (latestKind) => {
    const { getCachedAttachmentMetadata, loadCachedAttachment, readRoomAttachmentStorage } =
      await import('../../threads/cacheStore');
    const f = fixture();
    const engine = f.make();
    const root = new MatrixEvent(raw('$overlapping-stream'));
    f.room.findEventById = (id) => (id === root.getId() ? root : undefined);
    f.mx.mxcUrlToHttp = (uri) => `https://test/${uri.split('/').pop()}`;
    await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [root.event]);
    engine.noteRoomFocused(roomId);
    await vi.waitFor(() => expect(engine.offline.getSnapshot(roomId).status).toBe('ready'));
    let releaseOld!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/overlap-1')
          ? new Promise<Response>((resolve) => {
              releaseOld = resolve;
            })
          : Promise.resolve(
              new Response(JSON.stringify({ msgtype: 'm.text', body: `full ${url}` }))
            )
      )
    );
    const emitEdit = (revision: number, inline = false) => {
      const content = {
        msgtype: 'm.text',
        body: `revision ${revision}`,
        ...(!inline && {
          url: `mxc://test/overlap-${revision}`,
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        }),
      };
      const edit = new MatrixEvent({
        ...raw(`$overlap-edit-${revision}`),
        origin_server_ts: revision + 1,
        content: {
          ...content,
          'm.new_content': content,
          'm.relates_to': { rel_type: 'm.replace', event_id: root.getId()! },
        },
      });
      root.makeReplaced(edit);
      f.mx.emit(RoomEvent.Timeline, edit, f.room, false, false, { liveEvent: true } as never);
    };
    try {
      emitEdit(1);
      await vi.waitFor(() => expect(releaseOld).toBeDefined(), { timeout: 3000 });
      for (const revision of [2, 3]) {
        emitEdit(revision, revision === 3 && latestKind === 'inline');
        await vi.waitFor(
          async () => {
            const cached = await loadCachedRoomEvent(engine.sessionId, roomId, root.getId()!);
            expect(cached?.unsigned?.['m.relations']?.['m.replace']?.event_id).toBe(
              `$overlap-edit-${revision}`
            );
          },
          { timeout: 3000 }
        );
      }
      releaseOld(new Response(JSON.stringify({ msgtype: 'm.text', body: 'old body' })));
      await vi.waitFor(() => expect(engine.scheduler.pendingJobs()).toHaveLength(0));
      await vi.waitFor(async () => {
        if (latestKind === 'attachment') {
          const latest = await getCachedAttachmentMetadata(
            engine.sessionId,
            'mxc://test/overlap-3'
          );
          expect(latest?.references).toEqual([
            expect.objectContaining({
              eventId: '$overlapping-stream',
              revisionId: '$overlap-edit-3',
              status: 'cached',
            }),
          ]);
          const saved = await loadCachedAttachment(engine.sessionId, 'mxc://test/overlap-3');
          expect(new TextDecoder().decode(saved!.bytes)).toContain('full https://test/overlap-3');
        } else {
          expect(await readRoomAttachmentStorage(engine.sessionId, roomId)).toMatchObject({
            bytes: 0,
            saved: 0,
            missingEssential: 0,
          });
        }
        expect(
          await loadCachedAttachment(engine.sessionId, 'mxc://test/overlap-1')
        ).toBeUndefined();
        expect(
          await loadCachedAttachment(engine.sessionId, 'mxc://test/overlap-2')
        ).toBeUndefined();
      });
    } finally {
      releaseOld?.(new Response(JSON.stringify({ msgtype: 'm.text', body: 'old body' })));
    }
  }
);

it('superseding a queued live owner still downloads the other owners in its batch', async () => {
  const { loadCachedAttachment } = await import('../../threads/cacheStore');
  const f = fixture();
  const sessionId = createSessionId(f.mx.getHomeserverUrl(), f.mx.getSafeUserId());
  const scheduler = createBackfillScheduler({ maxConcurrent: 1 });
  const offline = createRoomOfflineController({
    mx: f.mx,
    sessionId,
    scheduler,
    connection: {
      getSnapshot: () => ({ connected: true, unmetered: true }),
      subscribe: () => () => undefined,
    },
    getPrefetchConfig: () => resolvePrefetchConfig({ prefetchScope: 'all-rooms' }),
    onChanged: () => undefined,
  });
  await updateRoomOfflineProgress(sessionId, roomId, () => ({ opened: true }));
  offline.start();
  let release!: () => void;
  const busy = scheduler.enqueue({
    roomId,
    kind: 'reconcile',
    priority: 0,
    execute: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'saved body' })))
  );
  const events = ['$first', '$other'].map(
    (id) =>
      new MatrixEvent({
        ...raw(id),
        content: {
          msgtype: 'm.text',
          body: 'preview',
          url: `mxc://test/${id}`,
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        },
      })
  );
  await persistRoomChunkWithPreferLive({
    mx: f.mx,
    room: f.room,
    sessionId,
    chunk: events.map((event) => event.event),
    mappedEvents: events,
  });
  try {
    const older = offline.observe(events, roomId);
    await vi.waitFor(() =>
      expect(scheduler.pendingJobs().some((job) => job.threadId === '$first')).toBe(true)
    );
    const replacement = offline.observe([events[0]], roomId);
    await vi.waitFor(() =>
      expect(scheduler.pendingJobs().some((job) => job.threadId === '$other')).toBe(true)
    );
    release();
    await Promise.all([busy, older, replacement]);
    expect(await loadCachedAttachment(sessionId, 'mxc://test/$other')).toBeDefined();
  } finally {
    release?.();
    offline.stop();
    scheduler.abortAll();
  }
});

it('compacted redaction lookup leaves live unsigned and later SDK re-emission untouched', async () => {
  const { createClient, Room } = await import('matrix-js-sdk');
  const mx = createClient({ baseUrl: 'https://test', userId: '@alice:test' });
  const room = new Room(roomId, mx, '@alice:test');
  const live = new MatrixEvent({ ...raw('$a-live'), unsigned: { age: 7 } });
  room.findEventById = (id) => (id === '$a-live' ? live : undefined);
  mx.getRoom = () => room;
  const sessionId = 'mapper-regression';
  await saveRoomEventsToCacheCommitted(sessionId, roomId, [
    { ...raw('$a-live'), unsigned: { age: 999 } },
  ]);
  const mapper = mx.getEventMapper({ decrypt: false });
  mx.getEventMapper = () => mapper;
  await persistRoomChunkWithPreferLive({
    mx,
    sessionId,
    room,
    chunk: [
      { ...raw('$redaction'), type: 'm.room.redaction', redacts: '$absent-edit', content: {} },
    ],
  });
  expect(live.getUnsigned().age).toBe(7);
  const seen = vi.fn();
  mx.on(MatrixEventEvent.Decrypted, seen);
  const later = mapper({
    ...raw('$later'),
    type: 'm.room.encrypted',
    content: { ciphertext: 'later' },
  });
  later.emit(MatrixEventEvent.Decrypted, later);
  expect(seen).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'ordinary known root redaction skips retained snapshots (saved=%s)',
  async (saved) => {
    const f = fixture();
    const engine = f.make();
    const root = new MatrixEvent(raw('$root'));
    f.room.findEventById = (id) => (id === '$root' ? root : undefined);
    if (saved) await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [root.event]);
    const scans: string[] = [];
    const original = IDBIndex.prototype.openCursor;
    const spy = vi
      .spyOn(IDBIndex.prototype, 'openCursor')
      .mockImplementation(function countReads(...args) {
        scans.push(this.name);
        return original.apply(this, args);
      });
    try {
      await persistRoomChunkWithPreferLive({
        mx: f.mx,
        sessionId: engine.sessionId,
        room: f.room,
        chunk: [
          { ...raw('$redact-root'), type: 'm.room.redaction', redacts: '$root', content: {} },
        ],
      });
      expect(scans.filter((name) => name === 'by_room_event')).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  }
);

it('keeps captured thread scope when a compacted target loses its live relation', async () => {
  const f = fixture();
  const engine = f.make();
  const target = new MatrixEvent({
    ...raw('$reply'),
    content: {
      msgtype: 'm.text',
      body: 'reply',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
    },
  });
  const edit = new MatrixEvent({
    ...raw('$edit-reply'),
    origin_server_ts: 2,
    content: {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
      'm.new_content': { msgtype: 'm.text', body: 'changed' },
    },
  });
  f.room.findEventById = (id) => (id === '$reply' ? target : undefined);
  await persistRoomChunkWithPreferLive({
    mx: f.mx,
    sessionId: engine.sessionId,
    room: f.room,
    chunk: [
      {
        ...raw('$unresolved'),
        type: 'm.reaction',
        content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$unknown', key: 'x' } },
      },
    ],
  });
  await updateRoomOfflineProgress(engine.sessionId, roomId, { opened: true });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    f.mx.emit(RoomEvent.Timeline, edit, f.room, false, false, { liveEvent: true } as never);
    target.event.content = {};
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await vi.waitFor(async () =>
      expect(
        (
          await loadLatestCachedThreadEvents(engine.sessionId, roomId, '$thread', 20)
        ).events.map((event) => event.event_id)
      ).toEqual(['$reply'])
    );
  } finally {
    vi.useRealTimers();
  }
});

it.each([false, true])(
  'SDK-pruned ordinary roots skip retained snapshots (encrypted=%s)',
  async (encrypted) => {
    const f = fixture();
    const engine = f.make();
    const root = new MatrixEvent(
      encrypted
        ? {
            ...raw('$pruned-root'),
            type: 'm.room.encrypted',
            content: { ciphertext: 'saved ciphertext' },
          }
        : raw('$pruned-root')
    );
    if (encrypted)
      root.setClearData({
        clearEvent: {
          type: 'm.room.message',
          content: { msgtype: 'm.text', body: 'decrypted root' },
        },
      });
    f.room.findEventById = (id) => (id === root.getId() ? root : undefined);
    await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [root.event]);
    const redaction = new MatrixEvent({
      ...raw('$prune-root'),
      type: 'm.room.redaction',
      redacts: root.getId(),
      content: {},
    });
    root.makeRedacted(redaction, f.room);
    expect(root.isRedacted()).toBe(true);
    expect(root.getContent()).toEqual({});
    const scans: string[] = [];
    const original = IDBIndex.prototype.openCursor;
    const spy = vi
      .spyOn(IDBIndex.prototype, 'openCursor')
      .mockImplementation(function countScans(...args) {
        scans.push(this.name);
        return original.apply(this, args);
      });
    try {
      await persistRoomChunkWithPreferLive({
        mx: f.mx,
        sessionId: engine.sessionId,
        room: f.room,
        chunk: [redaction.event],
        mappedEvents: [redaction],
      });
      expect(scans.filter((name) => name === 'by_room_event')).toEqual([]);
      expect(
        (await loadCachedRoomEvent(engine.sessionId, roomId, '$pruned-root'))?.unsigned
          ?.redacted_because?.event_id
      ).toBe('$prune-root');
    } finally {
      spy.mockRestore();
    }
  }
);

it('SDK-pruned encrypted standalone edits still recover their compacted owner', async () => {
  const f = fixture();
  const engine = f.make();
  const original = new MatrixEvent({
    ...raw('$original-encrypted-edit'),
    content: {
      msgtype: 'm.text',
      body: 'original',
      url: 'mxc://test/original-edit-body',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  });
  const relation = { rel_type: 'm.replace', event_id: original.getId()! };
  const edit = new MatrixEvent({
    ...raw('$encrypted-edit'),
    origin_server_ts: 2,
    type: 'm.room.encrypted',
    content: { ciphertext: 'edit ciphertext', 'm.relates_to': relation },
  });
  edit.setClearData({
    clearEvent: {
      type: 'm.room.message',
      content: {
        'm.relates_to': relation,
        'm.new_content': { ...original.getContent(), url: 'mxc://test/latest-edit-body' },
      },
    },
  });
  f.room.findEventById = (id) =>
    id === original.getId() ? original : id === edit.getId() ? edit : undefined;
  await persistRoomChunkWithPreferLive({
    mx: f.mx,
    sessionId: engine.sessionId,
    room: f.room,
    chunk: [original.event, edit.event],
    mappedEvents: [original, edit],
  });
  // A standalone ciphertext copy may coexist with the compacted owner's embedded edit.
  await saveRoomEventsToCacheCommitted(engine.sessionId, roomId, [edit.event]);
  await saveAttachmentOwner(
    engine.sessionId,
    roomId,
    original.getId()!,
    2,
    [{ mxcUri: 'mxc://test/latest-edit-body', essential: true }],
    undefined,
    { revisionId: edit.getId() }
  );
  const redaction = new MatrixEvent({
    ...raw('$redact-encrypted-edit'),
    type: 'm.room.redaction',
    redacts: edit.getId(),
    content: {},
  });
  edit.makeRedacted(redaction, f.room);
  expect(edit.getRelation()).toBeNull();
  await persistRoomChunkWithPreferLive({
    mx: f.mx,
    sessionId: engine.sessionId,
    room: f.room,
    chunk: [redaction.event],
    mappedEvents: [redaction],
  });
  expect(
    await saveAttachmentOwner(engine.sessionId, roomId, original.getId()!, 1, [
      { mxcUri: 'mxc://test/original-edit-body', essential: true },
    ])
  ).toBe(true);
  expect(
    await saveAttachmentOwner(
      engine.sessionId,
      roomId,
      original.getId()!,
      2,
      [{ mxcUri: 'mxc://test/latest-edit-body', essential: true }],
      undefined,
      { revisionId: edit.getId() }
    )
  ).toBe(true);
  expect(
    (await loadCachedRoomEvent(engine.sessionId, roomId, original.getId()!))?.unsigned?.[
      'm.relations'
    ]?.['m.replace']
  ).toBeUndefined();
});
