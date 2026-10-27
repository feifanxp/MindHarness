import { Direction, MatrixEvent } from 'matrix-js-sdk';
import type { EventTimeline, MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { refreshLatestThreadSlice } from './threadOpenCacheController';

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root:example.org';

const makeMessageEvent = (eventId: string, ts: number, threadRootId?: string) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
      ...(threadRootId ? { 'm.relates_to': { event_id: threadRootId, rel_type: 'm.thread' } } : {}),
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM_ID,
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

/**
 * Minimal EventTimeline stand-in: single timeline (no neighbours) with a
 * mutable backward pagination token, so getLinkedTimelines resolves to
 * exactly this timeline.
 */
const makeTimeline = (initialBackwardToken: string | null) => {
  let backwardToken = initialBackwardToken;
  const timeline = {
    getPaginationToken: vi.fn((dir: Direction) =>
      dir === Direction.Backward ? backwardToken : null
    ),
    setPaginationToken: vi.fn((token: string | null, dir: Direction) => {
      if (dir === Direction.Backward) backwardToken = token;
    }),
    getNeighbouringTimeline: vi.fn(() => null),
  };
  return timeline as unknown as EventTimeline & typeof timeline;
};

describe('refreshLatestThreadSlice', () => {
  const setup = (initialBackwardToken: string | null, exhaustAfterPaginateCall?: number) => {
    const timeline = makeTimeline(initialBackwardToken);
    const rootEvent = makeMessageEvent(THREAD_ID, 1_000);
    const replyEvent = makeMessageEvent('$reply-1:example.org', 2_000, THREAD_ID);
    const thread = {
      getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => timeline }),
      events: [replyEvent],
      rootEvent,
    };
    const room = {
      roomId: ROOM_ID,
      getThread: vi.fn((threadId: string) => (threadId === THREAD_ID ? thread : null)),
      findEventById: vi.fn((eventId: string) => (eventId === THREAD_ID ? rootEvent : undefined)),
    } as unknown as Room;
    const paginateEventTimeline = vi.fn(async () => {
      if (
        exhaustAfterPaginateCall !== undefined &&
        paginateEventTimeline.mock.calls.length >= exhaustAfterPaginateCall
      ) {
        timeline.setPaginationToken(null, Direction.Backward);
      }
      return true;
    });
    const mx = {
      getEventMapper: () => (rawEvent: Record<string, unknown>) =>
        new MatrixEvent(rawEvent as ConstructorParameters<typeof MatrixEvent>[0]),
      paginateEventTimeline,
    } as unknown as MatrixClient;
    return { mx, room, thread, timeline, rootEvent, replyEvent, paginateEventTimeline };
  };

  it('drains backward history to exhaustion so the open leaves a complete snapshot', async () => {
    // The eager-cache contract (2026-07-06): a thread open is the fallback
    // downloader when the background prefetch has not covered this thread
    // yet — it MUST finish with the full history cached, not a partial
    // window. Token exhausts after 3 pages; expect exactly 3 paginations.
    const { mx, room, paginateEventTimeline } = setup('token-deep-history', 3);
    const persistThreadEventCache = vi.fn();

    const result = await refreshLatestThreadSlice(
      {
        mx,
        room,
        persistThreadEventCache,
        shouldAbortRefresh: () => false,
      },
      THREAD_ID
    );

    expect(result).toBeDefined();
    expect(paginateEventTimeline).toHaveBeenCalledTimes(3);
    expect(persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [threadId, , , beforeToken, tailLoaded, snapshotComplete] =
      persistThreadEventCache.mock.calls[0];
    expect(threadId).toBe(THREAD_ID);
    expect(beforeToken).toBeNull();
    expect(tailLoaded).toBe(true);
    expect(snapshotComplete).toBe(true);
    expect(result?.hasMoreCachedBack).toBe(false);
  });

  it('records a complete snapshot when a single page exhausts the token', async () => {
    const { mx, room, paginateEventTimeline } = setup('token-last-page', 1);
    const persistThreadEventCache = vi.fn();

    const result = await refreshLatestThreadSlice(
      {
        mx,
        room,
        persistThreadEventCache,
        shouldAbortRefresh: () => false,
      },
      THREAD_ID
    );

    expect(paginateEventTimeline).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [, , , beforeToken, tailLoaded, snapshotComplete] = persistThreadEventCache.mock.calls[0];
    expect(beforeToken).toBeNull();
    expect(tailLoaded).toBe(true);
    expect(snapshotComplete).toBe(true);
    expect(result?.hasMoreCachedBack).toBe(false);
  });

  it('skips pagination entirely when the SDK has no backward token', async () => {
    const { mx, room, paginateEventTimeline } = setup(null);
    const persistThreadEventCache = vi.fn();

    const result = await refreshLatestThreadSlice(
      {
        mx,
        room,
        persistThreadEventCache,
        shouldAbortRefresh: () => false,
      },
      THREAD_ID
    );

    expect(result?.hasMoreCachedBack).toBe(false);
    expect(paginateEventTimeline).not.toHaveBeenCalled();
    expect(persistThreadEventCache).toHaveBeenCalledTimes(1);
  });
});
