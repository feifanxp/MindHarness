import { Direction, type EventTimeline } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  getActiveTimelineRange,
  getEmptyTimeline,
  getFirstLinkedTimeline,
  getFocusedRoomEventIndex,
  getLatestTimelineRange,
  getLinkedTimelines,
  getVisibleTimelineRange,
  recalibrateTimelinePagination,
  type Timeline,
} from './timelinePagination';

const makeEvent = (eventId: string) =>
  ({
    getId: () => eventId,
  } as never);

const makeTimeline = () =>
  ({
    getEvents: () => [],
    getNeighbouringTimeline: () => null,
  } as never);

const makeLinkedTimeline = () => {
  const neighbours = new Map<Direction, EventTimeline>();
  const timeline = {
    getEvents: () => [],
    getNeighbouringTimeline: (direction: Direction) => neighbours.get(direction) ?? null,
  } as EventTimeline;

  return {
    timeline,
    setNeighbour: (direction: Direction, neighbour: EventTimeline) => {
      neighbours.set(direction, neighbour);
    },
  };
};

describe('timeline pagination helpers', () => {
  it('selects the latest range for fresh room timelines', () => {
    expect(getLatestTimelineRange(120, 50)).toEqual({ start: 70, end: 120 });
    expect(getLatestTimelineRange(20, 50)).toEqual({ start: 0, end: 20 });
  });

  it('keeps a valid visible range and repairs out-of-bounds ranges', () => {
    expect(getVisibleTimelineRange({ start: 10, end: 20 }, 100, 50)).toEqual({
      start: 10,
      end: 20,
    });
    expect(getVisibleTimelineRange({ start: 120, end: 140 }, 100, 50)).toEqual({
      start: 50,
      end: 100,
    });
    expect(getVisibleTimelineRange({ start: 10, end: 10 }, 100, 50)).toEqual({
      start: 50,
      end: 100,
    });
    expect(getVisibleTimelineRange({ start: 0, end: 10 }, 0, 50)).toEqual({
      start: 0,
      end: 0,
    });
  });

  it('uses full filtered range for room overviews and no virtual range inside threads', () => {
    expect(getActiveTimelineRange(undefined, true, { start: 10, end: 20 }, 80, 50)).toEqual({
      start: 0,
      end: 80,
    });
    expect(getActiveTimelineRange('$thread', true, { start: 10, end: 20 }, 80, 50)).toEqual({
      start: 0,
      end: 0,
    });
  });

  it('resolves focused events against the filtered room order', () => {
    expect(getFocusedRoomEventIndex([makeEvent('$a'), makeEvent('$b')], '$b', 5)).toBe(1);
    expect(getFocusedRoomEventIndex([makeEvent('$a')], '$missing', 5)).toBe(5);
    expect(getFocusedRoomEventIndex([makeEvent('$a')], undefined, 5)).toBe(5);
  });

  it('builds an empty timeline placeholder', () => {
    expect(getEmptyTimeline()).toEqual({
      linkedTimelines: [],
      range: { start: 0, end: 0 },
    });
  });

  it('falls back to the starting timeline when backward links form a cycle', () => {
    const first = makeLinkedTimeline();
    const second = makeLinkedTimeline();
    first.setNeighbour(Direction.Backward, second.timeline);
    second.setNeighbour(Direction.Backward, first.timeline);

    expect(getFirstLinkedTimeline(first.timeline, Direction.Backward)).toBe(first.timeline);
  });

  it('walks a deep valid backward chain without consuming the call stack', () => {
    const linkedTimelines = Array.from({ length: 20_000 }, makeLinkedTimeline);
    for (let index = 1; index < linkedTimelines.length; index += 1) {
      linkedTimelines[index].setNeighbour(Direction.Backward, linkedTimelines[index - 1].timeline);
    }

    expect(
      getFirstLinkedTimeline(
        linkedTimelines[linkedTimelines.length - 1].timeline,
        Direction.Backward
      )
    ).toBe(linkedTimelines[0].timeline);
  });

  it('collects each timeline once when forward links form a cycle', () => {
    let forwardReads = 0;
    const timeline = {
      getEvents: () => [],
      getNeighbouringTimeline: (direction: Direction) => {
        if (direction === Direction.Backward) return null;
        forwardReads += 1;
        if (forwardReads > 2) throw new Error('forward cycle was not stopped');
        return timeline;
      },
    } as EventTimeline;

    expect(getLinkedTimelines(timeline)).toEqual([timeline]);
    expect(forwardReads).toBe(1);
  });

  it('does not replace a newer linked chain with a stale pagination result', () => {
    const staleTimeline = makeTimeline();
    const focusedTimeline = makeTimeline();
    const focusedState: Timeline = {
      linkedTimelines: [focusedTimeline],
      range: { start: 4, end: 8 },
    };
    let currentState = focusedState;

    recalibrateTimelinePagination(
      (update) => {
        currentState = typeof update === 'function' ? update(currentState) : update;
      },
      [staleTimeline],
      [0],
      true
    );

    expect(currentState).toBe(focusedState);
  });
});
