import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginThreadReconcileContinuation,
  checkpointThreadReconcileContinuation,
  clearThreadReconcileContinuation,
  deleteCacheStoreDb,
  loadThreadReconcileContinuation,
  resetCacheStoreForTesting,
  restartThreadReconcileContinuationFromHead,
  saveThreadEventsToCache,
} from '..';

const SESSION_ID = 'reconcile-continuation-session';
const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread';

describe('thread reconciliation continuation', () => {
  beforeEach(() => resetCacheStoreForTesting());
  afterEach(async () => {
    await deleteCacheStoreDb(SESSION_ID);
    resetCacheStoreForTesting();
  });

  it('survives thread cache writes and advances only for its generation', async () => {
    const marker = {
      generation: 'generation-a',
      startedAt: 1,
      overlapEventIds: ['$known'],
    };

    expect(await beginThreadReconcileContinuation(SESSION_ID, ROOM_ID, THREAD_ID, marker)).toEqual(
      marker
    );
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [
      { event_id: '$partial', origin_server_ts: 2 },
    ]);
    expect(await loadThreadReconcileContinuation(SESSION_ID, ROOM_ID, THREAD_ID)).toEqual(marker);

    expect(
      await checkpointThreadReconcileContinuation(
        SESSION_ID,
        ROOM_ID,
        THREAD_ID,
        'stale-generation',
        'ignored'
      )
    ).toBe(false);
    expect(
      await checkpointThreadReconcileContinuation(
        SESSION_ID,
        ROOM_ID,
        THREAD_ID,
        marker.generation,
        'page-2'
      )
    ).toBe(true);
    expect(await loadThreadReconcileContinuation(SESSION_ID, ROOM_ID, THREAD_ID)).toEqual({
      ...marker,
      nextToken: 'page-2',
    });
    const restarted = await restartThreadReconcileContinuationFromHead(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      marker.generation,
      'generation-b'
    );
    expect(restarted).toEqual({
      ...marker,
      generation: 'generation-b',
      validatingHead: true,
    });
    expect(await loadThreadReconcileContinuation(SESSION_ID, ROOM_ID, THREAD_ID)).toEqual({
      ...marker,
      generation: 'generation-b',
      validatingHead: true,
    });

    expect(
      await checkpointThreadReconcileContinuation(
        SESSION_ID,
        ROOM_ID,
        THREAD_ID,
        marker.generation,
        'stale-page'
      )
    ).toBe(false);
    expect(
      await clearThreadReconcileContinuation(SESSION_ID, ROOM_ID, THREAD_ID, marker.generation)
    ).toBe(false);
    expect(
      await clearThreadReconcileContinuation(
        SESSION_ID,
        ROOM_ID,
        THREAD_ID,
        restarted?.generation ?? ''
      )
    ).toBe(true);
    expect(await loadThreadReconcileContinuation(SESSION_ID, ROOM_ID, THREAD_ID)).toBeUndefined();
  });
});
