import React from 'react';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, Room, MatrixEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Direction, RoomEvent } from 'matrix-js-sdk';
import { useRoomLiveRenderController } from './roomLiveRenderController';
import { createDefaultThreadFilterState } from './roomThreadOverviewModel';
import { createEnginePersistFacade } from '../engine/enginePersistFacade';
import {
  clearRoomCachedContent,
  loadCachedRoomEvent,
  loadLatestCachedThreadEvents,
  resetCacheStoreForTesting,
} from './cacheStore';
import { useRoomPaginationCommandController } from './roomPaginationCommandController';
import type { Timeline } from './timelinePagination';

const { loadRoomCachedPaginationSnapshotMock, hydrateCachedEventsMock, reconcileMock } = vi.hoisted(
  () => ({
    loadRoomCachedPaginationSnapshotMock: vi.fn(),
    hydrateCachedEventsMock: vi.fn(() => []),
    reconcileMock: vi.fn(),
  })
);

vi.mock('./eventRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./eventRepository')>();
  return {
    ...actual,
    loadRoomCachedPaginationSnapshot: loadRoomCachedPaginationSnapshotMock,
  };
});

vi.mock('./eventCacheEditUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./eventCacheEditUtils')>();
  return {
    ...actual,
    hydrateCachedEvents: hydrateCachedEventsMock,
    reconcileRelationEventsWithAggregation: reconcileMock,
  };
});

const makeRoomEvent = (eventId: string, threadRootId?: string) =>
  ({
    event: { event_id: eventId, origin_server_ts: 1 },
    getId: () => eventId,
    getSender: () => '@sender:server',
    getType: () => 'm.room.message',
    getContent: () => ({ msgtype: 'm.text', body: eventId }),
    getStateKey: () => undefined,
    getRelation: () => undefined,
    getServerAggregatedRelation: () => undefined,
    getTs: () => 1,
    isRedacted: () => false,
    isRedaction: () => false,
    threadRootId,
  } as never);

const makeTimeline = (events: unknown[]) =>
  ({
    getEvents: () => events,
    getPaginationToken: (direction: Direction) =>
      direction === Direction.Backward ? 'before-token' : undefined,
    setPaginationToken: vi.fn(),
    getNeighbouringTimeline: () => null,
  } as never);

