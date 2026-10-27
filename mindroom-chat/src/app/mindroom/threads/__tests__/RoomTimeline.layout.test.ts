import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';

const findTimelineContentBox = (renderer: ReturnType<typeof create>) => {
  const matches = renderer.root.findAll(
    (node) => node.type === 'div' && node.props.style?.minHeight === '100%'
  );
  expect(matches).toHaveLength(1);
  return matches[0];
};

describe('RoomTimeline layout', () => {
  it('top-aligns short active thread timelines', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const threadRoot = makeEvent('$thread-root');
    threadRenderStateMock.threadEvents = [threadRoot];
    const room = makeRoom({ liveEvents: [threadRoot] });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          threadId: '$thread-root',
        })
      );
      await flushAsyncWork(1);
    });

    expect(findTimelineContentBox(renderer!).props.justifyContent).toBe('Start');
  });

  it('keeps normal room timelines bottom-aligned', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const room = makeRoom({ liveEvents: [makeEvent('$message')] });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(findTimelineContentBox(renderer!).props.justifyContent).toBe('End');
  });
});
