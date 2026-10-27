import {
  createClient,
  Direction,
  EventTimeline,
  Room,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBackfillScheduler } from '../engine/backfillScheduler';
import { scheduleReconcile } from '../engine/reconciler';
import { getLinkedTimelines, getThreadTimelineEvents } from './linkedTimelines';
import { refreshLatestThreadSlice } from './threadOpenCacheController';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';
import type { HydratedThreadCachePage } from './types';

const roomId = '!room:example.org';
const userId = '@mindroom:example.org';
const rootId = '$root';

/**
 * Real SDK client against a transport with Tuwunel's token semantics: a token is a stream
 * position, pagination excludes its `from` position, `/relations` returns `next_batch` for every
 * non-empty page (30 events by default), and `/messages` omits `end` when nothing follows `from`.
 */
const tuwunel = () => {
  const stream: IEvent[] = [];
  const replies = () =>
    stream.filter((event) => event.content['m.relates_to']?.rel_type === 'm.thread');
  const send = (eventId: string, content: Record<string, unknown> = {}): IEvent => {
    const event = {
      event_id: eventId,
      room_id: roomId,
      sender: userId,
      type: 'm.room.message',
      origin_server_ts: 1000 + stream.length,
      unsigned: {},
      content: { msgtype: 'm.text', body: eventId, ...content },
    } as IEvent;
    stream.push(event);
    return event;
  };
  const reply = (index: number) =>
    send(`$reply-${index}`, { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } });
  const edit = (target: IEvent, index: number) =>
    send(`${target.event_id}-edit-${index}`, {
      'm.new_content': { msgtype: 'm.text', body: `edit ${index}` },
      'm.relates_to': { rel_type: 'm.replace', event_id: target.event_id },
    });
  const root = () => {
    const threadReplies = replies();
    return {
      ...stream.find((event) => event.event_id === rootId)!,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: threadReplies.length,
            current_user_participated: true,
            latest_event: threadReplies[threadReplies.length - 1],
          },
        },
      },
    };
  };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const page = (events: IEvent[], from: number, dir: string | null, limit: number) => {
    const ordered =
      dir === 'f'
        ? events.filter((event) => stream.indexOf(event) > from)
        : events.filter((event) => stream.indexOf(event) < from).reverse();
    return ordered.slice(0, limit);
  };
  const client = createClient({
    baseUrl: 'https://example.org',
    userId,
    accessToken: 'token',
    timelineSupport: true,
    fetchFn: async (input) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.pathname);
      const query = url.searchParams;
      if (path.endsWith(`/context/${rootId}`)) {
        const at = String(stream.findIndex((event) => event.event_id === rootId));
        const context = { events_before: [], events_after: [], state: [] };
        return json({ ...context, event: root(), start: at, end: at });
      }
      const eventId = path.match(/\/event\/(.+)$/)?.[1];
      if (eventId)
        return json(
          eventId === rootId ? root() : stream.find((event) => event.event_id === eventId)
        );
      if (path.includes(`/relations/${rootId}`)) {
        const dir = query.get('dir');
        const from = Number(query.get('from') ?? (dir === 'f' ? -1 : stream.length));
        const limit = Math.min(Number(query.get('limit') ?? 30), 100);
        const chunk = page(replies(), from, dir, limit);
        const last = chunk[chunk.length - 1];
        return json(last ? { chunk, next_batch: String(stream.indexOf(last)) } : { chunk });
      }
      if (path.endsWith('/messages')) {
        const from = Number(query.get('from'));
        const chunk = page(stream, from, query.get('dir'), Number(query.get('limit')));
        const last = chunk[chunk.length - 1];
        return json({
          chunk,
          start: String(from),
          ...(last ? { end: String(stream.indexOf(last)) } : {}),
        });
      }
      throw new Error(`Unexpected request ${path}`);
    },
  });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  const room = new Room(roomId, client, userId, { timelineSupport: true });
  room.setMaxListeners(0);
  client.store.storeRoom(room);
  return { client, room, stream, send, reply, edit, root };
};

const openThread = async (mx: MatrixClient, room: Room) => {
  const persistThreadEventCache = vi.fn();
  await runThreadOpenSdkBootstrap({
    debugTraceId: undefined,
    isMounted: () => true,
    mx,
    persistThreadEventCache,
    pinThreadToBottomOnOpen: vi.fn(),
    room,
    setSupplementalThreadEvents: vi.fn(),
    onBootstrap: vi.fn(),
    shouldScrollToLatestOnOpen: true,
    threadId: rootId,
  });
  await refreshLatestThreadSlice(
    { mx, room, persistThreadEventCache, shouldAbortRefresh: () => false },
    rootId
  );
  const thread = room.getThread(rootId)!;
  const events = getThreadTimelineEvents(thread);
  return {
    replies: events.filter((event) => event.isRelation('m.thread')).length,
    root: events.some((event) => event.getId() === rootId),
    backward: getLinkedTimelines(thread.liveTimeline)[0].getPaginationToken(Direction.Backward),
  };
};

let support: FeatureSupport[];
beforeEach(() => {
  support = [Thread.hasServerSideSupport, Thread.hasServerSideFwdPaginationSupport];
  Thread.hasServerSideSupport = FeatureSupport.Stable;
  Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
});
afterEach(() => {
  [Thread.hasServerSideSupport, Thread.hasServerSideFwdPaginationSupport] = support;
  vi.restoreAllMocks();
});

/** While the app is suspended an agent streams a reply. The limited /sync window holds only its
 * edits, which Tuwunel's compact edits collapse to the newest; prev_batch is that edit. */
