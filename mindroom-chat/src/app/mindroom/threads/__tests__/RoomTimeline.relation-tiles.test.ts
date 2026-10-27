import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  inSameDayMock,
  makeEvent,
  makeRoom,
  makeTimeline,
  reactionOrEditEventMock,
  roomTimelineVirtualizerState,
  threadRenderStateMock,
  timeDayMonthYearMock,
} from '../test-utils/RoomTimeline.test.shared';

describe('thread relation tiles', () => {
  it.each([0, 86_400_000])(
    'omits relation tiles while preserving context across a %ims day offset',
    async (dayOffset) => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const threadId = '$root';
      const day = 86_400_000;
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
      const events = [
        rootEvent,
        makeEvent('$before', { threadRootId: threadId, ts: 61_000 }),
        makeEvent('$edit', {
          threadRootId: threadId,
          ts: dayOffset + 90_000,
          relation: { rel_type: 'm.replace', event_id: '$before' },
        }),
        makeEvent('$reaction', {
          threadRootId: threadId,
          ts: dayOffset + 91_000,
          relation: { rel_type: 'm.annotation', event_id: '$before' },
        }),
        makeEvent('$after', { threadRootId: threadId, ts: dayOffset + 120_000 }),
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
      roomTimelineVirtualizerState.virtualIndexes = [1, 2, 3, 4];
      reactionOrEditEventMock.mockImplementation((event) =>
        ['m.replace', 'm.annotation'].includes(
          (event as { getRelation: () => { rel_type?: string } }).getRelation()?.rel_type ?? ''
        )
      );
      inSameDayMock.mockImplementation(
        (a: number, b: number) => Math.floor(a / day) === Math.floor(b / day)
      );
      timeDayMonthYearMock.mockImplementation((ts: number) => `day-${ts}`);
      const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(React.createElement(Harness, { room, threadId }));
          await flushAsyncWork();
        });
        expect(getRenderedEventIds(renderer!)).toEqual(['$before', '$after']);
        const tiles = renderer!.root.findAll(
          (node) => node.type === 'div' && node.props['data-virtual-index'] !== undefined
        );
        expect(tiles.map((node) => node.props['data-virtual-index'])).toEqual([1, 4]);
        const after = renderer!.root.findAll(
          (node) => node.props['data-message-id'] === '$after'
        )[0];
        expect(after.props.collapse).toBe(false);
        if (dayOffset > 0) {
          expect(
            renderer!.root.findAll((node) => node.children.includes(`day-${dayOffset + 120_000}`))
              .length
          ).toBeGreaterThan(0);
        }

        // A previously encrypted tile may still have a nonzero measured size
        // after decryption reveals its relation. Keep it mounted until the
        // normal measurement path has corrected that stale height.
        const sizes = roomTimelineVirtualizerState.lastInstance!.itemSizeCache as Map<
          string,
          number
        >;
        sizes.set('$edit', 80);
        await act(async () => {
          renderer!.update(React.createElement(Harness, { room, threadId }));
          await flushAsyncWork();
        });
        expect(
          renderer!.root.findAll(
            (node) => node.type === 'div' && node.props['data-virtual-index'] === 2
          )
        ).toHaveLength(1);
        sizes.set('$edit', 0);
        await act(async () => {
          renderer!.update(React.createElement(Harness, { room, threadId }));
          await flushAsyncWork();
        });
        expect(
          renderer!.root.findAll(
            (node) => node.type === 'div' && node.props['data-virtual-index'] === 2
          )
        ).toHaveLength(0);

        // Mutable SDK events can become renderable again without changing
        // object/array identity. A cached zero must not suppress their content.
        events[2].getRelation = () => undefined;
        await act(async () => {
          renderer!.update(React.createElement(Harness, { room, threadId }));
          await flushAsyncWork();
        });
        expect(getRenderedEventIds(renderer!)).toEqual(['$before', '$edit', '$after']);
      } finally {
        renderer?.unmount();
        reactionOrEditEventMock.mockImplementation(() => false);
        inSameDayMock.mockImplementation(() => true);
        timeDayMonthYearMock.mockImplementation(() => 'time');
      }
    }
  );
});
