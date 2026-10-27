import { IDBFactory } from 'fake-indexeddb';
import {
  ClientEvent,
  createClient,
  EventType,
  MatrixEvent,
  RelationType,
  SyncState,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCachedSpecVersions } from '../app/state/cachedSpecVersions';
import { startClient } from './initMatrix';

const BASE_URL = 'https://matrix.example';
const USER_ID = '@alice:example';
const ROOM_ID = '!room:example';

const event = (eventId: string, content: IEvent['content'], type = EventType.RoomMessage) => ({
  event_id: eventId,
  room_id: ROOM_ID,
  sender: USER_ID,
  origin_server_ts: 1,
  type,
  content,
});

const olderMessage = event('$older', { msgtype: 'm.text', body: 'Original message' });
const recentMessage = event('$recent', { msgtype: 'm.text', body: 'Recent cached message' });
const reaction = event(
  '$reaction',
  { 'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$older', key: '👍' } },
  EventType.Reaction
);
const edit = event('$edit', {
  msgtype: 'm.text',
  body: '* Edited message',
  'm.new_content': { msgtype: 'm.text', body: 'Edited message' },
  'm.relates_to': { rel_type: RelationType.Replace, event_id: '$older' },
});

describe('cached Matrix startup', () => {
  let indexedDB: IDBFactory;
  let storage: Storage;
  const clients: MatrixClient[] = [];
  const stores: IndexedDBStore[] = [];

  beforeEach(() => {
    indexedDB = new IDBFactory();
    const values = new Map<string, string>();
    storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
    vi.stubGlobal('localStorage', storage);
    writeCachedSpecVersions(BASE_URL, USER_ID, { versions: ['v1.4', 'v1.11'] });
  });

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.stopClient());
    await Promise.all(stores.splice(0).map((store) => store.destroy()));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const createStoredClient = async (fetchFn: typeof fetch) => {
    const store = new IndexedDBStore({ indexedDB, localStorage: storage, dbName: 'cached-sync' });
    stores.push(store);
    const client = createClient({
      baseUrl: BASE_URL,
      userId: USER_ID,
      accessToken: 'test-token',
      store,
      timelineSupport: true,
      fetchFn,
    });
    clients.push(client);
    await store.startup();
    return client;
  };

  const restoreCachedRoom = async (events: IEvent[]) => {
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise(() => {
          // No server response may be needed to restore persisted chats.
        })
    );
    const previousClient = await createStoredClient(request);
    await previousClient.store.setSyncData({
      next_batch: 'saved-position',
      rooms: {
        join: {
          [ROOM_ID]: {
            state: {
              events: [
                { ...event('$name', { name: 'Cached room' }, EventType.RoomName), state_key: '' },
                {
                  ...event('$member', { membership: 'join' }, EventType.RoomMember),
                  state_key: USER_ID,
                },
              ],
            },
            timeline: { events, prev_batch: 'older-position', limited: false },
          },
        },
      },
    });
    await previousClient.store.save(true);
    await previousClient.store.destroy();

    const client = await createStoredClient(request);
    const syncEvents: Array<{ fromCache?: boolean }> = [];
    client.on(ClientEvent.Sync, (_state, _previous, data) => {
      if (data) syncEvents.push(data);
    });
    await startClient(client);
    return { client, request, syncEvents };
  };

  it.each([
    ['reaction', reaction],
    ['edit', edit],
  ])(
    'restores persisted chats with an orphan %s while every network request is stalled',
    async (_name, relation) => {
      const { client, request, syncEvents } = await restoreCachedRoom([relation, recentMessage]);

      await vi.waitFor(() => expect(client.getSyncState()).toBe(SyncState.Prepared), {
        timeout: 500,
      });

      const room = client.getRoom(ROOM_ID);
      expect(room?.name).toBe('Cached room');
      expect(
        room
          ?.getLiveTimeline()
          .getEvents()
          .map((item) => item.getId())
      ).toContain('$recent');
      expect(
        room?.relations.getAllChildEventsForEvent('$older').map((item) => item.getId())
      ).toEqual([relation.event_id]);
      expect(syncEvents).toContainEqual(expect.objectContaining({ fromCache: true }));
      expect(request.mock.calls.some(([input]) => String(input).includes('/event/'))).toBe(false);
    }
  );

  it.each(['room', 'thread'])(
    'applies retained cached edits and reactions when their parent loads in a %s later',
    async (surface) => {
      const { client } = await restoreCachedRoom([reaction, edit, recentMessage]);
      await vi.waitFor(() => expect(client.getSyncState()).toBe(SyncState.Prepared), {
        timeout: 500,
      });
      const room = client.getRoom(ROOM_ID)!;
      const parent = new MatrixEvent(
        surface === 'thread'
          ? {
              ...olderMessage,
              content: {
                ...olderMessage.content,
                'm.relates_to': { rel_type: RelationType.Thread, event_id: '$root' },
              },
            }
          : olderMessage
      );

      if (surface === 'thread') {
        const root = new MatrixEvent(event('$root', { msgtype: 'm.text', body: 'Thread root' }));
        const thread = room.createThread('$root', root, [], false);
        room.addEventsToTimeline([parent], true, false, thread.liveTimeline);
        expect(thread.liveTimeline.getEvents()).toContain(parent);
      } else {
        await room.addLiveEvents([parent], { fromCache: false });
      }

      await vi.waitFor(() => expect(parent.getContent().body).toBe('Edited message'));
      expect(
        room.relations
          .getChildEventsForEvent('$older', RelationType.Annotation, EventType.Reaction)
          ?.getRelations()
      ).toEqual([
        expect.objectContaining({ event: expect.objectContaining({ event_id: '$reaction' }) }),
      ]);
    }
  );

  it('still resolves missing relation parents for new live events', async () => {
    const { client } = await restoreCachedRoom([recentMessage]);
    await vi.waitFor(() => expect(client.getSyncState()).toBe(SyncState.Prepared), {
      timeout: 500,
    });
    const room = client.getRoom(ROOM_ID)!;
    const fetchParent = vi.spyOn(client, 'fetchRoomEvent').mockResolvedValue(olderMessage);

    await room.addLiveEvents([new MatrixEvent(reaction)], { fromCache: false });

    expect(fetchParent).toHaveBeenCalledOnce();
    expect(fetchParent).toHaveBeenCalledWith(ROOM_ID, '$older');
    expect(room.relations.getAllChildEventsForEvent('$older').map((item) => item.getId())).toEqual([
      '$reaction',
    ]);
  });
});
