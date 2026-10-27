import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Direction, MatrixClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { createMindroomSyncEngine } from '../engine/mindroomSyncEngine';
import { MindroomSyncEngineProvider } from '../engine/engineContext';
import {
  clearRoomCachedContent,
  deleteCacheStoreDb,
  loadLatestCachedThreadEvents,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
} from './cacheStore';
import { useRoomThreadList } from './useRoomThreadList';
import { buildCompactThreadRootData } from './compactThreadRootData';

const userId = '@alice:example.org';
const roomId = '!offline:example.org';
let renderer: ReactTestRenderer | undefined;
let sessionId: string;
const originalListSupport = Thread.hasServerSideListSupport;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  if (sessionId) await deleteCacheStoreDb(sessionId);
  Thread.hasServerSideListSupport = originalListSupport;
  vi.restoreAllMocks();
});

it('restores 400 cached threads while only one is in the SDK and discovery is pending', async () => {
  const fetchFn = vi.fn(() => Promise.reject(new TypeError('Offline')));
  class OfflineClient extends MatrixClient {
    constructor() {
      super({ baseUrl: 'https://example.org', userId, fetchFn });
      this.clientOpts = { threadSupport: true };
    }
  }
  const mx = new OfflineClient();
  mx.threadSupportPending = new Promise(() => {});
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  room.setMaxListeners(500);
  mx.store.storeRoom(room);
  const engine = createMindroomSyncEngine({ mx });
  sessionId = engine.sessionId;
  const roots = Array.from({ length: 400 }, (_, index): Partial<IEvent> => {
    const reply = {
      event_id: `$reply-${index}`,
      room_id: roomId,
      sender: userId,
      origin_server_ts: 2000 + index,
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: `Reply ${index}`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: `$root-${index}`,
        },
      },
    };
    return {
      event_id: `$root-${index}`,
      room_id: roomId,
      sender: userId,
      origin_server_ts: 1000 + index,
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: `Thread ${index}` },
      unsigned: {
        'm.relations': {
          'm.thread': { count: 1, current_user_participated: true, latest_event: reply },
        },
      },
    };
  });
  await Promise.all(
    roots.map(async (root, index) => {
      // Historical pagination can save the reply before encountering the root.
      if (index % 2 === 0) {
        const reply = root.unsigned!['m.relations']!['m.thread']!.latest_event as IEvent;
        // A root cached before its first reply has no server thread bundle.
        root.unsigned = {};
        await saveRoomEventsToCache(sessionId, roomId, [root]);
        await saveThreadEventsToCache(sessionId, roomId, root.event_id!, [
          reply,
          {
            event_id: `$reaction-${index}`,
            room_id: roomId,
            sender: userId,
            origin_server_ts: 3000 + index,
            type: 'm.reaction',
            content: {
              'm.relates_to': { rel_type: 'm.annotation', event_id: reply.event_id, key: '👍' },
            },
          },
        ]);
      } else {
        await saveThreadEventsToCache(sessionId, roomId, root.event_id!, [], root);
      }
    })
  );
  await saveThreadEventsToCache(sessionId, '!another:example.org', '$foreign', [], {
    ...roots[0],
    event_id: '$foreign',
    room_id: '!another:example.org',
  });
  const liveRoot = new MatrixEvent({
    ...roots[399],
    content: { msgtype: 'm.text', body: 'Newer live title' },
  });
  room.processThreadRoots([liveRoot], false);
  expect(room.getThreads()).toHaveLength(1);
  let ids: string[] = [];
  function Harness() {
    const { threads } = useRoomThreadList(room);
    ids = buildCompactThreadRootData({
      room,
      threads,
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
    }).ids;
    return null;
  }
  await act(async () => {
    renderer = create(
      <MatrixClientProvider value={mx}>
        <MindroomSyncEngineProvider engine={engine}>
          <Harness />
        </MindroomSyncEngineProvider>
      </MatrixClientProvider>
    );
  });
  await act(async () => {
    await vi.waitFor(() => expect(ids).toHaveLength(400), { timeout: 5000 });
  });
  expect(new Set(ids)).toEqual(new Set(roots.map((root) => root.event_id)));
  expect(fetchFn).not.toHaveBeenCalled();
  expect(room.getLiveTimeline().getEvents()).toHaveLength(0);
  expect(room.getThread('$root-399')?.rootEvent).toBe(liveRoot);
  expect(liveRoot.getContent().body).toBe('Newer live title');
  expect(room.getThread('$root-0')?.replyToEvent?.getId()).toBe('$reply-0');
  expect(room.getThread('$root-0')?.initialEventsFetched).toBe(false);
  expect(room.getThread('$root-1')?.events).toHaveLength(0);
});