const syncStreamedReplyAfterGap = async (server: ReturnType<typeof tuwunel>, index: number) => {
  const oldSyncToken = String(server.stream.length - 1);
  const streamed = server.reply(index);
  let finalEdit = streamed;
  for (let edit = 0; edit < 25; edit += 1) finalEdit = server.edit(streamed, edit);
  server.room.resetLiveTimeline(String(server.stream.indexOf(finalEdit)), oldSyncToken);
  await server.room.addLiveEvents([server.client.getEventMapper()(finalEdit)], {
    addToState: false,
  });
};

it.each(['opened', 'shown'] as const)(
  'reopens every reply after a limited sync collapsed to a streamed reply (thread %s before)',
  async (before) => {
    const server = tuwunel();
    server.send('$before');
    server.send(rootId);
    for (let index = 0; index < 40; index += 1) server.reply(index);
    server.room.processThreadRoots([server.client.getEventMapper()(server.root())], true);
    if (before === 'opened') {
      expect(await openThread(server.client, server.room)).toEqual({
        replies: 40,
        root: true,
        backward: null,
      });
    } else {
      // A shown card loads only the latest page; the root stays unloaded.
      await server.room.getThread(rootId)!.initialize();
    }

    await syncStreamedReplyAfterGap(server, 40);

    expect(await openThread(server.client, server.room)).toEqual({
      replies: 41,
      root: true,
      backward: null,
    });
  }
);

/** A limited /sync whose window holds no event of the thread, so the thread's reset stays deferred. */
const syncQuietGapAfterReply = async (server: ReturnType<typeof tuwunel>, index: number) => {
  const oldSyncToken = String(server.stream.length - 1);
  server.reply(index);
  const other = server.send(`$other-${index}`);
  server.room.resetLiveTimeline(String(server.stream.indexOf(other)), oldSyncToken);
  await server.room.addLiveEvents([server.client.getEventMapper()(other)], { addToState: false });
};

it.each(['streamed', 'quiet'] as const)(
  'keeps thread segments in order when a reconcile repairs a thread between sync gaps (%s first gap)',
  async (firstGap) => {
    const joinWarnings: string[] = [];
    vi.spyOn(logger, 'warn').mockImplementation((...args: unknown[]) => {
      const message = args.map(String).join(' ');
      if (message.startsWith('Refusing')) joinWarnings.push(message);
    });
    // A walk around a segment cycle never ends; fail instead of hanging the run.
    const { getNeighbouringTimeline } = EventTimeline.prototype;
    let neighbourReads = 0;
    vi.spyOn(EventTimeline.prototype, 'getNeighbouringTimeline').mockImplementation(
      function countedNeighbour(this: EventTimeline, direction) {
        neighbourReads += 1;
        if (neighbourReads > 1_000_000) throw new Error('walked a timeline cycle');
        return getNeighbouringTimeline.call(this, direction);
      }
    );
    const server = tuwunel();
    server.send('$before');
    server.send(rootId);
    for (let index = 0; index < 100; index += 1) server.reply(index);
    server.room.processThreadRoots([server.client.getEventMapper()(server.root())], true);
    const thread = server.room.getThread(rootId)!;
    // A shown card loads only the latest page.
    await thread.initialize();
    const timelineSet = thread.getUnfilteredTimelineSet();
    // The thread view pages the first segment linked to the live one while it has a cursor.
    const paginateHistory = async () => {
      const [first] = getLinkedTimelines(timelineSet.getLiveTimeline());
      if (!first.getPaginationToken(Direction.Backward)) return;
      await server.client.paginateEventTimeline(first, { backwards: true, limit: 30 });
    };

    if (firstGap === 'streamed') {
      await syncStreamedReplyAfterGap(server, 100);
      await paginateHistory();
    } else {
      // Nothing applies the thread's deferred reset before the reconcile.
      await syncQuietGapAfterReply(server, 100);
    }
    const result = await scheduleReconcile({
      mx: server.client,
      sessionId: 'session',
      scheduler: createBackfillScheduler({ mx: server.client }),
      roomId,
      room: server.room,
      threadId: rootId,
      cachedPage: { events: [], hasMoreBefore: true, tailLoaded: true } as HydratedThreadCachePage,
      persistRepair: () => ({ rawEvents: [], loadedReplyCount: 0, write: Promise.resolve(true) }),
      onRepaired: vi.fn(),
    });
    expect(result.repaired).toBe(true);
    await paginateHistory();
    await syncStreamedReplyAfterGap(server, 101);
    await paginateHistory();
    await paginateHistory();

    const replyIds = getThreadTimelineEvents(thread)
      .filter((event) => event.isRelation('m.thread'))
      .map((event) => event.getId());
    // The streamed case pages once more, before the reconcile.
    const oldest = firstGap === 'streamed' ? 10 : 40;
    expect(replyIds).toEqual(
      Array.from({ length: 102 - oldest }, (_, index) => `$reply-${index + oldest}`)
    );
    expect(joinWarnings).toEqual([]);
    // The agent's next reply arrives after another gap; ordering its receipt against the
    // previous one, now in an older segment, is the walk that froze the app.
    const previousReceipt = thread.getEventReadUpTo(userId)!;
    const oldSyncToken = String(server.stream.length - 1);
    const nextReply = server.reply(102);
    server.room.resetLiveTimeline(String(server.stream.indexOf(nextReply)), oldSyncToken);
    await server.room.addLiveEvents([server.client.getEventMapper()(nextReply)], {
      addToState: false,
    });

    expect(timelineSet.eventIdToTimeline(previousReceipt)).not.toBe(thread.liveTimeline);
    expect(thread.liveTimeline.getEvents().map((event) => event.getId())).toEqual(['$reply-102']);
    expect(thread.getEventReadUpTo(userId)).toBe('$reply-102');
    expect(joinWarnings).toEqual([]);
  }
);
