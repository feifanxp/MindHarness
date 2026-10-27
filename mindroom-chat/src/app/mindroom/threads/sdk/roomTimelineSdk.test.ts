import { Direction, MatrixClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { insertCachedRoomTimeline, prependCachedRoomTimeline } from './roomTimelineSdk';

class ThreadEnabledClient extends MatrixClient {
  constructor() {
    super({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    // startClient normally stores this option after server discovery and starts sync.
    this.clientOpts = { threadSupport: true };
  }
}

const makeRoom = () => {
  const mx = new ThreadEnabledClient();
  const room = new Room('!room:example.org', mx, '@alice:example.org', {
    timelineSupport: true,
  });
  return { mx, room };
};

const makeEvent = (id: string, ts: number, content = {}): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: id, ...content },
  });

const makeRedaction = (target: string): MatrixEvent =>
  new MatrixEvent({
    event_id: '$redaction',
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.redaction',
    origin_server_ts: 4,
    redacts: target,
    content: {},
  });

it.each(['insert', 'prepend'])('processes cached poll models after %s', async (operation) => {
  const { mx, room } = makeRoom();
  const poll = new MatrixEvent({
    ...makeEvent('$poll', 1).event,
    type: 'm.poll.start',
    content: {
      'm.poll.start': {
        question: { 'm.text': 'Ready?' },
        kind: 'm.poll.disclosed',
        max_selections: 1,
        answers: [
          { id: 'yes', 'm.text': 'Yes' },
          { id: 'no', 'm.text': 'No' },
        ],
      },
    },
  });

  if (operation === 'insert') {
    await insertCachedRoomTimeline({ mx, room, events: [poll] });
  } else {
    await prependCachedRoomTimeline({
      mx,
      room,
      events: [poll],
      firstTimeline: room.getLiveTimeline(),
      beforeToken: null,
      showThreadRepliesInRoom: false,
    });
  }

  await vi.waitFor(() => expect(room.polls.get('$poll')?.rootEvent).toBe(poll));
  expect(room.findEventById('$poll')).toBe(poll);
});

describe('insertCachedRoomTimeline', () => {
  it('preserves cached event identity in the live timeline and room index', async () => {
    const { mx, room } = makeRoom();
    const event = new MatrixEvent({
      event_id: '$cached',
      room_id: room.roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { msgtype: 'm.text', body: 'cached' },
    });

    const result = await insertCachedRoomTimeline({ mx, room, events: [event] });

    expect(result.timelineWasEmpty).toBe(true);
    expect(result.timeline).toBe(room.getLiveTimeline());
    expect(result.timeline.getEvents()).toContain(event);
    expect(room.findEventById('$cached')).toBe(event);
    expect(room.getUnfilteredTimelineSet().eventIdToTimeline('$cached')).toBe(result.timeline);
  });

  it('retains existing events and reports a nonempty timeline', async () => {
    const { mx, room } = makeRoom();
    const existing = makeEvent('$existing', 1);
    await room.addLiveEvents([existing], { addToState: false });
    const cached = makeEvent('$cached', 2);

    const result = await insertCachedRoomTimeline({ mx, room, events: [existing, cached] });

    expect(result.timelineWasEmpty).toBe(false);
    expect(result.timeline.getEvents()).toEqual([existing, cached]);
    expect(room.findEventById('$existing')).toBe(existing);
  });

  it('hydrates edits and redactions before cached targets become visible', async () => {
    const { mx, room } = makeRoom();
    const target = makeEvent('$target', 1);
    const edit = makeEvent('$edit', 2, {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
      'm.new_content': { msgtype: 'm.text', body: 'edited' },
    });
    const redacted = makeEvent('$redacted', 3);
    const visible: unknown[] = [];
    room.on(RoomEvent.Timeline, (event) => {
      if (event === target) visible.push(event.getContent().body);
      if (event === redacted) visible.push(event.isRedacted());
    });

    await insertCachedRoomTimeline({
      mx,
      room,
      events: [target, edit, redacted, makeRedaction('$redacted')],
    });

    expect(visible).toEqual(['edited', true]);
    expect(room.findEventById('$target')).toBe(target);
    expect(target.replacingEvent()).toBe(edit);
    expect(redacted.getContent()).toEqual({});
  });
});

