import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { isDeepTraceRecording, recordDeepTraceEvent } from '../../../diagnostics/deepTrace';
import { deleteCacheStoreDb, openCacheStore } from '../cacheStoreDb';
import { CACHE_STALL_MS } from '../cacheStoreTrace';

vi.mock('../../../diagnostics/deepTrace', () => ({
  isDeepTraceRecording: vi.fn(() => true),
  recordDeepTraceEvent: vi.fn(),
}));

const sessionId = 'cache-trace';
const otherSessionId = 'cache-trace-other';
const record = vi.mocked(recordDeepTraceEvent);
const settled = (transaction: IDBTransaction) =>
  new Promise<void>((resolve) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
  });

afterEach(async () => {
  vi.useRealTimers();
  vi.mocked(isDeepTraceRecording).mockReturnValue(true);
  await deleteCacheStoreDb(sessionId);
  await deleteCacheStoreDb(otherSessionId);
  record.mockClear();
});

it('records cache transactions still open after the stall threshold and how they end', async () => {
  const db = (await openCacheStore(sessionId))!;
  // fake-indexeddb runs requests on setImmediate, so only the stall timers are held back.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const write = db.transaction(['events', 'meta'], 'readwrite');
  const read = db.transaction('events', 'readonly');
  vi.advanceTimersByTime(CACHE_STALL_MS);

  const open = { open: 2, open_readwrite: 1, oldest_open_ms: expect.any(Number) };
  expect(record.mock.calls).toEqual([
    ['storage.cache.transaction_stalled', { readwrite: true, events: true, meta: true, ...open }],
    ['storage.cache.transaction_stalled', { readwrite: false, events: true, ...open }],
  ]);

  await Promise.all([settled(write), settled(read)]);
  const duration = { duration_ms: expect.any(Number), aborted: false };
  expect(record.mock.calls.slice(2)).toEqual([
    [
      'storage.cache.transaction_settled',
      { readwrite: true, events: true, meta: true, ...duration },
    ],
    ['storage.cache.transaction_settled', { readwrite: false, events: true, ...duration }],
  ]);
});

it('records nothing for cache transactions that finish in time', async () => {
  const db = (await openCacheStore(sessionId))!;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await settled(db.transaction('events', 'readonly'));
  vi.advanceTimersByTime(CACHE_STALL_MS);

  expect(record).not.toHaveBeenCalled();
});

it('counts only the open transactions of the stalled transaction’s account', async () => {
  const db = (await openCacheStore(sessionId))!;
  const other = (await openCacheStore(otherSessionId))!;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const read = db.transaction('events', 'readonly');
  const otherWrite = other.transaction('events', 'readwrite');
  vi.advanceTimersByTime(CACHE_STALL_MS);

  const counts = record.mock.calls.map(([, data]) => [data?.open, data?.open_readwrite]);
  expect(counts).toEqual([
    [1, 0],
    [1, 1],
  ]);
  await Promise.all([settled(read), settled(otherWrite)]);
});

it('tracks no cache transactions while the deep trace is off', async () => {
  const db = (await openCacheStore(sessionId))!;
  vi.mocked(isDeepTraceRecording).mockReturnValue(false);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const read = db.transaction('events', 'readonly');
  vi.advanceTimersByTime(CACHE_STALL_MS);
  await settled(read);

  expect(record).not.toHaveBeenCalled();
});

it('records a cache connection that the browser closes', async () => {
  const db = (await openCacheStore(sessionId))!;
  const closed = new Promise<void>((resolve) => {
    db.addEventListener('close', () => resolve(), { once: true });
  });
  forceCloseDatabase(db as unknown as Parameters<typeof forceCloseDatabase>[0]);
  await closed;

  expect(record).toHaveBeenCalledWith('storage.cache.close', { version_change: false });
});

it('records a cache open that stalls and how it ends', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const request = {} as IDBOpenDBRequest;
  const open = vi.spyOn(indexedDB, 'open').mockReturnValue(request);
  try {
    const opening = openCacheStore(sessionId).catch(() => undefined);
    vi.advanceTimersByTime(CACHE_STALL_MS);
    expect(record).toHaveBeenCalledWith('storage.cache.open_stalled');

    request.onblocked?.call(request, {} as IDBVersionChangeEvent);
    await opening;
    expect(record).toHaveBeenLastCalledWith('storage.cache.open_settled', {
      duration_ms: expect.any(Number),
      ok: false,
      blocked: true,
    });
  } finally {
    open.mockRestore();
  }
});
