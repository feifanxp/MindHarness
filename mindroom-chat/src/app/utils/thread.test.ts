import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { describe, expect, it } from 'vitest';
import { getThreadTailEvents } from './thread';

type MockTimeline = {
  getEvents: () => MatrixEvent[];
  getNeighbouringTimeline: () => MockTimeline | null;
};

const makeThreadReplyEvent = (eventId: string, ts: number, type = 'm.room.message'): MatrixEvent =>
  new MatrixEvent({
    content: {
      body: eventId,
      'm.relates_to': {
        event_id: '$root',
        rel_type: 'm.thread',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type,
  });

const makeRelationEvent = (
  eventId: string,
  ts: number,
  relType: string,
  type = 'm.room.message'
): MatrixEvent =>
  new MatrixEvent({
    content:
      type === 'm.reaction'
        ? {
            'm.relates_to': {
              event_id: '$reply-2',
              key: '👍',
              rel_type: relType,
            },
          }
        : {
            body: eventId,
            'm.new_content': {
              body: eventId,
              msgtype: 'm.text',
            },
            'm.relates_to': {
              event_id: '$reply-1',
              rel_type: relType,
            },
            msgtype: 'm.text',
          },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type,
  });

const makeRootEvent = (eventId = '$root', ts = 100): MatrixEvent =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

const makeTimeline = (
  events: MatrixEvent[],
  previousTimeline: MockTimeline | null = null
): MockTimeline => ({
  getEvents: () => events,
  getNeighbouringTimeline: () => previousTimeline,
});

const makeThread = ({
  liveTimeline,
  lastReply = null,
  replyToEvent = null,
  rootEvent,
}: {
  liveTimeline: MockTimeline;
  lastReply?: MatrixEvent | null;
  replyToEvent?: MatrixEvent | null;
  rootEvent?: MatrixEvent;
}): Thread =>
  ({
    rootEvent,
    replyToEvent,
    lastReply: () => lastReply,
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => liveTimeline,
    }),
  } as unknown as Thread);

describe('getThreadTailEvents', () => {
  it('returns the last N thread messages in chronological order', () => {
    const reply1 = makeThreadReplyEvent('$reply-1', 101);
    const reply2 = makeThreadReplyEvent('$reply-2', 102);
    const reply3 = makeThreadReplyEvent('$reply-3', 103);
    const reply4 = makeThreadReplyEvent('$reply-4', 104);
    const olderTimeline = makeTimeline([reply1, reply2]);
    const liveTimeline = makeTimeline([reply3, reply4], olderTimeline);
    const thread = makeThread({
      liveTimeline,
      lastReply: reply4,
      rootEvent: makeRootEvent(),
    });

    expect(getThreadTailEvents(thread, 3).map((event) => event.getId())).toEqual([
      '$reply-2',
      '$reply-3',
      '$reply-4',
    ]);
  });

  it('skips annotation and replace relations when scanning the tail', () => {
    const reply1 = makeThreadReplyEvent('$reply-1', 101);
    const reaction = makeRelationEvent('$reaction', 102, 'm.annotation', 'm.reaction');
    const edit = makeRelationEvent('$edit', 103, 'm.replace');
    const reply2 = makeThreadReplyEvent('$reply-2', 104, 'm.sticker');
    const liveTimeline = makeTimeline([reply1, reaction, edit, reply2]);
    const thread = makeThread({
      liveTimeline,
      lastReply: reply2,
      rootEvent: makeRootEvent(),
    });

    expect(getThreadTailEvents(thread, 2).map((event) => event.getId())).toEqual([
      '$reply-1',
      '$reply-2',
    ]);
  });

  it('returns all loaded thread messages plus the root when fewer than N replies exist', () => {
    const rootEvent = makeRootEvent();
    const reply1 = makeThreadReplyEvent('$reply-1', 101);
    const reply2 = makeThreadReplyEvent('$reply-2', 102);
    const thread = makeThread({
      liveTimeline: makeTimeline([reply1, reply2]),
      lastReply: reply2,
      rootEvent,
    });

    expect(getThreadTailEvents(thread, 10).map((event) => event.getId())).toEqual([
      '$root',
      '$reply-1',
      '$reply-2',
    ]);
  });

  it('reads each timeline once when SDK segments link into a cycle', () => {
    const rootEvent = makeRootEvent();
    const reply1 = makeThreadReplyEvent('$reply-1', 101);
    const reply2 = makeThreadReplyEvent('$reply-2', 102);
    let neighbourReads = 0;
    let olderNeighbour: MockTimeline | null = null;
    const olderTimeline: MockTimeline = {
      getEvents: () => [reply1],
      getNeighbouringTimeline: () => {
        neighbourReads += 1;
        if (neighbourReads > 100) throw new Error('walked a timeline cycle');
        return olderNeighbour;
      },
    };
    const liveTimeline = makeTimeline([reply2], olderTimeline);
    olderNeighbour = liveTimeline;
    const thread = makeThread({ liveTimeline, lastReply: reply2, rootEvent });

    expect(getThreadTailEvents(thread, 10).map((event) => event.getId())).toEqual([
      '$root',
      '$reply-1',
      '$reply-2',
    ]);
  });

  it('falls back to the root event for an empty loaded thread timeline', () => {
    const rootEvent = makeRootEvent();
    const thread = makeThread({
      liveTimeline: makeTimeline([]),
      rootEvent,
    });

    expect(getThreadTailEvents(thread, 10).map((event) => event.getId())).toEqual(['$root']);
  });
});
