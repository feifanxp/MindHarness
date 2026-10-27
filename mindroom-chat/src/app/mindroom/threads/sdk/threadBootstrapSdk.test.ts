import { createClient, Direction, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { describe, expect, it, vi } from 'vitest';
import { getLinkedTimelines, getThreadTimelineEvents } from '../linkedTimelines';
import {
  appendThreadBootstrapRelations,
  createInitializedThreadForRoot,
  fetchThreadBootstrapRelations,
} from './threadBootstrapSdk';

const makeEvent = (id: string, ts: number, reply = false): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(reply ? { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } } : {}),
    },
  });

class ThreadEnabledClient extends MatrixClient {
  constructor() {
    super({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    // Configure real thread routing without starting a network sync loop.
    this.clientOpts = { threadSupport: true };
  }
}

const makeDeferredThread = () => {
  const mx = new ThreadEnabledClient();
  const room = new Room('!room:example.org', mx, '@alice:example.org', {
    timelineSupport: true,
  });
  const root = makeEvent('$root', 1);
  vi.spyOn(mx, 'fetchRoomEvent');
  const thread = createInitializedThreadForRoot(room, root);
  // The SDK processes a known root locally; let that metadata update settle.
  const settleMetadata = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  return { mx, room, root, thread, settleMetadata };
};

describe('threadBootstrapSdk', () => {
  it('inserts fetched replies before reset token conversion settles and preserves the relations cursor', async () => {
    const previousSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    try {
      const { mx, room, thread, settleMetadata } = makeDeferredThread();
      let finishConversion!: (value: { chunk: never[]; start: string; end: string }) => void;
      const conversion = new Promise<{ chunk: never[]; start: string; end: string }>((resolve) => {
        finishConversion = resolve;
      });
      vi.spyOn(mx, 'createMessagesRequest').mockReturnValue(conversion);
      const previousLive = thread.liveTimeline;
      room.resetLiveTimeline('sync-back', 'sync-forward');
      const reply = makeEvent('$reply', 2, true);
      appendThreadBootstrapRelations({ thread, events: [reply], nextBatch: 'relations-older' });
      expect(thread.liveTimeline).not.toBe(previousLive);
      expect(thread.events).toEqual([reply]);
      expect(thread.liveTimeline.getPaginationToken(Direction.Backward)).toBe('relations-older');
      finishConversion({ chunk: [], start: 'converted-forward', end: 'converted-back' });
      await thread.flushPendingTimelineReset();
      await settleMetadata();
      expect(thread.liveTimeline.getPaginationToken(Direction.Backward)).toBe('relations-older');
    } finally {
      Thread.hasServerSideSupport = previousSupport;
      vi.restoreAllMocks();
    }
  });
  it('places new events around a known historical window without changing the latest reply', async () => {
    const previousSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    try {
      const { thread, settleMetadata } = makeDeferredThread();
      const older = makeEvent('$older', 2, true);
      const middle = makeEvent('$middle', 3, true);
      const newer = makeEvent('$newer', 4, true);
      thread.setEventMetadata(middle);
      const timelineSet = thread.getUnfilteredTimelineSet();
      const historical = timelineSet.addTimeline();
      timelineSet.addEventsToTimeline([middle], true, false, historical, 'before-middle');
      appendThreadBootstrapRelations({
        thread,
        events: [older, middle, newer],
        nextBatch: 'before-older',
      });
      await settleMetadata();
      expect(getThreadTimelineEvents(thread)).toEqual([older, middle, newer]);
      expect(thread.lastReply()).toBe(newer);
      expect(
        getLinkedTimelines(thread.liveTimeline)[0].getPaginationToken(Direction.Backward)
      ).toBe('before-older');
    } finally {
      Thread.hasServerSideSupport = previousSupport;
      vi.restoreAllMocks();
    }
  });
  it('keeps a reply added while the thread metadata settles without refetching the root', async () => {
    const previousSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    try {
      const { mx, room, root, thread, settleMetadata } = makeDeferredThread();
      const paginate = vi.spyOn(mx, 'paginateEventTimeline');
      const reply = makeEvent('$reply', 2, true);
      expect(thread.rootEvent).toBe(root);
      expect(room.getThread('$root')).toBe(thread);

      await thread.addEvent(reply, false);
      await settleMetadata();

      expect(thread.events).toContain(reply);
      expect(thread.findEventById('$reply')).toBe(reply);
      expect(thread.getUnfilteredTimelineSet().eventIdToTimeline('$reply')).toBe(
        thread.liveTimeline
      );
      expect(paginate).not.toHaveBeenCalled();
      expect(mx.fetchRoomEvent).not.toHaveBeenCalled();
      expect(thread.initialEventsFetched).toBe(true);
      expect(thread.replayEvents).toBeNull();
    } finally {
      Thread.hasServerSideSupport = previousSupport;
      vi.restoreAllMocks();
    }
  });

  it('requests one backward thread relation page with limit 50 through the real SDK', async () => {
    const requests: URL[] = [];
    const chunk = [makeEvent('$reply', 2, true).event];
    const mx = createClient({
      baseUrl: 'https://example.org',
      userId: '@alice:example.org',
      fetchFn: async (url) => {
        requests.push(new URL(String(url)));
        return new Response(JSON.stringify({ chunk, next_batch: 'older' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const result = await fetchThreadBootstrapRelations(mx, '!room:example.org', '$root');

    expect(result.chunk).toEqual(chunk);
    expect(result.next_batch).toBe('older');
    expect(requests).toHaveLength(1);
    expect(decodeURIComponent(requests[0].pathname)).toBe(
      '/_matrix/client/v1/rooms/!room:example.org/relations/$root/m.thread'
    );
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ dir: 'b', limit: '50' });
  });

  it.each(['older', undefined])(
    'adds indexed replies and applies next_batch=%s',
    async (nextBatch) => {
      const previousSupport = Thread.hasServerSideSupport;
      Thread.hasServerSideSupport = FeatureSupport.Stable;
      try {
        const { thread, settleMetadata } = makeDeferredThread();
        const firstTimeline = thread.liveTimeline;
        firstTimeline.setPaginationToken('previous', Direction.Backward);
        const reply = makeEvent('$reply', 2, true);
        const newerReply = makeEvent('$newer-reply', 3, true);

        appendThreadBootstrapRelations({
          thread,
          events: [reply, newerReply],
          nextBatch,
        });
        await settleMetadata();

        // Native backward pagination accepts newest first and stores chronological order.
        expect(thread.events).toEqual([reply, newerReply]);
        expect(thread.findEventById('$reply')).toBe(reply);
        expect(firstTimeline.getPaginationToken(Direction.Backward)).toBe(nextBatch ?? null);
      } finally {
        Thread.hasServerSideSupport = previousSupport;
        vi.restoreAllMocks();
      }
    }
  );

  it('indexes relations in the live timeline', async () => {
    const previousSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    try {
      const { thread, settleMetadata } = makeDeferredThread();
      const reply = makeEvent('$reply', 2, true);
      appendThreadBootstrapRelations({
        thread,
        events: [reply],
        nextBatch: undefined,
      });
      await settleMetadata();

      expect(thread.events).toContain(reply);
      expect(thread.findEventById('$reply')).toBe(reply);
    } finally {
      Thread.hasServerSideSupport = previousSupport;
      vi.restoreAllMocks();
    }
  });
});
