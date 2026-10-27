import React from 'react';
import { EventEmitter } from 'events';
import { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { RelationsEvent } from 'matrix-js-sdk/lib/models/relations';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { getThreadStreamingState, useThreadStreamingState } from './useThreadStreamingState';

const THREAD_ROOT_ID = '$root';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  content: Record<string, unknown> = {},
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
      ...content,
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeThreadReplyEvent = (
  eventId: string,
  ts: number,
  content: Record<string, unknown> = {},
  sender = '@alice:example.org'
) =>
  makeMessageEvent(
    eventId,
    ts,
    {
      ...content,
      'm.relates_to': {
        event_id: THREAD_ROOT_ID,
        rel_type: 'm.thread',
      },
    },
    sender
  );

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  newContent: Record<string, unknown>,
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: eventId,
        msgtype: 'm.text',
        ...newContent,
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

type HookValue = ReturnType<typeof useThreadStreamingState>;

type HarnessProps = {
  room: Room;
  threadRootId: string;
  onRender: (value: HookValue) => void;
};

type MockRelations = EventEmitter & {
  setGroupedAnnotations: (annotations: [string, Set<MatrixEvent>][]) => void;
  getSortedAnnotationsByKey: () => [string, Set<MatrixEvent>][] | null;
};

type MockThread = Thread &
  EventEmitter & {
    setLastReply: (event: MatrixEvent | null) => void;
    setTimelineEvents: (events: MatrixEvent[]) => void;
    getUnfilteredTimelineSet: () => ReturnType<typeof makeTimelineSet>;
  };

function Harness({ room, threadRootId, onRender }: HarnessProps) {
  const value = useThreadStreamingState(room, threadRootId);
  onRender(value);
  return null;
}

const makeRelations = (): MockRelations => {
  const emitter = new EventEmitter();
  let groupedAnnotations: [string, Set<MatrixEvent>][] | null = null;

  return Object.assign(emitter, {
    setGroupedAnnotations: (annotations: [string, Set<MatrixEvent>][]) => {
      groupedAnnotations = annotations;
    },
    getSortedAnnotationsByKey: () => groupedAnnotations,
  }) as MockRelations;
};

const makeTimelineSet = (
  relationMap: Map<string, MockRelations>,
  getEvents: () => MatrixEvent[]
) => {
  const liveTimeline = {
    getEvents,
    getNeighbouringTimeline: () => null,
  };

  return {
    getLiveTimeline: () => liveTimeline,
    relations: {
      getChildEventsForEvent: vi.fn((eventId: string) => relationMap.get(eventId)),
    },
  } as {
    getLiveTimeline: () => {
      getEvents: () => MatrixEvent[];
      getNeighbouringTimeline: () => null;
    };
    relations: {
      getChildEventsForEvent: (eventId: string) => MockRelations | undefined;
    };
  };
};

const makeThread = ({
  lastReply,
  relationMap,
  timelineEvents,
}: {
  lastReply?: MatrixEvent | null;
  relationMap: Map<string, MockRelations>;
  timelineEvents?: MatrixEvent[];
}): MockThread => {
  const emitter = new EventEmitter();
  let currentLastReply = lastReply ?? null;
  let currentTimelineEvents = timelineEvents ?? (lastReply ? [lastReply] : []);
  const timelineSet = makeTimelineSet(relationMap, () => currentTimelineEvents);

  return Object.assign(emitter, {
    lastReply: vi.fn(() => currentLastReply),
    setLastReply: (event: MatrixEvent | null) => {
      currentLastReply = event;
    },
    setTimelineEvents: (events: MatrixEvent[]) => {
      currentTimelineEvents = events;
    },
    getUnfilteredTimelineSet: () => timelineSet,
  }) as unknown as MockThread;
};

const makeRoom = ({
  rootEventId,
  thread,
  roomTimelineSet,
}: {
  rootEventId: string;
  thread?: MockThread;
  roomTimelineSet: ReturnType<typeof makeTimelineSet>;
}): Room =>
  ({
    getThread: vi.fn((threadRootId: string) => (threadRootId === rootEventId ? thread : undefined)),
    getUnfilteredTimelineSet: () => roomTimelineSet,
  } as unknown as Room);

const renderHookHarness = (
  room: Room,
  threadRootId = '$root'
): {
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
    getSnapshot: () => latestValue ?? false,
    renderer: renderer as ReactTestRenderer,
  };
};

