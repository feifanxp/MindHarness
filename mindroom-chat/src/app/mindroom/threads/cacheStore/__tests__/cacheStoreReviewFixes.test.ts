/**
 * CINNY-207 P2 review fixes.
 *
 * Covers the four review findings that touch runtime behavior:
 *
 *   (a) open-failure health gate + no unhandled rejection: room, thread,
 *       and summary saves must report to the health gate when the open
 *       rejects (they run under `void save(...)` in callers).
 *   (b) memo eviction after a rejected open: the next open attempt
 *       succeeds after the failure clears.
 *   (c) duplicate-id delete: ledger is decremented once per real record,
 *       not once per duplicate id.
 *   (d) eviction with multi-room meta: only the evicted room's meta
 *       rows are removed (exercises the new IDBKeyRange path).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CACHE_STORE_DB_VERSION,
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  buildMetaKey,
  estimateRawEventBytes,
  type CachedMetaRecord,
} from '../cacheStoreSchema';

vi.mock('../cacheStoreLegacyWipe', () => ({
  LEGACY_WIPE_MARKER_META_KEY: '__cacheStore|migration',
  performLegacyDbWipe: vi.fn(async () => undefined),
  shouldAttemptLegacySingletonWipe: () => false,
}));

const SESSION_ID = 'p2-review-session';
const ROOM_ID_A = '!room-a:example.org';
const ROOM_ID_B = '!room-b:example.org';
const THREAD_ID = '$thread-root';

const makeRawEvent = (eventId: string, ts: number, bodyLen = 20) => ({
  event_id: eventId,
  origin_server_ts: ts,
  type: 'm.room.message',
  sender: '@alice:example.org',
  content: { body: 'x'.repeat(bodyLen) },
});

const openTestDb = (dbName: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, CACHE_STORE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const eventsStore = db.createObjectStore(EVENTS_STORE, { keyPath: 'cacheKey' });
      eventsStore.createIndex(EVENTS_BY_SCOPE_TS_INDEX, ['roomId', 'scope', 'ts', 'eventId'], {
        unique: false,
      });
      db.createObjectStore(META_STORE, { keyPath: 'metaKey' });
      db.createObjectStore(ROOM_LEDGER_STORE, { keyPath: 'roomId' });
      const summariesStore = db.createObjectStore(THREAD_SUMMARIES_STORE, {
        keyPath: 'cacheKey',
      });
      summariesStore.createIndex(THREAD_SUMMARIES_BY_ROOM_INDEX, 'roomId', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readLedger = async (
  db: IDBDatabase,
  roomId: string
): Promise<{ approxBytes: number; eventCount: number; lastActivityTs: number } | undefined> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(ROOM_LEDGER_STORE, 'readonly');
    const store = txn.objectStore(ROOM_LEDGER_STORE);
    const req = store.get(roomId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    txn.onerror = () => reject(txn.error);
  });

const putMetaRow = (db: IDBDatabase, record: CachedMetaRecord): Promise<void> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(META_STORE, 'readwrite');
    txn.objectStore(META_STORE).put(record);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });

const readAllMetaKeys = (db: IDBDatabase): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(META_STORE, 'readonly');
    const store = txn.objectStore(META_STORE);
    const keys: string[] = [];
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      keys.push(String(c.key));
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
    txn.oncomplete = () => resolve(keys);
    txn.onerror = () => reject(txn.error);
  });

describe('CINNY-207 P2 review: open-failure health gate', () => {
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const health = await import('../../cacheHealth');
    health.resetCacheHealthForTesting();
  });

  afterEach(async () => {
    const health = await import('../../cacheHealth');
    health.resetCacheHealthForTesting();
    vi.restoreAllMocks();
  });

  /**
   * Break `openCacheStore` by swapping the IDBFactory for one whose
   * open() always rejects. `resetCacheStoreForTesting()` clears the
   * memo so the very next open takes the broken factory path.
   */
  const breakOpen = async (): Promise<() => void> => {
    const cacheStore = await import('../index');
    cacheStore.resetCacheStoreForTesting();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalFactory = (globalThis as any).indexedDB;
    const brokenFactory = {
      open: (): IDBOpenDBRequest => {
        // Minimal EventTarget-like shim: schedule an error microtask.
        const req: Partial<IDBOpenDBRequest> & {
          error: DOMException | null;
          onerror: ((this: IDBRequest, ev: Event) => unknown) | null;
          onsuccess: ((this: IDBRequest, ev: Event) => unknown) | null;
          onupgradeneeded: unknown;
        } = {
          error: new DOMException('synthetic open failure', 'InvalidStateError'),
          onerror: null,
          onsuccess: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => {
          req.onerror?.call(req as unknown as IDBRequest, new Event('error'));
        });
        return req as IDBOpenDBRequest;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = brokenFactory;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).indexedDB = originalFactory;
    };
  };

  it('room save reports to health and resolves (no unhandled rejection) when open fails', async () => {
    const cacheStore = await import('../index');
    const health = await import('../../cacheHealth');
    const restore = await breakOpen();

    const reportSpy = vi.spyOn(health, 'reportCacheWriteError');

    // Must not throw / reject.
    await expect(
      cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID_A, [makeRawEvent('$a', 100)])
    ).resolves.toBeUndefined();

    expect(reportSpy).toHaveBeenCalledWith('roomEventCache.save', expect.anything());
    restore();
  });

  it('thread save reports to health and resolves when open fails', async () => {
    const cacheStore = await import('../index');
    const health = await import('../../cacheHealth');
    const restore = await breakOpen();

    const reportSpy = vi.spyOn(health, 'reportCacheWriteError');

    await expect(
      cacheStore.saveThreadEventsToCache(
        SESSION_ID,
        ROOM_ID_A,
        THREAD_ID,
        [makeRawEvent('$reply', 200)],
        makeRawEvent(THREAD_ID, 100)
      )
    ).resolves.toBeUndefined();

    expect(reportSpy).toHaveBeenCalledWith('threadEventCache.save', expect.anything());
    restore();
  });

  it('summary save reports to health and resolves when open fails', async () => {
    const cacheStore = await import('../index');
    const health = await import('../../cacheHealth');
    const restore = await breakOpen();

    const reportSpy = vi.spyOn(health, 'reportCacheWriteError');

    await expect(
      cacheStore.saveCachedThreadSummary(SESSION_ID, ROOM_ID_A, THREAD_ID, {
        summaryText: 'summary',
      })
    ).resolves.toBeUndefined();

    expect(reportSpy).toHaveBeenCalledWith('threadSummaryCache.save', expect.anything());
    restore();
  });

  it('a quota-shaped open failure degrades health to read-only', async () => {
    const cacheStore = await import('../index');
    const health = await import('../../cacheHealth');

    // Custom broken factory that surfaces a QuotaExceededError.
    cacheStore.resetCacheStoreForTesting();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalFactory = (globalThis as any).indexedDB;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = {
      open: (): IDBOpenDBRequest => {
        const req: Partial<IDBOpenDBRequest> & {
          error: DOMException | null;
          onerror: ((this: IDBRequest, ev: Event) => unknown) | null;
          onsuccess: ((this: IDBRequest, ev: Event) => unknown) | null;
        } = {
          error: new DOMException('quota', 'QuotaExceededError'),
          onerror: null,
          onsuccess: null,
        };
        queueMicrotask(() => {
          req.onerror?.call(req as unknown as IDBRequest, new Event('error'));
        });
        return req as IDBOpenDBRequest;
      },
    };

    expect(health.isCacheWritable()).toBe(true);
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID_A, [makeRawEvent('$a', 1)]);
    expect(health.isCacheWritable()).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = originalFactory;
  });
});

