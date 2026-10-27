import { openCacheStore } from './cacheStoreDb';
import {
  EVENTS_BY_SCOPE_TS_INDEX,
  MAX_EVENT_ID,
  MAX_EVENT_TS,
  ROOM_LEDGER_STORE,
  type CachedEventRecord,
  type CachedRoomLedgerRecord,
} from './cacheStoreSchema';

// CINNY-207 P2.2 commit 1: room byte/activity ledger.
//
// Ledger deltas are computed inside the SAME readwrite transaction as
// the event puts/deletes so ledger totals stay consistent with the
// events store. The flow inside each save/delete transaction is:
//
//   1. `beginLedgerBaseline` — schedules a ledger.get(roomId), and if
//      missing, a bounded sum-scan over just this room to seed the
//      baseline. Both happen BEFORE the caller schedules any event
//      put/delete, so the baseline reflects the pre-write state.
//   2. The caller schedules event puts/deletes, and for each records
//      the exact delta via `notePut` / `noteDelete`.
//   3. `finalize` — writes ledger row = baseline + accumulated deltas,
//      scheduled from the last put/delete's onsuccess so all deltas
//      are known.
//
// Pure IDB request callbacks throughout (no async/await) — awaiting on
// a JS promise between IDB requests lets the transaction auto-commit.

export type EventsIndexLike = {
  openCursor: (
    range?: IDBKeyRange,
    direction?: IDBCursorDirection
  ) => IDBRequest<IDBCursorWithValue | null>;
};

export type EventsStoreLike = {
  index: (name: string) => EventsIndexLike;
};

export type LedgerStoreLike = {
  get: (key: IDBValidKey) => IDBRequest<CachedRoomLedgerRecord | undefined>;
  put: (value: CachedRoomLedgerRecord) => IDBRequest<IDBValidKey>;
  delete: (key: IDBValidKey) => IDBRequest<undefined>;
};

type LedgerBaseline = {
  approxBytes: number;
  eventCount: number;
  lastActivityTs: number;
  federated: boolean | undefined;
  pinned?: boolean;
};

type LedgerAccumulator = {
  bytesDelta: number;
  countDelta: number;
  latestActivityTsSeen: number;
};

const createAccumulator = (): LedgerAccumulator => ({
  bytesDelta: 0,
  countDelta: 0,
  latestActivityTsSeen: 0,
});

const readOrBootstrapBaseline = (
  ledgerStore: LedgerStoreLike,
  eventsStore: EventsStoreLike,
  roomId: string,
  onReady: (baseline: LedgerBaseline) => void
): void => {
  const readRequest = ledgerStore.get(roomId);
  readRequest.onsuccess = () => {
    const currentLedger = readRequest.result;
    if (currentLedger) {
      onReady({
        approxBytes: currentLedger.approxBytes,
        eventCount: currentLedger.eventCount,
        lastActivityTs: currentLedger.lastActivityTs,
        federated: currentLedger.federated,
        pinned: currentLedger.pinned,
      });
      return;
    }
    // Missing — bootstrap by sum-scanning this room only.
    const index = eventsStore.index(EVENTS_BY_SCOPE_TS_INDEX);
    const range = IDBKeyRange.bound(
      [roomId, '', 0, ''],
      [roomId, MAX_EVENT_ID, MAX_EVENT_TS, MAX_EVENT_ID]
    );
    let approxBytes = 0;
    let eventCount = 0;
    let lastActivityTs = 0;

    const cursorRequest = index.openCursor(range);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        onReady({ approxBytes, eventCount, lastActivityTs, federated: undefined });
        return;
      }
      const record = cursor.value as CachedEventRecord;
      approxBytes += typeof record.approxBytes === 'number' ? record.approxBytes : 0;
      eventCount += 1;
      if (typeof record.ts === 'number' && record.ts > lastActivityTs) {
        lastActivityTs = record.ts;
      }
      cursor.continue();
    };
  };
};

const writeUpdatedLedger = (
  ledgerStore: LedgerStoreLike,
  roomId: string,
  baseline: LedgerBaseline,
  acc: LedgerAccumulator
): void => {
  const nextBytes = Math.max(0, baseline.approxBytes + acc.bytesDelta);
  const nextCount = Math.max(0, baseline.eventCount + acc.countDelta);
  const nextLastActivityTs = Math.max(baseline.lastActivityTs, acc.latestActivityTsSeen);

  if (nextCount === 0 && nextBytes === 0 && !baseline.pinned) {
    ledgerStore.delete(roomId);
    return;
  }

  const nextLedger: CachedRoomLedgerRecord = {
    roomId,
    approxBytes: nextBytes,
    eventCount: nextCount,
    lastActivityTs: nextLastActivityTs,
    ...(baseline.pinned !== undefined ? { pinned: baseline.pinned } : {}),
    ...(baseline.federated !== undefined ? { federated: baseline.federated } : {}),
  };
  ledgerStore.put(nextLedger);
};

// ---------- Public API ----------

