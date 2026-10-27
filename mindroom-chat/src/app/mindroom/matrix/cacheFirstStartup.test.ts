import {
  ClientEvent,
  createClient,
  SyncState,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import {
  FeatureSupport,
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
  Thread,
} from 'matrix-js-sdk/lib/models/thread';
import { MemoryStore } from 'matrix-js-sdk/lib/store/memory';
import type { ISavedSync } from 'matrix-js-sdk/lib/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRoomThreads } from '../threads/roomThreadList';

const roomId = '!room:example.org';
const userId = '@alice:example.org';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const settle = async () => {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
};
const event = (id: string, timestamp: number, reply = false): IEvent => ({
  event_id: id,
  room_id: roomId,
  sender: userId,
  type: 'm.room.message',
  origin_server_ts: timestamp,
  content: {
    msgtype: 'm.text',
    body: id,
    ...(reply ? { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } } : {}),
  },
});
const reply = event('$cached-reply', 2, true);
const root = {
  ...event('$root', 1),
  unsigned: {
    'm.relations': {
      'm.thread': { count: 2, current_user_participated: true, latest_event: reply },
    },
  },
};
const savedSync: ISavedSync = {
  nextBatch: 'cached-token',
  accountData: [],
  roomsData: {
    join: {
      [roomId]: {
        state: {
          events: [
            {
              type: 'm.room.member',
              event_id: '$membership',
              sender: userId,
              state_key: userId,
              content: { membership: 'join' },
            },
          ],
        },
        timeline: { events: [root, reply], prev_batch: 'cached-history' },
        ephemeral: { events: [] },
        account_data: { events: [] },
      },
    },
    invite: {},
    leave: {},
    knock: {},
  },
};
const clients: MatrixClient[] = [];
const threadNamespaces = [
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
];

const fixture = (
  snapshot: Promise<ISavedSync | null> = Promise.resolve(structuredClone(savedSync))
) => {
  const versions = deferred<Response>();
  const network = deferred<void>();
  const live = deferred<Response>();
  const requests: URL[] = [];
  let syncRequests = 0;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const store = new MemoryStore();
  const readSavedSync = vi.spyOn(store, 'getSavedSync').mockReturnValue(snapshot);
  vi.spyOn(store, 'getSavedSyncToken').mockImplementation(() =>
    snapshot.then((saved) => saved?.nextBatch ?? null)
  );
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId,
    accessToken: 'token',
    timelineSupport: true,
    store,
    fetchFn: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith('/versions')) return versions.promise;
      await network.promise;
      if (url.pathname.endsWith('/pushrules/')) return json({ global: {} });
      if (url.pathname.endsWith('/filter')) return json({ filter_id: 'startup-filter' });
      if (url.pathname.endsWith('/capabilities')) return json({ capabilities: {} });
      if (url.pathname.endsWith('/sync')) {
        syncRequests += 1;
        return syncRequests === 1 ? live.promise : new Promise<Response>(() => {});
      }
      if (url.pathname.includes('/event/')) return json(root);
      if (url.pathname.includes('/relations/')) return json({ chunk: [reply] });
      if (url.pathname.endsWith('/threads')) return json({ chunk: [root] });
      throw new Error('Unexpected startup request: ' + url.pathname);
    },
  });
  clients.push(mx);
  const syncEvents: Array<{ state: SyncState; fromCache: boolean }> = [];
  mx.on(ClientEvent.Sync, (state, _previous, data) => {
    syncEvents.push({ state, fromCache: data?.fromCache === true });
  });
  return {
    mx,
    requests,
    readSavedSync,
    syncEvents,
    start: () => mx.startClient({ threadSupport: true, lazyLoadMembers: true }),
    releaseVersions: (supported = ['v1.4']) =>
      versions.resolve(json({ versions: supported, unstable_features: {} })),
    releaseNetwork: () => network.resolve(),
    releaseLive: () =>
      live.resolve(
        json({
          next_batch: 'live-token',
          rooms: { join: { [roomId]: { timeline: { events: [event('$live-message', 3)] } } } },
        })
      ),
  };
};

