import {
  createClient,
  EventStatus,
  MatrixEvent,
  SyncState,
  ThreadEvent,
  type IEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { _createAndReEmitRoom } from 'matrix-js-sdk/lib/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMindroomSyncEngine } from '../mindroomSyncEngine';
import type { EngineWriteThrough } from '../engineWriteThrough';
import type { EngineGapTracker } from '../engineGapTracker';
import { loadRoomThreads } from '../../threads/roomThreadList';

const roomId = '!room:example.org';
const userId = '@alice:example.org';

const message = (eventId: string, ts: number, content: Record<string, unknown> = {}): IEvent =>
  ({
    event_id: eventId,
    room_id: roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: { msgtype: 'm.text', body: eventId, ...content },
  } as IEvent);
const reply = (rootId: string, index: number, ts: number): IEvent =>
  message(`${rootId}-reply-${index}`, ts, {
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
/** A root as listed by /threads: its unsigned bundle is the server's thread summary. */
const listedRoot = (index: number): IEvent => {
  const rootId = `$root-${String(index).padStart(3, '0')}`;
  return {
    ...message(rootId, index * 10),
    unsigned: {
      'm.relations': {
        'm.thread': {
          count: 2,
          current_user_participated: true,
          latest_event: reply(rootId, 2, index * 10 + 2),
        },
      },
    },
  };
};

/** Root ids in the SDK's All threads list, oldest first. */
const listedRootIds = (room: Room) =>
  room.threadsTimelineSets[0]
    ?.getLiveTimeline()
    .getEvents()
    .map((event) => event.getId()) ?? [];

const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

/** Real SDK client and room (re-emitted like a synced room) behind a /threads-only transport. */
const roomWithListedThreads = (count: number) => {
  const roots = Array.from({ length: count }, (_, index) => listedRoot(index)).reverse();
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const client: MatrixClient = createClient({
    baseUrl: 'https://example.org',
    userId,
    accessToken: 'token',
    timelineSupport: true,
    fetchFn: async (input) => {
      const url = new URL(String(input));
      if (decodeURIComponent(url.pathname).endsWith('/threads')) {
        const from = Number(url.searchParams.get('from') ?? 0);
        const limit = Number(url.searchParams.get('limit'));
        const next = from + limit < roots.length ? String(from + limit) : undefined;
        return json({ chunk: roots.slice(from, from + limit), next_batch: next });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    },
  });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  vi.spyOn(client, 'getSyncState').mockReturnValue(SyncState.Syncing);
  const room = _createAndReEmitRoom(client, roomId, {});
  room.setMaxListeners(0);
  client.store.storeRoom(room);
  return { client, room };
};

describe('engine live writes and the SDK thread lists', () => {
  let support: [FeatureSupport, FeatureSupport, FeatureSupport];
  beforeEach(() => {
    support = [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ];
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    Thread.hasServerSideListSupport = FeatureSupport.Stable;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
  });
  afterEach(() => {
    [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ] = support;
    vi.restoreAllMocks();
  });

  const startEngine = (client: MatrixClient) => {
    const writeThrough: EngineWriteThrough = { handleLiveEvent: vi.fn(), flush: vi.fn() };
    const gapTracker = {
      handleTimelineReset: vi.fn(),
      handleSyncPrepared: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    } as unknown as EngineGapTracker;
    const engine = createMindroomSyncEngine({ mx: client, writeThrough, gapTracker });
    engine.start();
    return { engine, writeThrough };
  };

  it('does not persist roots that the SDK adds to its thread lists', async () => {
    // Listing a room's threads adds every root to the All list, and the
    // user's own to the My list, as a live event. Each cost a room-cache
    // write (four IndexedDB transactions) on every launch.
    const { client, room } = roomWithListedThreads(90);
    const { engine, writeThrough } = startEngine(client);

    await loadRoomThreads(room);
    await settle();

    expect(room.getThreads()).toHaveLength(90);
    expect(listedRootIds(room)).toHaveLength(90);
    expect(writeThrough.handleLiveEvent).not.toHaveBeenCalled();
    engine.stop();
  });

  it('does not persist a root that a new reply moves to the top of the thread lists', async () => {
    const { client, room } = roomWithListedThreads(3);
    await loadRoomThreads(room);
    await settle();
    const { engine, writeThrough } = startEngine(client);
    const thread = room.getThread('$root-001')!;

    // The SDK removes the root from both lists and adds it again as live.
    room.emit(ThreadEvent.NewReply, thread, thread.rootEvent!);
    await settle();

    expect(listedRootIds(room).at(-1)).toBe('$root-001');
    expect(writeThrough.handleLiveEvent).not.toHaveBeenCalled();
    engine.stop();
  });

  it('still persists live room events and thread replies', async () => {
    const { client, room } = roomWithListedThreads(3);
    await loadRoomThreads(room);
    await settle();
    const { engine, writeThrough } = startEngine(client);

    await room.addLiveEvents([new MatrixEvent(message('$plain', 1_000))], { addToState: false });
    await room.addLiveEvents([new MatrixEvent(reply('$root-002', 3, 1_001))], {
      addToState: false,
    });
    await settle();

    const persisted = vi
      .mocked(writeThrough.handleLiveEvent)
      .mock.calls.map(([event]) => event.getId());
    expect(persisted).toEqual(expect.arrayContaining(['$plain', '$root-002-reply-3']));
    expect(persisted).not.toContain('$root-002');
    engine.stop();
  });

  it('persists an own thread root when the server confirms it', async () => {
    // The remote echo updates the local echo in place, without a timeline
    // event; only the thread lists used to save the confirmed root.
    const { client, room } = roomWithListedThreads(0);
    await loadRoomThreads(room);
    const { engine, writeThrough } = startEngine(client);
    const saved: [string | undefined, EventStatus | null][] = [];
    vi.mocked(writeThrough.handleLiveEvent).mockImplementation((event) => {
      saved.push([event.getId(), event.status]);
    });
    const local = new MatrixEvent({ ...message('~txn-1', 2_000), event_id: undefined });
    local.setTxnId('txn-1');
    local.setStatus(EventStatus.SENDING);
    room.addPendingEvent(local, 'txn-1');
    room.updatePendingEvent(local, EventStatus.SENT, '$own-root');

    await room.addLiveEvents(
      [new MatrixEvent({ ...message('$own-root', 2_000), unsigned: { transaction_id: 'txn-1' } })],
      { addToState: false }
    );
    await room.addLiveEvents([new MatrixEvent(reply('$own-root', 1, 2_001))], {
      addToState: false,
    });
    await settle();

    expect(saved).toContainEqual(['$own-root', null]);
    expect(saved).toContainEqual(['$own-root-reply-1', null]);
    engine.stop();
  });

  it('persists a confirmed own thread reply once', async () => {
    // The thread timeline announces the confirmed reply before its echo update.
    const { client, room } = roomWithListedThreads(1);
    await loadRoomThreads(room);
    await settle();
    const { engine, writeThrough } = startEngine(client);
    const saved: [string | undefined, EventStatus | null][] = [];
    vi.mocked(writeThrough.handleLiveEvent).mockImplementation((event) => {
      saved.push([event.getId(), event.status]);
    });
    const local = new MatrixEvent({ ...reply('$root-000', 3, 3_000), event_id: undefined });
    local.setTxnId('txn-2');
    local.setStatus(EventStatus.SENDING);
    room.addPendingEvent(local, 'txn-2');
    room.updatePendingEvent(local, EventStatus.SENT, '$own-reply');

    await room.addLiveEvents(
      [
        new MatrixEvent({
          ...reply('$root-000', 3, 3_000),
          event_id: '$own-reply',
          unsigned: { transaction_id: 'txn-2' },
        }),
      ],
      { addToState: false }
    );
    await settle();

    expect(saved.filter(([id, status]) => id === '$own-reply' && !status)).toHaveLength(1);
    engine.stop();
  });
});
