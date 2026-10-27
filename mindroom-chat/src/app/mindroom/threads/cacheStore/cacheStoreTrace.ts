import {
  isDeepTraceRecording,
  recordDeepTraceEvent,
  type DeepTraceData,
} from '../../diagnostics/deepTrace';

// An iPhone export showed every cache read hanging after a long suspension while the
// deep trace's own IndexedDB kept working, with nothing recorded about the cache
// database. These events record only operations that stall, so the next export shows
// whether opening the database or a transaction stopped, and which ones were still open.

/** A cache open or transaction still running after this long is recorded as stalled. */
export const CACHE_STALL_MS = 5_000;

type OpenTransaction = { startedAt: number; readwrite: boolean };
type OpenTransactions = Map<IDBTransaction, OpenTransaction>;

const elapsed = (startedAt: number): number => Math.round(performance.now() - startedAt);

/** Store names are fixed schema identifiers, so they are safe deep trace field names. */
const storeFields = (stores: readonly string[]): DeepTraceData =>
  Object.fromEntries(stores.map((store) => [store, true]));

const transactionData = (
  openTransactions: OpenTransactions,
  stores: readonly string[],
  readwrite: boolean
): DeepTraceData => {
  let oldestStartedAt = performance.now();
  let openReadwrite = 0;
  openTransactions.forEach((transaction) => {
    oldestStartedAt = Math.min(oldestStartedAt, transaction.startedAt);
    if (transaction.readwrite) openReadwrite += 1;
  });
  return {
    readwrite,
    ...storeFields(stores),
    open: openTransactions.size,
    open_readwrite: openReadwrite,
    oldest_open_ms: elapsed(oldestStartedAt),
  };
};

/** Records an open that has not settled after CACHE_STALL_MS, and how a stalled open ended. */
export const traceCacheStoreOpen = (opening: Promise<IDBDatabase | undefined>): void => {
  const startedAt = performance.now();
  let stalled = false;
  const timer = setTimeout(() => {
    stalled = true;
    recordDeepTraceEvent('storage.cache.open_stalled');
  }, CACHE_STALL_MS);
  const settle = (ok: boolean, blocked: boolean) => {
    clearTimeout(timer);
    if (stalled) {
      recordDeepTraceEvent('storage.cache.open_settled', {
        duration_ms: elapsed(startedAt),
        ok,
        blocked,
      });
    }
  };
  opening.then(
    (db) => settle(!!db, false),
    (error: unknown) =>
      settle(false, error instanceof Error && error.name === 'CacheStoreBlockedError')
  );
};

/**
 * Every cache transaction starts on its connection, so watch them there. Each account has
 * its own cache database, so open counts cover only this connection's transactions.
 */
export const traceCacheTransactions = (db: IDBDatabase): void => {
  // Resolve the inherited method per call, so it stays the browser's (or a test's) current one.
  const inherited = Object.getPrototypeOf(db) as IDBDatabase;
  const openTransactions: OpenTransactions = new Map();
  db.transaction = ((
    storeNames: string | string[],
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions
  ) => {
    const transaction = inherited.transaction.call(db, storeNames, mode, options);
    if (!isDeepTraceRecording()) return transaction;
    const stores = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
    const readwrite = mode === 'readwrite';
    const startedAt = performance.now();
    openTransactions.set(transaction, { startedAt, readwrite });
    let stalled = false;
    const timer = setTimeout(() => {
      stalled = true;
      recordDeepTraceEvent(
        'storage.cache.transaction_stalled',
        transactionData(openTransactions, stores, readwrite)
      );
    }, CACHE_STALL_MS);
    const settle = (aborted: boolean) => () => {
      clearTimeout(timer);
      openTransactions.delete(transaction);
      if (stalled) {
        recordDeepTraceEvent('storage.cache.transaction_settled', {
          duration_ms: elapsed(startedAt),
          readwrite,
          aborted,
          ...storeFields(stores),
        });
      }
    };
    transaction.addEventListener('complete', settle(false), { once: true });
    transaction.addEventListener('abort', settle(true), { once: true });
    return transaction;
  }) as IDBDatabase['transaction'];
};

/** The browser or another tab closed the cache connection. */
export const traceCacheStoreClose = (versionChange: boolean): void => {
  recordDeepTraceEvent('storage.cache.close', { version_change: versionChange });
};