describe('cached Matrix startup before server discovery', () => {
  let previousSupport: [FeatureSupport, FeatureSupport, FeatureSupport];
  let previousNamespacePreferences: boolean[];
  beforeEach(() => {
    previousNamespacePreferences = threadNamespaces.map((value) => value.name === value.unstable);
    threadNamespaces.forEach((value) => value.setPreferUnstable(false));
    previousSupport = [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ];
    Thread.hasServerSideSupport = FeatureSupport.None;
    Thread.hasServerSideListSupport = FeatureSupport.None;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.None;
  });
  afterEach(() => {
    clients.splice(0).forEach((mx) => mx.stopClient());
    [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ] = previousSupport;
    threadNamespaces.forEach((value, index) =>
      value.setPreferUnstable(previousNamespacePreferences[index])
    );
    vi.restoreAllMocks();
  });

  it('restores cached rooms and thread metadata before versions, then syncs on the same room', async () => {
    const f = fixture();
    const starting = f.start();
    await vi.waitFor(() =>
      expect(f.syncEvents).toContainEqual({ state: SyncState.Prepared, fromCache: true })
    );
    const room = f.mx.getRoom(roomId)!;
    const thread = room.getThread('$root')!;
    expect(thread.events.map((item) => item.getId())).toContain('$cached-reply');
    expect(thread.length).toBe(2);
    expect(thread.hasCurrentUserParticipated).toBe(true);
    expect(f.requests.some((url) => url.pathname.endsWith('/sync'))).toBe(false);
    const threadListLoading = loadRoomThreads(room);
    await settle();
    expect(f.requests.some((url) => /\/(threads|messages)$/.test(url.pathname))).toBe(false);

    f.releaseVersions();
    await starting;
    expect(f.mx.canSupport.get(Feature.ThreadUnreadNotifications)).toBe(ServerSupport.Stable);
    expect(Thread.hasServerSideSupport).toBe(FeatureSupport.Stable);
    expect(thread.length).toBe(2);
    expect(thread.hasCurrentUserParticipated).toBe(true);
    f.releaseNetwork();
    f.releaseLive();
    await threadListLoading;
    expect(f.requests.some((url) => url.pathname.endsWith('/threads'))).toBe(true);
    expect(f.requests.some((url) => url.pathname.endsWith('/messages'))).toBe(false);
    await vi.waitFor(() => expect(room.findEventById('$live-message')).toBeDefined());
    expect(f.mx.getRoom(roomId)).toBe(room);
    expect(room.getThread('$root')).toBe(thread);
    expect(thread.events.map((item) => item.getId())).toContain('$cached-reply');
    expect(f.readSavedSync).toHaveBeenCalledOnce();
    expect(f.syncEvents.filter(({ fromCache }) => fromCache)).toHaveLength(1);
    expect(
      f.requests.find((url) => url.pathname.endsWith('/sync'))?.searchParams.get('since')
    ).toBe('cached-token');
  });

  it('applies buffered cached edits when discovery removes prior server thread support', async () => {
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    const snapshot = structuredClone(savedSync);
    snapshot.roomsData.join[roomId].timeline.events.push({
      ...event('$cached-edit', 3),
      content: {
        msgtype: 'm.text',
        body: '* corrected reply',
        'm.new_content': { msgtype: 'm.text', body: 'corrected reply' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$cached-reply' },
      },
    });
    const f = fixture(Promise.resolve(snapshot));
    const starting = f.start();
    await vi.waitFor(() =>
      expect(f.syncEvents).toContainEqual({ state: SyncState.Prepared, fromCache: true })
    );
    const thread = f.mx.getRoom(roomId)!.getThread('$root')!;
    const cachedReply = thread.findEventById('$cached-reply')!;
    expect(cachedReply.getContent().body).toBe('$cached-reply');

    f.releaseVersions(['v1.3']);
    await starting;
    await vi.waitFor(() => expect(cachedReply.getContent().body).toBe('corrected reply'));
    expect(thread.findEventById('$cached-reply')).toBe(cachedReply);
    expect(cachedReply.replacingEvent()?.getId()).toBe('$cached-edit');
    expect(thread.replayEvents).toBeNull();
  });

  it('does not replay saved rooms or emit Prepared after stopping a pending saved read', async () => {
    const saved = deferred<ISavedSync | null>();
    const f = fixture(saved.promise);
    const starting = f.start();
    f.releaseVersions();
    f.releaseNetwork();
    await vi.waitFor(() => expect(f.readSavedSync).toHaveBeenCalledOnce());
    f.mx.stopClient();
    saved.resolve(structuredClone(savedSync));
    await starting;
    await settle();
    expect(f.mx.getRoom(roomId) === null).toBe(true);
    expect(f.syncEvents.some(({ state }) => state === SyncState.Prepared)).toBe(false);
  });

  it('does not resume startup when versions finish after stop', async () => {
    const f = fixture();
    const starting = f.start();
    await vi.waitFor(() =>
      expect(f.requests.some((url) => url.pathname.endsWith('/versions'))).toBe(true)
    );
    f.mx.stopClient();
    const eventsAtStop = f.syncEvents.length;
    f.releaseVersions();
    f.releaseNetwork();
    await starting;
    await settle();
    expect(f.syncEvents.slice(eventsAtStop).some(({ state }) => state === SyncState.Prepared)).toBe(
      false
    );
    expect(f.requests.some((url) => url.pathname.endsWith('/sync'))).toBe(false);
    expect(f.mx.clientRunning).toBe(false);
  });

  it('waits for live sync before Prepared when no saved snapshot exists', async () => {
    const f = fixture(Promise.resolve(null));
    const starting = f.start();
    f.releaseVersions();
    f.releaseNetwork();
    await starting;
    await vi.waitFor(() =>
      expect(f.requests.some((url) => url.pathname.endsWith('/sync'))).toBe(true)
    );
    expect(f.syncEvents.some(({ state }) => state === SyncState.Prepared)).toBe(false);
    f.releaseLive();
    await vi.waitFor(() =>
      expect(f.syncEvents).toContainEqual({ state: SyncState.Prepared, fromCache: false })
    );
  });
});
