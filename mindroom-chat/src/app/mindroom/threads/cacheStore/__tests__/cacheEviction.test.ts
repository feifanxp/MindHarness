import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as deepTrace from '../../../diagnostics/deepTrace';
import * as store from '../index';

const session = 'media-eviction';
const save = (id: string, roomId: string) =>
  store.putCachedAttachment(
    session,
    {
      mxcUri: `mxc://test/${id}`,
      bytes: new ArrayBuffer(2000),
      mimeType: 'image/png',
    },
    { roomId }
  );
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store.resetCacheStoreForTesting();
  store.__resetEvictionForTests();
});
afterEach(() => {
  store.__setCacheStoreByteBudgetForTests(undefined);
  vi.restoreAllMocks();
});

it('reclaims oldest optional attachments, preserving recent and focused rooms and text', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => {
    now += 1000;
    return now;
  });
  await save('old', 'room-old');
  await save('new', 'room-new');
  await save('recent', 'room-recent');
  await save('focused', 'room-focused');
  await store.noteRoomOpened(session, 'room-recent');
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(7000);
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedMxcUris).toEqual(['mxc://test/old']);
  expect(result.bytesAfter).toBe(6000);
  expect(await store.readRoomAttachmentStorage(session, 'room-old')).toMatchObject({
    missing: 1,
    saved: 0,
  });
  expect(await store.loadCachedAttachment(session, 'mxc://test/recent')).toBeDefined();
  expect(await store.loadCachedAttachment(session, 'mxc://test/focused')).toBeDefined();
});

const saveText = (roomId: string, ts: number) =>
  store.saveRoomEventsToCacheCommitted(session, roomId, [
    {
      event_id: '$text',
      type: 'm.room.message',
      origin_server_ts: ts,
      content: { body: 'cached message' },
    },
  ]);
const hasText = async (roomId: string) =>
  (await store.loadCachedRoomEvent(session, roomId, '$text')) !== undefined;
/** Set a budget that one room's bytes, of `roomCount` equal rooms, brings back under. */
const budgetOverByHalfARoom = async (roomCount: number) => {
  const { bytesBefore } = await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(bytesBefore - bytesBefore / roomCount / 2);
};

it('evicts the least recently active unprotected rooms when media cannot free enough', async () => {
  await saveText('room-cold', 1);
  await saveText('room-warm', 2);
  await saveText('room-recent', 3);
  await saveText('room-focused', 4);
  await saveText('room-pinned', 5);
  await store.noteRoomOpened(session, 'room-recent');
  await store.setRoomAttachmentPinned(session, 'room-pinned', true);
  store.setEvictionProtectedRoomIds(['room-focused']);
  await store.markRoomTailDiscontinuity(session, 'room-cold', { markedAt: 1, prevBatch: 'gap' });
  await budgetOverByHalfARoom(5);
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result).toMatchObject({ evictedRoomIds: ['room-cold'], underPressure: false });
  expect(await hasText('room-cold')).toBe(false);
  expect(await store.loadRoomTailDiscontinuity(session, 'room-cold')).toBeUndefined();
  for (const roomId of ['room-warm', 'room-recent', 'room-focused', 'room-pinned']) {
    // eslint-disable-next-line no-await-in-loop
    expect(await hasText(roomId)).toBe(true);
  }
});

it("frees an evicted room's essential bodies with its history", async () => {
  await saveText('room-cold', 1);
  await save('body', 'room-cold');
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/essential', bytes: new ArrayBuffer(2000), mimeType: 'text/plain' },
    { roomId: 'room-cold', essential: true }
  );
  await saveText('room-focused', 2);
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(2000);
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result).toMatchObject({ evictedRoomIds: ['room-cold'], underPressure: false });
  expect(await store.loadCachedAttachment(session, 'mxc://test/essential')).toBeUndefined();
  expect(await hasText('room-focused')).toBe(true);
});

