import React from 'react';
import { EventEmitter } from 'events';
import { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useThreadLastActivityTs } from './useThreadLastActivityTs';

const THREAD_ROOT_ID = '$root';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = eventId,
  content: Record<string, unknown> = {}
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
      ...content,
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeThreadRootWithBundledLatestEvent = ({
  eventId = THREAD_ROOT_ID,
  ts,
  latestEventTs,
  latestEditTs,
}: {
  eventId?: string;
  ts: number;
  latestEventTs?: number;
  latestEditTs?: number;
}) =>
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
    unsigned: {
      'm.relations':
        latestEventTs || latestEditTs
          ? {
              'm.thread': {
                latest_event: {
                  content: {
                    body: '$latest',
                    msgtype: 'm.text',
                  },
                  event_id: '$latest',
                  origin_server_ts: latestEventTs,
                  room_id: '!room:example.org',
                  sender: '@alice:example.org',
                  type: 'm.room.message',
                  unsigned:
                    latestEditTs !== undefined
                      ? {
                          'm.relations': {
                            'm.replace': {
                              origin_server_ts: latestEditTs,
                            },
                          },
                        }
                      : undefined,
                },
              },
            }
          : undefined,
    },
  });

const makeThreadReplyEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = eventId
) =>
  makeMessageEvent(eventId, ts, sender, body, {
    'm.relates_to': {
      event_id: THREAD_ROOT_ID,
      rel_type: 'm.thread',
    },
  });

const makeHiddenThreadTagEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: THREAD_ROOT_ID,
        rel_type: 'm.thread',
      },
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'com.mindroom.thread.tag',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: eventId,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

type HookValue = ReturnType<typeof useThreadLastActivityTs>;

type HarnessProps = {
  room: Room;
  threadRootId: string;
  onRender: (value: HookValue) => void;
};

type MockThread = Thread &
  EventEmitter & {
    setLastReply: (event: MatrixEvent | null) => void;
    setTimelineEvents: (events: MatrixEvent[]) => void;
    getUnfilteredTimelineSet: () => {
      getLiveTimeline: () => {
        getEvents: () => MatrixEvent[];
        getNeighbouringTimeline: () => null;
      };
    };
  };

function Harness({ room, threadRootId, onRender }: HarnessProps) {
  const value = useThreadLastActivityTs(room, threadRootId);
  onRender(value);
  return null;
}

const makeThread = ({
  rootEvent,
  lastReply,
  replyToEvent,
  timelineEvents,
}: {
  rootEvent: MatrixEvent;
  lastReply?: MatrixEvent | null;
  replyToEvent?: MatrixEvent | null;
  timelineEvents?: MatrixEvent[];
}): MockThread => {
  const emitter = new EventEmitter();
  let currentLastReply = lastReply ?? null;
  let currentTimelineEvents =
    timelineEvents ?? [rootEvent, ...(lastReply ? [lastReply] : replyToEvent ? [replyToEvent] : [])];
  const liveTimeline = {
    getEvents: () => currentTimelineEvents,
    getNeighbouringTimeline: () => null,
  };

  return Object.assign(emitter, {
    rootEvent,
    replyToEvent,
    lastReply: vi.fn(() => currentLastReply),
    setLastReply: (event: MatrixEvent | null) => {
      currentLastReply = event;
    },
    setTimelineEvents: (events: MatrixEvent[]) => {
      currentTimelineEvents = events;
    },
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => liveTimeline,
    }),
  }) as unknown as MockThread;
};

const makeRoom = (rootEvent: MatrixEvent, thread?: MockThread): Room =>
  ({
    findEventById: vi.fn((eventId: string) => (eventId === rootEvent.getId() ? rootEvent : undefined)),
    getThread: vi.fn((threadRootId: string) =>
      threadRootId === rootEvent.getId() ? thread : undefined
    ),
  } as unknown as Room);

const renderHookHarness = (room: Room, threadRootId = '$root'): {
  getSnapshot: () => HookValue;
  renderer: ReactTestRenderer;
} => {
  let latestValue: HookValue | undefined;
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(
      React.createElement(Harness, {
        room,
        threadRootId,
        onRender: (value) => {
          latestValue = value;
        },
      })
    );
  });

  return {
    getSnapshot: () => latestValue,
    renderer: renderer as ReactTestRenderer,
  };
};