it.each([false, true])(
  'saves server-listed roots and later revisions without claiming replies downloaded (later page: %s)',
  async (laterPage) => {
    class Client extends MatrixClient {
      constructor() {
        super({ baseUrl: 'https://example.org', userId });
        this.clientOpts = { threadSupport: true };
        this.threadSupportPending = Promise.resolve();
      }
    }
    const mx = new Client();
    const room = new Room(roomId, mx, userId, { timelineSupport: true });
    mx.store.storeRoom(room);
    const engine = createMindroomSyncEngine({ mx });
    const persist = engine.persist.forRoom(room);
    const saveRoot = vi.spyOn(persist, 'persistThreadEventCache');
    vi.spyOn(engine.persist, 'forRoom').mockReturnValue(persist);
    sessionId = engine.sessionId;
    const root = new MatrixEvent({
      event_id: '$listed',
      room_id: roomId,
      sender: userId,
      origin_server_ts: 1000,
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'Listed by server' },
    });
    if (laterPage) {
      Thread.hasServerSideListSupport = FeatureSupport.Stable;
      const list = room.getUnfilteredTimelineSet();
      room.threadsTimelineSets[0] = list;
      room.threadsTimelineSets[1] = list;
      list.getLiveTimeline().setPaginationToken('older-roots', Direction.Backward);
      vi.spyOn(mx, 'paginateEventTimeline').mockImplementation(async () => {
        if (root.replacingEvent()) {
          // A further unchanged page must not rewrite all restored roots.
          list.getLiveTimeline().setPaginationToken(null, Direction.Backward);
          return false;
        }
        // First progress callback has already saved this same root.
        await vi.waitFor(async () => {
          const cached = await loadLatestCachedThreadEvents(sessionId, roomId, '$listed', 1);
          expect(cached.rootEvent?.content?.body).toBe('Listed by server');
        });
        root.makeReplaced(
          new MatrixEvent({
            event_id: '$edit',
            room_id: roomId,
            sender: userId,
            origin_server_ts: 2000,
            type: 'm.room.message',
            content: {
              msgtype: 'm.text',
              body: '* Newer server title',
              'm.new_content': { msgtype: 'm.text', body: 'Newer server title' },
              'm.relates_to': { rel_type: 'm.replace', event_id: '$listed' },
            },
          })
        );
        list.getLiveTimeline().setPaginationToken('unchanged-page', Direction.Backward);
        return true;
      });
    }
    vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
      room.processThreadRoots([root], false);
    });
    let loading = true;
    function Harness() {
      loading = useRoomThreadList(room).loading;
      return null;
    }
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <MindroomSyncEngineProvider engine={engine}>
            <Harness />
          </MindroomSyncEngineProvider>
        </MatrixClientProvider>
      );
      await vi.waitFor(async () => {
        const cached = await loadLatestCachedThreadEvents(sessionId, roomId, '$listed', 1);
        if (laterPage) expect(JSON.stringify(cached.rootEvent)).toContain('Newer server title');
        else expect(cached.rootEvent?.content?.body).toBe('Listed by server');
        expect(cached.events).toEqual([]);
        expect(cached.tailLoaded).toBe(false);
        expect(cached.snapshotComplete).toBe(false);
        expect(loading).toBe(false);
      });
    });
    expect(saveRoot).toHaveBeenCalledTimes(laterPage ? 2 : 1);
  }
);

