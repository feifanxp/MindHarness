/**
 * PR #84 review deferral (finding #3): `meta.expectedReplyCount` merge
 * policy. Background sweep chunks persist a per-thread
 * expectedReplyCount derived from the live root's bundled
 * `m.thread.count` — which the SDK does NOT update as replies arrive
 * and which is stale when the root is restored from the SDK store. An
 * unconditional overwrite let a stale-LOW sweep value replace a
 * fresher count, weakening the reply-count completeness proof the
 * eager-cache open path leans on.
 *
 * Policy under test:
 *   - snapshotComplete !== true writes (sweeps, partial persists):
 *     expectedReplyCount merges MONOTONICALLY (max of stored/incoming)
 *     — a stale-low value can never weaken the proof.
 *   - snapshotComplete === true writes (authoritative full-drain
 *     proof): SET absolutely — the only writer allowed to LOWER the
 *     count, because redactions legitimately shrink threads and the
 *     drain observed the real reply set.
 */

import 'fake-indexeddb/auto';
import type { IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadLatestCachedThreadEvents,
  resetCacheStoreForTesting,
  saveThreadEventsToCache,
} from '..';

const SESSION_ID = 'reply-count-merge-session';
const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root:example.org';

const rawReply = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  type: 'm.room.message',
  room_id: ROOM_ID,
  sender: '@alice:example.org',
  content: {
    body: id,
    'm.relates_to': { event_id: THREAD_ID, rel_type: 'm.thread' },
  },
});

const saveWithCount = (
  expectedReplyCount: number | undefined,
  snapshotComplete: boolean | undefined,
  eventId = '$reply-1'
) =>
  saveThreadEventsToCache(
    SESSION_ID,
    ROOM_ID,
    THREAD_ID,
    [rawReply(eventId, 1_000)],
    undefined,
    undefined,
    undefined,
    snapshotComplete,
    expectedReplyCount,
    undefined
  );

const storedCount = async (): Promise<number | undefined> =>
  (await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 5)).expectedReplyCount;

describe('thread meta expectedReplyCount merge policy', () => {
  beforeEach(() => resetCacheStoreForTesting());
  afterEach(() => resetCacheStoreForTesting());

  it('a non-complete write with a stale-LOW count cannot lower the stored value', async () => {
    await saveWithCount(282, undefined, '$reply-1');
    await saveWithCount(20, undefined, '$reply-2');
    expect(await storedCount()).toBe(282);
  });

  it('a non-complete write with a HIGHER count raises the stored value', async () => {
    await saveWithCount(20, undefined, '$reply-1');
    await saveWithCount(282, undefined, '$reply-2');
    expect(await storedCount()).toBe(282);
  });

  it('a complete-proof write may LOWER the stored value (redactions shrink threads)', async () => {
    await saveWithCount(282, undefined, '$reply-1');
    await saveWithCount(200, true, '$reply-2');
    expect(await storedCount()).toBe(200);
  });

  it('an undefined incoming count keeps the stored value', async () => {
    await saveWithCount(282, undefined, '$reply-1');
    await saveWithCount(undefined, undefined, '$reply-2');
    expect(await storedCount()).toBe(282);
  });

  it('a count-LESS complete write retains the stored value (refreshLatestThreadSlice shape)', async () => {
    // Production-reachable: refreshLatestThreadSlice persists complete
    // snapshots without an expectedReplyCount argument. The complete-
    // proof "set absolutely" rule applies only when the write carries
    // a count — with none, there is no observation to prefer.
    await saveWithCount(282, undefined, '$reply-1');
    await saveWithCount(undefined, true, '$reply-2');
    expect(await storedCount()).toBe(282);
  });
});