describe('CINNY-207 P2 review: cacheStoreDb memo eviction on rejected open', () => {
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const health = await import('../../cacheHealth');
    health.resetCacheHealthForTesting();
  });

  afterEach(async () => {
    const health = await import('../../cacheHealth');
    health.resetCacheHealthForTesting();
    vi.restoreAllMocks();
  });

  it('a rejected open does NOT poison the memo — the next call retries with a fresh factory', async () => {
    const cacheStore = await import('../index');
    cacheStore.resetCacheStoreForTesting();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalFactory = (globalThis as any).indexedDB;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = {
      open: (): IDBOpenDBRequest => {
        const req: Partial<IDBOpenDBRequest> & {
          error: DOMException | null;
          onerror: ((this: IDBRequest, ev: Event) => unknown) | null;
          onsuccess: ((this: IDBRequest, ev: Event) => unknown) | null;
        } = {
          error: new DOMException('synthetic', 'InvalidStateError'),
          onerror: null,
          onsuccess: null,
        };
        queueMicrotask(() => {
          req.onerror?.call(req as unknown as IDBRequest, new Event('error'));
        });
        return req as IDBOpenDBRequest;
      },
    };

    // First attempt rejects.
    await expect(cacheStore.openCacheStore(SESSION_ID)).rejects.toBeDefined();

    // Restore a working factory. If the rejected promise had stuck in
    // the memo, this second open would return the SAME rejected
    // promise; instead it retries and succeeds.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = originalFactory;

    // Wait a microtask for the catch handler that evicts the memo to
    // run before we re-open.
    await Promise.resolve();

    const db = await cacheStore.openCacheStore(SESSION_ID);
    expect(db).toBeDefined();
  });
});