it('reports pressure and keeps the text when protected rooms alone exceed the budget', async () => {
  await saveText('room-focused', 1);
  await saveText('room-recent', 2);
  await store.noteRoomOpened(session, 'room-recent');
  store.setEvictionProtectedRoomIds(['room-focused']);
  store.__setCacheStoreByteBudgetForTests(1);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(trace).toHaveBeenCalledWith('storage.cache.eviction', {
    budget_bytes: 1,
    bytes_before: result.bytesBefore,
    bytes_after: result.bytesBefore,
    protected_bytes: result.bytesBefore,
    evicted_media: 0,
    evicted_rooms: 0,
    under_pressure: true,
  });
  expect(result).toMatchObject({ underPressure: true, evictedMxcUris: [], evictedRoomIds: [] });
  expect(await hasText('room-focused')).toBe(true);
  expect(await hasText('room-recent')).toBe(true);
});

it('evicts rooms never opened before rooms opened more than a day ago', async () => {
  await saveText('room-opened', 1);
  await saveText('room-busy', 2);
  const openedAt = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 25 * 60 * 60 * 1000);
  await store.noteRoomOpened(session, 'room-opened');
  openedAt.mockRestore();
  // Federation and traffic do not say whether anyone uses a room.
  await store.noteRoomFederated(session, 'room-opened', true);
  await budgetOverByHalfARoom(2);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: ['room-busy'],
  });
});

it('keeps a room focused while its protection is read', async () => {
  for (let index = 1; index <= 3; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(1);
  const getKey = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function getSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    if (this.name === 'room_ledger' && key === 'room-2')
      store.setEvictionProtectedRoomIds(['room-2']);
    return getKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toEqual(['room-1', 'room-3']);
  expect(await hasText('room-2')).toBe(true);
});

it('keeps a room opened and left again while the pass runs', async () => {
  for (let index = 1; index <= 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(1);
  const deleteKey = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function deleteSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    // Opening stamps the room; leaving it clears the focus registry again.
    if (key === 'room-1') store.noteRoomOpened(session, 'room-4');
    return deleteKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toEqual(['room-1', 'room-2', 'room-3']);
  expect(await hasText('room-4')).toBe(true);
});

it('leaves unused rooms alone when protected text alone exceeds the budget', async () => {
  await saveText('room-cold', 1);
  await saveText('room-focused', 2);
  store.setEvictionProtectedRoomIds(['room-focused']);
  await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(1);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: [],
    underPressure: true,
  });
  expect(await hasText('room-cold')).toBe(true);
});

it("leaves unused rooms alone when a protected room's media alone exceeds the budget", async () => {
  await saveText('room-cold', 1);
  await saveText('room-focused', 2);
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/focused-body', bytes: new ArrayBuffer(4000), mimeType: 'text/plain' },
    { roomId: 'room-focused', essential: true }
  );
  store.setEvictionProtectedRoomIds(['room-focused']);
  await store.runCacheEvictionIfOverBudget(session);
  store.__setCacheStoreByteBudgetForTests(3000);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: [],
    underPressure: true,
  });
  expect(await hasText('room-cold')).toBe(true);
  expect(trace.mock.calls[0]?.[1]?.protected_bytes).toBeGreaterThan(4000);
});

it("counts an evicted room's attachment bytes toward the target", async () => {
  await saveText('room-a', 1);
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/a-body', bytes: new ArrayBuffer(4000), mimeType: 'text/plain' },
    { roomId: 'room-a', essential: true }
  );
  await saveText('room-b', 2);
  const { bytesBefore } = await store.runCacheEvictionIfOverBudget(session);
  // Clearing room-a's text alone would not reach the target; its body does.
  store.__setCacheStoreByteBudgetForTests(bytesBefore - 2000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: ['room-a'],
    underPressure: false,
  });
  expect(await hasText('room-b')).toBe(true);
});