describe('prependCachedRoomTimeline', () => {
  it.each([
    { beforeToken: 'cached-before', expected: 'cached-before' },
    { beforeToken: null, expected: null },
    { beforeToken: undefined, expected: 'live-before' },
  ])(
    'prepends indexed events and resolves token $beforeToken',
    async ({ beforeToken, expected }) => {
      const { mx, room } = makeRoom();
      const newest = makeEvent('$newest', 3);
      await room.addLiveEvents([newest], { addToState: false });
      const firstTimeline = room.getLiveTimeline();
      firstTimeline.setPaginationToken('live-before', Direction.Backward);
      const middle = makeEvent('$middle', 2);
      const oldest = makeEvent('$oldest', 1);

      const result = await prependCachedRoomTimeline({
        mx,
        room,
        events: [middle, oldest],
        firstTimeline,
        beforeToken,
        showThreadRepliesInRoom: false,
      });

      expect(result).toBe(firstTimeline);
      expect(result.getEvents()).toEqual([oldest, middle, newest]);
      expect(result.getPaginationToken(Direction.Backward)).toBe(expected);
      expect(room.findEventById('$oldest')).toBe(oldest);
      expect(room.getUnfilteredTimelineSet().eventIdToTimeline('$middle')).toBe(firstTimeline);
    }
  );

  it('returns the backward neighbor when overlap joins timelines', async () => {
    const { mx, room } = makeRoom();
    const timelineSet = room.getUnfilteredTimelineSet();
    const firstTimeline = room.getLiveTimeline();
    const neighbor = timelineSet.addTimeline();
    const overlap = makeEvent('$overlap', 2);
    timelineSet.addEventToTimeline(overlap, neighbor, { toStartOfTimeline: false });
    const oldest = makeEvent('$oldest', 1);

    const result = await prependCachedRoomTimeline({
      mx,
      room,
      events: [overlap, oldest],
      firstTimeline,
      beforeToken: 'older-page',
      showThreadRepliesInRoom: false,
    });

    expect(result).toBe(neighbor);
    expect(firstTimeline.getNeighbouringTimeline(Direction.Backward)).toBe(neighbor);
    expect(neighbor.getNeighbouringTimeline(Direction.Forward)).toBe(firstTimeline);
    expect(neighbor.getEvents()).toEqual([oldest, overlap]);
    expect(neighbor.getPaginationToken(Direction.Backward)).toBe('older-page');
    expect(timelineSet.eventIdToTimeline('$oldest')).toBe(neighbor);
    expect(room.findEventById('$overlap')).toBe(overlap);
  });

  it.each([false, true])(
    'retains SDK placement with showThreadRepliesInRoom=%s',
    async (showThreadRepliesInRoom) => {
      const { mx, room } = makeRoom();
      const partition = vi.spyOn(room, 'partitionThreadedEvents');
      const reply = makeEvent('$reply', 2, {
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      });
      const message = makeEvent('$message', 1);

      const result = await prependCachedRoomTimeline({
        mx,
        room,
        events: [reply, message],
        firstTimeline: room.getLiveTimeline(),
        beforeToken: null,
        showThreadRepliesInRoom,
      });

      // Bypassing partition does not bypass the SDK timeline set's canContain check.
      expect(result.getEvents()).toEqual([message]);
      expect(room.getUnfilteredTimelineSet().findEventById('$reply')).toBeUndefined();
      expect(room.getUnfilteredTimelineSet().eventIdToTimeline('$reply')).toBeUndefined();
      expect(partition).toHaveBeenCalledTimes(showThreadRepliesInRoom ? 0 : 1);
      partition.mockRestore();
    }
  );

  it('hydrates edited targets and reconciles unknown and redacted relations', async () => {
    const { mx, room } = makeRoom();
    const target = makeEvent('$target', 1);
    const edit = makeEvent('$edit', 2, {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
      'm.new_content': { msgtype: 'm.text', body: 'edited' },
    });
    const reaction = new MatrixEvent({
      ...makeEvent('$reaction', 3).event,
      type: 'm.reaction',
      content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$missing', key: 'ok' } },
    });
    const redactedReaction = new MatrixEvent({
      ...reaction.event,
      event_id: '$removed',
      content: {
        'm.relates_to': { rel_type: 'm.annotation', event_id: '$missing', key: 'removed' },
      },
    });
    room.relations.aggregateChildEvent(redactedReaction);

    const result = await prependCachedRoomTimeline({
      mx,
      room,
      events: [makeRedaction('$removed'), redactedReaction, reaction, edit, target],
      firstTimeline: room.getLiveTimeline(),
      beforeToken: null,
      showThreadRepliesInRoom: false,
    });

    expect(target.getContent().body).toBe('edited');
    expect(target.replacingEvent()).toBe(edit);
    expect(room.findEventById('$target')).toBe(target);
    expect(result.getEvents()).not.toContain(reaction);
    expect(redactedReaction.isRedacted()).toBe(true);
    expect(
      room.relations
        .getChildEventsForEvent('$missing', 'm.annotation', 'm.reaction')
        ?.getRelations()
    ).toEqual([reaction]);
  });
});