describe('useRoomPaginationCommandController', () => {
  it('does not insert a cached page after navigation changes rooms during the read', async () => {
    const timeline = makeTimeline([makeRoomEvent('$loaded')]);
    let finishSnapshot!: (snapshot: unknown) => void;
    loadRoomCachedPaginationSnapshotMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSnapshot = resolve;
        })
    );
    const roomIdRef = { current: '!room:server' };
    const roomPaginatingBackRef = { current: false };
    const room = {
      roomId: '!room:server',
      addEventsToTimeline: vi.fn(),
      partitionThreadedEvents: vi.fn((events) => [events, [], []]),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    };
    const setTimeline = vi.fn();
    const setRoomHasMoreCachedBack = vi.fn();
    let callback!: (backwards: boolean) => Promise<void>;
    let renderer!: ReactTestRenderer;
    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination: vi.fn(),
        mx: { getEventMapper: () => (event: unknown) => event } as never,
        beginRoomCacheWrite: () => vi.fn(),
        recalibrateFilterOptsRef: { current: undefined },
        room: room as never,
        roomIdRef,
        roomPaginatingBackRef,
        prefetchDepthRef: { current: 50 },
        sessionId: 'session',
        setRoomHasMoreCachedBack,
        setTimeline,
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: { linkedTimelines: [timeline], range: { start: 0, end: 1 } },
      });
      return null;
    }
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    try {
      const work = callback(true);
      roomIdRef.current = '!other:server';
      finishSnapshot({
        status: 'cache-hit',
        events: [makeRoomEvent('$cached')],
        beforeToken: null,
        hasMoreCachedBack: false,
      });
      await act(async () => {
        await work;
      });

      expect(room.addEventsToTimeline).not.toHaveBeenCalled();
      expect(setTimeline).not.toHaveBeenCalled();
      expect(setRoomHasMoreCachedBack).not.toHaveBeenCalled();
      expect(roomPaginatingBackRef.current).toBe(false);
    } finally {
      renderer.unmount();
    }
  });

  it('joins and clears an active backward pagination', async () => {
    const timeline = makeTimeline([makeRoomEvent('$loaded')]);
    const initialTimeline: Timeline = {
      linkedTimelines: [timeline],
      range: { start: 0, end: 1 },
    };
    let callback: ((backwards: boolean) => Promise<void>) | undefined;
    let renderer: ReactTestRenderer | undefined;
    let rejectSnapshot: ((reason?: unknown) => void) | undefined;
    loadRoomCachedPaginationSnapshotMock.mockClear();
    loadRoomCachedPaginationSnapshotMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSnapshot = reject;
        })
    );

    const room = {
      roomId: '!room:server',
      partitionThreadedEvents: vi.fn((events) => [events, [], []]),
      addEventsToTimeline: vi.fn(),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    } as never;
    const mx = {
      getEventMapper: () => (rawEvent: unknown) => rawEvent,
      processAggregatedTimelineEvents: vi.fn(),
    } as never;

    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination: vi.fn(),
        mx,
        beginRoomCacheWrite: () => vi.fn(),
        recalibrateFilterOptsRef: { current: undefined },
        room,
        roomIdRef: { current: '!room:server' },
        roomPaginatingBackRef: { current: false },
        prefetchDepthRef: { current: 50 },
        sessionId: 'session',
        setRoomHasMoreCachedBack: vi.fn(),
        setTimeline: vi.fn(),
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: initialTimeline,
      });
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    const first = callback?.(true);
    const second = callback?.(true);
    expect(second).toBe(first);
    const settled = Promise.allSettled([first, second]);
    let joinedSettled = false;
    void settled.then(() => {
      joinedSettled = true;
    });
    await Promise.resolve();

    expect(loadRoomCachedPaginationSnapshotMock).toHaveBeenCalledTimes(1);
    expect(joinedSettled).toBe(false);

    rejectSnapshot?.(new Error('cache failed'));
    let results: PromiseSettledResult<void>[] = [];
    await act(async () => {
      results = await settled;
    });

    expect(results).toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' }),
    ]);

    loadRoomCachedPaginationSnapshotMock.mockResolvedValue({ status: 'start-known' });
    await act(async () => {
      await callback?.(true);
    });
    renderer?.unmount();

    expect(loadRoomCachedPaginationSnapshotMock).toHaveBeenCalledTimes(2);
  });

  it('uses a bounded interactive cache page size when the preload target is large', async () => {
    const loaded = makeRoomEvent('$loaded');
    const timeline = makeTimeline([loaded]);
    const initialTimeline: Timeline = {
      linkedTimelines: [timeline],
      range: { start: 0, end: 1 },
    };
    let callback: ((backwards: boolean) => Promise<void>) | undefined;
    let renderer: ReactTestRenderer | undefined;

    loadRoomCachedPaginationSnapshotMock.mockResolvedValue({
      status: 'start-known',
    });

    const room = {
      roomId: '!room:server',
      partitionThreadedEvents: vi.fn((events) => [events, [], []]),
      addEventsToTimeline: vi.fn(),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    } as never;
    const mx = {
      getEventMapper: () => (rawEvent: unknown) => rawEvent,
      processAggregatedTimelineEvents: vi.fn(),
    } as never;

    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination: vi.fn(),
        mx,
        beginRoomCacheWrite: () => vi.fn(),
        recalibrateFilterOptsRef: {
          current: {
            room,
            threadId: undefined,
            ignoredUsersSet: new Set(),
            showHiddenEvents: false,
            hideMembershipEvents: false,
            hideNickAvatarEvents: false,
            showThreadRepliesInRoom: true,
          },
        },
        room,
        roomIdRef: { current: '!room:server' },
        roomPaginatingBackRef: { current: false },
        prefetchDepthRef: { current: 10000 },
        sessionId: 'session',
        setRoomHasMoreCachedBack: vi.fn(),
        setTimeline: vi.fn(),
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: initialTimeline,
      });
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    await act(async () => {
      await callback?.(true);
    });

    renderer?.unmount();

    expect(loadRoomCachedPaginationSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 })
    );
  });

  it('preserves classic thread-reply filtering when recalibrating cached prepend range', async () => {
    const root = makeRoomEvent('$root');
    const reply = makeRoomEvent('$reply', '$root');
    const older = makeRoomEvent('$older');
    const timelineEvents = [root, reply];
    const timeline = makeTimeline(timelineEvents);
    const initialTimeline: Timeline = {
      linkedTimelines: [timeline],
      range: { start: 10, end: 20 },
    };
    let callback: ((backwards: boolean) => Promise<void>) | undefined;
    let recalibratedTimeline: Timeline | undefined;
    let renderer: ReactTestRenderer | undefined;

    loadRoomCachedPaginationSnapshotMock.mockResolvedValue({
      status: 'cache-hit',
      events: [older],
      beforeToken: 'older-before-token',
      hasMoreCachedBack: true,
    });

    const room = {
      roomId: '!room:server',
      partitionThreadedEvents: vi.fn((events) => [events, [], []]),
      addEventsToTimeline: vi.fn((events) => {
        timelineEvents.unshift(...events);
      }),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    } as never;
    const mx = {
      getEventMapper: () => (rawEvent: unknown) => rawEvent,
      processAggregatedTimelineEvents: vi.fn(),
    } as never;

    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination: vi.fn(),
        mx,
        beginRoomCacheWrite: () => vi.fn(),
        recalibrateFilterOptsRef: {
          current: {
            room,
            threadId: undefined,
            ignoredUsersSet: new Set(),
            showHiddenEvents: false,
            hideMembershipEvents: false,
            hideNickAvatarEvents: false,
            showThreadRepliesInRoom: true,
          },
        },
        room,
        roomIdRef: { current: '!room:server' },
        roomPaginatingBackRef: { current: false },
        prefetchDepthRef: { current: 50 },
        sessionId: 'session',
        setRoomHasMoreCachedBack: vi.fn(),
        setTimeline: (update) => {
          recalibratedTimeline = typeof update === 'function' ? update(initialTimeline) : update;
        },
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: initialTimeline,
      });
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    await act(async () => {
      await callback?.(true);
    });

    renderer?.unmount();

    expect(recalibratedTimeline?.range).toEqual({ start: 11, end: 21 });
  });

  it('keeps cached thread replies in the classic room timeline', async () => {
    const root = makeRoomEvent('$root');
    const olderRoot = makeRoomEvent('$older-root');
    const olderReply = makeRoomEvent('$older-reply', '$older-root');
    const timelineEvents = [root];
    const timeline = makeTimeline(timelineEvents);
    const initialTimeline: Timeline = {
      linkedTimelines: [timeline],
      range: { start: 1, end: 1 },
    };
    let callback: ((backwards: boolean) => Promise<void>) | undefined;
    let renderer: ReactTestRenderer | undefined;

    loadRoomCachedPaginationSnapshotMock.mockResolvedValue({
      status: 'cache-hit',
      events: [olderRoot, olderReply],
      beforeToken: 'older-before-token',
      hasMoreCachedBack: true,
    });

    const room = {
      roomId: '!room:server',
      partitionThreadedEvents: vi.fn(() => [[olderRoot], [], [olderReply]]),
      addEventsToTimeline: vi.fn((events) => {
        timelineEvents.unshift(...events);
      }),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    } as never;
    const mx = {
      getEventMapper: () => (rawEvent: unknown) => rawEvent,
      processAggregatedTimelineEvents: vi.fn(),
    } as never;

    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination: vi.fn(),
        mx,
        beginRoomCacheWrite: () => vi.fn(),
        recalibrateFilterOptsRef: {
          current: {
            room,
            threadId: undefined,
            ignoredUsersSet: new Set(),
            showHiddenEvents: false,
            hideMembershipEvents: false,
            hideNickAvatarEvents: false,
            showThreadRepliesInRoom: true,
          },
        },
        room,
        roomIdRef: { current: '!room:server' },
        roomPaginatingBackRef: { current: false },
        prefetchDepthRef: { current: 50 },
        sessionId: 'session',
        setRoomHasMoreCachedBack: vi.fn(),
        setTimeline: vi.fn(),
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: initialTimeline,
      });
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    await act(async () => {
      await callback?.(true);
    });

    renderer?.unmount();

    expect(room.addEventsToTimeline).toHaveBeenCalledWith(
      [olderRoot, olderReply],
      true,
      false,
      timeline,
      'older-before-token'
    );
    expect(timelineEvents).toEqual([olderRoot, olderReply, root]);
  });
});

