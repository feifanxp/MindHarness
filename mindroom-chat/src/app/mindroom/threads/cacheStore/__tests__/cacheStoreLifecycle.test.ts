import { IDBFactory, IDBKeyRange, IDBObjectStore as FakeIDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const sessionId = 'cache-lifecycle';
const roomId = '!clear:example.org';
const rawEvent = {
  event_id: '$late',
  type: 'm.room.message',
  origin_server_ts: 1,
  content: { body: 'late', msgtype: 'm.text' },
};
const connections: IDBDatabase[] = [];

const createRuntime = async () => {
  vi.resetModules();
  const store = await import('../index');
  const meta = await import('../cacheStoreMeta');
  const dbTools = await import('../cacheStoreDb');
  const probe = await import('../../cacheProbe');
  const db = (await store.openCacheStore(sessionId))!;
  connections.push(db);
  return { ...store, ...meta, ...dbTools, ...probe, db };
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});
afterEach(() => {
  connections.splice(0).forEach((db) => db.close());
  vi.restoreAllMocks();
});

it.each(['room', 'thread', 'attachment', 'progress'] as const)(
  'rejects a pending %s write after this runtime clears the room',
  async (kind) => {
    const writer = await createRuntime();
    const lease = writer.captureCacheStoreWriteLease(sessionId, roomId);
    await writer.clearRoomCachedContent(sessionId, roomId);
    if (kind === 'room') {
      expect(
        await writer.saveRoomEventsToCacheCommitted(
          sessionId,
          roomId,
          [rawEvent],
          undefined,
          'partial',
          lease
        )
      ).toBe(false);
      expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toBeUndefined();
    } else if (kind === 'thread') {
      expect(
        await writer.saveThreadEventsToCacheCommitted(
          sessionId,
          roomId,
          '$root',
          [rawEvent],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'partial',
          lease
        )
      ).toBe(false);
      expect(
        (await writer.loadLatestCachedThreadEvents(sessionId, roomId, '$root', 10)).events
      ).toEqual([]);
    } else if (kind === 'attachment') {
      expect(
        await writer.putCachedAttachment(
          sessionId,
          {
            mxcUri: 'mxc://example.org/late',
            bytes: new ArrayBuffer(1),
            mimeType: 'text/plain',
          },
          { roomId, writeLease: lease }
        )
      ).toBe('revoked');
      expect(
        await writer.loadCachedAttachment(sessionId, 'mxc://example.org/late')
      ).toBeUndefined();
    } else {
      expect(
        await writer.updateRoomOfflineProgress(sessionId, roomId, { savedEvents: 1 }, lease)
      ).toBe(false);
      expect(await writer.readRoomOfflineProgress(sessionId, roomId)).toEqual({});
    }
    expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
  }
);

it('rolls back a failed clear while cancelling earlier local writes', async () => {
  const writer = await createRuntime();
  await writer.saveRoomEventsToCacheCommitted(sessionId, roomId, [rawEvent]);
  const oldLease = writer.captureCacheStoreWriteLease(sessionId, roomId);
  const remove = FakeIDBObjectStore.prototype.delete;
  const fault = vi
    .spyOn(FakeIDBObjectStore.prototype, 'delete')
    .mockImplementation(function abortDelete(key) {
      const request = remove.call(this, key);
      // Abort once the room's events are removed, so the clear must roll back.
      if (key instanceof IDBKeyRange) {
        request.addEventListener('success', () => this.transaction.abort(), { once: true });
      }
      return request;
    });
  await expect(writer.clearRoomCachedContent(sessionId, roomId)).rejects.toBeDefined();
  fault.mockRestore();
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toEqual(rawEvent);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      oldLease
    )
  ).toBe(false);
  expect(await writer.saveRoomEventsToCacheCommitted(sessionId, roomId, [rawEvent])).toBe(true);
  expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
});

it('saves the first fresh snapshot after reopening a previously cleared room', async () => {
  const previous = await createRuntime();
  await previous.saveRoomEventsToCacheCommitted(sessionId, roomId, [rawEvent]);
  await previous.clearRoomCachedContent(sessionId, roomId);
  previous.db.close();
  const current = await createRuntime();
  expect(await current.loadCachedRoomEvent(sessionId, roomId, '$late')).toBeUndefined();
  expect(await current.saveRoomEventsToCacheCommitted(sessionId, roomId, [rawEvent])).toBe(true);
  expect(await current.loadCachedRoomEvent(sessionId, roomId, '$late')).toEqual(rawEvent);
  expect(current.getCacheProbeCounter('writeErrors')).toBe(0);
});

