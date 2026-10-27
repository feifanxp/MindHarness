import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadCachedEventAcrossRoomScopes, loadRoomOfflineEventBatch } from '../cacheStoreEvents';
import { getCacheStoreDbName, openCacheStore, resetCacheStoreForTesting } from '../cacheStoreDb';
import {
  getCachedAttachmentMetadata,
  loadCachedAttachment,
  readRoomAttachmentStorage,
} from '../cacheStoreAttachments';
import {
  ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX,
  ATTACHMENT_REFERENCES_BY_ROOM_INDEX,
  ATTACHMENT_REFERENCES_STORE,
  ATTACHMENTS_STORE,
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  META_STORE,
  ROOM_LEDGER_STORE,
  THREAD_SUMMARIES_BY_ROOM_INDEX,
  THREAD_SUMMARIES_STORE,
  type CachedEventRecord,
} from '../cacheStoreSchema';

const SESSION_ID = 'schema-upgrade-session';

const seedVersionThreeDatabase = async (version = 3): Promise<CachedEventRecord> => {
  const seededEvent: CachedEventRecord = {
    cacheKey: '!room:example.org||$event',
    roomId: '!room:example.org',
    scope: '',
    eventId: '$event',
    ts: 123,
    rawEvent: {
      event_id: '$event',
      origin_server_ts: 123,
      room_id: '!room:example.org',
      type: 'm.room.message',
      content: { body: 'preserved', msgtype: 'm.text' },
    },
    approxBytes: 128,
  };
  const request = indexedDB.open(getCacheStoreDbName(SESSION_ID), version);
  request.onupgradeneeded = () => {
    const db = request.result;
    const events = db.createObjectStore(EVENTS_STORE, { keyPath: 'cacheKey' });
    events.createIndex(EVENTS_BY_SCOPE_TS_INDEX, ['roomId', 'scope', 'ts', 'eventId']);
    db.createObjectStore(META_STORE, { keyPath: 'metaKey' });
    const ledger = db.createObjectStore(ROOM_LEDGER_STORE, { keyPath: 'roomId' });
    const summaries = db.createObjectStore(THREAD_SUMMARIES_STORE, { keyPath: 'cacheKey' });
    summaries.createIndex(THREAD_SUMMARIES_BY_ROOM_INDEX, 'roomId');
    if (version >= 4) {
      const attachments = db.createObjectStore(ATTACHMENTS_STORE, { keyPath: 'mxcUri' });
      const refs = db.createObjectStore(ATTACHMENT_REFERENCES_STORE, { keyPath: 'referenceKey' });
      refs.createIndex(ATTACHMENT_REFERENCES_BY_ROOM_INDEX, 'roomId');
      refs.createIndex(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX, 'mxcUri');
      const mxcUri = 'mxc://example.org/shared-body';
      attachments.put({
        mxcUri,
        bytes: new Uint8Array([1, 2, 3]).buffer,
        byteLength: 3,
        mimeType: 'application/octet-stream',
        essential: true,
        storedAt: 10,
        lastAccessedAt: 20,
      });
      for (const [roomId, eventId, status] of [
        ['!room:example.org', '$event', 'cached'],
        ['!other:example.org', '$other', 'missing'],
      ]) {
        refs.put({
          referenceKey: JSON.stringify([roomId, mxcUri, eventId]),
          roomId,
          eventId,
          mxcUri,
          revisionTs: 123,
          revisionId: '$edit',
          essential: true,
          byteLength: 3,
          maxBytes: 1024,
          status,
          updatedAt: 20,
        });
      }
      ledger.put({
        roomId: '!room:example.org',
        pinned: true,
        approxBytes: 128,
        eventCount: 1,
        lastActivityTs: 123,
      });
    }
    events.put(seededEvent);
  };
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
  return seededEvent;
};