describe('useThreadStreamingState', () => {
  it('copies bundled edits shallowly without changing them and observes newer bundles', () => {
    const relationMap = new Map<string, MockRelations>();
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.stream_status': 'pending',
    });
    const attach = (id: string, ts: number, status: string) => {
      replyEvent.setUnsigned({
        'm.relations': {
          'm.replace': makeEditEvent(id, ts, '$reply', {
            'io.mindroom.stream_status': status,
          }).event,
        },
      });
    };
    attach('$streaming', 300, 'streaming');
    // An older live edit carries metadata the bundle lacks, so resolving the
    // bundled winner fills that metadata into its copy.
    const olderEdit = makeEditEvent('$older', 250, '$reply', {
      'io.mindroom.tool_trace': { version: 1, events: [] },
    });
    relationMap.set('$reply', Object.assign(makeRelations(), { getRelations: () => [olderEdit] }));
    const thread = makeThread({ lastReply: replyEvent, relationMap });
    const room = makeRoom({
      rootEventId: '$root',
      thread,
      roomTimelineSet: makeTimelineSet(relationMap, () => []),
    });
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      const streamingBundle = JSON.stringify(replyEvent.getUnsigned());
      expect(getThreadStreamingState(room, '$root')).toBe(true);
      expect(JSON.stringify(replyEvent.getUnsigned())).toBe(streamingBundle);
      attach('$completed', 400, 'completed');
      const bundle = JSON.stringify(replyEvent.getUnsigned());
      expect(getThreadStreamingState(room, '$root')).toBe(false);
      // Every record rebuild runs this check for each thread's tail.
      expect(clone).not.toHaveBeenCalled();
      expect(JSON.stringify(replyEvent.getUnsigned())).toBe(bundle);
    } finally {
      clone.mockRestore();
    }
  });

  it('returns true for ai_run streaming metadata', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('returns true when a stop reaction is added to the current last reply', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    act(() => {
      relations.setGroupedAnnotations([['⏹', new Set([stopReaction])]]);
      relations.emit(RelationsEvent.Add, stopReaction);
    });

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it("recognizes the backend's current 🛑 stop key as a streaming signal", () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '🛑', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['🛑', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('ignores a redacted stop reaction shell after reload', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const redactedStopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹', rel_type: 'm.annotation' },
    });
    vi.spyOn(redactedStopReaction, 'isRedacted').mockReturnValue(true);
    const relations = makeRelations();
    relations.setGroupedAnnotations([['⏹', new Set([redactedStopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('returns false when there is no streaming metadata or stop reaction', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('treats terminal metadata as stronger than a stale stop reaction', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'completed' },
    });
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹️', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['⏹️', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it("treats the 'cached' ai_run terminal status as ending the stream despite a stale 🛑", () => {
    // 'cached' is terminal only in the ai_run status set — a divergence from
    // TERMINAL_STREAM_STATUSES here would wedge a permanent spinner while
    // the stop chip (gated on the shared helper) is hidden.
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'cached' },
    });
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '🛑', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['🛑', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('updates when the thread switches to a new streaming reply', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const firstReply = makeThreadReplyEvent('$reply-1', 200);
    const secondReply = makeThreadReplyEvent('$reply-2', 300, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const thread = makeThread({
      lastReply: firstReply,
      relationMap,
      timelineEvents: [firstReply],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    act(() => {
      thread.setTimelineEvents([firstReply, secondReply]);
      thread.setLastReply(secondReply);
      thread.emit(ThreadEvent.NewReply, thread, secondReply);
    });

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('updates when ai_run streaming metadata arrives via a replacement event', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const streamingEdit = makeEditEvent('$reply-edit', 300, '$reply', {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    act(() => {
      replyEvent.makeReplaced(streamingEdit);
    });

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('treats completed ai_run metadata on a replacement as stronger than stale raw streaming metadata', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const completedEdit = makeEditEvent('$reply-edit', 300, '$reply', {
      'io.mindroom.ai_run': { version: 1, status: 'completed' },
    });
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent, completedEdit],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    act(() => {
      replyEvent.makeReplaced(completedEdit);
    });

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('updates when stream_status changes to a terminal state via a replacement event', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.stream_status': 'active',
    });
    const completedEdit = makeEditEvent('$reply-edit', 300, '$reply', {
      'io.mindroom.stream_status': 'completed',
    });
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    act(() => {
      replyEvent.makeReplaced(completedEdit);
    });

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('returns true when a non-last reply in the scanned tail is streaming', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const firstReply = makeThreadReplyEvent('$reply-1', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const secondReply = makeThreadReplyEvent('$reply-2', 250);
    const thread = makeThread({
      lastReply: secondReply,
      relationMap,
      timelineEvents: [firstReply, secondReply],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('updates when a stop reaction is added to a non-last reply in the scanned tail', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const firstReply = makeThreadReplyEvent('$reply-1', 200);
    const secondReply = makeThreadReplyEvent('$reply-2', 250);
    const stopReaction = makeMessageEvent('$reaction', 260, {
      'm.relates_to': { event_id: '$reply-1', key: '⏹', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relationMap.set('$reply-1', relations);

    const thread = makeThread({
      lastReply: secondReply,
      relationMap,
      timelineEvents: [firstReply, secondReply],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    act(() => {
      relations.setGroupedAnnotations([['⏹', new Set([stopReaction])]]);
      relations.emit(RelationsEvent.Add, stopReaction);
    });

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('refreshes when a stop reaction is redacted away', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['⏹', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    act(() => {
      vi.spyOn(stopReaction, 'isRedacted').mockReturnValue(true);
      relations.emit(RelationsEvent.Redaction);
    });

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('ignores streaming metadata on messages older than the last 10 scanned thread messages', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replies = Array.from({ length: 11 }, (_, index) =>
      makeThreadReplyEvent(
        `$reply-${index + 1}`,
        200 + index,
        index === 0 ? { 'io.mindroom.ai_run': { version: 1, status: 'streaming' } } : {}
      )
    );
    const thread = makeThread({
      lastReply: replies[replies.length - 1],
      relationMap,
      timelineEvents: replies,
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });
  it('treats cancelled stream_status as terminal (no false positive with stop reaction)', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.stream_status': { status: 'cancelled' },
    });
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹️', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['⏹️', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });
});
