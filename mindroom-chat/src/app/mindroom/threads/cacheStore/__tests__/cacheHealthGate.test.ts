/**
 * CINNY-207 P2.3: the P1.5 (finding F4, AC11) health gate moved into
 * the unified `cacheStore` module — the sole write choke point. After
 * an injected quota failure the session degrades to cache-read-only:
 * subsequent save calls at the store boundary skip their IDB writes
 * silently. Reads keep painting (I1), deletes stay ungated (they only
 * shrink storage), and the reconcile path keeps correcting from the
 * network (I2).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bypass the D8 legacy wipe so the fresh IDB starts clean per test.
vi.mock('../cacheStoreLegacyWipe', () => ({
  LEGACY_WIPE_MARKER_META_KEY: '__cacheStore|migration',
  performLegacyDbWipe: vi.fn(async () => undefined),
}));

const SESSION_ID = 'health-gate-session';
const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root';

const makeRawEvent = (eventId: string, ts: number) => ({
  event_id: eventId,
  origin_server_ts: ts,
  type: 'm.room.message',
  content: { body: eventId },
});

const loadModules = async () => {
  const store = await import('../index');
  const health = await import('../../cacheHealth');
  const probe = await import('../../cacheProbe');
  return { store, health, probe };
};

describe('cacheStore save entry points honor cache health (CINNY-207 P2.3)', () => {
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { health } = await loadModules();
    health.resetCacheHealthForTesting();
  });

  afterEach(async () => {
    const { health } = await loadModules();
    health.resetCacheHealthForTesting();
    vi.restoreAllMocks();
  });

  it('room save skips its IDB write once health is degraded', async () => {
    const { store, health, probe } = await loadModules();
    probe.resetCacheProbe();

    // Write once so a ledger row exists to observe against.
    await store.saveRoomEventsToCache(SESSION_ID, ROOM_ID, [makeRawEvent('$a', 100)], 'tok-a');
    const db = await store.openCacheStore(SESSION_ID);
    if (!db) throw new Error('cacheStore db unexpectedly unavailable');
    const beforeSnapshot = await store.readLedgerSnapshot(db);
    expect(beforeSnapshot.find((row) => row.roomId === ROOM_ID)?.eventCount).toBe(1);

    // Degrade session to read-only via a synthesized quota error.
    health.reportCacheWriteError(
      'roomEventCache.save',
      Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    );
    expect(health.isCacheWritable()).toBe(false);

    const probeBefore = probe.getCacheProbeSnapshot();
    await store.saveRoomEventsToCache(SESSION_ID, ROOM_ID, [makeRawEvent('$b', 200)], 'tok-b');
    const probeAfter = probe.getCacheProbeSnapshot();

    // No IDB path taken: save-call, put, and meta-put probes are unchanged.
    expect(probeAfter.roomSaveCalls).toBe(probeBefore.roomSaveCalls);
    expect(probeAfter.roomEventPuts).toBe(probeBefore.roomEventPuts);
    expect(probeAfter.roomMetaPuts).toBe(probeBefore.roomMetaPuts);

    // Ledger still reports the pre-degrade row shape (no new record landed).
    const afterSnapshot = await store.readLedgerSnapshot(db);
    expect(afterSnapshot.find((row) => row.roomId === ROOM_ID)?.eventCount).toBe(1);
  });

  it('thread save skips its IDB write once health is degraded', async () => {
    const { store, health, probe } = await loadModules();
    probe.resetCacheProbe();

    await store.saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [makeRawEvent('$reply', 200)],
      makeRawEvent(THREAD_ID, 100),
      null,
      false,
      false,
      1
    );

    health.reportCacheWriteError(
      'threadEventCache.save',
      Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    );
    expect(health.isCacheWritable()).toBe(false);

    const probeBefore = probe.getCacheProbeSnapshot();
    await store.saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [makeRawEvent('$reply-2', 300)],
      undefined,
      null
    );
    const probeAfter = probe.getCacheProbeSnapshot();

    // Thread probes unchanged after degrade.
    expect(probeAfter.threadSaveCalls).toBe(probeBefore.threadSaveCalls);
    expect(probeAfter.threadEventPuts).toBe(probeBefore.threadEventPuts);
    expect(probeAfter.threadMetaPuts).toBe(probeBefore.threadMetaPuts);
  });

  it('deletes stay ungated even after a quota degrade', async () => {
    const { store, health, probe } = await loadModules();
    probe.resetCacheProbe();

    await store.saveRoomEventsToCache(SESSION_ID, ROOM_ID, [makeRawEvent('$a', 100)]);

    health.reportCacheWriteError(
      'roomEventCache.save',
      Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    );

    await store.deleteRoomEventsFromCache(SESSION_ID, ROOM_ID, ['$a']);

    // The delete probe increments even under a degraded session, and the
    // record is gone from IDB — evidence deletes bypass the gate.
    expect(probe.getCacheProbeSnapshot().eventDeletes).toBeGreaterThan(0);

    const remaining = await store.loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10);
    expect(remaining.events.map((event) => event.event_id)).toEqual([]);
  });
});