describe('useThreadLastActivityTs', () => {
  it('uses a newer reply when the thread emits a new reply event', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const thread = makeThread({ rootEvent });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(100);

    act(() => {
      thread.setTimelineEvents([rootEvent, replyEvent]);
      thread.setLastReply(replyEvent);
      thread.emit(ThreadEvent.NewReply, thread, replyEvent);
    });

    expect(getSnapshot()).toBe(200);

    renderer.unmount();
  });

  it('prefers the latest edit timestamp over the original reply timestamp', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const replyEdit = makeEditEvent('$edit', 300, '$reply');
    const thread = makeThread({ rootEvent, lastReply: replyEvent });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(200);

    act(() => {
      replyEvent.makeReplaced(replyEdit);
    });

    expect(getSnapshot()).toBe(300);

    renderer.unmount();
  });

  it('uses a root edit timestamp when there is no newer reply', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const rootEdit = makeEditEvent('$root-edit', 250, '$root');
    const thread = makeThread({ rootEvent, lastReply: null });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(100);

    act(() => {
      rootEvent.makeReplaced(rootEdit);
    });

    expect(getSnapshot()).toBe(250);

    renderer.unmount();
  });

  it('re-subscribes when a new last reply has the same activity timestamp', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const firstReply = makeThreadReplyEvent('$reply-1', 200);
    const secondReply = makeThreadReplyEvent('$reply-2', 200);
    const secondReplyEdit = makeEditEvent('$reply-2-edit', 320, '$reply-2');
    const thread = makeThread({ rootEvent, lastReply: firstReply });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(200);

    act(() => {
      thread.setTimelineEvents([rootEvent, firstReply, secondReply]);
      thread.setLastReply(secondReply);
      thread.emit(ThreadEvent.NewReply, thread, secondReply);
    });

    expect(getSnapshot()).toBe(200);

    act(() => {
      secondReply.makeReplaced(secondReplyEdit);
    });

    expect(getSnapshot()).toBe(320);

    renderer.unmount();
  });

  it('falls back to replyToEvent when lastReply is unavailable', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replyToEvent = makeThreadReplyEvent('$latest-known', 180);
    const thread = makeThread({ rootEvent, lastReply: null, replyToEvent, timelineEvents: [] });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(180);

    renderer.unmount();
  });

  it('falls back to the root timestamp when the thread model is missing', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const room = makeRoom(rootEvent, undefined);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(100);

    renderer.unmount();
  });

  it('uses a newer lastReply even when the loaded thread tail is stale', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const olderReply = makeThreadReplyEvent('$reply-old', 180);
    const newerReply = makeThreadReplyEvent('$reply-new', 260);
    const thread = makeThread({
      rootEvent,
      lastReply: newerReply,
      replyToEvent: newerReply,
      timelineEvents: [rootEvent, olderReply],
    });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(260);

    renderer.unmount();
  });

  it('uses bundled latest_event timestamps when the thread model is missing', () => {
    const rootEvent = makeThreadRootWithBundledLatestEvent({
      eventId: '$root',
      ts: 100,
      latestEventTs: 240,
    });
    const room = makeRoom(rootEvent, undefined);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(240);

    renderer.unmount();
  });

  it('ignores bundled latest_event timestamps for hidden threaded metadata relations', () => {
    const rootEvent = new MatrixEvent({
      content: {
        body: '$root',
        msgtype: 'm.text',
      },
      event_id: '$root',
      origin_server_ts: 100,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: {
        'm.relations': {
          'm.thread': {
            latest_event: {
              event_id: '$thread-tag',
              origin_server_ts: 240,
              room_id: '!room:example.org',
              sender: '@alice:example.org',
              type: 'com.mindroom.thread.tag',
            },
          },
        },
      },
    });
    const room = makeRoom(rootEvent, undefined);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(100);

    renderer.unmount();
  });

  it('uses bundled latest_event replacement timestamps when they are newer', () => {
    const rootEvent = makeThreadRootWithBundledLatestEvent({
      eventId: '$root',
      ts: 100,
      latestEventTs: 220,
      latestEditTs: 310,
    });
    const room = makeRoom(rootEvent, undefined);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(310);

    renderer.unmount();
  });

  it('uses the latest edit timestamp from a non-last reply in the scanned tail', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const firstReply = makeThreadReplyEvent('$reply-1', 200);
    const secondReply = makeThreadReplyEvent('$reply-2', 250);
    const firstReplyEdit = makeEditEvent('$reply-1-edit', 320, '$reply-1');
    const thread = makeThread({
      rootEvent,
      lastReply: secondReply,
      timelineEvents: [rootEvent, firstReply, secondReply],
    });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(250);

    act(() => {
      firstReply.makeReplaced(firstReplyEdit);
    });

    expect(getSnapshot()).toBe(320);

    renderer.unmount();
  });

  it('ignores hidden threaded metadata relations when deriving live activity', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const visibleReply = makeThreadReplyEvent('$reply-visible', 180);
    const hiddenThreadTag = makeHiddenThreadTagEvent('$thread-tag', 320);
    const thread = makeThread({
      rootEvent,
      lastReply: hiddenThreadTag,
      replyToEvent: hiddenThreadTag,
      timelineEvents: [rootEvent, visibleReply, hiddenThreadTag],
    });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(180);

    renderer.unmount();
  });

  it('ignores edits on messages older than the last 10 scanned thread messages', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replies = Array.from({ length: 11 }, (_, index) =>
      makeThreadReplyEvent(`$reply-${index + 1}`, 200 + index)
    );
    const outsideTailEdit = makeEditEvent('$reply-1-edit', 999, '$reply-1');
    const thread = makeThread({
      rootEvent,
      lastReply: replies[replies.length - 1],
      timelineEvents: [rootEvent, ...replies],
    });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(210);

    act(() => {
      replies[0].makeReplaced(outsideTailEdit);
    });

    expect(getSnapshot()).toBe(210);

    renderer.unmount();
  });
});