describe('CINNY-207 P2 review: duplicate eventIds do not underflow the ledger', () => {
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    vi.resetModules();
    const health = await import('../../cacheHealth');
    health.resetCacheHealthForTesting();
  });

  afterEach(async () => {
    const health = await import('../../cacheHealth');
    health.resetCacheHealthForTesting();
    vi.restoreAllMocks();
  });

  it('room delete with duplicate ids decrements the ledger exactly once per real record', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    const events = [
      makeRawEvent('$a', 100, 10),
      makeRawEvent('$b', 200, 20),
      makeRawEvent('$c', 300, 30),
    ];
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID_A, events);

    // Delete $b twice + $c once. Without dedupe, $b would decrement
    // twice (double the bytes, count underflow); with dedupe, exact.
    await cacheStore.deleteRoomEventsFromCache(SESSION_ID, ROOM_ID_A, ['$b', '$b', '$c']);

    const db = await openTestDb(dbName);
    const ledger = await readLedger(db, ROOM_ID_A);
    // Only $a survives.
    expect(ledger?.eventCount).toBe(1);
    expect(ledger?.approxBytes).toBe(estimateRawEventBytes(events[0]));
  });

  it('thread delete with duplicate ids decrements the ledger exactly once per real record', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    const rootEvent = makeRawEvent(THREAD_ID, 50, 5);
    const replyA = makeRawEvent('$rA', 100, 10);
    const replyB = makeRawEvent('$rB', 200, 20);
    await cacheStore.saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID_A,
      THREAD_ID,
      [rootEvent, replyA, replyB],
      rootEvent
    );

    await expect(
      cacheStore.deleteThreadEventsFromCache(SESSION_ID, ROOM_ID_A, THREAD_ID, [
        '$rA',
        '$rA',
        '$rA',
      ])
    ).resolves.toBeUndefined();

    const db = await openTestDb(dbName);
    const ledger = await readLedger(db, ROOM_ID_A);
    expect(ledger?.eventCount).toBe(1);
    expect(ledger?.approxBytes).toBe(estimateRawEventBytes(replyB));
  });
});

describe('CINNY-207 P2 review: eviction meta scan uses key-range', () => {
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    vi.resetModules();
    const health = await import('../../cacheHealth');
    health.resetCacheHealthForTesting();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("explicitly clears only the target room's meta rows (leaves the other room untouched)", async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    // Seed events into both rooms so ledger rows populate for both.
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID_A, [makeRawEvent('$a', 100, 300)]);
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID_B, [makeRawEvent('$b', 200, 300)]);

    // Manually add multiple meta rows for both rooms — mimicking a
    // room with several thread scopes.
    cacheStore.resetCacheStoreForTesting();
    const db = await openTestDb(dbName);
    await putMetaRow(db, {
      metaKey: buildMetaKey(ROOM_ID_A, ''),
      roomId: ROOM_ID_A,
      scope: '',
      updatedAt: 1,
    });
    await putMetaRow(db, {
      metaKey: buildMetaKey(ROOM_ID_A, '$thread-1'),
      roomId: ROOM_ID_A,
      scope: '$thread-1',
      updatedAt: 1,
    });
    await putMetaRow(db, {
      metaKey: buildMetaKey(ROOM_ID_A, '$thread-2'),
      roomId: ROOM_ID_A,
      scope: '$thread-2',
      updatedAt: 1,
    });
    await putMetaRow(db, {
      metaKey: buildMetaKey(ROOM_ID_B, ''),
      roomId: ROOM_ID_B,
      scope: '',
      updatedAt: 1,
    });
    await putMetaRow(db, {
      metaKey: buildMetaKey(ROOM_ID_B, '$thread-b1'),
      roomId: ROOM_ID_B,
      scope: '$thread-b1',
      updatedAt: 1,
    });
    db.close();

    await cacheStore.clearRoomCachedContent(SESSION_ID, ROOM_ID_A);

    const db3 = await openTestDb(dbName);
    const remainingKeys = await readAllMetaKeys(db3);
    db3.close();

    // Every meta key that was on room A is gone.
    expect(remainingKeys).not.toContain(buildMetaKey(ROOM_ID_A, ''));
    expect(remainingKeys).not.toContain(buildMetaKey(ROOM_ID_A, '$thread-1'));
    expect(remainingKeys).not.toContain(buildMetaKey(ROOM_ID_A, '$thread-2'));
    // Room B's meta rows survive untouched.
    expect(remainingKeys).toContain(buildMetaKey(ROOM_ID_B, ''));
    expect(remainingKeys).toContain(buildMetaKey(ROOM_ID_B, '$thread-b1'));
  });
});
