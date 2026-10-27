import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { resetCacheStoreForTesting } from '../cacheStore';
import { revokeRoomCacheStoreWrites } from '../cacheStore/cacheStoreDb';
import { readRoomOfflineProgress, updateRoomOfflineProgress } from '../cacheStore/cacheStoreMeta';
import { resetCacheHealthForTesting } from '../cacheHealth';
import { getCacheProbeSnapshot, resetCacheProbe } from '../cacheProbe';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
  resetCacheProbe();
});

it('declines a progress write revoked during its metadata read without reporting storage failure', async () => {
  const original = IDBObjectStore.prototype.get;
  const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function get(key) {
    const request = original.call(this, key);
    if (this.name === 'meta') revokeRoomCacheStoreWrites('session', '!room:test');
    return request;
  });
  try {
    expect(await updateRoomOfflineProgress('session', '!room:test', { opened: true })).toBe(false);
    expect(getCacheProbeSnapshot().writeErrors).toBe(0);
  } finally {
    read.mockRestore();
  }
  expect(await readRoomOfflineProgress('session', '!room:test')).toEqual({});
});

it('reports a real metadata transaction failure while keeping progress uncommitted', async () => {
  const original = IDBObjectStore.prototype.put;
  const write = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function put(value, key) {
      const request = original.call(this, value, key);
      if (this.name === 'meta') this.transaction.abort();
      return request;
    });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    expect(await updateRoomOfflineProgress('session', '!room:test', { opened: true })).toBe(false);
    expect(getCacheProbeSnapshot().writeErrors).toBe(1);
  } finally {
    write.mockRestore();
    warning.mockRestore();
  }
  expect(await readRoomOfflineProgress('session', '!room:test')).toEqual({});
});

it('skips unchanged progress writes while preserving concurrent changes', async () => {
  await updateRoomOfflineProgress('session', '!room:test', {
    opened: true,
    undecryptedEventIds: ['$pending'],
    unresolvedRelations: {},
  });
  const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
  try {
    expect(
      await updateRoomOfflineProgress('session', '!room:test', {
        opened: true,
        undecryptedEventIds: ['$pending'],
        unresolvedRelations: {},
      })
    ).toBe(true);
    expect(writes).not.toHaveBeenCalled();
    await Promise.all([
      updateRoomOfflineProgress('session', '!room:test', { exhausted: true }),
      updateRoomOfflineProgress('session', '!room:test', (current) => ({
        undecryptedEventIds: [...(current.undecryptedEventIds ?? []), '$another'],
      })),
    ]);
    expect(await readRoomOfflineProgress('session', '!room:test')).toMatchObject({
      opened: true,
      exhausted: true,
      undecryptedEventIds: ['$pending', '$another'],
    });
  } finally {
    writes.mockRestore();
  }
});
