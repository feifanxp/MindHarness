import { Direction, Room, type MatrixClient } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flushAsyncWork = async (cycles = 10) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

const makeClient = (createMessagesRequest: ReturnType<typeof vi.fn>): MatrixClient =>
  ({
    canSupport: new Map(),
    createMessagesRequest,
    getUserId: () => '@alice:example.org',
    supportsThreads: () => true,
  } as unknown as MatrixClient);

const makeRoomThreads = (roomId: string, client: MatrixClient, count = 3) => {
  const room = new Room(roomId, client, '@alice:example.org');
  const threads = Array.from({ length: count }, (_, index) =>
    room.createThread(`$thread-${index}`, undefined, [], false)
  );
  return { room, threads };
};

describe('matrix-js-sdk thread timeline reset', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.None;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
  });

  it('shares identical limited-sync token conversions across materialized threads', async () => {
    const createMessagesRequest = vi.fn(
      async (_roomId: string, token: string, _limit: number, direction: Direction) =>
        direction === Direction.Forward
          ? { chunk: [], end: `messages:${token}` }
          : { chunk: [], start: `messages:${token}` }
    );
    const { room, threads } = makeRoomThreads(
      '!room:example.org',
      makeClient(createMessagesRequest)
    );
    const oldLiveTimelines = threads.map((thread) => thread.liveTimeline);

    room.resetLiveTimeline('sync-back', 'sync-forward');

    expect(createMessagesRequest).toHaveBeenCalledTimes(2);
    expect(createMessagesRequest).toHaveBeenCalledWith(
      room.roomId,
      'sync-back',
      1,
      Direction.Forward
    );

    await flushAsyncWork();

    expect(createMessagesRequest).toHaveBeenCalledTimes(2);
    expect(createMessagesRequest).toHaveBeenLastCalledWith(
      room.roomId,
      'sync-forward',
      1,
      Direction.Backward
    );
    await Promise.all(threads.map((thread) => thread.flushPendingTimelineReset()));
    threads.forEach((thread, index) => {
      expect(thread.liveTimeline.getPaginationToken(Direction.Backward)).toBe('messages:sync-back');
      expect(oldLiveTimelines[index]?.getPaginationToken(Direction.Forward)).toBe(
        'messages:sync-forward'
      );
    });

    room.resetLiveTimeline('sync-back', 'sync-forward');
    await flushAsyncWork();

    expect(createMessagesRequest).toHaveBeenCalledTimes(4);
  });

  it('evicts a rejected conversion so the same token can be retried', async () => {
    const createMessagesRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('conversion failed'))
      .mockResolvedValue({ chunk: [], end: 'messages:sync-back' });
    const { threads } = makeRoomThreads('!room:example.org', makeClient(createMessagesRequest));

    const failedResults = await Promise.allSettled(
      threads.map((thread) => thread.resetLiveTimeline('sync-back', null))
    );

    expect(createMessagesRequest).toHaveBeenCalledOnce();
    expect(failedResults.every((result) => result.status === 'rejected')).toBe(true);

    await Promise.all(threads.map((thread) => thread.resetLiveTimeline('sync-back', null)));

    expect(createMessagesRequest).toHaveBeenCalledTimes(2);
    threads.forEach((thread) => {
      expect(thread.liveTimeline.getPaginationToken(Direction.Backward)).toBe('messages:sync-back');
    });
  });

  it('isolates conversions by room and Matrix client', async () => {
    const firstClientRequest = vi.fn(async (_roomId: string, token: string) => ({
      chunk: [],
      end: `messages:${token}`,
    }));
    const secondClientRequest = vi.fn(async (_roomId: string, token: string) => ({
      chunk: [],
      end: `messages:${token}`,
    }));
    const firstClient = makeClient(firstClientRequest);
    const firstRoomThreads = makeRoomThreads('!first:example.org', firstClient, 2).threads;
    const secondRoomThreads = makeRoomThreads('!second:example.org', firstClient, 2).threads;
    const secondClientThreads = makeRoomThreads(
      '!first:example.org',
      makeClient(secondClientRequest),
      2
    ).threads;

    await Promise.all(
      [...firstRoomThreads, ...secondRoomThreads, ...secondClientThreads].map((thread) =>
        thread.resetLiveTimeline('shared-token', null)
      )
    );

    expect(firstClientRequest).toHaveBeenCalledTimes(2);
    expect(firstClientRequest).toHaveBeenCalledWith(
      '!first:example.org',
      'shared-token',
      1,
      Direction.Forward
    );
    expect(firstClientRequest).toHaveBeenCalledWith(
      '!second:example.org',
      'shared-token',
      1,
      Direction.Forward
    );
    expect(secondClientRequest).toHaveBeenCalledOnce();
  });

  it('isolates conversions by token and direction', async () => {
    const createMessagesRequest = vi.fn(
      async (_roomId: string, token: string, _limit: number, direction: Direction) =>
        direction === Direction.Forward
          ? { chunk: [], end: `messages:${token}` }
          : { chunk: [], start: `messages:${token}` }
    );
    const { threads } = makeRoomThreads('!room:example.org', makeClient(createMessagesRequest), 2);

    await Promise.all([
      threads[0]?.resetLiveTimeline('first-token', null),
      threads[1]?.resetLiveTimeline('second-token', null),
    ]);

    expect(createMessagesRequest).toHaveBeenCalledTimes(2);

    createMessagesRequest.mockClear();
    await Promise.all([
      threads[0]?.resetLiveTimeline('shared-token', null),
      threads[1]?.resetLiveTimeline(null, 'shared-token'),
    ]);

    expect(createMessagesRequest).toHaveBeenCalledTimes(2);
    expect(createMessagesRequest).toHaveBeenCalledWith(
      '!room:example.org',
      'shared-token',
      1,
      Direction.Forward
    );
    expect(createMessagesRequest).toHaveBeenCalledWith(
      '!room:example.org',
      'shared-token',
      1,
      Direction.Backward
    );
  });
});
