import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';

export const INDEXED_DB_LOSS_SENTINEL_DB_NAME = 'mindroom-indexeddb-sentinel-v1';
/**
 * Time of the last recovery reload, to avoid reload loops. Kept in localStorage:
 * WebKit loses sessionStorage with its networking process, while localStorage
 * writes made after that loss survive the reload.
 */
export const INDEXED_DB_LOSS_RELOAD_KEY = 'mindroom.indexedDbLoss.reloadAt.v1';
const RELOAD_GUARD_MS = 60_000;

/** @returns the time since a stored recovery reload, while it still guards against another. */
const guardedReloadAge = (lastReload: number, at: number): number | undefined =>
  lastReload > 0 && lastReload <= at && at - lastReload < RELOAD_GUARD_MS
    ? at - lastReload
    : undefined;

/**
 * @returns how long ago this page's recovery reload happened, when the page was
 * loaded by one; used to record the recovery in diagnostics.
 */
export const readRecoveryReloadAge = (
  storage: Storage | undefined = getSafeLocalStorage(),
  at = Date.now()
): number | undefined => {
  try {
    const [navigation] = performance.getEntriesByType(
      'navigation'
    ) as PerformanceNavigationTiming[];
    if (navigation?.type !== 'reload') return undefined;
  } catch {
    return undefined;
  }
  return guardedReloadAge(Number(getStorageItemSafe(storage, INDEXED_DB_LOSS_RELOAD_KEY)), at);
};

type Options = {
  factory?: IDBFactory;
  reload?: () => void;
  now?: () => number;
  storage?: Storage;
};

/**
 * WebKit hosts IndexedDB in its networking process. When that process exits
 * (on iOS, typically while the app is suspended), the browser closes every
 * connection in the page and each fires `close`. The Matrix SDK keeps syncing
 * without them, but neither its sync store nor the Rust crypto store reopens,
 * so a sentinel connection detects the loss and reloads the page. The reload
 * must come within the minute the SDK keeps retrying unprocessed to-device
 * messages, so it does not wait for a hidden page to be shown.
 */
export const installIndexedDbLossRecovery = ({
  factory = globalThis.indexedDB,
  reload = () => window.location.reload(),
  now = Date.now,
  storage = getSafeLocalStorage(),
}: Options = {}): (() => void) => {
  if (!factory) return () => undefined;
  let disposed = false;
  let connection: IDBDatabase | undefined;
  let guardTimer: number | undefined;

  function reloadNow() {
    if (disposed) return;
    // Without a stored guard a failing reload could loop; stay on this page.
    if (!setStorageItemSafe(storage, INDEXED_DB_LOSS_RELOAD_KEY, String(now()))) return;
    reload();
  }

  function recover() {
    if (disposed || guardTimer !== undefined) return;
    const age = guardedReloadAge(
      Number(getStorageItemSafe(storage, INDEXED_DB_LOSS_RELOAD_KEY)),
      now()
    );
    // A loss right after a recovery reload waits out the rest of the interval.
    // The deadline is fixed here: reloads of other tabs must not extend it.
    if (age !== undefined) {
      guardTimer = window.setTimeout(reloadNow, RELOAD_GUARD_MS - age);
      return;
    }
    reloadNow();
  }

  function arm() {
    if (disposed) return;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(INDEXED_DB_LOSS_SENTINEL_DB_NAME, 1);
    } catch {
      return;
    }
    request.onerror = (event) => {
      // Without a sentinel there is no detection; the page keeps working.
      event.preventDefault();
    };
    request.onsuccess = () => {
      const opened = request.result;
      if (disposed) {
        opened.close();
        return;
      }
      connection = opened;
      // `close` fires only when the browser closes the connection itself.
      opened.onclose = recover;
      // Another context deleting the database is not a loss; do not block it,
      // and reopen afterwards (the open waits for the deletion).
      opened.onversionchange = () => {
        opened.close();
        arm();
      };
    };
  }

  arm();

  return () => {
    disposed = true;
    if (guardTimer !== undefined) window.clearTimeout(guardTimer);
    connection?.close();
  };
};
