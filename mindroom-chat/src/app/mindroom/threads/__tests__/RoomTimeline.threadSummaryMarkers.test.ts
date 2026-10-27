import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomTimelineVirtualizerState,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';

const threadId = '$root';
const summary = (id: string, text: string, ts: number) =>
  makeEvent(id, {
    threadRootId: threadId,
    ts,
    content: {
      msgtype: 'm.notice',
      body: text,
      'io.mindroom.thread_summary': { version: 1, summary: text, message_count: 1 },
    },
  });

describe('thread summary markers', () => {
  it('hides a repeated summary and marks the others in an open thread', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const { MindroomThreadSummaryMarker } = await import(
      '../../messages/MindroomThreadSummaryMarker'
    );
    const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
    const events = [
      rootEvent,
      makeEvent('$r1', { threadRootId: threadId, ts: 2_000 }),
      summary('$s1', 'Push bug', 3_000),
      makeEvent('$r2', { threadRootId: threadId, ts: 4_000 }),
      summary('$s2', 'Push bug', 5_000),
      summary('$s3', 'Fixing token refresh', 6_000),
    ];
    const timeline = makeTimeline(events, { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [rootEvent] });
    room.getThread = () =>
      ({
        rootEvent,
        events: events.slice(1),
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    threadRenderStateMock.threadEvents = events as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      events.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = [1, 2, 3, 4, 5];
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });

      expect(getRenderedEventIds(renderer!)).toEqual(['$r1', '$s1', '$r2', '$s3']);
      // Whether the first counts as the thread's first depends on the session's
      // history state, which the planner's own tests cover.
      expect(
        renderer!.root
          .findAllByType(MindroomThreadSummaryMarker)
          .map((node) => node.props.plan?.previousSummaryText)
      ).toEqual([undefined, 'Push bug']);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('keeps a repeated summary visible after the route that opened it moves on', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
    const events = [
      rootEvent,
      summary('$s1', 'Push bug', 2_000),
      makeEvent('$r1', { threadRootId: threadId, ts: 3_000 }),
      summary('$s2', 'Push bug', 4_000),
    ];
    const timeline = makeTimeline(events, { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [rootEvent] });
    room.getThread = () =>
      ({
        rootEvent,
        events: events.slice(1),
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    threadRenderStateMock.threadEvents = events as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      events.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = [1, 2, 3];
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId, eventId: '$s2' }));
        await flushAsyncWork();
      });
      expect(getRenderedEventIds(renderer!)).toEqual(['$s1', '$r1', '$s2']);

      await act(async () => {
        renderer!.update(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });
      expect(getRenderedEventIds(renderer!)).toEqual(['$s1', '$r1', '$s2']);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('compares a summary by its latest edit, as its row shows it', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const { MindroomThreadSummaryMarker } = await import(
      '../../messages/MindroomThreadSummaryMarker'
    );
    const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
    const edited = summary('$s2', 'Push bug', 3_000);
    // The shared fixture's getEditedEvent returns this, as the SDK's replacement.
    Object.assign(edited, {
      __editedEvent: {
        getContent: () => ({
          'm.new_content': {},
          msgtype: 'm.notice',
          body: 'Token refresh',
          'io.mindroom.thread_summary': { version: 1, summary: 'Token refresh' },
        }),
      },
    });
    const events = [rootEvent, summary('$s1', 'Push bug', 2_000), edited];
    const timeline = makeTimeline(events, { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [rootEvent] });
    room.getThread = () =>
      ({
        rootEvent,
        events: events.slice(1),
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    threadRenderStateMock.threadEvents = events as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      events.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = [1, 2];
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });

      expect(getRenderedEventIds(renderer!)).toEqual(['$s1', '$s2']);
      expect(
        renderer!.root
          .findAllByType(MindroomThreadSummaryMarker)
          .map((node) => node.props.plan?.previousSummaryText)
      ).toEqual([undefined, 'Push bug']);
    } finally {
      act(() => renderer?.unmount());
    }
  });
});