// CINNY-207 P3.3 review (PR #69): the explicit persist point for network
// back-pagination must (a) collect the NEWLY FETCHED events — which are
// OLDER than the pre-fetch earliest and sit at the start of the timeline
// when the SDK extends in place — and (b) pass the timeline's backward
// token as the continuity proof for the new overall-earliest cached event.
describe('network back-pagination persist point (CINNY-207 P3.3)', () => {
  it('persists the newly fetched older slice with the backward token', async () => {
    const root = makeRoomEvent('$root');
    const fetchedOld1 = makeRoomEvent('$old-1');
    const fetchedOld2 = makeRoomEvent('$old-2');
    const timelineEvents: unknown[] = [root];
    const timelineObj = {
      getEvents: () => timelineEvents,
      getPaginationToken: (direction: Direction) =>
        direction === Direction.Backward ? 'deeper-before-token' : undefined,
      setPaginationToken: vi.fn(),
      getNeighbouringTimeline: () => null,
    } as never;
    const initialTimeline: Timeline = {
      linkedTimelines: [timelineObj],
      range: { start: 0, end: 1 },
    };
    let callback: ((backwards: boolean) => Promise<void>) | undefined;
    let renderer: ReactTestRenderer | undefined;

    loadRoomCachedPaginationSnapshotMock.mockResolvedValue({ status: 'cache-miss' });
    const persistRoomEventCache = vi.fn();
    const handleTimelinePagination = vi.fn(async () => {
      // SDK extends the same timeline in place: older events prepend.
      timelineEvents.unshift(fetchedOld1, fetchedOld2);
    });

    const room = {
      roomId: '!room:server',
      partitionThreadedEvents: vi.fn((events) => [events, [], []]),
      addEventsToTimeline: vi.fn(),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    } as never;
    const mx = {
      getEventMapper: () => (rawEvent: unknown) => rawEvent,
      processAggregatedTimelineEvents: vi.fn(),
    } as never;

    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination,
        mx,
        beginRoomCacheWrite: () => persistRoomEventCache,
        recalibrateFilterOptsRef: { current: undefined },
        room,
        roomIdRef: { current: '!room:server' },
        roomPaginatingBackRef: { current: false },
        prefetchDepthRef: { current: 50 },
        sessionId: 'session',
        setRoomHasMoreCachedBack: vi.fn(),
        setTimeline: vi.fn(),
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: initialTimeline,
      });
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {
      await callback?.(true);
    });
    renderer?.unmount();

    expect(handleTimelinePagination).toHaveBeenCalledWith(true);
    expect(persistRoomEventCache).toHaveBeenCalledTimes(1);
    const [persisted, token] = persistRoomEventCache.mock.calls[0];
    // Oldest -> newest, only the newly fetched slice.
    expect((persisted as Array<{ getId: () => string }>).map((e) => e.getId())).toEqual([
      '$old-1',
      '$old-2',
    ]);
    expect(token).toBe('deeper-before-token');
  });
});

