/**
 * CINNY-207 P2.2 commit 1: room byte/activity ledger unit tests.
 *
 * Covers the four properties in the assignment:
 *   - put deltas exact (fresh insert + overwrite)
 *   - delete deltas exact
 *   - one-time lazy bootstrap sums existing records
 *   - meta-only writes leave the ledger untouched
 *
 * Plus the noteRoomOpened / noteThreadOpened stamping APIs.
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
  buildEventCacheKey,
  buildMetaKey,
  estimateRawEventBytes,
  type CachedEventRecord,
} from '../cacheStoreSchema';

// Bypass the D8 wipe hook in these tests — we own the DB seed and don't
// need the legacy-DB cleanup interference.
vi.mock('../cacheStoreLegacyWipe', () => ({
  performLegacyDbWipe: vi.fn(async () => undefined),
  shouldAttemptLegacySingletonWipe: () => false,
}));

const SESSION_ID = 'ledger-test-session';
const ROOM_ID = '!ledger-room:example.org';
const THREAD_ID = '$ledger-thread';

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

const seedRawEvent = (
  db: IDBDatabase,
  roomId: string,
  scope: string,
  raw: ReturnType<typeof makeRawEvent>
): Promise<void> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(EVENTS_STORE, 'readwrite');
    const store = txn.objectStore(EVENTS_STORE);
    const record: CachedEventRecord = {
      cacheKey: buildEventCacheKey(roomId, scope, raw.event_id),
      roomId,
      scope,
      eventId: raw.event_id,
      ts: raw.origin_server_ts,
      rawEvent: raw,
      approxBytes: estimateRawEventBytes(raw),
    };
    store.put(record);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });

const readLedger = async (
  db: IDBDatabase,
  roomId: string
): Promise<
  | { approxBytes: number; eventCount: number; lastActivityTs: number; federated?: boolean }
  | undefined
> =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(ROOM_LEDGER_STORE, 'readonly');
    const store = txn.objectStore(ROOM_LEDGER_STORE);
    const request = store.get(roomId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });

const readMeta = async (db: IDBDatabase, roomId: string, scope: string) =>
  new Promise((resolve, reject) => {
    const txn = db.transaction(META_STORE, 'readonly');
    const store = txn.objectStore(META_STORE);
    const request = store.get(buildMetaKey(roomId, scope));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });

describe('CINNY-207 P2.2 commit 1: cacheStore ledger', () => {
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records exact byte + count deltas for fresh room event puts', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    const events = [makeRawEvent('$a', 100, 10), makeRawEvent('$b', 200, 20)];
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID, events);

    const db = await openTestDb(dbName);
    const ledger = await readLedger(db, ROOM_ID);
    const expectedBytes = estimateRawEventBytes(events[0]) + estimateRawEventBytes(events[1]);
    expect(ledger).toBeDefined();
    expect(ledger?.approxBytes).toBe(expectedBytes);
    expect(ledger?.eventCount).toBe(2);
    expect(ledger?.lastActivityTs).toBe(200);
  });

  it('applies exact delta when a put overwrites an existing record', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    // First put: small body.
    const small = makeRawEvent('$a', 100, 10);
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID, [small]);

    // Overwrite: larger body, same event id.
    const large = makeRawEvent('$a', 150, 100);
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID, [large]);

    const db = await openTestDb(dbName);
    const ledger = await readLedger(db, ROOM_ID);
    // Bytes reflect ONLY the latest (overwrite replaces the previous record).
    expect(ledger?.approxBytes).toBe(estimateRawEventBytes(large));
    // Count still 1 (overwrite is not a fresh insert).
    expect(ledger?.eventCount).toBe(1);
    expect(ledger?.lastActivityTs).toBe(150);
  });

  it('records exact delete deltas by reading the record before deletion', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    const events = [
      makeRawEvent('$a', 100, 10),
      makeRawEvent('$b', 200, 20),
      makeRawEvent('$c', 300, 30),
    ];
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID, events);

    await cacheStore.deleteRoomEventsFromCache(SESSION_ID, ROOM_ID, ['$b']);

    const db = await openTestDb(dbName);
    const ledger = await readLedger(db, ROOM_ID);
    const expectedBytes = estimateRawEventBytes(events[0]) + estimateRawEventBytes(events[2]);
    expect(ledger?.approxBytes).toBe(expectedBytes);
    expect(ledger?.eventCount).toBe(2);
  });

  it('deleting all room events drops the ledger row', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    const events = [makeRawEvent('$a', 100), makeRawEvent('$b', 200)];
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID, events);
    await cacheStore.deleteRoomEventsFromCache(SESSION_ID, ROOM_ID, ['$a', '$b']);

    const db = await openTestDb(dbName);
    const ledger = await readLedger(db, ROOM_ID);
    expect(ledger).toBeUndefined();
  });

  it('delete of a non-existent id does not underflow the ledger', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID, [makeRawEvent('$a', 100, 10)]);
    // Delete an id that never existed alongside a real one.
    await cacheStore.deleteRoomEventsFromCache(SESSION_ID, ROOM_ID, ['$ghost', '$a']);

    const db = await openTestDb(dbName);
    const ledger = await readLedger(db, ROOM_ID);
    expect(ledger).toBeUndefined();
  });

  it('bootstrap: sums pre-existing records when no ledger row exists', async () => {
    // Seed records into the DB WITHOUT going through saveRoomEventsToCache
    // (simulates an upgraded install carrying pre-P2.2 events).
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    // Open through the app to trigger the schema-v3 create.
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID, [makeRawEvent('$seed', 50, 5)]);
    // Manually drop the ledger row so the next write triggers bootstrap.
    const db = await openTestDb(dbName);
    await new Promise<void>((resolve, reject) => {
      const txn = db.transaction(ROOM_LEDGER_STORE, 'readwrite');
      txn.objectStore(ROOM_LEDGER_STORE).delete(ROOM_ID);
      txn.oncomplete = () => resolve();
      txn.onerror = () => reject(txn.error);
    });
    // Seed two more pre-existing records directly into the events store
    // (bypassing saveRoomEventsToCache so the ledger stays absent).
    const preSeeded = [makeRawEvent('$x', 500, 15), makeRawEvent('$y', 600, 25)];
    await seedRawEvent(db, ROOM_ID, '', preSeeded[0]);
    await seedRawEvent(db, ROOM_ID, '', preSeeded[1]);
    db.close();

    // Force cacheStoreDb to re-open on the next cacheStore call.
    cacheStore.resetCacheStoreForTesting();

    // Now perform a new put — bootstrap should sum the pre-existing
    // records THEN apply the current put's delta.
    const fresh = makeRawEvent('$z', 700, 30);
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID, [fresh]);

    const db2 = await openTestDb(dbName);
    const ledger = await readLedger(db2, ROOM_ID);
    const expectedBytes =
      estimateRawEventBytes({
        event_id: '$seed',
        origin_server_ts: 50,
        type: 'm.room.message',
        sender: '@alice:example.org',
        content: { body: 'x'.repeat(5) },
      }) +
      estimateRawEventBytes(preSeeded[0]) +
      estimateRawEventBytes(preSeeded[1]) +
      estimateRawEventBytes(fresh);
    expect(ledger?.approxBytes).toBe(expectedBytes);
    expect(ledger?.eventCount).toBe(4);
    expect(ledger?.lastActivityTs).toBe(700);
  });

  it('rootEvent-only save (meta-only) does not touch the ledger', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    // Meta-only write: rootEvent supplied, no pageable events.
    const rootEvent = makeRawEvent(THREAD_ID, 50, 5);
    await cacheStore.saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [], rootEvent);

    const db = await openTestDb(dbName);
    const ledger = await readLedger(db, ROOM_ID);
    expect(ledger).toBeUndefined();
  });

  it('thread event puts populate the same per-room ledger as room puts', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    // A room event.
    const roomEvent = makeRawEvent('$rm', 100, 10);
    await cacheStore.saveRoomEventsToCache(SESSION_ID, ROOM_ID, [roomEvent]);

    // A thread reply in the same room.
    const rootEvent = makeRawEvent(THREAD_ID, 50, 5);
    const reply = makeRawEvent('$rp', 200, 20);
    await cacheStore.saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [rootEvent, reply],
      rootEvent
    );

    const db = await openTestDb(dbName);
    const ledger = await readLedger(db, ROOM_ID);
    const expectedBytes = estimateRawEventBytes(roomEvent) + estimateRawEventBytes(reply);
    expect(ledger?.approxBytes).toBe(expectedBytes);
    // 1 room event + 1 thread reply (root is filtered out of the pageable
    // set by filterPageableCachedThreadEvents).
    expect(ledger?.eventCount).toBe(2);
    expect(ledger?.lastActivityTs).toBe(200);
  });

  it('noteRoomOpened stamps lastOpenedTs on the room meta row (upsert)', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    const before = Date.now();
    await cacheStore.noteRoomOpened(SESSION_ID, ROOM_ID);
    const after = Date.now();

    const db = await openTestDb(dbName);
    const meta = (await readMeta(db, ROOM_ID, '')) as
      | { lastOpenedTs?: number; roomId?: string; scope?: string }
      | undefined;
    expect(meta).toBeDefined();
    expect(meta?.roomId).toBe(ROOM_ID);
    expect(meta?.scope).toBe('');
    expect(meta?.lastOpenedTs).toBeGreaterThanOrEqual(before);
    expect(meta?.lastOpenedTs).toBeLessThanOrEqual(after);
  });

  it('noteThreadOpened stamps lastOpenedTs preserving other meta fields', async () => {
    const cacheStore = await import('../index');
    const dbName = cacheStore.getCacheStoreDbName(SESSION_ID);

    // First: write a thread with a real rootEvent + snapshotComplete flag.
    const rootEvent = makeRawEvent(THREAD_ID, 50, 5);
    await cacheStore.saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [rootEvent, makeRawEvent('$reply', 100, 10)],
      rootEvent,
      undefined,
      true,
      true
    );

    // Then: stamp lastOpenedTs.
    await cacheStore.noteThreadOpened(SESSION_ID, ROOM_ID, THREAD_ID);

    const db = await openTestDb(dbName);
    const openedMeta = (await readMeta(db, ROOM_ID, THREAD_ID)) as
      | {
          lastOpenedTs?: number;
          snapshotComplete?: boolean;
          rootEvent?: { event_id?: string };
        }
      | undefined;
    expect(openedMeta?.lastOpenedTs).toBeGreaterThan(0);

    await cacheStore.saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [
      makeRawEvent('$later-reply', 200, 10),
    ]);
    const savedMeta = (await readMeta(db, ROOM_ID, THREAD_ID)) as typeof openedMeta;

    expect(savedMeta?.lastOpenedTs).toBe(openedMeta?.lastOpenedTs);
    // Prior fields survive.
    expect(savedMeta?.snapshotComplete).toBe(true);
    expect(savedMeta?.rootEvent?.event_id).toBe(THREAD_ID);
  });
});
