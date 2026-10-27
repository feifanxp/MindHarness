// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INDEXED_DB_LOSS_RELOAD_KEY,
  INDEXED_DB_LOSS_SENTINEL_DB_NAME,
  installIndexedDbLossRecovery,
  readRecoveryReloadAge,
} from './indexedDbLossRecovery';

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
};

describe('IndexedDB server loss recovery', () => {
  let connections: IDBDatabase[];
  let restoreOpen: () => void;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    window.localStorage.clear();
    setVisibility('visible');
    connections = [];
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function recordedOpen(this: IDBFactory, ...args) {
      const request = open.apply(this, args);
      request.addEventListener('success', () => connections.push(request.result));
      return request;
    } as typeof IDBFactory.prototype.open;
    restoreOpen = () => {
      IDBFactory.prototype.open = open;
    };
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    restoreOpen();
    vi.useRealTimers();
  });

  const sentinels = () => connections.filter((db) => db.name === INDEXED_DB_LOSS_SENTINEL_DB_NAME);
  const sentinel = async (count = 1) => {
    await vi.waitFor(() => expect(sentinels()).toHaveLength(count));
    return sentinels().at(-1)!;
  };
  // fake-indexeddb dispatches `close` through setImmediate, which fake timers leave real.
  const closeEvent = () =>
    new Promise((resolve) => {
      setImmediate(resolve);
    });

  it('reloads once the browser closes every IndexedDB connection', async () => {
    const reload = vi.fn();
    dispose = installIndexedDbLossRecovery({ reload, now: () => 1_000 });

    forceCloseDatabase(await sentinel());

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(window.localStorage.getItem(INDEXED_DB_LOSS_RELOAD_KEY)).toBe('1000');
  });

  it('reloads a hidden page without waiting for it to be shown', async () => {
    // The SDK acknowledges unprocessed to-device messages after a minute of retries.
    const reload = vi.fn();
    setVisibility('hidden');
    dispose = installIndexedDbLossRecovery({ reload });

    forceCloseDatabase(await sentinel());

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('postpones a reload within a minute of the previous one', async () => {
    let now = 100_000;
    const reload = vi.fn();
    window.localStorage.setItem(INDEXED_DB_LOSS_RELOAD_KEY, String(now - 10_000));
    dispose = installIndexedDbLossRecovery({ reload, now: () => now });
    const db = await sentinel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    forceCloseDatabase(db);
    await closeEvent();
    now += 49_999;
    await vi.advanceTimersByTimeAsync(49_999);
    expect(reload).not.toHaveBeenCalled();

    now += 1;
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(INDEXED_DB_LOSS_RELOAD_KEY)).toBe(String(now));
  });

  it("does not let another tab's reload extend the wait", async () => {
    let now = 100_000;
    const reload = vi.fn();
    window.localStorage.setItem(INDEXED_DB_LOSS_RELOAD_KEY, String(now - 10_000));
    dispose = installIndexedDbLossRecovery({ reload, now: () => now });
    const db = await sentinel();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    forceCloseDatabase(db);
    await closeEvent();
    // Another tab reloads meanwhile and records its own time.
    now += 30_000;
    window.localStorage.setItem(INDEXED_DB_LOSS_RELOAD_KEY, String(now));
    now += 20_000;
    await vi.advanceTimersByTimeAsync(50_000);

    // The SDK keeps unprocessed to-device messages for about a minute only.
    expect(reload).toHaveBeenCalledOnce();
  });

  it('ignores a reload time from the future', async () => {
    const reload = vi.fn();
    window.localStorage.setItem(INDEXED_DB_LOSS_RELOAD_KEY, String(5_000_000));
    dispose = installIndexedDbLossRecovery({ reload, now: () => 1_000 });

    forceCloseDatabase(await sentinel());

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('does not reload when the reload guard cannot be stored', async () => {
    const reload = vi.fn();
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as Storage;
    dispose = installIndexedDbLossRecovery({ reload, storage: blocked });

    forceCloseDatabase(await sentinel());
    await closeEvent();

    expect(reload).not.toHaveBeenCalled();
  });

  it('lets another context delete the database and keeps watching afterwards', async () => {
    const reload = vi.fn();
    dispose = installIndexedDbLossRecovery({ reload });
    await sentinel();

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(INDEXED_DB_LOSS_SENTINEL_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('sentinel blocked deletion'));
    });
    expect(reload).not.toHaveBeenCalled();

    forceCloseDatabase(await sentinel(2));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('stops watching after disposal', async () => {
    const reload = vi.fn();
    dispose = installIndexedDbLossRecovery({ reload });
    const db = await sentinel();
    dispose();
    dispose = undefined;

    forceCloseDatabase(db);
    await closeEvent();
    expect(reload).not.toHaveBeenCalled();
  });

  describe('recovery reload age', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const navigation = (type: NavigationTimingType) =>
      vi
        .spyOn(performance, 'getEntriesByType')
        .mockReturnValue([{ type } as PerformanceNavigationTiming]);

    it('reports how long ago the recovery reload of this page happened', () => {
      navigation('reload');
      window.localStorage.setItem(INDEXED_DB_LOSS_RELOAD_KEY, '10000');

      expect(readRecoveryReloadAge(window.localStorage, 12_500)).toBe(2_500);
    });

    it.each([
      ['a fresh start', 'navigate', '10000', 12_500],
      ['a reload a minute later', 'reload', '10000', 70_000],
      ['a reload without a recovery', 'reload', null, 12_500],
      ['a time from the future', 'reload', '20000', 12_500],
    ] as const)('reports nothing after %s', (_case, type, lastReload, at) => {
      navigation(type);
      if (lastReload) window.localStorage.setItem(INDEXED_DB_LOSS_RELOAD_KEY, lastReload);

      expect(readRecoveryReloadAge(window.localStorage, at)).toBeUndefined();
    });
  });
});