it('fences an old page after clear and saves a new page in the same mounted view', async () => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  const sessionId = 'pagination-clear';
  const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
  const room = new Room('!room:example.org', mx, '@alice:example.org');
  const message = (id: string) =>
    new MatrixEvent({
      event_id: id,
      room_id: room.roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { msgtype: 'm.text', body: id },
    });
  const events = [message('$root')];
  const first = makeTimeline(events);
  const timeline = { linkedTimelines: [first], range: { start: 0, end: 1 } };
  const facade = createEnginePersistFacade({ sessionId });
  let release!: () => void;
  let nextId = '$old';
  const paginate = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    const reply = new MatrixEvent({
      ...message(nextId + '-reply').event,
      content: {
        msgtype: 'm.text',
        body: nextId,
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    });
    events.unshift(message(nextId), reply);
    room.emit(RoomEvent.Timeline, reply, room, true, false, {
      liveEvent: false,
      timeline: first,
    } as never);
  });
  loadRoomCachedPaginationSnapshotMock.mockResolvedValue({ status: 'cache-miss' });
  let callback!: (backwards: boolean) => Promise<void>;
  let renderer!: ReactTestRenderer;
  function Harness() {
    useRoomLiveRenderController({
      atBottomRef: { current: true },
      atLiveEndRef: { current: true },
      effectiveThreadFilterState: createDefaultThreadFilterState(),
      hideActivity: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      ignoredUsersSet: new Set(),
      markLiveExpansionCandidate: vi.fn(),
      mx,
      normalThreadRecordMap: new Map(),
      onStoreThreadSummary: vi.fn(),
      room,
      roomThreadFilterActive: false,
      scrollRef: { current: null },
      scrollToBottomRef: { current: { count: 0, smooth: false } },
      setSupplementalThreadEvents: vi.fn(),
      observeLiveTail: vi.fn(),
      notifyThreadEventsChanged: vi.fn(),
      setTimeline: vi.fn(),
      setUnreadInfo: vi.fn(),
      showHiddenEvents: false,
      threadEventIndexMapRef: { current: new Map() },
      threadId: undefined,
      threadResolutionMap: new Map(),
      timelineAtLiveEnd: true,
      unreadInfo: undefined,
    });
    callback = useRoomPaginationCommandController({
      alive: () => true,
      handleTimelinePagination: paginate,
      mx,
      beginRoomCacheWrite: () => facade.forRoom(room).persistRoomEventCache,
      recalibrateFilterOptsRef: { current: undefined },
      room,
      roomIdRef: { current: room.roomId },
      roomPaginatingBackRef: { current: false },
      prefetchDepthRef: { current: 200 },
      sessionId,
      setRoomHasMoreCachedBack: vi.fn(),
      setTimeline: vi.fn(),
      threadId: undefined,
      threadIdRef: { current: undefined },
      timeline,
    });
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(Harness));
  });
  const old = callback(true);
  await vi.waitFor(() => expect(paginate).toHaveBeenCalledOnce());
  await clearRoomCachedContent(sessionId, room.roomId);
  release();
  await old;
  expect(await loadCachedRoomEvent(sessionId, room.roomId, '$old')).toBeUndefined();
  expect((await loadLatestCachedThreadEvents(sessionId, room.roomId, '$root', 10)).events).toEqual(
    []
  );
  nextId = '$new';
  const next = callback(true);
  await vi.waitFor(() => expect(paginate).toHaveBeenCalledTimes(2));
  release();
  await next;
  await vi.waitFor(async () =>
    expect(await loadCachedRoomEvent(sessionId, room.roomId, '$new')).toBeDefined()
  );
  await vi.waitFor(async () =>
    expect(
      (
        await loadLatestCachedThreadEvents(sessionId, room.roomId, '$root', 10)
      ).events.map((event) => event.event_id)
    ).toContain('$new-reply')
  );
  act(() => renderer.unmount());
});
