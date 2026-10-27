import { EventEmitter } from 'events';
import React, { type Dispatch, type SetStateAction } from 'react';
import { RoomEvent, type EventTimeline, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Timeline } from './timelinePagination';
import { useRoomTimelineResetRelink } from './roomTimelineResetRelink';

const makeEventTimeline = (): EventTimeline => ({ __timeline: true } as unknown as EventTimeline);

const makeRoom = (initialLiveTimeline: EventTimeline) => {
  let liveTimeline = initialLiveTimeline;
  const timelineSet = { getLiveTimeline: () => liveTimeline };
  const room = Object.assign(new EventEmitter(), {
    roomId: '!room:example.org',
    getUnfilteredTimelineSet: () => timelineSet,
  }) as unknown as Room & EventEmitter;
  return {
    room,
    setLiveTimeline: (next: EventTimeline) => {
      liveTimeline = next;
    },
    timelineSet,
  };
};

type HarnessProps = {
  room: Room;
  threadId?: string;
  eventId?: string;
  timeline: Timeline;
  rebuildTimeline: () => Timeline;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  atBottom?: boolean;
  scrollToBottomRef?: { current: { count: number; smooth: boolean } };
};

const Harness = ({
  room,
  threadId,
  eventId,
  timeline,
  rebuildTimeline,
  setTimeline,
  atBottom = false,
  scrollToBottomRef = { current: { count: 0, smooth: true } },
}: HarnessProps) => {
  useRoomTimelineResetRelink({
    room,
    threadId,
    eventId,
    timeline,
    rebuildTimeline,
    setTimeline,
    isViewportAtBottomNow: () => atBottom,
    scrollToBottomRef,
  });
  return null;
};

const setup = () => {
  const oldLiveTimeline = makeEventTimeline();
  const newLiveTimeline = makeEventTimeline();
  const { room, setLiveTimeline, timelineSet } = makeRoom(oldLiveTimeline);
  const timeline: Timeline = {
    linkedTimelines: [oldLiveTimeline],
    range: { start: 0, end: 1 },
  };
  const rebuiltTimeline: Timeline = {
    linkedTimelines: [newLiveTimeline],
    range: { start: 0, end: 1 },
  };
  const rebuildTimeline = vi.fn(() => rebuiltTimeline);
  const setTimeline = vi.fn();
  const mount = (overrides: Partial<HarnessProps> = {}) => {
    act(() => {
      create(
        React.createElement(Harness, {
          room,
          timeline,
          rebuildTimeline,
          setTimeline,
          ...overrides,
        })
      );
    });
  };
  return {
    newLiveTimeline,
    rebuildTimeline,
    rebuiltTimeline,
    room,
    setLiveTimeline,
    setTimeline,
    timelineSet,
    mount,
  };
};

describe('useRoomTimelineResetRelink', () => {
  it('rebuilds an orphaned room timeline once across duplicate reset events', () => {
    const state = setup();
    state.mount();
    state.setLiveTimeline(state.newLiveTimeline);

    act(() => {
      state.room.emit(RoomEvent.TimelineReset, state.room, state.timelineSet);
      state.room.emit(RoomEvent.TimelineReset, state.room, state.timelineSet);
    });

    expect(state.rebuildTimeline).toHaveBeenCalledTimes(1);
    expect(state.setTimeline).toHaveBeenCalledWith(state.rebuiltTimeline);
  });

  it.each([
    ['linked timeline', {}, false, false],
    ['thread view', { threadId: '$thread' }, true, false],
    ['event view', { eventId: '$event' }, true, false],
    ['different timeline set', {}, true, true],
  ])('ignores %s resets', (_label, overrides, orphaned, foreignSet) => {
    const state = setup();
    state.mount(overrides);
    if (orphaned) state.setLiveTimeline(state.newLiveTimeline);

    act(() => {
      state.room.emit(
        RoomEvent.TimelineReset,
        state.room,
        foreignSet ? { getLiveTimeline: () => state.newLiveTimeline } : state.timelineSet
      );
    });

    expect(state.setTimeline).not.toHaveBeenCalled();
  });

  it.each([
    ['pinned', true, 1],
    ['scrolled up', false, 0],
  ])('keeps a %s reader bottom-pin state', (_label, atBottom, expectedCount) => {
    const state = setup();
    const scrollToBottomRef = { current: { count: 0, smooth: true } };
    state.mount({ atBottom, scrollToBottomRef });
    state.setLiveTimeline(state.newLiveTimeline);

    act(() => {
      state.room.emit(RoomEvent.TimelineReset, state.room, state.timelineSet);
    });

    expect(scrollToBottomRef.current.count).toBe(expectedCount);
    expect(scrollToBottomRef.current.smooth).toBe(!atBottom);
  });

  it('recovers when the live timeline changed before the passive subscription', () => {
    const state = setup();
    state.setLiveTimeline(state.newLiveTimeline);

    state.mount();

    expect(state.setTimeline).toHaveBeenCalledWith(state.rebuiltTimeline);
  });
});