it('saves only changed listed roots when the overview is shown again', async () => {
  class Client extends MatrixClient {
    constructor() {
      super({ baseUrl: 'https://example.org', userId });
      this.clientOpts = { threadSupport: true };
      this.threadSupportPending = Promise.resolve();
    }
  }
  const mx = new Client();
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const engine = createMindroomSyncEngine({ mx });
  sessionId = engine.sessionId;
  const saveRoot = vi.fn();
  const forRoom = engine.persist.forRoom.bind(engine.persist);
  vi.spyOn(engine.persist, 'forRoom').mockImplementation((target) => {
    const persist = forRoom(target);
    return {
      ...persist,
      persistThreadEventCache: (...args) => {
        saveRoot(args[0]);
        return persist.persistThreadEventCache(...args);
      },
    };
  });
  const roots = Array.from(
    { length: 3 },
    (_, index) =>
      new MatrixEvent({
        event_id: `$listed-${index}`,
        room_id: roomId,
        sender: userId,
        origin_server_ts: 1000 + index,
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: `Listed ${index}` },
      })
  );
  // Every mount reports the known threads to the hook again.
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots(roots, false);
  });
  let loading = true;
  function Harness() {
    loading = useRoomThreadList(room).loading;
    return null;
  }
  const showOverview = async () => {
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <MindroomSyncEngineProvider engine={engine}>
            <Harness />
          </MindroomSyncEngineProvider>
        </MatrixClientProvider>
      );
      await vi.waitFor(() => expect(loading).toBe(false));
    });
    await act(async () => renderer?.unmount());
    renderer = undefined;
  };

  await showOverview();
  expect(saveRoot.mock.calls.map(([threadId]) => threadId)).toEqual([
    '$listed-0',
    '$listed-1',
    '$listed-2',
  ]);

  saveRoot.mockClear();
  await showOverview();
  expect(saveRoot).not.toHaveBeenCalled();

  roots[1].makeReplaced(
    new MatrixEvent({
      event_id: '$edit',
      room_id: roomId,
      sender: userId,
      origin_server_ts: 2000,
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: '* Edited',
        'm.new_content': { msgtype: 'm.text', body: 'Edited' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$listed-1' },
      },
    })
  );
  await showOverview();
  expect(saveRoot.mock.calls.map(([threadId]) => threadId)).toEqual(['$listed-1']);

  // A cleared room cache gets every root again.
  saveRoot.mockClear();
  await clearRoomCachedContent(sessionId, roomId);
  await showOverview();
  expect(saveRoot).toHaveBeenCalledTimes(3);
  await vi.waitFor(async () => {
    const cached = await loadLatestCachedThreadEvents(sessionId, roomId, '$listed-1', 1);
    expect(JSON.stringify(cached.rootEvent)).toContain('Edited');
  });
});

it('saves encrypted listed roots once decrypted, and again when a failed one decrypts', async () => {
  class Client extends MatrixClient {
    constructor() {
      super({ baseUrl: 'https://example.org', userId });
      this.clientOpts = { threadSupport: true };
      this.threadSupportPending = Promise.resolve();
    }
  }
  const mx = new Client();
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const engine = createMindroomSyncEngine({ mx });
  sessionId = engine.sessionId;
  const saved: string[] = [];
  const forRoom = engine.persist.forRoom.bind(engine.persist);
  vi.spyOn(engine.persist, 'forRoom').mockImplementation((target) => {
    const persist = forRoom(target);
    return {
      ...persist,
      persistThreadEventCache: (...args) => {
        const root = args[2];
        saved.push(
          `${args[0]} ${root?.getType()}${root?.isDecryptionFailure() ? ' (failed)' : ''}`
        );
        return persist.persistThreadEventCache(...args);
      },
    };
  });
  const encryptedRoot = (eventId: string) =>
    new MatrixEvent({
      event_id: eventId,
      room_id: roomId,
      sender: userId,
      origin_server_ts: 1000,
      type: 'm.room.encrypted',
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: eventId },
    });
  const decrypting = encryptedRoot('$decrypting');
  const lateKey = encryptedRoot('$late-key');
  const decrypt = (root: MatrixEvent, result: Promise<{ type: string; content: object }>) =>
    root.attemptDecryption({
      decryptEvent: async () => ({ clearEvent: { room_id: roomId, ...(await result) } }),
    } as unknown as CryptoBackend);
  const clear = (body: string) => Promise.resolve({ type: 'm.room.message', content: { body } });
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots([decrypting, lateKey], false);
  });
  let loading = true;
  function Harness() {
    loading = useRoomThreadList(room).loading;
    return null;
  }
  const showOverview = async (whileShown?: () => Promise<void>) => {
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <MindroomSyncEngineProvider engine={engine}>
            <Harness />
          </MindroomSyncEngineProvider>
        </MatrixClientProvider>
      );
      await vi.waitFor(() => expect(loading).toBe(false));
      await whileShown?.();
    });
    await act(async () => renderer?.unmount());
    renderer = undefined;
  };

  await decrypt(lateKey, Promise.reject(new Error('Missing key')));
  let releaseKey!: () => void;
  const decrypted = decrypt(
    decrypting,
    new Promise((resolve) => {
      releaseKey = () => resolve(clear('Clear title'));
    })
  );
  await showOverview(async () => {
    // A root listed while its decryption runs is saved once, with its clear content.
    expect(decrypting.isBeingDecrypted()).toBe(true);
    expect(saved).toEqual(['$late-key m.room.message (failed)']);
    releaseKey();
    await decrypted;
    await vi.waitFor(() =>
      expect(saved).toEqual(['$late-key m.room.message (failed)', '$decrypting m.room.message'])
    );
  });

  // Its ciphertext is unchanged, but a root that decrypts later is a new revision.
  saved.length = 0;
  await decrypt(lateKey, clear('Late title'));
  await showOverview();
  expect(saved).toEqual(['$late-key m.room.message']);
});
