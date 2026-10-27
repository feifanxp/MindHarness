/**
 * Regression coverage for the redacted-relation scrub gate.
 *
 * The room/thread save paths only run the room-wide scrub cursor for
 * redacted ids that have never been marked before — once an id has a
 * marker row, its historical repair is complete and re-scrubbing on
 * later saves is pure work. This test observes the gate through cursor
 * spy counts on the events store index (the only IDB index the scrub
 * walks).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadLatestCachedRoomEvents,
  resetCacheStoreForTesting,
  saveRoomEventsToCache,
} from '..';

const SESSION_ID = 'scrub-gate-session';
const ROOM_ID = '!room:example.org';
const SENDER = '@alice:example.org';

const message = (eventId: string, body: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  origin_server_ts: ts,
  sender: SENDER,
  type: 'm.room.message',
  content: { body },
});

const redaction = (eventId: string, target: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  origin_server_ts: ts,
  sender: SENDER,
  type: 'm.room.redaction',
  redacts: target,
  content: {},
});

describe('cacheStore redacted-relation scrub gate', () => {
  beforeEach(() => {
    // Fresh IDB per test; drop memoized dbPromise entries.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCacheStoreForTesting();
  });

  it('skips the room-wide scrub cursor when every redacted id already has a marker', async () => {
    // Seed a small room with the redaction target and a live event.
    const target = message('$target', 'to-redact', 100);
    const live = message('$live', 'stays', 200);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [target, live]);

    // First save with the redaction runs the room-wide scrub cursor.
    // Spy on IDBIndex.prototype.openCursor: the scrub is the only path
    // that opens a cursor over the events index inside a save.
    const openCursorSpy = vi.spyOn(IDBIndex.prototype, 'openCursor');
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [redaction('$redact-1', '$target', 300)]);
    const cursorsAfterFirstScrub = openCursorSpy.mock.calls.length;
    expect(cursorsAfterFirstScrub).toBeGreaterThan(0);

    // The target is now gone and a marker row was written for `$target`.
    const scrubbed = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 20);
    expect(scrubbed.events.map((event) => event.event_id)).not.toContain('$target');

    // Second save with the SAME redacted id and a fresh normal event —
    // the events-index cursor must NOT open again on the scrub path.
    openCursorSpy.mockClear();
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      message('$live-2', 'later', 400),
      redaction('$redact-2', '$target', 400),
    ]);
    expect(openCursorSpy).not.toHaveBeenCalled();

    // Newly-seen redaction id still triggers a scrub.
    const anotherTarget = message('$target-2', 'another', 500);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [anotherTarget]);
    openCursorSpy.mockClear();
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [redaction('$redact-3', '$target-2', 600)]);
    expect(openCursorSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
