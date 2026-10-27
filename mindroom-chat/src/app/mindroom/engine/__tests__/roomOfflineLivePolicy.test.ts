import 'fake-indexeddb/auto';
import { IDBFactory, IDBIndex } from 'fake-indexeddb';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRoomOfflineController } from '../roomOffline';
import { createBackfillScheduler } from '../backfillScheduler';
import { resetCacheStoreForTesting } from '../../threads/cacheStore';
import { resetCacheHealthForTesting } from '../../threads/cacheHealth';
import { updateRoomOfflineProgress } from '../../threads/cacheStore/cacheStoreMeta';
import { persistRoomChunkWithPreferLive } from '../../threads/eventRepository';

const sessionId = 'live-policy';
const roomId = '!room:example.org';
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const setup = async (scope: 'all-rooms' | 'current-room-only') => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
  const room = new Room(roomId, mx, '@alice:example.org');
  mx.store.storeRoom(room);
  vi.spyOn(mx, 'getVersions').mockResolvedValue({ versions: ['v1.11'] });
  const scheduler = createBackfillScheduler();
  const control = createRoomOfflineController({
    mx,
    sessionId,
    scheduler,
    connection: {
      getSnapshot: () => ({ connected: true, unmetered: false }),
      subscribe: () => () => undefined,
    },
    getPrefetchConfig: () => ({ scope }),
    onChanged: () => undefined,
  });
  await updateRoomOfflineProgress(sessionId, roomId, { opened: true });
  const event = new MatrixEvent({
    event_id: '$body',
    room_id: roomId,
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: 1,
    content: {
      msgtype: 'm.text',
      body: 'preview',
      url: 'mxc://example.org/body',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  });
  await persistRoomChunkWithPreferLive({
    mx,
    sessionId,
    room,
    chunk: [event.event],
    mappedEvents: [event],
  });
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'full body' }))
  );
  vi.stubGlobal('fetch', fetch);
  control.start();
  return { control, event, fetch, mx };
};

it.each(['current-room-only', 'all-rooms'] as const)(
  'live bodies in an opened background room obey %s scope',
  async (scope) => {
    const { control, event, fetch } = await setup(scope);
    try {
      await control.observe([event], roomId);
      expect(fetch).toHaveBeenCalledTimes(scope === 'all-rooms' ? 1 : 0);
    } finally {
      control.stop();
    }
  }
);

it('ordinary live events do not rescan attachment counts without a subscriber', async () => {
  const { control } = await setup('current-room-only');
  const scans = vi.spyOn(IDBIndex.prototype, 'getAll');
  try {
    await control.observe([], roomId);
    expect(scans).not.toHaveBeenCalled();
  } finally {
    control.stop();
  }
});

it('does not schedule attachment work for an inline replacement', async () => {
  const { control, event, mx } = await setup('all-rooms');
  event.makeReplaced(
    new MatrixEvent({
      ...event.event,
      event_id: '$inline-edit',
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: event.getId() },
        'm.new_content': { msgtype: 'm.text', body: 'inline now' },
      },
    })
  );
  try {
    await control.observe([event], roomId);
    expect(mx.getVersions).not.toHaveBeenCalled();
  } finally {
    control.stop();
  }
});
