import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { describe, expect, it, vi } from 'vitest';
import { getOptimisticReceiptUnreadInfo, getRoomUnreadAction } from './roomToUnread';

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root';
const USER_ID = '@alice:example.org';

const makeMessageEvent = (eventId: string, sender = '@bob:example.org') =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
  });

const makeThreadReplyEvent = (eventId: string) =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: THREAD_ID,
        'm.in_reply_to': {
          event_id: THREAD_ID,
        },
        is_falling_back: true,
        rel_type: RelationType.Thread,
      },
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: ROOM_ID,
    sender: '@bob:example.org',
    type: 'm.room.message',
  });

const makeRoom = ({
  events,
  highlight = 0,
  membership = 'join',
  roomHighlight = highlight,
  readUpToEventId = null,
  threadHighlight = 0,
  total = 0,
  roomTotal = total,
  threadTotal = 0,
}: {
  events: MatrixEvent[];
  highlight?: number;
  membership?: string;
  roomHighlight?: number;
  readUpToEventId?: string | null;
  threadHighlight?: number;
  total?: number;
  roomTotal?: number;
  threadTotal?: number;
}) =>
  ({
    findEventById: vi.fn(() => undefined),
    roomId: ROOM_ID,
    getEventReadUpTo: vi.fn(() => readUpToEventId),
    getLiveTimeline: vi.fn(() => ({
      getEvents: () => events,
    })),
    getMyMembership: vi.fn(() => membership),
    getUnreadNotificationCount: vi.fn((type: string) => {
      if (type === 'highlight') return highlight;
      return total;
    }),
    getRoomUnreadNotificationCount: vi.fn((type: string) => {
      if (type === 'highlight') return roomHighlight;
      return roomTotal;
    }),
    getThreadUnreadNotificationCount: vi.fn((threadId: string, type: string) => {
      if (threadId !== THREAD_ID) return 0;
      if (type === 'highlight') return threadHighlight;
      return threadTotal;
    }),
    isSpaceRoom: vi.fn(() => false),
  }) as const;

const makeClient = () =>
  ({
    getAccountData: vi.fn(() => undefined),
    getRoomPushRule: vi.fn(() => undefined),
    getUserId: vi.fn(() => USER_ID),
  }) as const;

describe('getRoomUnreadAction', () => {
  it('keeps a room unread entry when aggregate unread counts remain', () => {
    const room = makeRoom({
      events: [makeMessageEvent('$main')],
      readUpToEventId: '$main',
      total: 2,
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'PUT',
      unreadInfo: {
        roomId: ROOM_ID,
        highlight: 0,
        total: 2,
      },
    });
  });

  it('deletes a room unread entry once the room is fully read', () => {
    const latestEvent = makeMessageEvent('$main');
    const room = makeRoom({
      events: [latestEvent],
      readUpToEventId: latestEvent.getId(),
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'DELETE',
      roomId: ROOM_ID,
    });
  });

  it('preserves non-notifying unread markers when counts are still zero', () => {
    const room = makeRoom({
      events: [makeMessageEvent('$main')],
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'PUT',
      unreadInfo: {
        roomId: ROOM_ID,
        highlight: 0,
        total: 0,
      },
    });
  });

  it('drops zero-count thread-only activity after a thread receipt clears that thread', () => {
    const room = makeRoom({
      events: [makeThreadReplyEvent('$thread-reply')],
    });

    expect(getRoomUnreadAction(makeClient() as never, room as never)).toEqual({
      type: 'DELETE',
      roomId: ROOM_ID,
    });
  });
});

describe('getOptimisticReceiptUnreadInfo', () => {
  it('clears all unread counts for an explicit unthreaded receipt', () => {
    const room = makeRoom({
      events: [makeMessageEvent('$main')],
      total: 5,
      highlight: 1,
    });

    expect(
      getOptimisticReceiptUnreadInfo(room as never, [
        {
          unthreaded: true,
        },
      ])
    ).toEqual({
      roomId: ROOM_ID,
      highlight: 0,
      total: 0,
    });
  });

  it('subtracts only the main-timeline counts for a threaded main receipt', () => {
    const room = makeRoom({
      events: [makeMessageEvent('$main')],
      highlight: 1,
      roomHighlight: 1,
      roomTotal: 3,
      total: 5,
      threadTotal: 2,
    });

    expect(
      getOptimisticReceiptUnreadInfo(room as never, [
        {
          threadId: MAIN_ROOM_TIMELINE,
          unthreaded: false,
        },
      ])
    ).toEqual({
      roomId: ROOM_ID,
      highlight: 0,
      total: 2,
    });
  });

  it('subtracts only the acknowledged thread counts for a thread receipt', () => {
    const room = makeRoom({
      events: [makeThreadReplyEvent('$thread-reply')],
      threadHighlight: 1,
      threadTotal: 4,
      total: 6,
    });

    expect(
      getOptimisticReceiptUnreadInfo(room as never, [
        {
          threadId: THREAD_ID,
          unthreaded: false,
        },
      ])
    ).toEqual({
      roomId: ROOM_ID,
      highlight: 0,
      total: 2,
    });
  });
});
