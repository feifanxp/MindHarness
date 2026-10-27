import { describe, expect, it } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk';
import { buildThreadTagSnapshotMap, getRoomThreadTagSnapshotMap } from './threadTagSnapshots';
import { MINDROOM_THREAD_TAGS_EVENT } from './threadTags';

const ISO_1 = '2026-04-04T18:00:00.000Z';
const ISO_2 = '2026-04-04T18:05:00.000Z';

let nextEventNumber = 0;

// Each state change is a new event with its own id, as in the SDK.
const makeTagEvent = (stateKey: string, content: Record<string, unknown>): MatrixEvent => {
  nextEventNumber += 1;
  return new MatrixEvent({
    content,
    event_id: `$tags-${nextEventNumber}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: MINDROOM_THREAD_TAGS_EVENT,
  });
};

const makeRedaction = (redacts: MatrixEvent) =>
  new MatrixEvent({
    content: {},
    event_id: `$redaction-${redacts.getId()}`,
    origin_server_ts: 2,
    redacts: redacts.getId(),
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.redaction',
  });

// Like the SDK's RoomState, every read copies the current events into a new array.
const makeRoom = (initialEvents: MatrixEvent[]) => {
  let events = initialEvents;
  const roomState = { getStateEvents: () => [...events] };
  const room = {
    getLiveTimeline: () => ({ getState: () => roomState }),
  } as unknown as Room;
  return {
    room,
    setEvents: (next: MatrixEvent[]) => {
      events = next;
    },
  };
};

const blocked = (setAt = ISO_2) =>
  makeTagEvent(JSON.stringify(['$root', 'blocked']), { set_by: '@bob:example.org', set_at: setAt });
const urgent = () =>
  makeTagEvent('$other', { tags: { urgent: { set_by: '@alice:example.org', set_at: ISO_1 } } });

describe('buildThreadTagSnapshotMap', () => {
  it('projects aggregated tag state into display/resolved snapshots', () => {
    const snapshots = buildThreadTagSnapshotMap([
      makeTagEvent('$root', {
        tags: {
          resolved: { set_by: '@alice:example.org', set_at: ISO_1 },
          urgent: { set_by: '@alice:example.org', set_at: ISO_1 },
        },
      }),
      makeTagEvent(JSON.stringify(['$root', 'blocked']), {
        set_by: '@bob:example.org',
        set_at: ISO_2,
      }),
    ]);

    expect(snapshots.get('$root')).toMatchObject({
      isResolved: true,
      displayTags: ['blocked', 'urgent'],
      content: {
        tags: {
          blocked: { set_by: '@bob:example.org', set_at: ISO_2 },
          resolved: { set_by: '@alice:example.org', set_at: ISO_1 },
          urgent: { set_by: '@alice:example.org', set_at: ISO_1 },
        },
      },
    });
  });
});

describe('getRoomThreadTagSnapshotMap', () => {
  it('reuses the snapshot map while the room tag state is unchanged', () => {
    const { room } = makeRoom([blocked(), urgent()]);
    const first = getRoomThreadTagSnapshotMap(room);

    expect(getRoomThreadTagSnapshotMap(room)).toBe(first);
    expect(first.get('$root')?.displayTags).toEqual(['blocked']);
  });

  it('keeps a separate slot for every room', () => {
    // The command palette and cross-room flushes read every room in turn.
    const rooms = Array.from({ length: 12 }, () => makeRoom([blocked()]).room);
    const first = rooms.map(getRoomThreadTagSnapshotMap);

    rooms.forEach((room, index) => expect(getRoomThreadTagSnapshotMap(room)).toBe(first[index]));
  });

  it('rebuilds when an event is replaced, added, removed or reordered', () => {
    const tagEvents = [blocked(), urgent()];
    const { room, setEvents } = makeRoom(tagEvents);
    const first = getRoomThreadTagSnapshotMap(room);

    setEvents([blocked(ISO_1), tagEvents[1]]);
    const replaced = getRoomThreadTagSnapshotMap(room);
    expect(replaced).not.toBe(first);
    expect(replaced.get('$root')?.content.tags.blocked?.set_at).toBe(ISO_1);

    setEvents([tagEvents[0]]);
    expect(getRoomThreadTagSnapshotMap(room).has('$other')).toBe(false);

    setEvents([tagEvents[1], tagEvents[0]]);
    const reordered = getRoomThreadTagSnapshotMap(room);
    expect(reordered).toEqual(first);
    expect(reordered).not.toBe(first);
  });

  it('rebuilds after an event is redacted in place', () => {
    const tagEvents = [blocked(), urgent()];
    const { room } = makeRoom(tagEvents);
    const first = getRoomThreadTagSnapshotMap(room);

    // The SDK keeps the event and its content object, stripping the keys.
    tagEvents[0].makeRedacted(makeRedaction(tagEvents[0]), room);
    const redacted = getRoomThreadTagSnapshotMap(room);

    expect(redacted).not.toBe(first);
    expect(redacted.has('$root')).toBe(false);
    expect(getRoomThreadTagSnapshotMap(room)).toBe(redacted);
  });

  it('follows a pending local redaction and its reversal', () => {
    const tagEvents = [blocked(), urgent()];
    const { room } = makeRoom(tagEvents);
    const first = getRoomThreadTagSnapshotMap(room);

    tagEvents[0].markLocallyRedacted(makeRedaction(tagEvents[0]));
    const redacted = getRoomThreadTagSnapshotMap(room);
    // A pending local redaction reads a fresh `{}` each time, yet still reuses the map.
    expect(redacted).not.toBe(first);
    expect(redacted.has('$root')).toBe(false);
    expect(getRoomThreadTagSnapshotMap(room)).toBe(redacted);

    tagEvents[0].unmarkLocallyRedacted();
    const restored = getRoomThreadTagSnapshotMap(room);
    expect(restored).not.toBe(redacted);
    expect(restored.get('$root')?.displayTags).toEqual(['blocked']);
  });

  it('shares one empty map for rooms without tag state', () => {
    const empty = getRoomThreadTagSnapshotMap(makeRoom([]).room);

    expect(getRoomThreadTagSnapshotMap(makeRoom([]).room)).toBe(empty);
    expect(empty.size).toBe(0);
  });
});
