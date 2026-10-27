import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { afterEach, expect, it } from 'vitest';
import { deleteCacheStoreDb, openCacheStore } from '../cacheStoreDb';
import {
  loadLatestCachedThreadEvents,
  saveThreadEventsToCacheCommitted,
} from '../cacheStoreEvents';

const sessionId = 'unexpected-close';
const roomId = '!room:example.org';
const threadId = '$root';

afterEach(async () => {
  await deleteCacheStoreDb(sessionId);
});

it('reads existing thread history and accepts new writes after unexpected database closure', async () => {
  const reply = {
    event_id: '$reply',
    room_id: roomId,
    type: 'm.room.message',
    sender: '@alice:example.org',
    origin_server_ts: 1,
    content: {
      msgtype: 'm.text',
      body: 'Saved reply',
      'm.relates_to': { rel_type: 'm.thread', event_id: threadId },
    },
  };
  expect(await saveThreadEventsToCacheCommitted(sessionId, roomId, threadId, [reply])).toBe(true);
  const db = (await openCacheStore(sessionId))!;
  const closed = new Promise<void>((resolve) => {
    db.addEventListener('close', () => resolve(), { once: true });
  });
  // fake-indexeddb 6.2 declares a constructor here but accepts a connection.
  forceCloseDatabase(db as unknown as Parameters<typeof forceCloseDatabase>[0]);
  await closed;

  expect((await loadLatestCachedThreadEvents(sessionId, roomId, threadId, 10)).events).toEqual([
    reply,
  ]);
  const next = { ...reply, event_id: '$next', origin_server_ts: 2 };
  expect(await saveThreadEventsToCacheCommitted(sessionId, roomId, threadId, [next])).toBe(true);
  expect((await loadLatestCachedThreadEvents(sessionId, roomId, threadId, 10)).events).toEqual([
    reply,
    next,
  ]);
});
