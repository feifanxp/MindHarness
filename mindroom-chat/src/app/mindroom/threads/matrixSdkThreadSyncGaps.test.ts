import { createClient, Direction, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const fixture = (count = 1) => {
  const client = createClient({
    baseUrl: 'https://example.org',
    userId: '@alice:example.org',
    timelineSupport: true,
  });
  const room = new Room('!room:example.org', client, '@alice:example.org', {
    timelineSupport: true,
  });
  client.store.storeRoom(room);
  room.setMaxListeners(0);
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  const messages = vi
    .spyOn(client, 'createMessagesRequest')
    .mockImplementation(async (_room, token, _limit, dir) => ({
      chunk: [],
      start: dir === Direction.Backward ? 'messages:' + token : token!,
      end: dir === Direction.Forward ? 'messages:' + token : token!,
    }));
  const event = (id: string, root = '$root-0') =>
    new MatrixEvent({
      event_id: id,
      room_id: room.roomId,
      type: 'm.room.message',
      sender: '@alice:example.org',
      origin_server_ts: Date.now(),
      content: {
        msgtype: 'm.text',
        body: id,
        'm.relates_to': { rel_type: 'm.thread', event_id: root },
      },
    });
  const threads = Array.from({ length: count }, (_, i) =>
    room.createThread('$root-' + i, undefined, [event('$reply-' + i, '$root-' + i)], false)
  );
  return { client, room, threads, messages, event };
};

describe('deferred thread sync gaps', () => {
  let support: FeatureSupport;
  beforeEach(() => {
    support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.None;
  });
  afterEach(() => {
    Thread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  it('keeps 200 untouched thread timelines across 20 gaps and forks only a touched thread', async () => {
    const { room, threads, event } = fixture(200);
    const old = threads.map((t) => t.liveTimeline);
    for (let i = 0; i < 20; i += 1) {
      room.resetLiveTimeline('back-' + i, 'forward-' + i);
      threads.forEach((t, index) => {
        expect(t.liveTimeline === old[index]).toBe(true);
        expect(t.events).toHaveLength(1);
      });
    }
    expect(threads.reduce((n, t) => n + t.timelineSet.getTimelines().length, 0)).toBe(200);
    threads[0].addEvent(event('$new'), false);
    await threads[0].flushPendingTimelineReset();
    expect(threads.reduce((n, t) => n + t.timelineSet.getTimelines().length, 0)).toBe(201);
    expect(threads[0].findEventById('$reply-0')).toBe(old[0].getEvents()[0]);
    expect(old[0].getPaginationToken(Direction.Forward)).toBe('messages:forward-0');
    expect(threads[0].liveTimeline.getPaginationToken(Direction.Backward)).toBe('messages:back-19');
    expect(threads[0].liveTimeline.getEvents()[0].getId()).toBe('$new');
  });

  it('starts shared conversions immediately, including the earliest forward boundary', async () => {
    const { room, threads, messages } = fixture(3);
    room.resetLiveTimeline('back', 'forward');
    await settle();
    expect(messages).toHaveBeenCalledTimes(2);
    await Promise.all(threads.map((t) => t.flushPendingTimelineReset()));
    expect(messages).toHaveBeenCalledTimes(2);
  });

  it('keeps a backward cursor when no room event follows the gap boundary', async () => {
    // Tuwunel's compact edits can shrink a limited window of streamed edits to its newest
    // event; `/messages` then finds nothing after `prev_batch` and omits `end`.
    const { room, threads, messages, client, event } = fixture();
    messages.mockImplementation(async (_room, token, _limit, dir) =>
      dir === Direction.Forward
        ? { chunk: [], start: token! }
        : { chunk: [], start: 'messages:' + token, end: token! }
    );
    const http = vi
      .spyOn(client.http, 'authedRequest')
      .mockResolvedValue({ chunk: [event('$gap-reply').event], next_batch: 'older' });
    room.resetLiveTimeline('back', 'forward');
    await threads[0].flushPendingTimelineReset();

    expect(threads[0].liveTimeline.getPaginationToken(Direction.Backward)).toBe('back');
    await client.paginateEventTimeline(threads[0].liveTimeline, { backwards: true });
    expect(new URL(http.mock.calls[0][1], 'https://example.org').searchParams.get('from')).toBe(
      'back'
    );
    expect(threads[0].liveTimeline.getEvents().map((e) => e.getId())).toContain('$gap-reply');
  });

  it('clears a deferred gap on destructive reset and ignores old conversion completion', async () => {
    const { room, threads, messages } = fixture();
    const pending = deferred<any>();
    messages.mockReturnValue(pending.promise);
    room.resetLiveTimeline('back', 'forward');
    room.resetLiveTimeline(null, null);
    const live = threads[0].liveTimeline;
    pending.resolve({ chunk: [], start: 'stale-forward', end: 'stale-back' });
    await settle();
    await threads[0].flushPendingTimelineReset();
    expect(threads[0].liveTimeline).toBe(live);
    expect(threads[0].timelineSet.getTimelines()).toEqual([live]);
    expect(live.getPaginationToken(Direction.Backward)).toBeNull();
  });
  it.each([true, false])(
    'waits for conversions and paginates the original historical target (backwards=%s)',
    async (backwards) => {
      const { room, threads, messages, client, event } = fixture();
      const old = threads[0].liveTimeline;
      old.setPaginationToken('original-back', Direction.Backward);
      const conversion = deferred<any>();
      messages.mockReturnValue(conversion.promise);
      const http = vi
        .spyOn(client.http, 'authedRequest')
        .mockResolvedValue({ chunk: [event('$history').event], next_batch: 'more' });
      room.resetLiveTimeline('back', 'forward');
      const request = client.paginateEventTimeline(old, { backwards });
      expect(http).not.toHaveBeenCalled();
      conversion.resolve({ chunk: [], start: 'converted-forward', end: 'converted-back' });
      await request;
      expect(new URL(http.mock.calls[0][1], 'https://example.org').searchParams.get('from')).toBe(
        backwards ? 'original-back' : 'converted-forward'
      );
      expect(threads[0].timelineSet.getTimelineForEvent('$history') === old).toBe(true);
      expect(threads[0].liveTimeline === old).toBe(false);
    }
  );

  it('cancels pagination if a destructive reset removes its target during conversion', async () => {
    const { room, threads, messages, client } = fixture();
    const old = threads[0].liveTimeline;
    const conversion = deferred<any>();
    messages.mockReturnValue(conversion.promise);
    const http = vi
      .spyOn(client.http, 'authedRequest')
      .mockResolvedValue({ chunk: [], next_batch: 'more' });
    room.resetLiveTimeline('back', 'forward');
    const request = client.paginateEventTimeline(old, { backwards: true });
    room.resetLiveTimeline(null, null);
    conversion.resolve({ chunk: [], start: 'converted-forward', end: 'converted-back' });
    expect(await request).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });

  it('keeps conversions visible after insertion and cleans up a rejected conversion', async () => {
    const { room, threads, messages, client, event } = fixture();
    const conversion = deferred<any>();
    messages.mockReturnValue(conversion.promise);
    const http = vi
      .spyOn(client.http, 'authedRequest')
      .mockResolvedValue({ chunk: [], next_batch: 'more' });
    room.resetLiveTimeline('back', 'forward');
    threads[0].addEvent(event('$new'), false);
    const request = client.paginateEventTimeline(threads[0].liveTimeline, { backwards: true });
    expect(http).not.toHaveBeenCalled();
    conversion.reject(new Error('conversion failed'));
    await expect(request).rejects.toThrow('conversion failed');
    expect(threads[0].flushPendingTimelineReset()).toBeUndefined();
    await expect(
      client.paginateEventTimeline(threads[0].liveTimeline, { backwards: true })
    ).resolves.toBe(true);
  });

  it('forks immediately while HTTP pagination is in flight and keeps its target registered', async () => {
    const { room, threads, client, event } = fixture();
    const old = threads[0].liveTimeline;
    const transport = deferred<any>();
    vi.spyOn(client.http, 'authedRequest').mockReturnValue(transport.promise);
    const request = client.paginateEventTimeline(old, { backwards: true });
    room.resetLiveTimeline('back', 'forward');
    expect(threads[0].liveTimeline === old).toBe(false);
    transport.resolve({ chunk: [event('$history').event], next_batch: 'more' });
    await request;
    expect(threads[0].timelineSet.getTimelineForEvent('$history') === old).toBe(true);
    expect(threads[0].timelineSet.getTimelines()).toContain(old);
  });

  it.each(['cache', 'echo'])(
    'materializes before a direct timeline-set live insertion (%s)',
    async (kind) => {
      const { room, threads, event } = fixture();
      const old = threads[0].liveTimeline;
      room.resetLiveTimeline('back', 'forward');
      const next = event('$insert');
      if (kind === 'cache')
        threads[0].timelineSet.addLiveEvent(next, { fromCache: true, addToState: false });
      else threads[0].timelineSet.handleRemoteEcho(next, '$local', '$insert');
      expect(threads[0].liveTimeline === old).toBe(false);
      expect(threads[0].liveTimeline.getEvents()).toContain(next);
      expect(old.getEvents()).not.toContain(next);
      await threads[0].flushPendingTimelineReset();
    }
  );
  it('does not materialize for duplicate thread or cache insertions', async () => {
    const { room, threads } = fixture();
    const thread = threads[0];
    const old = thread.liveTimeline;
    const known = old.getEvents()[0];
    room.resetLiveTimeline('back', 'forward');
    thread.addEvent(known, false);
    thread.insertEventIntoTimeline(known);
    thread.timelineSet.addLiveEvent(known, { fromCache: true, addToState: false });
    expect(thread.liveTimeline === old).toBe(true);
    await thread.flushPendingTimelineReset();
  });

  it('exposes conversion work to pagination reentering from the reset notification', async () => {
    const { room, threads, messages, client } = fixture();
    const conversion = deferred<any>();
    messages.mockReturnValue(conversion.promise);
    const http = vi
      .spyOn(client.http, 'authedRequest')
      .mockResolvedValue({ chunk: [], next_batch: 'more' });
    room.resetLiveTimeline('back', 'forward');
    let request: Promise<boolean> | undefined;
    threads[0].once(RoomEvent.TimelineReset, () => {
      request = client.paginateEventTimeline(threads[0].liveTimeline, { backwards: true });
    });
    const flush = threads[0].flushPendingTimelineReset();
    expect(http).not.toHaveBeenCalled();
    conversion.resolve({ chunk: [], start: 'converted-forward', end: 'converted-back' });
    await flush;
    await request;
    expect(new URL(http.mock.calls[0][1], 'https://example.org').searchParams.get('from')).toBe(
      'converted-back'
    );
  });

  it('keeps the newest gap if another reset arrives while pagination awaits conversion', async () => {
    const { room, threads, messages, client } = fixture();
    const first = deferred<any>();
    messages.mockReturnValueOnce(first.promise).mockReturnValueOnce(first.promise);
    const http = vi
      .spyOn(client.http, 'authedRequest')
      .mockResolvedValue({ chunk: [], next_batch: 'more' });
    const old = threads[0].liveTimeline;
    room.resetLiveTimeline('back-1', 'forward-1');
    const request = client.paginateEventTimeline(old, { backwards: false });
    room.resetLiveTimeline('back-2', 'forward-2');
    first.resolve({ chunk: [], start: 'first-forward', end: 'first-back' });
    await request;
    expect(new URL(http.mock.calls[0][1], 'https://example.org').searchParams.get('from')).toBe(
      'first-forward'
    );
    expect(threads[0].liveTimeline.getPaginationToken(Direction.Backward)).toBe('messages:back-2');
    expect(threads[0].timelineSet.getTimelines()).toHaveLength(3);
  });

  it('does not defer resets during initial metadata loading', async () => {
    const { room, threads } = fixture();
    await settle();
    // An opened thread whose first page is still loading.
    threads[0].initialEventsFetched = false;
    (threads[0] as unknown as { initializationDeferred: boolean }).initializationDeferred = false;
    const old = threads[0].liveTimeline;
    room.resetLiveTimeline('back', 'forward');
    expect(threads[0].liveTimeline === old).toBe(false);
    await threads[0].flushPendingTimelineReset();
    threads[0].timelineSet.resetLiveTimeline();
    expect(threads[0].flushPendingTimelineReset()).toBeUndefined();
    expect(threads[0].timelineSet.getTimelines()).toHaveLength(1);
  });
  it('materializes before direct history insertion while preserving the requested timeline', async () => {
    const { room, threads, event } = fixture();
    const old = threads[0].liveTimeline;
    room.resetLiveTimeline('back', 'forward');
    const history = event('$history');
    threads[0].timelineSet.addEventsToTimeline([history], true, false, old, 'older');
    expect(threads[0].liveTimeline === old).toBe(false);
    expect(threads[0].timelineSet.getTimelineForEvent('$history') === old).toBe(true);
    await threads[0].flushPendingTimelineReset();
    expect(old.getPaginationToken(Direction.Backward)).toBe('older');
  });
});