it('keeps a room focused while the pass runs', async () => {
  for (let index = 1; index <= 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  store.__setCacheStoreByteBudgetForTests(1);
  const deleteKey = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function deleteSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    // The first room's ledger row goes; the user opens the last room meanwhile.
    if (key === 'room-1') store.setEvictionProtectedRoomIds(['room-4']);
    return deleteKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toEqual(['room-1', 'room-2', 'room-3']);
  expect(await hasText('room-4')).toBe(true);
});

it('keeps a room pinned while the pass runs', async () => {
  for (let index = 1; index <= 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  store.__setCacheStoreByteBudgetForTests(1);
  const deleteKey = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function deleteSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    if (key === 'room-1') store.setRoomAttachmentPinned(session, 'room-4', true);
    return deleteKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toEqual(['room-1', 'room-2', 'room-3']);
  expect(await hasText('room-4')).toBe(true);
});

it('evicts a room known only from its attachment references', async () => {
  // No cached event left, so the room has no ledger row.
  await store.putCachedAttachment(
    session,
    { mxcUri: 'mxc://test/orphan-body', bytes: new ArrayBuffer(2000), mimeType: 'text/plain' },
    { roomId: 'room-refs', essential: true }
  );
  store.__setCacheStoreByteBudgetForTests(1000);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: ['room-refs'],
    underPressure: false,
  });
  expect(await store.loadCachedAttachment(session, 'mxc://test/orphan-body')).toBeUndefined();
});

it("keeps a room's media when its download starts during the pass", async () => {
  await save('old', 'room-old');
  await save('new', 'room-new');
  store.__setCacheStoreByteBudgetForTests(3000);
  const getKey = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function getSpy(
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    if (key === 'mxc://test/old') store.setEvictionDownloadingRoomIds(session, ['room-old']);
    return getKey.call(this, key);
  });
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedMxcUris).toEqual(['mxc://test/new']);
  expect(await store.loadCachedAttachment(session, 'mxc://test/old')).toBeDefined();
});

it("keeps one session's download protection when another session updates its own", async () => {
  await saveText('room-a', 1);
  // Let the check the save scheduled settle under the default budget.
  await store.runCacheEvictionIfOverBudget(session);
  store.setEvictionDownloadingRoomIds(session, ['room-a']);
  store.setEvictionDownloadingRoomIds('other-session', []);
  store.__setCacheStoreByteBudgetForTests(1);
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    evictedRoomIds: [],
    underPressure: true,
  });
});

it('reads the attachment total once more after the freed bytes reach the target', async () => {
  for (let index = 1; index <= 5; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveText(`room-${index}`, index);
  }
  store.__setCacheStoreByteBudgetForTests(1);
  const keyCursor = vi.spyOn(IDBIndex.prototype, 'openKeyCursor');
  const result = await store.runCacheEvictionIfOverBudget(session);
  expect(result.evictedRoomIds).toHaveLength(5);
  // Admission, the media phase and one final total, not one total per room.
  expect(
    keyCursor.mock.contexts.filter((index) => index.objectStore.name === 'attachments')
  ).toHaveLength(3);
});

it('shares one pass between concurrent checks', async () => {
  await saveText('room-a', 1);
  await saveText('room-b', 2);
  await saveText('room-c', 3);
  await budgetOverByHalfARoom(3);
  const trace = vi.spyOn(deepTrace, 'recordDeepTraceEvent');
  const [first, second] = await Promise.all([
    store.runCacheEvictionIfOverBudget(session),
    store.runCacheEvictionIfOverBudget(session),
  ]);
  expect(second).toBe(first);
  expect(trace.mock.calls.filter(([name]) => name === 'storage.cache.eviction')).toHaveLength(1);
  expect(first.evictedRoomIds).toEqual(['room-a']);
  expect(await hasText('room-b')).toBe(true);
});

it('admits under-budget work without reading raw blobs, references or protection metadata', async () => {
  await save('cached', 'room-a');
  const rawCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
  const all = vi.spyOn(IDBObjectStore.prototype, 'getAll');
  expect(await store.runCacheEvictionIfOverBudget(session)).toMatchObject({
    bytesBefore: 2000,
    underPressure: false,
  });
  expect(rawCursor).not.toHaveBeenCalled();
  expect(all.mock.contexts.map((context) => context.name)).toEqual(['room_ledger']);
});
