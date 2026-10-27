import { MatrixEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { describe, expect, it, vi } from 'vitest';
import { makeEvent, makeRoom } from './test-utils/RoomTimeline.test.shared';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';

const flushAsyncWork = async (cycles = 5) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

describe('runThreadOpenSdkBootstrap', () => {
  it('loads replies through relations without a context request when only the root is loaded', async () => {
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const reply = makeEvent('$reply', {
      relation: { rel_type: 'm.thread', event_id: '$root' },
      threadRootId: '$root',
      ts: 2,
    });
    const events: Array<ReturnType<typeof makeEvent> | MatrixEvent> = [root];
    let backward: string | null = null;
    const timeline = {
      getEvents: () => events,
      getNeighbouringTimeline: () => null,
      getPaginationToken: () => backward,
      setPaginationToken: (value: string | null) => {
        backward = value;
      },
    };
    const thread = {
      initialize: vi.fn(() => undefined),
      id: '$root',
      rootEvent: root,
      events,
      setEventMetadata: vi.fn(),
      flushPendingTimelineReset: vi.fn(),
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => timeline,
        getTimelines: () => [timeline],
        addEventsToTimeline: (
          incoming: MatrixEvent[],
          _backwards: boolean,
          _state: boolean,
          _timeline: unknown,
          token: string | null
        ) => {
          incoming.forEach((event) => {
            if (!events.some((existing) => existing.getId() === event.getId()))
              events.unshift(event);
          });
          backward = token;
        },
      }),
    };
    const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
    const mx = {
      getThreadTimeline: vi.fn(),
      fetchRelations: vi.fn().mockResolvedValue({ chunk: [reply.event], next_batch: 'older' }),
      getEventMapper: () => () => reply,
    };
    const result = await runThreadOpenSdkBootstrap({
      debugTraceId: undefined,
      isMounted: () => true,
      mx: mx as never,
      room: room as never,
      threadId: '$root',
      persistThreadEventCache: vi.fn(),
      pinThreadToBottomOnOpen: vi.fn(),
      setSupplementalThreadEvents: vi.fn(),
      onBootstrap: vi.fn(),
      shouldScrollToLatestOnOpen: true,
    });
    expect(result).toBe(true);
    expect(mx.getThreadTimeline).not.toHaveBeenCalled();
    expect(events.map((event) => event.getId())).toEqual(['$reply', '$root']);
    expect(backward).toBe('older');
  });

  it.each(['context', 'missing-thread-relations', 'empty-thread-relations'])(
    'stops after cancellation during %s without mapping or publishing fetched events',
    async (phase) => {
      let finishFetch!: (value: unknown) => void;
      const pending = new Promise((resolve) => {
        finishFetch = resolve;
      });
      const threadTimeline = {
        getEvents: () => [],
        getNeighbouringTimeline: () => null,
        getPaginationToken: () => null,
        setPaginationToken: vi.fn(),
      };
      const thread = {
        initialize: vi.fn(() => undefined),
        id: '$root',
        events: [],
        addEvents: vi.fn(),
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => threadTimeline,
          getTimelines: () => [threadTimeline],
        }),
      };
      const room = makeRoom({
        liveEvents: [],
        threads: phase === 'empty-thread-relations' ? [thread as never] : [],
      });
      const mx = {
        getEventTimeline: vi.fn(() => (phase === 'context' ? pending : Promise.resolve())),
        fetchRelations: vi.fn(() => pending),
        getThreadTimeline: vi.fn().mockResolvedValue(undefined),
        getEventMapper: vi.fn(),
      };
      let mounted = true;
      const persistThreadEventCache = vi.fn();
      const setSupplementalThreadEvents = vi.fn();
      const onBootstrap = vi.fn();
      const work = runThreadOpenSdkBootstrap({
        debugTraceId: 'test',
        isMounted: () => mounted,
        mx: mx as never,
        persistThreadEventCache,
        pinThreadToBottomOnOpen: vi.fn(),
        room: room as never,
        setSupplementalThreadEvents,
        onBootstrap,
        shouldScrollToLatestOnOpen: false,
        threadId: '$root',
      });
      await flushAsyncWork();
      if (phase !== 'context') expect(mx.fetchRelations).toHaveBeenCalledOnce();
      mounted = false;
      finishFetch({ chunk: [{ event_id: '$reply' }], next_batch: 'older' });

      expect(await work).toBe(false);
      expect(mx.getEventMapper).not.toHaveBeenCalled();
      expect(persistThreadEventCache).not.toHaveBeenCalled();
      expect(setSupplementalThreadEvents).not.toHaveBeenCalled();
      expect(onBootstrap).not.toHaveBeenCalledWith({ kind: 'load-error' });
      expect(thread.events).toEqual([]);
      expect(thread.addEvents).not.toHaveBeenCalled();
      expect(threadTimeline.setPaginationToken).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    'initializes an unopened SDK thread before reading its timeline (mounted=%s)',
    async (stayMounted) => {
      const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
      let finishInitialization!: () => void;
      const initialization = new Promise<void>((resolve) => {
        finishInitialization = resolve;
      });
      const threadTimeline = {
        getEvents: () => [],
        getNeighbouringTimeline: () => null,
        getPaginationToken: () => null,
        setPaginationToken: vi.fn(),
      };
      const thread = {
        id: '$root',
        events: [root],
        rootEvent: root,
        initialize: vi.fn(() => initialization),
        flushPendingTimelineReset: vi.fn(),
        setEventMetadata: vi.fn(),
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => threadTimeline,
          getTimelines: () => [threadTimeline],
          addEventsToTimeline: vi.fn(),
        }),
      };
      const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
      const mx = {
        fetchRelations: vi.fn().mockResolvedValue({ chunk: [] }),
        getEventMapper: vi.fn(),
        getEventTimeline: vi.fn(),
        getThreadTimeline: vi.fn().mockResolvedValue(undefined),
      };
      let mounted = true;
      const work = runThreadOpenSdkBootstrap({
        debugTraceId: 'test',
        isMounted: () => mounted,
        mx: mx as never,
        persistThreadEventCache: vi.fn(),
        pinThreadToBottomOnOpen: vi.fn(),
        room: room as never,
        setSupplementalThreadEvents: vi.fn(),
        onBootstrap: vi.fn(),
        shouldScrollToLatestOnOpen: true,
        threadId: '$root',
      });
      await flushAsyncWork();
      // A recorded sync gap is materialized first, so its conversion errors still reach the open.
      expect(thread.flushPendingTimelineReset.mock.invocationCallOrder[0]).toBeLessThan(
        thread.initialize.mock.invocationCallOrder[0]
      );
      expect(mx.getThreadTimeline).not.toHaveBeenCalled();

      mounted = stayMounted;
      finishInitialization();

      expect(await work).toBe(stayMounted);
      expect(mx.getThreadTimeline).toHaveBeenCalledTimes(stayMounted ? 1 : 0);
    }
  );

  it('creates an initialized SDK thread and runs first-open timeline bootstrap', async () => {
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const room = makeRoom({ liveEvents: [root] });
    const onBootstrap = vi.fn();
    const pinThreadToBottomOnOpen = vi.fn();
    const mx = {
      fetchRelations: vi.fn().mockResolvedValue(undefined),
      getEventMapper: vi.fn(),
      getEventTimeline: vi.fn(),
      getThreadTimeline: vi.fn().mockResolvedValue(undefined),
    };

    const options = {
      debugTraceId: 'test',
      isMounted: () => true,
      mx: mx as never,
      persistThreadEventCache: vi.fn(),
      pinThreadToBottomOnOpen,
      room: room as never,
      setSupplementalThreadEvents: vi.fn(),
      onBootstrap,
      shouldScrollToLatestOnOpen: true,
      threadId: '$root',
    };
    const shouldContinue = await runThreadOpenSdkBootstrap(options);

    expect(shouldContinue).toBe(true);
    expect(room.createThread).toHaveBeenCalledOnce();
    expect(room.createThread).toHaveBeenCalledWith('$root', root, [], false);
    expect(onBootstrap).toHaveBeenCalledWith({ kind: 'root-ready' });
    expect(pinThreadToBottomOnOpen).toHaveBeenCalledTimes(1);
    expect(mx.getEventTimeline).not.toHaveBeenCalled();
    expect(mx.getThreadTimeline).toHaveBeenCalledOnce();
    expect(mx.fetchRelations).toHaveBeenCalledOnce();

    const createdThread = room.createThread.mock.results[0]?.value;
    expect(createdThread).toBeDefined();
    expect(room.getThread('$root')).toBe(createdThread);
    expect(createdThread?.initialEventsFetched).toBe(true);
    expect(createdThread?.replayEvents).toBeNull();

    const secondShouldContinue = await runThreadOpenSdkBootstrap(options);

    expect(secondShouldContinue).toBe(true);
    expect(room.getThread('$root')).toBe(createdThread);
    expect(room.createThread).toHaveBeenCalledOnce();
  });

  it('does not create another SDK thread when the root already has one', async () => {
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const reply = makeEvent('$reply', {
      relation: { rel_type: 'm.thread', event_id: '$root' },
      threadRootId: '$root',
      ts: 2,
    });
    const threadTimeline = {
      getEvents: () => [],
      getNeighbouringTimeline: () => null,
      getPaginationToken: () => null,
      setPaginationToken: vi.fn(),
    };
    const thread = {
      initialize: vi.fn(() => undefined),
      id: '$root',
      events: [reply],
      rootEvent: root,
      addEvents: vi.fn(),
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
      }),
    };
    const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
    vi.spyOn(room, 'findEventById');
    const mx = {
      fetchRelations: vi.fn(),
      getEventMapper: vi.fn(),
      getEventTimeline: vi.fn(),
      getThreadTimeline: vi.fn().mockResolvedValue(undefined),
    };

    const shouldContinue = await runThreadOpenSdkBootstrap({
      debugTraceId: 'test',
      isMounted: () => true,
      mx: mx as never,
      persistThreadEventCache: vi.fn(),
      pinThreadToBottomOnOpen: vi.fn(),
      room: room as never,
      setSupplementalThreadEvents: vi.fn(),
      onBootstrap: vi.fn(),
      shouldScrollToLatestOnOpen: true,
      threadId: '$root',
    });

    expect(shouldContinue).toBe(true);
    expect(room.createThread).not.toHaveBeenCalled();
    // Only the pending-local-echo check needs the room-wide lookup.
    expect(room.findEventById).toHaveBeenCalledTimes(1);
  });

  it('keeps first-open backfill and a racing reply when SDK metadata initialization completes', async () => {
    const previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;

    let resolveRootFetch: ((event: Record<string, unknown>) => void) | undefined;
    const rootFetch = new Promise<Record<string, unknown>>((resolve) => {
      resolveRootFetch = resolve;
    });
    const paginateEventTimeline = vi.fn().mockRejectedValue(new Error('pagination failed'));
    let room: Room;
    const getThreadTimeline = vi.fn(async () => {
      const existingReply = new MatrixEvent({
        content: {
          body: 'Existing reply',
          msgtype: 'm.text',
          'm.relates_to': { event_id: '$root', rel_type: 'm.thread' },
        },
        event_id: '$existing-reply',
        origin_server_ts: 2,
        room_id: room.roomId,
        sender: '@bob:example.org',
        type: 'm.room.message',
      });
      room.getThread('$root')?.addEvent(existingReply, false);
    });
    const client = {
      canSupport: new Map(),
      fetchRoomEvent: vi.fn(() => rootFetch),
      fetchRelations: vi.fn().mockResolvedValue(undefined),
      getEventMapper:
        () =>
        (event: Record<string, unknown>): MatrixEvent =>
          event instanceof MatrixEvent ? event : new MatrixEvent(event),
      getUserId: () => '@alice:example.org',
      getThreadTimeline,
      paginateEventTimeline,
      supportsThreads: () => true,
    } as unknown as MatrixClient;
    room = new Room('!room:example.org', client, '@alice:example.org');
    const root = new MatrixEvent({
      content: { body: 'Root', msgtype: 'm.text' },
      event_id: '$root',
      origin_server_ts: 1,
      room_id: room.roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    room.getUnfilteredTimelineSet().addEventToTimeline(root, room.getLiveTimeline(), {
      addToState: false,
      roomState: room.currentState,
      toStartOfTimeline: false,
    });

    try {
      await runThreadOpenSdkBootstrap({
        debugTraceId: 'test',
        isMounted: () => true,
        mx: client,
        persistThreadEventCache: vi.fn(),
        pinThreadToBottomOnOpen: vi.fn(),
        room,
        setSupplementalThreadEvents: vi.fn(),
        onBootstrap: vi.fn(),
        shouldScrollToLatestOnOpen: true,
        threadId: '$root',
      });

      const thread = room.getThread('$root');
      expect(thread).not.toBeNull();
      expect(thread?.events.map((event) => event.getId())).toContain('$existing-reply');

      const reply = new MatrixEvent({
        content: {
          body: 'Reply',
          msgtype: 'm.text',
          'm.relates_to': { event_id: '$root', rel_type: 'm.thread' },
        },
        event_id: '$reply',
        origin_server_ts: 2,
        room_id: room.roomId,
        sender: '@alice:example.org',
        type: 'm.room.message',
      });
      thread?.addEvent(reply, false);
      expect(thread?.events).toContain(reply);

      resolveRootFetch?.(root.event as unknown as Record<string, unknown>);
      await flushAsyncWork();

      expect(thread?.events).toContain(reply);
      expect(thread?.events.map((event) => event.getId())).toContain('$existing-reply');
      expect(paginateEventTimeline).not.toHaveBeenCalled();
      expect(getThreadTimeline).toHaveBeenCalledOnce();
    } finally {
      Thread.hasServerSideSupport = previousThreadSupport;
    }
  });
});
