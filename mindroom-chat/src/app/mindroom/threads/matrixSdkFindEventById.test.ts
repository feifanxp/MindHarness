import { MatrixEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const makeClient = (): MatrixClient =>
  ({
    canSupport: new Map(),
    decryptEventIfNeeded: async () => undefined,
    getUserId: () => '@alice:example.org',
    supportsThreads: () => true,
  } as unknown as MatrixClient);

const makeReply = (threadId: string, index: number) =>
  new MatrixEvent({
    content: {
      body: `Reply ${index}`,
      msgtype: 'm.text',
      'm.relates_to': { event_id: threadId, rel_type: 'm.thread' },
    },
    event_id: `$reply-${index}`,
    origin_server_ts: index,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

describe('matrix-js-sdk Room.findEventById (patched)', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.None;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
  });

  it('finds a thread event again without scanning the other threads', () => {
    const room = new Room('!room:example.org', makeClient(), '@alice:example.org');
    const threads = Array.from({ length: 5 }, (_, index) =>
      room.createThread(
        `$thread-${index}`,
        undefined,
        [makeReply(`$thread-${index}`, index)],
        false
      )
    );
    const reply = threads[4].findEventById('$reply-4');
    expect(reply).toBeDefined();
    expect(room.findEventById('$reply-4')).toBe(reply);
    const otherThreadLookups = threads
      .slice(0, 4)
      .map((thread) => vi.spyOn(thread, 'findEventById'));

    expect(room.findEventById('$reply-4')).toBe(reply);
    otherThreadLookups.forEach((lookup) => expect(lookup).not.toHaveBeenCalled());
  });

  it('does not return an event from a thread the room has removed', () => {
    const room = new Room('!room:example.org', makeClient(), '@alice:example.org');
    const thread = room.createThread('$thread-0', undefined, [makeReply('$thread-0', 0)], false);
    expect(room.findEventById('$reply-0')).toBeDefined();

    // The SDK subscribes this private handler once server thread lists load.
    // eslint-disable-next-line dot-notation
    room['onThreadDelete'](thread);

    expect(room.getThread('$thread-0')).toBeNull();
    expect(room.findEventById('$reply-0')).toBeUndefined();
  });
});
