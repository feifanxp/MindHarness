/**
 * CINNY-207 P3.1 Commit 3 — F1 fix regression guard.
 *
 * Verifies that the engine's write-through fires for live events in
 * ANY joined room (not just the room currently mounted in the UI).
 * This is the exact regression class the plan calls out in finding F1:
 * a live message in a background room reaches its cache via the
 * client-level RoomEvent.Timeline listener, so switching to that room
 * later renders from a cache that already knows about the message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room } from 'matrix-js-sdk';

const persistThreadEventCacheSnapshot = vi.fn();
const persistRoomEventCacheSnapshot = vi.fn();

vi.mock('../../threads/eventRepository', () => ({
  persistThreadEventCacheSnapshot: (...args: unknown[]) =>
    persistThreadEventCacheSnapshot(...args),
  persistRoomEventCacheSnapshot: (...args: unknown[]) => persistRoomEventCacheSnapshot(...args),
  deleteRoomEventsFromCache: vi.fn().mockResolvedValue(undefined),
  deleteThreadEventsFromCache: vi.fn().mockResolvedValue(undefined),
  deleteThreadEventFromCacheByEventId: vi.fn().mockResolvedValue(undefined),
  getThreadCacheTargetId: (_room: unknown, mEvent: { threadRootId?: string }) =>
    mEvent.threadRootId,
}));

import { createEngineWriteThrough } from '../engineWriteThrough';
import type { EngineLiveEventMeta } from '../types';

const makeEvent = (id: string, opts: { roomId: string; threadRootId?: string } = { roomId: '' }) => ({
  getId: () => id,
  getRelation: () => undefined,
  getSender: () => '@alice:example.org',
  getTs: () => 0,
  isRedaction: () => false,
  threadRootId: opts.threadRootId,
});

const makeRoom = (roomId: string): Room => ({
  roomId,
  findEventById: () => undefined,
  getThread: () => undefined,
  getLiveTimeline: () => ({ getEvents: () => [] }) as never,
  getUnfilteredTimelineSet: () => undefined as never,
  getThreads: () => [],
}) as unknown as Room;

const meta = (roomId: string): EngineLiveEventMeta => ({
  kind: 'timeline',
  roomId,
  liveEvent: true,
  toStartOfTimeline: false,
});

describe('engineWriteThrough — F1 fix (background room coverage)', () => {
  beforeEach(() => {
    persistThreadEventCacheSnapshot.mockReset();
    persistRoomEventCacheSnapshot.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists a live event delivered for a room the UI is not mounted on', () => {
    const backgroundRoom = makeRoom('!background:example.org');
    const foregroundRoom = makeRoom('!foreground:example.org');

    const writer = createEngineWriteThrough({ sessionId: 'session' });

    // A live event arrives for the BACKGROUND room. Under the old
    // component-scoped listener this would have been dropped because
    // the room-scoped room.on() only ran for the mounted room.
    const backgroundEvent = makeEvent('$evt-bg', { roomId: '!background:example.org' });
    writer.handleLiveEvent(
      backgroundEvent as unknown as MatrixEvent,
      backgroundRoom,
      meta('!background:example.org')
    );

    expect(persistRoomEventCacheSnapshot).toHaveBeenCalledTimes(1);
    const call = persistRoomEventCacheSnapshot.mock.calls[0][0];
    expect(call.room.roomId).toBe('!background:example.org');
    expect(call.events).toEqual([backgroundEvent]);

    // A subsequent live event for the FOREGROUND room ALSO persists,
    // proving both flows share the same write-through.
    persistRoomEventCacheSnapshot.mockReset();
    const foregroundEvent = makeEvent('$evt-fg', { roomId: '!foreground:example.org' });
    writer.handleLiveEvent(
      foregroundEvent as unknown as MatrixEvent,
      foregroundRoom,
      meta('!foreground:example.org')
    );

    expect(persistRoomEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistRoomEventCacheSnapshot.mock.calls[0][0].room.roomId).toBe(
      '!foreground:example.org'
    );
  });

  it('captures thread attribution from the event (not from any UI context) — thread events persist to their thread cache', () => {
    const room = makeRoom('!room:example.org');
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    const threadReply = makeEvent('$reply-1', {
      roomId: '!room:example.org',
      threadRootId: '$thread-root',
    });
    writer.handleLiveEvent(
      threadReply as unknown as MatrixEvent,
      room,
      meta('!room:example.org')
    );

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].threadId).toBe('$thread-root');
    // tailLoaded:true is the engine's semantic (see engineWriteThrough
    // header — live events are by definition at the tail).
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].tailLoaded).toBe(true);
  });
});