/**
 * Tracker instance per readwrite transaction. Records deltas as event
 * puts/deletes complete, then writes the final ledger row.
 *
 * Usage pattern (inside the caller's IDB txn):
 *
 *   const ledger = createLedgerTracker(roomId);
 *   ledger.begin(ledgerStore, eventsStore);   // schedules baseline read
 *   // ... schedule your event.get → put chains, calling notePut inside
 *   // each onsuccess ...
 *   // From the LAST put's onsuccess:
 *   ledger.finalize(ledgerStore);
 */
export type LedgerTracker = {
  /**
   * Schedule the ledger baseline read (get + optional bootstrap
   * sum-scan). The `onReady` callback fires as soon as the baseline is
   * captured — the caller schedules event puts/deletes from inside
   * `onReady` so the bootstrap sum reflects ONLY the pre-write state.
   */
  readBaseline: (
    ledgerStore: LedgerStoreLike,
    eventsStore: EventsStoreLike,
    onReady: () => void
  ) => void;
  notePut: (newRecord: CachedEventRecord, previous: CachedEventRecord | undefined) => void;
  noteDelete: (previous: CachedEventRecord | undefined) => void;
  /**
   * Write the ledger row. Callers schedule this from the last
   * put/delete's onsuccess so all deltas are recorded.
   */
  finalize: (ledgerStore: LedgerStoreLike) => void;
};

export const createLedgerTracker = (roomId: string): LedgerTracker => {
  const acc = createAccumulator();
  let baseline: LedgerBaseline | undefined;

  return {
    readBaseline: (ledgerStore, eventsStore, onReady) => {
      readOrBootstrapBaseline(ledgerStore, eventsStore, roomId, (result) => {
        baseline = result;
        onReady();
      });
    },
    notePut: (newRecord, previous) => {
      const previousBytes =
        previous && typeof previous.approxBytes === 'number' ? previous.approxBytes : 0;
      acc.bytesDelta += newRecord.approxBytes - previousBytes;
      if (!previous) acc.countDelta += 1;
      if (newRecord.ts > acc.latestActivityTsSeen) {
        acc.latestActivityTsSeen = newRecord.ts;
      }
    },
    noteDelete: (previous) => {
      if (!previous) return;
      acc.bytesDelta -= typeof previous.approxBytes === 'number' ? previous.approxBytes : 0;
      acc.countDelta -= 1;
    },
    finalize: (ledgerStore) => {
      if (!baseline) return;
      writeUpdatedLedger(ledgerStore, roomId, baseline, acc);
    },
  };
};

// ---------- Federated attribution setter (CINNY-207 P4.2) ----------

/**
 * Record whether a room is federated. Called from the engine's
 * `noteRoomFocused` after resolving the room's prefetch tier via the
 * homeserver-detection policy (D3). The write is scoped so it neither
 * bumps nor decays the ledger's byte/count/activity fields — it only
 * flips the eviction attribution flag.
 *
 * Behavior:
 *   - Existing ledger row: PATCH the `federated` field, keep every
 *     other counter untouched. This preserves the LRU-inside-priority
 *     ordering the eviction job depends on.
 *   - Missing ledger row: WRITE a minimal row (`approxBytes=0`,
 *     `eventCount=0`, `lastActivityTs=0`, `federated=<flag>`). The
 *     next save from the events store's ledger tracker will read this
 *     row as the baseline and merge in real deltas — the federated
 *     flag survives via the `baseline.federated !== undefined` branch
 *     in `writeUpdatedLedger`.
 *
 * Silent on any open/txn failure; this is an attribution hint, not
 * durability-critical.
 */
export const noteRoomFederated = async (
  sessionId: string,
  roomId: string,
  federated: boolean
): Promise<void> => {
  const db = await openCacheStore(sessionId).catch(() => undefined);
  if (!db) return;

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ROOM_LEDGER_STORE, 'readwrite');
      const ledgerStore = transaction.objectStore(ROOM_LEDGER_STORE);
      const getRequest = ledgerStore.get(roomId);
      getRequest.onsuccess = () => {
        const current = getRequest.result as CachedRoomLedgerRecord | undefined;
        if (current) {
          if (current.federated === federated) return; // No-op — already correct.
          ledgerStore.put({ ...current, federated });
          return;
        }
        // Minimal row so the flag persists until the events store fills
        // in real deltas on the first save.
        const bootstrap: CachedRoomLedgerRecord = {
          roomId,
          approxBytes: 0,
          eventCount: 0,
          lastActivityTs: 0,
          federated,
        };
        ledgerStore.put(bootstrap);
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // Attribution hint — swallow failures so callers stay resilient.
  }
};

// ---------- Read-only accessor used by the eviction job (commit 3) ----------

export const readLedgerSnapshot = async (db: IDBDatabase): Promise<CachedRoomLedgerRecord[]> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ROOM_LEDGER_STORE, 'readonly');
    const store = transaction.objectStore(ROOM_LEDGER_STORE);
    const rows: CachedRoomLedgerRecord[] = [];
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      rows.push(cursor.value as CachedRoomLedgerRecord);
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
    transaction.oncomplete = () => resolve(rows);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};
