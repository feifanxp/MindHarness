import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CacheStoreBlockedError,
  deleteCacheStoreDb,
  openCacheStore,
  resetCacheStoreForTesting,
} from '../cacheStoreDb';

const makeBlockedRequest = (): IDBOpenDBRequest => {
  const request = {
    error: null,
    onblocked: null,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
  } as unknown as IDBOpenDBRequest;
  queueMicrotask(() => request.onblocked?.call(request, new Event('blocked')));
  return request;
};

describe('cacheStoreDb blocked operations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetCacheStoreForTesting();
  });

  it('reports a blocked delete instead of pretending the database was removed', async () => {
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(
      () => makeBlockedRequest() as unknown as IDBOpenDBRequest
    );

    await expect(deleteCacheStoreDb('blocked-delete-session')).rejects.toBeInstanceOf(
      CacheStoreBlockedError
    );
  });

  it('rejects a blocked open and lets the next login retry with a fresh request', async () => {
    const realOpen = indexedDB.open.bind(indexedDB);
    const openSpy = vi
      .spyOn(indexedDB, 'open')
      .mockImplementationOnce(() => makeBlockedRequest());

    await expect(openCacheStore('blocked-open-session')).rejects.toBeInstanceOf(
      CacheStoreBlockedError
    );

    openSpy.mockImplementation(realOpen);
    await expect(openCacheStore('blocked-open-session')).resolves.toBeDefined();
  });
});
