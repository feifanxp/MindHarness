import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, EventStatus, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import { resetCacheHealthForTesting } from './cacheHealth';
import { loadCachedRoomEvent, resetCacheStoreForTesting } from './cacheStore';
import { readRoomOfflineProgress } from './cacheStore/cacheStoreMeta';
import { persistRoomChunkWithPreferLive } from './eventRepository';

const roomId = '!relation-repair:test';
const userId = '@alice:test';
const raw = (
  id: string,
  content: IEvent['content'] = { msgtype: 'm.text', body: id }
): Partial<IEvent> => ({
  event_id: id,
  room_id: roomId,
  sender: userId,
  origin_server_ts: 1,
  type: 'm.room.message',
  content,
});
const fixture = () => {
  const mx = createClient({ baseUrl: 'https://matrix.test', userId });
  const room = new Room(roomId, mx, userId);
  mx.getRoom = (id) => (id === roomId ? room : null);
  const sessionId = createSessionId(mx.getHomeserverUrl(), userId);
  const persist = (chunk: Partial<IEvent>[]) =>
    persistRoomChunkWithPreferLive({ mx, room, sessionId, chunk });
  return { mx, room, sessionId, persist };
};
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
});
afterEach(() => {
  resetCacheStoreForTesting();
  vi.restoreAllMocks();
});

it('does not track ordinary reply links as unresolved mutation work', async () => {
  const { sessionId, persist } = fixture();
  await persist([
    raw('$reply', {
      msgtype: 'm.text',
      body: 'reply',
      'm.relates_to': { 'm.in_reply_to': { event_id: '$absent' } },
    }),
  ]);
  const progress = await readRoomOfflineProgress(sessionId, roomId);
  expect(progress.unresolvedRelations).toEqual({});
});

it('does not rewrite or rescan unrelated unresolved redactions on a live message', async () => {
  const { persist } = fixture();
  await persist([{ ...raw('$unknown-redaction'), type: 'm.room.redaction', redacts: '$absent' }]);
  const puts = vi.spyOn(IDBObjectStore.prototype, 'put');
  const cursors = vi.spyOn(IDBIndex.prototype, 'openCursor');
  const result = await persist([raw('$fresh')]);
  const written = puts.mock.calls
    .map(([record]) => (record as { eventId?: string }).eventId)
    .filter(Boolean);
  expect(written).toEqual(['$fresh']);
  expect(result!.events.map((event) => event.getId())).toEqual(['$fresh']);
  expect(cursors.mock.calls).toHaveLength(0);
});

it('repairs an earlier edit as soon as its missing target arrives', async () => {
  const { sessionId, persist } = fixture();
  await persist([
    raw('$edit', {
      msgtype: 'm.text',
      body: 'edit',
      'm.new_content': { msgtype: 'm.text', body: 'latest' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
    }),
  ]);
  const saved = await persist([raw('$target')]);
  expect(saved!.events.find((event) => event.getId() === '$target')?.getContent().body).toBe(
    'latest'
  );
  expect(
    (await loadCachedRoomEvent(sessionId, roomId, '$target'))?.unsigned?.['m.relations']?.[
      'm.replace'
    ]?.event_id
  ).toBe('$edit');
});

it('applies an earlier redaction when its target arrives', async () => {
  const { sessionId, persist } = fixture();
  await persist([{ ...raw('$redaction'), type: 'm.room.redaction', redacts: '$target' }]);
  const saved = await persist([raw('$target')]);
  expect(saved!.events.find((event) => event.getId() === '$target')?.isRedacted()).toBe(true);
  expect((await loadCachedRoomEvent(sessionId, roomId, '$target'))?.content).not.toHaveProperty(
    'body'
  );
});

it('repairs a pending redaction when its compacted edit arrives inside the owner', async () => {
  const { sessionId, persist } = fixture();
  await persist([{ ...raw('$redaction'), type: 'm.room.redaction', redacts: '$edit' }]);
  const root = raw('$target');
  root.unsigned = {
    'm.relations': {
      'm.replace': {
        ...raw('$edit', {
          msgtype: 'm.text',
          body: 'edited',
          'm.new_content': { msgtype: 'm.text', body: 'deleted edit' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
        }),
        origin_server_ts: 2,
      },
    },
  };
  const saved = await persist([root]);
  expect(saved!.events.find((event) => event.getId() === '$target')?.getContent().body).toBe(
    '$target'
  );
  expect((await readRoomOfflineProgress(sessionId, roomId)).unresolvedRelations).toEqual({});
});

it('does not make a pending local edit authoritative after cache replay', async () => {
  const client = fixture();
  const root = new MatrixEvent(raw('$target'));
  await client.room.addLiveEvents([root], { addToState: false });
  await client.persist([root.event]);
  const pending = new MatrixEvent({
    ...raw('~local-edit', {
      msgtype: 'm.text',
      body: 'local',
      'm.new_content': { msgtype: 'm.text', body: 'pending content' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
    }),
    origin_server_ts: 100,
  });
  pending.setStatus(EventStatus.SENDING);
  pending.setTxnId('pending-edit');
  client.room.addPendingEvent(pending, 'pending-edit');
  await vi.waitFor(() => expect(root.replacingEvent()).toBe(pending));
  // Revision reconciliation can copy the current replacement into raw unsigned data.
  root.setUnsigned({ 'm.relations': { 'm.replace': pending.event } });
  await persistRoomChunkWithPreferLive({ ...client, chunk: [root.event], mappedEvents: [root] });
  const retained = (await loadCachedRoomEvent(client.sessionId, roomId, '$target'))!;
  expect(retained.unsigned?.['m.relations']?.['m.replace']).toBeUndefined();
  const cold = fixture();
  await cold.persist([retained]);
  const saved = await cold.persist([
    { ...pending.event, event_id: '$server-edit', origin_server_ts: 2 },
  ]);
  expect(
    saved!.events
      .find((event) => event.getId() === '$target')
      ?.replacingEvent()
      ?.getId()
  ).toBe('$server-edit');
  expect(
    (await loadCachedRoomEvent(client.sessionId, roomId, '$target'))?.unsigned?.['m.relations']?.[
      'm.replace'
    ]?.event_id
  ).toBe('$server-edit');
});

it('does not rescan retained events or attachment owners when retrying a marked unknown redaction', async () => {
  const { persist } = fixture();
  const redaction = { ...raw('$unknown'), type: 'm.room.redaction', redacts: '$absent' };
  await persist([redaction]);
  const scans = vi.spyOn(IDBIndex.prototype, 'openCursor');
  const references = vi.spyOn(IDBIndex.prototype, 'getAll');
  await persist([redaction]);
  expect(scans).not.toHaveBeenCalled();
  expect(
    references.mock.instances.filter((index) => index.objectStore.name === 'attachment_references')
  ).toHaveLength(0);
});
