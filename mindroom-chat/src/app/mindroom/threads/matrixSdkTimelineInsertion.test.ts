import { createClient, Direction, EventTimelineSet, MatrixEvent, RoomState } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';

const ROOM_ID = '!room:example.org';
const ROOT_ID = '$root';

const makeEvent = (id: string, timestamp: number, isReply = false): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: timestamp,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(isReply
        ? {
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: ROOT_ID,
            },
          }
        : {}),
    },
  });

const makeTimelineSet = () => {
  const client = createClient({
    baseUrl: 'https://example.org',
    userId: '@alice:example.org',
  });
  const timelineSet = new EventTimelineSet(undefined, { timelineSupport: true }, client);
  return {
    roomState: new RoomState(ROOM_ID),
    timelineSet,
    liveTimeline: timelineSet.getLiveTimeline(),
  };
};

const expectDenseTimestamps = (events: MatrixEvent[], timestamps: number[]) => {
  expect(events).toHaveLength(timestamps.length);
  expect(events.every((_event, index) => index in events)).toBe(true);
  expect(events.map((event) => event.getTs())).toEqual(timestamps);
};

describe('matrix-js-sdk timeline insertion', () => {
  it('orders a reply from the beginning when its parent is absent', () => {
    const { roomState, timelineSet, liveTimeline } = makeTimelineSet();
    const newest = makeEvent('$newest', 3, true);
    const missing = makeEvent('$missing', 2, true);
    timelineSet.addEventToTimeline(newest, liveTimeline, { toStartOfTimeline: false });

    timelineSet.insertEventIntoTimeline(missing, liveTimeline, roomState, false);

    expectDenseTimestamps(liveTimeline.getEvents(), [2, 3]);
    expect(timelineSet.findEventById('$missing')).toBe(missing);
    expect(timelineSet.eventIdToTimeline('$missing')).toBe(liveTimeline);
    expect(timelineSet.findEventById(ROOT_ID)).toBeUndefined();
  });

  it('orders a reply after its parent in the target timeline', () => {
    const { roomState, timelineSet, liveTimeline } = makeTimelineSet();
    const root = makeEvent(ROOT_ID, 1);
    const newest = makeEvent('$newest', 3, true);
    const missing = makeEvent('$missing', 2, true);
    timelineSet.addEventToTimeline(root, liveTimeline, { toStartOfTimeline: false });
    timelineSet.addEventToTimeline(newest, liveTimeline, { toStartOfTimeline: false });

    timelineSet.insertEventIntoTimeline(missing, liveTimeline, roomState, false);

    expectDenseTimestamps(liveTimeline.getEvents(), [1, 2, 3]);
    expect(timelineSet.findEventById('$missing')).toBe(missing);
    expect(timelineSet.eventIdToTimeline('$missing')).toBe(liveTimeline);
    expect(timelineSet.findEventById(ROOT_ID)).toBe(root);
    expect(timelineSet.eventIdToTimeline(ROOT_ID)).toBe(liveTimeline);
  });

  it('orders a reply when its parent is in a separate timeline', () => {
    const { roomState, timelineSet, liveTimeline } = makeTimelineSet();
    const olderTimeline = timelineSet.addTimeline();
    const root = makeEvent(ROOT_ID, 1);
    const newest = makeEvent('$newest', 3, true);
    const missing = makeEvent('$missing', 2, true);
    timelineSet.addEventToTimeline(root, olderTimeline, { toStartOfTimeline: false });
    timelineSet.addEventToTimeline(newest, liveTimeline, { toStartOfTimeline: false });

    timelineSet.insertEventIntoTimeline(missing, liveTimeline, roomState, false);

    expectDenseTimestamps(liveTimeline.getEvents(), [2, 3]);
    expectDenseTimestamps(olderTimeline.getEvents(), [1]);
    expect(timelineSet.findEventById('$missing')).toBe(missing);
    expect(timelineSet.eventIdToTimeline('$missing')).toBe(liveTimeline);
    expect(timelineSet.findEventById(ROOT_ID)).toBe(root);
    expect(timelineSet.eventIdToTimeline(ROOT_ID)).toBe(olderTimeline);
  });

  it('orders a reply when its parent is in a linked neighboring timeline', () => {
    const { roomState, timelineSet, liveTimeline } = makeTimelineSet();
    const olderTimeline = timelineSet.addTimeline();
    olderTimeline.setNeighbouringTimeline(liveTimeline, Direction.Forward);
    liveTimeline.setNeighbouringTimeline(olderTimeline, Direction.Backward);
    const root = makeEvent(ROOT_ID, 1);
    const newest = makeEvent('$newest', 3, true);
    const missing = makeEvent('$missing', 2, true);
    timelineSet.addEventToTimeline(root, olderTimeline, { toStartOfTimeline: false });
    timelineSet.addEventToTimeline(newest, liveTimeline, { toStartOfTimeline: false });

    timelineSet.insertEventIntoTimeline(missing, liveTimeline, roomState, false);

    expectDenseTimestamps(liveTimeline.getEvents(), [2, 3]);
    expectDenseTimestamps(olderTimeline.getEvents(), [1]);
    expect(olderTimeline.getNeighbouringTimeline(Direction.Forward)).toBe(liveTimeline);
    expect(liveTimeline.getNeighbouringTimeline(Direction.Backward)).toBe(olderTimeline);
    expect(timelineSet.findEventById('$missing')).toBe(missing);
    expect(timelineSet.eventIdToTimeline('$missing')).toBe(liveTimeline);
    expect(timelineSet.findEventById(ROOT_ID)).toBe(root);
    expect(timelineSet.eventIdToTimeline(ROOT_ID)).toBe(olderTimeline);
  });
});