describe('cacheStore attachment schema', () => {
  beforeEach(() => {
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
  });

  it.each([3, 4, 5])(
    'adds indexes without replacing version-%s retained content',
    async (version) => {
      const seededEvent = await seedVersionThreeDatabase(version);

      const db = await openCacheStore(SESSION_ID);

      expect(db?.objectStoreNames.contains(ATTACHMENTS_STORE)).toBe(true);
      expect(
        db?.transaction(EVENTS_STORE).objectStore(EVENTS_STORE).indexNames.contains('by_room_event')
      ).toBe(true);
      expect(db?.objectStoreNames.contains(ATTACHMENT_REFERENCES_STORE)).toBe(true);
      const transaction = db?.transaction([EVENTS_STORE, ATTACHMENT_REFERENCES_STORE], 'readonly');
      const eventRequest = transaction?.objectStore(EVENTS_STORE).get(seededEvent.cacheKey);
      const references = transaction?.objectStore(ATTACHMENT_REFERENCES_STORE);
      expect(db?.version).toBe(6);
      expect(
        db
          ?.transaction(ATTACHMENTS_STORE)
          .objectStore(ATTACHMENTS_STORE)
          .indexNames.contains('by_access_bytes')
      ).toBe(true);
      expect(references?.indexNames.contains('by_owner')).toBe(true);
      expect(references?.indexNames.contains(ATTACHMENT_REFERENCES_BY_ROOM_INDEX)).toBe(true);
      expect(references?.indexNames.contains(ATTACHMENT_REFERENCES_BY_ATTACHMENT_INDEX)).toBe(true);
      const preservedEvent = await new Promise<CachedEventRecord | undefined>((resolve, reject) => {
        if (!eventRequest) {
          resolve(undefined);
          return;
        }
        eventRequest.onsuccess = () =>
          resolve(eventRequest.result as CachedEventRecord | undefined);
        eventRequest.onerror = () => reject(eventRequest.error);
      });
      expect(preservedEvent?.rawEvent.content).toEqual({
        body: 'preserved',
        msgtype: 'm.text',
      });
      if (version >= 4) {
        const mxcUri = 'mxc://example.org/shared-body';
        const attachment = await loadCachedAttachment(SESSION_ID, mxcUri);
        expect(Array.from(new Uint8Array(attachment!.bytes))).toEqual([1, 2, 3]);
        expect(attachment).toMatchObject({
          byteLength: 3,
          essential: true,
          storedAt: 10,
          lastAccessedAt: 20,
        });
        const metadata = await getCachedAttachmentMetadata(SESSION_ID, mxcUri);
        expect(metadata?.references).toHaveLength(2);
        expect(metadata?.references).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              roomId: '!room:example.org',
              eventId: '$event',
              status: 'cached',
              revisionId: '$edit',
              maxBytes: 1024,
            }),
            expect.objectContaining({
              roomId: '!other:example.org',
              eventId: '$other',
              status: 'missing',
              revisionId: '$edit',
              maxBytes: 1024,
            }),
          ])
        );
        expect(await readRoomAttachmentStorage(SESSION_ID, '!room:example.org')).toMatchObject({
          bytes: 3,
          saved: 1,
          missing: 0,
          missingEssential: 0,
          pinned: true,
        });
        expect(await readRoomAttachmentStorage(SESSION_ID, '!other:example.org')).toMatchObject({
          bytes: 3,
          saved: 0,
          missing: 1,
          missingEssential: 1,
          pinned: false,
        });
      }
    }
  );
});

it('indexed target lookup merges duplicate tombstones and finds metadata-only roots', async () => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  const row = await seedVersionThreeDatabase(4);
  const db = (await openCacheStore(SESSION_ID))!;
  const tx = db.transaction([EVENTS_STORE, META_STORE], 'readwrite');
  const tombstone = {
    ...row.rawEvent,
    content: {},
    unsigned: {
      redacted_because: { type: 'm.room.redaction', event_id: '$redaction', content: {} },
    },
  };
  tx.objectStore(EVENTS_STORE).put({
    ...row,
    cacheKey: 'duplicate',
    scope: '$thread',
    rawEvent: tombstone,
  });
  tx.objectStore(META_STORE).put({
    metaKey: row.roomId + '|$root',
    roomId: row.roomId,
    scope: '$root',
    rootEvent: { ...row.rawEvent, event_id: '$root' },
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  expect(
    (await loadCachedEventAcrossRoomScopes(SESSION_ID, row.roomId, '$event'))?.unsigned
      ?.redacted_because
  ).toBeDefined();
  expect((await loadCachedEventAcrossRoomScopes(SESSION_ID, row.roomId, '$root'))?.event_id).toBe(
    '$root'
  );
  const batch = await loadRoomOfflineEventBatch(SESSION_ID, row.roomId, undefined, 1);
  expect(batch.events).toHaveLength(1);
  expect(batch.events[0].unsigned?.redacted_because).toBeDefined();
  expect(
    await loadCachedEventAcrossRoomScopes(SESSION_ID, '!other:test', '$event')
  ).toBeUndefined();
});
