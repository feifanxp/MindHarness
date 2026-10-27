import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteCacheStoreDb,
  loadLatestCachedThreadEventsBatch,
  openCacheStore,
  saveThreadEventsToCache,
} from '../index';

const SESSION_ID = 'cache-batch-session';
const ROOM_ID = '!room:example.org';

const rawEvent = (eventId: string, ts: number) => ({
  event_id: eventId,
  origin_server_ts: ts,
  sender: '@alice:example.org',
  type: 'm.room.message',
  content: { body: eventId },
});

describe('loadLatestCachedThreadEventsBatch', () => {
  afterEach(async () => {
    await deleteCacheStoreDb(SESSION_ID);
    vi.restoreAllMocks();
  });

  it('loads several thread tails through one readonly transaction', async () => {
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      '$thread-a',
      [rawEvent('$a1', 10), rawEvent('$a2', 20)],
      rawEvent('$thread-a', 1)
    );
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      '$thread-b',
      [rawEvent('$b1', 30)],
      rawEvent('$thread-b', 2)
    );
    const db = await openCacheStore(SESSION_ID);
    const transactionSpy = vi.spyOn(db!, 'transaction');

    const pages = await loadLatestCachedThreadEventsBatch(
      SESSION_ID,
      ROOM_ID,
      ['$thread-a', '$thread-b'],
      32
    );

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(pages.get('$thread-a')?.events.map((event) => event.event_id)).toEqual([
      '$a1',
      '$a2',
    ]);
    expect(pages.get('$thread-b')?.events.map((event) => event.event_id)).toEqual(['$b1']);
  });
});