it('does not persist encrypted history when this runtime clears during decryption', async () => {
  const writer = await createRuntime();
  const { persistRoomChunkWithPreferLive } = await import('../../eventRepository');
  const { createClient, Room } = await import('matrix-js-sdk');
  const userId = '@writer:example.org';
  const mx = createClient({ baseUrl: 'https://matrix.example.org', userId });
  const room = new Room(roomId, mx, userId);
  mx.getRoom = (id) => (id === roomId ? room : null);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const decrypting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  mx.decryptEventIfNeeded = async (event) => {
    entered();
    await gate;
    event.setClearData({
      clearEvent: {
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: 'old preview',
          url: 'mxc://example.org/late',
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        },
      },
    });
  };
  const saving = persistRoomChunkWithPreferLive({
    mx,
    sessionId,
    room,
    chunk: [
      {
        ...rawEvent,
        room_id: roomId,
        sender: userId,
        type: 'm.room.encrypted',
        content: { ciphertext: 'encrypted-wire' },
      },
    ],
  }).catch(() => undefined);
  await decrypting;
  await writer.clearRoomCachedContent(sessionId, roomId);
  release();
  await saving;
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toBeUndefined();
  expect(
    (await writer.loadLatestCachedThreadEvents(sessionId, roomId, '$root', 10)).events
  ).toEqual([]);
  expect(await writer.readRoomAttachmentStorage(sessionId, roomId)).toMatchObject({
    saved: 0,
    missing: 0,
  });
  expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
});

it.each(['settle', 'prepare'] as const)(
  'stops %s when its lease is revoked while continuation admission finishes',
  async (phase) => {
    const writer = await createRuntime();
    const { scanThreadRelations, DEFAULT_CONTINUATION_STORE } = await import(
      '../../../engine/reconcilerScan'
    );
    const { createClient, Room, MatrixEvent } = await import('matrix-js-sdk');
    const userId = '@writer:example.org';
    const mx = createClient({ baseUrl: 'https://matrix.example.org', userId });
    const room = new Room(roomId, mx, userId);
    mx.fetchRelations = async (_room, _thread, _relation, _type, options) => {
      if (options?.from) throw new Error('history temporarily unavailable');
      return { chunk: [{ ...rawEvent, room_id: roomId, sender: userId }], next_batch: 'older' };
    };
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const scan = await scanThreadRelations({
      mx,
      sessionId,
      room,
      roomId,
      threadId: '$root',
      cachedPage: undefined,
      cachedEventIds: new Set(),
      signal: new AbortController().signal,
      debugTraceId: undefined,
      preferLive: (raw) => new MatrixEvent(raw),
      continuationStore: {
        ...DEFAULT_CONTINUATION_STORE,
        begin: async (...args) => {
          const marker = await DEFAULT_CONTINUATION_STORE.begin(...args);
          entered();
          await gate;
          return marker;
        },
      },
    });
    expect(scan.scanComplete).toBe(false);
    const result =
      phase === 'settle' ? scan.settleWithoutRepair() : scan.prepareRepairPersistence();
    await admitting;
    writer.revokeRoomCacheStoreWrites(sessionId, roomId);
    release();
    if (phase === 'prepare') expect(await result).toBe(false);
    else {
      await result;
      expect(
        (await writer.loadThreadReconcileContinuation(sessionId, roomId, '$root'))?.nextToken
      ).toBeUndefined();
    }
  }
);

it('permits fresh writes after deleting and recreating the session database', async () => {
  const writer = await createRuntime();
  await writer.clearRoomCachedContent(sessionId, roomId);
  const oldLease = writer.captureCacheStoreWriteLease(sessionId, roomId);
  await writer.deleteCacheStoreDb(sessionId);
  expect(await writer.saveRoomEventsToCacheCommitted(sessionId, roomId, [rawEvent])).toBe(true);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      oldLease
    )
  ).toBe(false);
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toEqual(rawEvent);
  expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
});

it('recovers after another runtime deletes the database without reviving old session leases', async () => {
  const writer = await createRuntime();
  await writer.clearRoomCachedContent(sessionId, roomId);
  const otherSession = 'independent-session';
  await writer.clearRoomCachedContent(otherSession, roomId);
  connections.push((await writer.openCacheStore(otherSession))!);
  const oldRoomLease = writer.captureCacheStoreWriteLease(sessionId, roomId);
  const oldOtherRoomLease = writer.captureCacheStoreWriteLease(sessionId, '!untouched:example.org');
  const independentLease = writer.captureCacheStoreWriteLease(otherSession, roomId);
  const remover = await createRuntime();
  await remover.deleteCacheStoreDb(sessionId);
  expect(await writer.saveRoomEventsToCacheCommitted(sessionId, roomId, [rawEvent])).toBe(true);
  connections.push((await writer.openCacheStore(sessionId))!);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      oldRoomLease
    )
  ).toBe(false);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      sessionId,
      '!untouched:example.org',
      [rawEvent],
      undefined,
      'partial',
      oldOtherRoomLease
    )
  ).toBe(false);
  expect(
    await writer.saveRoomEventsToCacheCommitted(
      otherSession,
      roomId,
      [rawEvent],
      undefined,
      'partial',
      independentLease
    )
  ).toBe(true);
  expect(await writer.loadCachedRoomEvent(sessionId, roomId, '$late')).toEqual(rawEvent);
  expect(writer.getCacheProbeCounter('writeErrors')).toBe(0);
});
