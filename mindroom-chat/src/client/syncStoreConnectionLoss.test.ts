import {
  forceCloseDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
} from 'fake-indexeddb';
import { createClient, type MatrixClient } from 'matrix-js-sdk';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WebKit closes every IndexedDB connection when its networking process
 * exits: it marks each connection as closing, aborts active and committing
 * transactions, and only then fires `close`. The sync store must not hang or
 * delete the persisted sync; the page reload restores the connection.
 */
describe('Matrix sync store after an IndexedDB connection loss', () => {
  let indexedDB: IDBFactory;
  const stores: IndexedDBStore[] = [];
  const clients: MatrixClient[] = [];

  beforeEach(() => {
    indexedDB = new IDBFactory();
    // The SDK reads the global for its out-of-band member queries.
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clients.splice(0).forEach((client) => client.stopClient());
    await Promise.all(stores.splice(0).map((store) => store.destroy()));
  });

  const startStore = async () => {
    const store = new IndexedDBStore({ indexedDB, dbName: 'connection-loss' });
    stores.push(store);
    // `startup` needs the store to be attached to a client.
    clients.push(
      createClient({ baseUrl: 'https://matrix.example', userId: '@alice:example', store })
    );
    await store.startup();
    return store;
  };

  const backendDatabase = (store: IndexedDBStore): IDBDatabase =>
    (store as unknown as { backend: { db: IDBDatabase } }).backend.db;

  const accumulate = (store: IndexedDBStore, nextBatch: string) =>
    store.setSyncData({ next_batch: nextBatch } as Parameters<IndexedDBStore['setSyncData']>[0]);

  const persistedToken = async () => {
    const reader = await startStore();
    return reader.getSavedSyncToken();
  };

  const savedStore = async () => {
    const store = await startStore();
    await accumulate(store, 'saved');
    await store.save(true);
    return store;
  };

  it('settles a save whose commit is aborted by a lost connection', async () => {
    const store = await savedStore();

    // The write succeeds, then the lost server aborts the committing
    // transaction: only `abort` fires, nothing reports an error on a request.
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function abortAfterPut(
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => {
        this.transaction.db.close();
        this.transaction.abort();
      });
      return request;
    });
    await accumulate(store, 'aborted');
    const settled = await Promise.race([
      store.save(true).then(() => 'settled'),
      new Promise((resolve) => {
        setTimeout(() => resolve('pending'), 500);
      }),
    ]);

    expect(settled).toBe('settled');
    expect(await persistedToken()).toBe('saved');
  });

  it('keeps the persisted sync when a save fails because the connection was lost', async () => {
    const store = await savedStore();
    const degraded = vi.fn();
    store.on('degraded', degraded);

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function lose(
      this: IDBObjectStore
    ) {
      this.transaction.db.close();
      throw new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
    });
    await accumulate(store, 'failed');
    await store.save(true);

    expect(degraded).not.toHaveBeenCalled();
    expect(await persistedToken()).toBe('saved');
  });

  it('keeps the persisted sync when operations run after the browser closed the connection', async () => {
    const store = await savedStore();
    forceCloseDatabase(backendDatabase(store));
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    await accumulate(store, 'after-loss');
    await store.save(true);
    // Reads fall back to memory instead of failing.
    expect(await store.getOutOfBandMembers('!room:example')).toBeNull();

    expect(await persistedToken()).toBe('saved');
  });

  it('keeps the persisted sync when a read in flight fails because the connection was lost', async () => {
    const store = await savedStore();

    const openCursor = IDBIndex.prototype.openCursor;
    vi.spyOn(IDBIndex.prototype, 'openCursor').mockImplementationOnce(function lose(
      this: IDBIndex,
      ...args: Parameters<IDBIndex['openCursor']>
    ) {
      const request = openCursor.apply(this, args);
      const { transaction } = this.objectStore;
      transaction.db.close();
      transaction.abort();
      return request;
    });

    expect(await store.getOutOfBandMembers('!room:example')).toBeNull();
    expect(await persistedToken()).toBe('saved');
  });

  it.each([
    ['QuotaExceededError', 'Storage is full.'],
    ['UnknownError', 'Internal error.'],
  ])('still clears the store after a %s on a working connection', async (name, message) => {
    const store = await savedStore();

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException(message, name);
    });
    await accumulate(store, 'failed');
    await store.save(true);

    expect(await persistedToken()).toBeUndefined();
  });
});
