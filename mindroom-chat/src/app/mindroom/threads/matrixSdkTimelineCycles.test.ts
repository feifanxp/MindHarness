import {
  createClient,
  Direction,
  EventTimeline,
  EventTimelineSet,
  MatrixEvent,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOM_ID = '!room:example.org';

const makeEvent = (id: string, timestamp: number): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@agent:example.org',
    type: 'm.room.message',
    origin_server_ts: timestamp,
    content: { msgtype: 'm.text', body: id },
  });

const makeTimelineSet = () =>
  new EventTimelineSet(
    undefined,
    { timelineSupport: true },
    createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' })
  );

const prev = (timeline: EventTimeline) => timeline.getNeighbouringTimeline(Direction.Backward);
const next = (timeline: EventTimeline) => timeline.getNeighbouringTimeline(Direction.Forward);

// A walk around a cycle never ends and never yields, so a regression would hang the
// test run instead of failing it. Fail it once a walk reads far more links than exist.
const originalGetNeighbouringTimeline = EventTimeline.prototype.getNeighbouringTimeline;
let neighbourReads = 0;

beforeEach(() => {
  neighbourReads = 0;
  EventTimeline.prototype.getNeighbouringTimeline = function getNeighbouringTimeline(
    this: EventTimeline,
    direction: Direction
  ) {
    neighbourReads += 1;
    if (neighbourReads > 10_000) throw new Error('walked a timeline cycle');
    return originalGetNeighbouringTimeline.call(this, direction);
  };
});

afterEach(() => {
  EventTimeline.prototype.getNeighbouringTimeline = originalGetNeighbouringTimeline;
});

/**
 * The head segment holds the root and the first reply; a newer segment, joined
 * behind it by its history page, holds the next replies; a sync gap then leaves
 * both behind a new live segment.
 */
const makeGappedThreadSegments = () => {
  const timelineSet = makeTimelineSet();
  const head = timelineSet.getLiveTimeline();
  timelineSet.addEventsToTimeline(
    [makeEvent('$reply-2', 2), makeEvent('$root', 1)],
    true,
    false,
    head,
    'head-token'
  );
  timelineSet.resetLiveTimeline('newer-back', 'newer-forward');
  const newer = timelineSet.getLiveTimeline();
  timelineSet.addEventsToTimeline(
    [makeEvent('$reply-5', 5), makeEvent('$reply-4', 4)],
    true,
    false,
    newer,
    'newer-token'
  );
  timelineSet.addEventsToTimeline(
    [makeEvent('$reply-3', 3), makeEvent('$reply-2', 2)],
    true,
    false,
    newer,
    'newer-history-token'
  );
  timelineSet.resetLiveTimeline('live-back', 'live-forward');
  const live = timelineSet.getLiveTimeline();
  timelineSet.addLiveEvent(makeEvent('$reply-9', 9), { addToState: false });
  return { timelineSet, head, newer, live };
};

describe('matrix-js-sdk timeline cycles', () => {
  it('does not join a misordered history page into a cycle', () => {
    const { timelineSet, head, newer, live } = makeGappedThreadSegments();
    expect(prev(newer)).toBe(head);
    expect(next(head)).toBe(newer);

    // A history page for the head segment that holds a newer segment's reply.
    timelineSet.addEventsToTimeline([makeEvent('$reply-4', 4)], true, false, head, null);

    expect(prev(head)).toBeNull();
    expect(next(newer)).toBeNull();
    expect(prev(newer)).toBe(head);
    expect(next(head)).toBe(newer);
    expect(prev(live)).toBeNull();
    // The receipt check for a new live reply compares it with a reply in the old segments.
    expect(timelineSet.compareEventOrdering('$reply-2', '$reply-9')).toBeNull();
    expect(timelineSet.compareEventOrdering('$reply-2', '$reply-4')).toBe(-1);
  });

  it('skips a join that conflicts with an existing neighbour and keeps the rest of the page', () => {
    const timelineSet = makeTimelineSet();
    const older = timelineSet.getLiveTimeline();
    timelineSet.addEventsToTimeline([makeEvent('$reply-1', 1)], true, false, older, 'older-token');
    timelineSet.resetLiveTimeline('newer-back', 'newer-forward');
    const newer = timelineSet.getLiveTimeline();
    timelineSet.addEventsToTimeline(
      [makeEvent('$reply-3', 3), makeEvent('$reply-1', 1)],
      true,
      false,
      newer,
      null
    );
    expect(next(older)).toBe(newer);
    timelineSet.resetLiveTimeline('other-back', 'other-forward');
    const other = timelineSet.getLiveTimeline();
    timelineSet.addEventsToTimeline([makeEvent('$reply-6', 6)], true, false, other, 'other-token');
    timelineSet.resetLiveTimeline('live-back', 'live-forward');

    // The older segment already leads to the newer one, so it cannot also lead to this one.
    timelineSet.addEventsToTimeline(
      [makeEvent('$reply-5', 5), makeEvent('$reply-1', 1), makeEvent('$reply-0', 0)],
      true,
      false,
      other,
      'other-history-token'
    );

    expect(prev(other)).toBeNull();
    expect(next(older)).toBe(newer);
    expect(prev(newer)).toBe(older);
    expect(other.getEvents().map((event) => event.getId())).toEqual([
      '$reply-0',
      '$reply-5',
      '$reply-6',
    ]);
    expect(other.getPaginationToken(Direction.Backward)).toBe('other-history-token');
  });

  it('compares events across segments that already form a cycle', () => {
    const timelineSet = makeTimelineSet();
    const first = timelineSet.getLiveTimeline();
    timelineSet.addEventsToTimeline([makeEvent('$reply-1', 1)], true, false, first, null);
    timelineSet.resetLiveTimeline('second-back', 'second-forward');
    const second = timelineSet.getLiveTimeline();
    timelineSet.addEventsToTimeline([makeEvent('$reply-2', 2)], true, false, second, null);
    timelineSet.resetLiveTimeline('live-back', 'live-forward');
    timelineSet.addLiveEvent(makeEvent('$reply-9', 9), { addToState: false });
    // Links an older SDK build could leave behind: each segment on both sides of the other.
    first.setNeighbouringTimeline(second, Direction.Forward);
    first.setNeighbouringTimeline(second, Direction.Backward);
    second.setNeighbouringTimeline(first, Direction.Forward);
    second.setNeighbouringTimeline(first, Direction.Backward);

    expect(timelineSet.compareEventOrdering('$reply-1', '$reply-9')).toBeNull();
    expect(timelineSet.compareEventOrdering('$reply-9', '$reply-1')).toBeNull();
    expect(timelineSet.compareEventOrdering('$reply-1', '$reply-2')).toBe(-1);
  });
});
