import React from 'react';
import 'fake-indexeddb/auto';
import { MatrixEvent, createClient, Room as SdkRoom } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEnginePersistFacade } from '../engine/enginePersistFacade';
import {
  createMindroomSyncEngine,
  createBackfillScheduler,
  MindroomSyncEngineProvider,
} from '../engine';
import type { MindroomSyncEngine } from '../engine';
import {
  resetCacheStoreForTesting,
  saveThreadEventsToCache,
  loadLatestCachedThreadEvents,
} from './cacheStore';
import {
  clearThreadOpenSeedSnapshotsForTests,
  getThreadOpenSeedSnapshot,
} from './threadOpenSeedCache';
import { useThreadSeedPrewarmController } from './threadSeedPrewarmController';

const SESSION_ID = 'session-prewarm-test';
const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root:example.org';

const rawReply = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  type: 'm.room.message',
  room_id: ROOM_ID,
  sender: '@alice:example.org',
  content: {
    body: id,
    'm.relates_to': { event_id: THREAD_ID, rel_type: 'm.thread' },
  },
});

const makeRootEvent = () =>
  new MatrixEvent({
    content: { body: 'root', msgtype: 'm.text' },
    event_id: THREAD_ID,
    origin_server_ts: 1_000,
    room_id: ROOM_ID,
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

// NOTE: the controller persists through the engine facade
// (`engine.persist.persistThreadEventCache`, reached via
// `useMindroomSyncEngine()`), NOT through a prop — the spy the tests
// assert on lives on the fake engine passed to the provider below.
function Harness({ mx, room }: { mx: MatrixClient; room: Room }) {
  useThreadSeedPrewarmController({
    room,
    mx,
    sessionId: SESSION_ID,
    prefetchDepthRef: { current: 10_000 },
    activeThreadId: undefined,
    priorityTargets: [{ threadId: THREAD_ID }],
    // Keep the IDB seed pass inert so the tests exercise ONLY the
    // network content-prefetch phase.
    loadThreadOpenSeedSnapshotFromCache: async () => [],
    debugTraceId: 'prewarm-test',
  });
  return null;
}

const renderPrewarm = async (mx: MatrixClient, room: Room, engine: MindroomSyncEngine) => {
  await act(async () => {
    create(
      React.createElement(
        MindroomSyncEngineProvider,
        { engine },
        React.createElement(Harness, { mx, room })
      )
    );
  });
};

describe('threadSeedPrewarmController cache-only seeds', () => {
  beforeEach(() => {
    resetCacheStoreForTesting();
    clearThreadOpenSeedSnapshotsForTests();
  });
  afterEach(() => {
    resetCacheStoreForTesting();
    clearThreadOpenSeedSnapshotsForTests();
  });

  const setup = () => {
    const rootEvent = makeRootEvent();
    const room = {
      roomId: ROOM_ID,
      getThread: () => null,
      findEventById: (eventId: string) => (eventId === THREAD_ID ? rootEvent : undefined),
      getLastActiveTimestamp: () => 0,
    } as unknown as Room;
    const fetchRelations = vi.fn(async () => ({
      chunk: [rawReply('$reply-1', 2_000)],
      next_batch: undefined,
    }));
    const mx = {
      getEventMapper: () => (raw: Partial<IEvent>) =>
        new MatrixEvent(raw as ConstructorParameters<typeof MatrixEvent>[0]),
      fetchRelations,
      getRoom: () => room,
    } as unknown as MatrixClient;
    const persistThreadEventCache = vi.fn();
    const engine = {
      scheduler: createBackfillScheduler({ mx }),
      persist: { ...createEnginePersistFacade({ sessionId: SESSION_ID }), persistThreadEventCache },
      sessionId: SESSION_ID,
    } as unknown as MindroomSyncEngine;
    return { mx, room, engine, fetchRelations, persistThreadEventCache };
  };

  it('leaves cold-cache networking to the engine', async () => {
    const { mx, room, engine, fetchRelations, persistThreadEventCache } = setup();
    await renderPrewarm(mx, room, engine);
    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });

  it('skips the network entirely when the cached snapshot is already relations-proven complete', async () => {
    const { mx, room, engine, fetchRelations, persistThreadEventCache } = setup();
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$cached-reply', 1_500)],
      { event_id: THREAD_ID, origin_server_ts: 1_000, type: 'm.room.message' },
      null,
      true,
      true,
      1,
      true
    );

    await renderPrewarm(mx, room, engine);
    // Give the drain loop time to (incorrectly) fire if it were going to.

    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });

  it('gives up without persisting when the thread root is not SDK-resolvable (PR #84 greptile P2)', async () => {
    const { mx, engine, fetchRelations, persistThreadEventCache } = setup();
    // Root never resolves → fetchAndPersistThreadContent bails before
    // enqueuing; nothing is fetched or persisted, and the open-time
    // drain remains the fallback for this thread.
    const rootlessRoom = {
      roomId: ROOM_ID,
      getThread: () => null,
      findEventById: () => undefined,
      getLastActiveTimestamp: () => 0,
    } as unknown as Room;

    await renderPrewarm(mx, rootlessRoom, engine);

    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });

  it('skips the network for a count-proven (relation-unproven) snapshot — review finding #4', async () => {
    const { mx, room, engine, fetchRelations, persistThreadEventCache } = setup();
    // Sweep-warmed shape: snapshotComplete + tailLoaded proven, but no
    // /relations pass ever ran (relationSnapshotComplete=false). The
    // open paints this from cache under the eager-cache coverage
    // policy, so prefetching it again would be a redundant full drain.
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$cached-reply', 1_500)],
      { event_id: THREAD_ID, origin_server_ts: 1_000, type: 'm.room.message' },
      null,
      true,
      true,
      1,
      false
    );

    await renderPrewarm(mx, room, engine);

    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });
});

it('does not publish a held seed read after room clear', async () => {
  const mx = createClient({
    baseUrl: 'https://seed.example.org',
    userId: '@alice:seed.example.org',
  });
  const room = new SdkRoom(ROOM_ID, mx, '@alice:seed.example.org');
  mx.store.storeRoom(room);
  const engine = createMindroomSyncEngine({ mx });
  await saveThreadEventsToCache(engine.sessionId, ROOM_ID, THREAD_ID, [rawReply('$held-seed', 1)]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = vi.fn(async () => {
    const page = await loadLatestCachedThreadEvents(engine.sessionId, ROOM_ID, THREAD_ID, 10);
    await held;
    return page.events.map((raw) => new MatrixEvent(raw));
  });
  let controller!: ReturnType<typeof useThreadSeedPrewarmController>;
  function HeldHarness() {
    controller = useThreadSeedPrewarmController({
      room,
      mx,
      sessionId: engine.sessionId,
      prefetchDepthRef: { current: 200 },
      activeThreadId: undefined,
      priorityTargets: [{ threadId: THREAD_ID }],
      loadThreadOpenSeedSnapshotFromCache: load,
      debugTraceId: 'clear-held-seed',
    });
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(MindroomSyncEngineProvider, { engine }, React.createElement(HeldHarness))
    );
  });
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  const pending = controller.waitForExistingOrQueued(THREAD_ID, {});
  await engine.offline.clear(ROOM_ID);
  await act(async () => {
    release();
    await pending;
  });
  expect(getThreadOpenSeedSnapshot(room, THREAD_ID)).toEqual([]);
  act(() => renderer.unmount());
  engine.stop();
});
