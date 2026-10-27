// @vitest-environment jsdom

import React from 'react';
import { act, create } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi, type Mocked } from 'vitest';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import { MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { RoomEvent, RoomStateEvent, MatrixEvent as StateMatrixEvent } from 'matrix-js-sdk';
import { ThreadEvent, type Thread } from 'matrix-js-sdk/lib/models/thread';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { makeRecentThreadsAtom } from '../../recent-threads/recentThreads';
import {
  clearThreadSummarySharedState,
  storeThreadSummaryInState,
} from '../../threads/threadSummaryState';
import { MINDROOM_THREAD_TAGS_EVENT } from '../../threads/threadTags';
import { setRoomEventPinned } from '../../threads/threadPinning';
import { buildSidebarThreadEntries } from '../../recent-threads/threadNavCategoryUtils';
import { useCrossRoomThreadIndex } from '../useCrossRoomThreadIndex';
import { crossRoomThreadIndexAtom, getCrossRoomThreadIndexKey } from '../crossRoomThreadIndex';
import {
  applyCrossRoomThreadFilters,
  isCrossRoomThreadEntryEligible,
} from '../crossRoomThreadFilterPipeline';
import { DEFAULT_CROSS_ROOM_THREAD_FILTERS } from '../crossRoomThreadFilters';

const { matrixClientMock, activeSessionMock } = vi.hoisted(() => ({
  matrixClientMock: vi.fn(),
  activeSessionMock: vi.fn(),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: matrixClientMock,
}));

vi.mock('../../../hooks/useSessionStore', () => ({
  useActiveSession: activeSessionMock,
}));

type ListenerMap = Map<unknown, Set<(...args: any[]) => void>>;

const addListener = (listeners: ListenerMap, event: unknown, handler: (...args: any[]) => void) => {
  const eventListeners = listeners.get(event) ?? new Set();
  eventListeners.add(handler);
  listeners.set(event, eventListeners);
};

const removeListener = (
  listeners: ListenerMap,
  event: unknown,
  handler: (...args: any[]) => void
) => {
  listeners.get(event)?.delete(handler);
};

const emit = (listeners: ListenerMap, event: unknown, ...args: unknown[]) => {
  listeners.get(event)?.forEach((handler) => handler(...args));
};

const makeEvent = ({
  id,
  body = 'Root',
  content,
  eventType = 'm.room.message',
  sender = '@alice:example.org',
  threadRootId,
  relation,
  roomId,
  replacingEvent,
  status = null,
  ts = 100,
}: {
  id: string;
  body?: string;
  content?: Record<string, unknown>;
  eventType?: string;
  sender?: string;
  threadRootId?: string;
  relation?: { rel_type: string; event_id: string };
  roomId?: string;
  replacingEvent?: () => MatrixEvent | undefined;
  status?: unknown;
  ts?: number;
}): MatrixEvent => {
  const eventContent = content ?? { msgtype: 'm.text', body };
  const eventRelation =
    relation ??
    (threadRootId ? { rel_type: RelationType.Thread, event_id: threadRootId } : undefined);
  const event = {
    status,
    threadRootId,
    getId: () => id,
    getRoomId: () => roomId,
    getSender: () => sender,
    getTs: () => ts,
    getType: () => eventType,
    getContent: () => eventContent,
    getUnsigned: () => ({}),
    getRelation: () => eventRelation,
    isRelation: (relationType: string) => eventRelation?.rel_type === relationType,
    isSending: () => event.status !== undefined && event.status !== null,
    isRedacted: () => false,
    isRedaction: () => false,
    replacingEvent: () => replacingEvent?.(),
  } as MatrixEvent & { status: unknown };
  return event;
};

const makeTimelineSet = (events: MatrixEvent[]) => ({
  relations: {
    getChildEventsForEvent: () => undefined,
  },
  getLiveTimeline: () => ({
    getEvents: () => events,
    getNeighbouringTimeline: () => undefined,
  }),
});

const makeThread = (root: MatrixEvent, replies: MatrixEvent[] = []): Thread =>
  ({
    rootEvent: root,
    events: replies,
    timeline: replies,
    length: replies.length,
    lastReply: () => null,
    getUnfilteredTimelineSet: () => makeTimelineSet([root, ...replies]),
  } as unknown as Thread);

const makeRoom = (
  roomId = '!room:example.org',
  {
    rootId = '$root',
    rootBody = 'Root',
    rootContent,
    rootReplacingEvent,
    replies = [],
    relationEvents = [],
  }: {
    rootId?: string;
    rootBody?: string;
    rootContent?: Record<string, unknown>;
    rootReplacingEvent?: () => MatrixEvent | undefined;
    replies?: MatrixEvent[];
    relationEvents?: MatrixEvent[];
  } = {}
) => {
  const root = makeEvent({
    id: rootId,
    body: rootBody,
    content: rootContent,
    roomId,
    replacingEvent: rootReplacingEvent,
  });
  const thread = makeThread(root, replies);
  const eventMap = new Map<string, MatrixEvent>([
    [rootId, root],
    ...replies.map((reply): [string, MatrixEvent] => [reply.getId() ?? '', reply]),
  ]);
  const listeners: ListenerMap = new Map();
  const room = {
    roomId,
    name: 'Room',
    getMyMembership: vi.fn(() => 'join'),
    isSpaceRoom: vi.fn(() => false),
    getLastActiveTimestamp: vi.fn(() => 100),
    getThreads: vi.fn(() => [thread]),
    getThread: vi.fn((threadRootId: string) => (threadRootId === rootId ? thread : null)),
    findEventById: vi.fn((eventId: string) => eventMap.get(eventId)),
    getMember: vi.fn(() => undefined),
    getEventReadUpTo: vi.fn(() => undefined),
    getLiveTimeline: vi.fn(() => ({
      getState: () => ({
        getStateEvents: () => [],
      }),
    })),
    getUnfilteredTimelineSet: vi.fn(() => makeTimelineSet([root, ...replies])),
    relations: {
      getAllChildEventsForEvent: vi.fn((eventId: string) =>
        eventId === rootId ? relationEvents : []
      ),
    },
    on: vi.fn((event: unknown, handler: (...args: any[]) => void) =>
      addListener(listeners, event, handler)
    ),
    removeListener: vi.fn((event: unknown, handler: (...args: any[]) => void) =>
      removeListener(listeners, event, handler)
    ),
    emit: (event: unknown, ...args: unknown[]) => emit(listeners, event, ...args),
  } as unknown as Mocked<Room> & { emit: (event: unknown, ...args: unknown[]) => void };

  return { room, root, thread };
};

const makeRoomWithThreads = (roomId: string, threadRoots: Array<{ id: string; body: string }>) => {
  const roots = threadRoots.map(({ id, body }) => makeEvent({ id, body, roomId }));
  const threads = roots.map((root) => makeThread(root));
  const eventMap = new Map<string, MatrixEvent>(
    roots.map((root): [string, MatrixEvent] => [root.getId() ?? '', root])
  );
  const listeners: ListenerMap = new Map();
  const room = {
    roomId,
    name: 'Room',
    getMyMembership: vi.fn(() => 'join'),
    isSpaceRoom: vi.fn(() => false),
    getLastActiveTimestamp: vi.fn(() => 100),
    getThreads: vi.fn(() => threads),
    getThread: vi.fn((threadRootId: string) => {
      const index = roots.findIndex((root) => root.getId() === threadRootId);
      return index >= 0 ? threads[index] : null;
    }),
    findEventById: vi.fn((eventId: string) => eventMap.get(eventId)),
    getMember: vi.fn(() => undefined),
    getEventReadUpTo: vi.fn(() => undefined),
    getLiveTimeline: vi.fn(() => ({
      getState: () => ({
        getStateEvents: () => [],
      }),
    })),
    getUnfilteredTimelineSet: vi.fn(() => makeTimelineSet(roots)),
    on: vi.fn((event: unknown, handler: (...args: any[]) => void) =>
      addListener(listeners, event, handler)
    ),
    removeListener: vi.fn((event: unknown, handler: (...args: any[]) => void) =>
      removeListener(listeners, event, handler)
    ),
    emit: (event: unknown, ...args: unknown[]) => emit(listeners, event, ...args),
  } as unknown as Mocked<Room> & { emit: (event: unknown, ...args: unknown[]) => void };

  return { room, roots, threads };
};

const makeRoomWithThreadReplies = (roomId: string, threadCount: number) => {
  const roots = Array.from({ length: threadCount }, (_, index) =>
    makeEvent({ id: `$root-${index}`, body: `Root ${index}`, roomId })
  );
  const replies = roots.map((root, index) =>
    makeEvent({
      id: `$reply-${index}`,
      body: `Reply ${index}`,
      threadRootId: root.getId(),
      roomId,
    })
  );
  const threads = roots.map((root, index) => makeThread(root, [replies[index]]));
  const threadMap = new Map<string, Thread>(
    roots.map((root, index): [string, Thread] => [root.getId() ?? '', threads[index]])
  );
  const eventMap = new Map<string, MatrixEvent>([
    ...roots.map((root): [string, MatrixEvent] => [root.getId() ?? '', root]),
    ...replies.map((reply): [string, MatrixEvent] => [reply.getId() ?? '', reply]),
  ]);
  const listeners: ListenerMap = new Map();
  const room = {
    roomId,
    name: 'Room',
    getMyMembership: vi.fn(() => 'join'),
    isSpaceRoom: vi.fn(() => false),
    getLastActiveTimestamp: vi.fn(() => 100),
    getThreads: vi.fn(() => threads),
    getThread: vi.fn((threadRootId: string) => threadMap.get(threadRootId) ?? null),
    findEventById: vi.fn((eventId: string) => eventMap.get(eventId)),
    getMember: vi.fn(() => undefined),
    getEventReadUpTo: vi.fn(() => undefined),
    getLiveTimeline: vi.fn(() => ({
      getState: () => ({
        getStateEvents: () => [],
      }),
    })),
    getUnfilteredTimelineSet: vi.fn(() => makeTimelineSet([...roots, ...replies])),
    on: vi.fn((event: unknown, handler: (...args: any[]) => void) =>
      addListener(listeners, event, handler)
    ),
    removeListener: vi.fn((event: unknown, handler: (...args: any[]) => void) =>
      removeListener(listeners, event, handler)
    ),
    emit: (event: unknown, ...args: unknown[]) => emit(listeners, event, ...args),
  } as unknown as Mocked<Room> & { emit: (event: unknown, ...args: unknown[]) => void };

  return { room, roots, replies, threads };
};

const makeClient = (rooms: Room | Room[]) => {
  const roomList = Array.isArray(rooms) ? rooms : [rooms];
  const roomMap = new Map(roomList.map((room): [string, Room] => [room.roomId, room]));
  const listeners: ListenerMap = new Map();
  return {
    getUserId: vi.fn(() => '@me:example.org'),
    getRoom: vi.fn((roomId: string) => roomMap.get(roomId) ?? null),
    on: vi.fn((event: unknown, handler: (...args: any[]) => void) =>
      addListener(listeners, event, handler)
    ),
    removeListener: vi.fn((event: unknown, handler: (...args: any[]) => void) =>
      removeListener(listeners, event, handler)
    ),
    emit: (event: unknown, ...args: unknown[]) => emit(listeners, event, ...args),
  };
};

function HookProbe() {
  useCrossRoomThreadIndex();
  return null;
}

const flushScheduledWork = async () => {
  await act(async () => {
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useCrossRoomThreadIndex', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    clearThreadSummarySharedState();
    activeSessionMock.mockReturnValue({
      sessionId: 'session',
      userId: '@me:example.org',
      baseUrl: 'https://example.org',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
    clearThreadSummarySharedState();
  });

  it('reads room tag state once when bootstrapping many threads, including untagged roots', async () => {
    const { room } = makeRoomWithThreadReplies('!room:example.org', 40);
    const tag = new StateMatrixEvent({
      type: MINDROOM_THREAD_TAGS_EVENT,
      state_key: '["$root-0","resolved"]',
      content: { set_by: '@me:example.org', set_at: '2026-09-21T00:00:00Z' },
    });
    const readTags = vi.fn(() => [tag]);
    vi.mocked(room.getLiveTimeline).mockReturnValue({
      getState: () => ({
        // Like the SDK, each read returns a fresh array.
        getStateEvents: (type: string) => (type === MINDROOM_THREAD_TAGS_EVENT ? readTags() : null),
      }),
    } as never);
    matrixClientMock.mockReturnValue(makeClient(room));
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    const entries = store.get(crossRoomThreadIndexAtom).entries;
    expect(entries.size).toBe(40);
    expect(entries.get(getCrossRoomThreadIndexKey(room.roomId, '$root-0'))?.isResolved).toBe(true);
    expect(entries.get(getCrossRoomThreadIndexKey(room.roomId, '$root-39'))?.isResolved).toBe(
      false
    );
    expect(readTags).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it.each(['canonical', 'legacy'])(
    'only rebuilds the changed thread on %s resolve and reopen',
    async (format) => {
      const { room, replies } = makeRoomWithThreadReplies('!room:example.org', 3);
      let tag = new StateMatrixEvent({
        type: MINDROOM_THREAD_TAGS_EVENT,
        state_key: format === 'canonical' ? '["$root-1","resolved"]' : '$root-1',
        content: {},
      });
      vi.mocked(room.getLiveTimeline).mockReturnValue({
        getState: () => ({
          getStateEvents: (type: string) => (type === MINDROOM_THREAD_TAGS_EVENT ? [tag] : null),
        }),
      } as never);
      const mx = makeClient(room);
      matrixClientMock.mockReturnValue(mx);
      const store = createStore();
      store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });
      let renderer!: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
      });
      await flushScheduledWork();
      const untouched = store
        .get(crossRoomThreadIndexAtom)
        .entries.get(getCrossRoomThreadIndexKey(room.roomId, '$root-0'));
      const untouchedContent = vi.spyOn(replies[0], 'getContent');
      const metadata = { set_by: '@me:example.org', set_at: '2026-09-21T00:00:00Z' };
      for (const resolved of [true, false]) {
        tag = new StateMatrixEvent({
          ...tag.event,
          content: resolved
            ? format === 'canonical'
              ? metadata
              : { tags: { resolved: metadata } }
            : {},
        });
        await act(async () => {
          mx.emit(RoomStateEvent.Events, tag, { roomId: room.roomId });
          await Promise.resolve();
        });
        await flushScheduledWork();
        const entries = store.get(crossRoomThreadIndexAtom).entries;
        expect(entries.get(getCrossRoomThreadIndexKey(room.roomId, '$root-1'))?.isResolved).toBe(
          resolved
        );
        expect(entries.get(getCrossRoomThreadIndexKey(room.roomId, '$root-0'))).toBe(untouched);
        expect(untouchedContent).not.toHaveBeenCalled();
      }
      renderer.unmount();
    }
  );

  it.each(['sync', 'local'])(
    'suspends global resolution for %s pins and restores it on unpin',
    async (source) => {
      const { room } = makeRoom();
      const mx = {
        ...makeClient(room),
        getSafeUserId: () => '@me:example.org',
        getStateEvent: vi.fn(async () => ({ pinned: [] as string[] })),
        sendStateEvent: vi.fn(async () => ({ event_id: '$saved' })),
      };
      const tags = new StateMatrixEvent({
        type: MINDROOM_THREAD_TAGS_EVENT,
        state_key: '["$root","resolved"]',
        content: { set_by: '@me:example.org', set_at: '2026-09-21T00:00:00Z' },
      });
      let pins = new StateMatrixEvent({
        type: 'm.room.pinned_events',
        state_key: '',
        event_id: '$initial',
        content: { pinned: [] },
      });
      const state = {
        roomId: room.roomId,
        getStateEvents: (type: string) => {
          if (type === MINDROOM_THREAD_TAGS_EVENT) return [tags];
          if (type === 'm.room.pinned_events') return pins;
          if (type === 'm.room.power_levels')
            return new StateMatrixEvent({ content: { users: { '@me:example.org': 100 } } });
          return undefined;
        },
      };
      vi.mocked(room.getLiveTimeline).mockReturnValue({ getState: () => state } as never);
      matrixClientMock.mockReturnValue(mx);
      const store = createStore();
      store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });
      let renderer!: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
      });
      const entries = () => Array.from(store.get(crossRoomThreadIndexAtom).entries.values());
      const syncPins = async (ids: string[]) => {
        await act(async () => {
          pins = new StateMatrixEvent({
            type: 'm.room.pinned_events',
            state_key: '',
            content: { pinned: ids },
          });
          room.emit(RoomStateEvent.Events, pins, state);
          mx.emit(RoomStateEvent.Events, pins, state);
        });
        await flushScheduledWork();
      };
      try {
        await flushScheduledWork();
        expect(entries()[0].isResolved).toBe(true);
        expect(buildSidebarThreadEntries(entries(), [])).toHaveLength(0);
        if (source === 'sync') await syncPins(['$root']);
        else {
          await act(async () => {
            await setRoomEventPinned(mx as never, room, '$root', true);
          });
          await flushScheduledWork();
        }
        expect(entries()[0].isResolved).toBe(false);
        expect(entries()[0].threadRecord.status.isResolved).toBe(false);
        expect(
          applyCrossRoomThreadFilters(entries(), {
            ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
            scope: 'all',
            resolved: 'unresolved',
            activityWindow: 'all',
          })
        ).toHaveLength(1);
        expect(buildSidebarThreadEntries(entries(), [])).toHaveLength(1);
        await syncPins(['$root']);
        await syncPins([]);
        expect(entries()[0].isResolved).toBe(true);
        expect(
          applyCrossRoomThreadFilters(entries(), {
            ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
            scope: 'all',
            resolved: 'unresolved',
            activityWindow: 'all',
          })
        ).toHaveLength(0);
        expect(buildSidebarThreadEntries(entries(), [])).toHaveLength(0);
      } finally {
        act(() => renderer.unmount());
      }
    }
  );

  it('bootstraps loaded joined room threads lazily and registers listeners while mounted', async () => {
    const { room } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([[room.roomId, new Set(['!space:example.org'])]]),
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });

    await flushScheduledWork();

    const snapshot = store.get(crossRoomThreadIndexAtom);
    expect(snapshot.bootstrapped).toBe(true);
    expect(Array.from(snapshot.entries.values())[0]?.parentSpaceIds).toEqual([
      '!space:example.org',
    ]);
    expect(room.on).toHaveBeenCalledWith(RoomEvent.Timeline, expect.any(Function));
    expect(room.on).toHaveBeenCalledWith(RoomEvent.LocalEchoUpdated, expect.any(Function));
    expect(room.on).toHaveBeenCalledWith(ThreadEvent.NewReply, expect.any(Function));
    expect(mx.on).toHaveBeenCalledWith(RoomEvent.MyMembership, expect.any(Function));
    expect(mx.on).toHaveBeenCalledWith(MatrixEventEvent.Decrypted, expect.any(Function));

    await act(async () => {
      renderer?.unmount();
    });
    expect(room.removeListener).toHaveBeenCalledWith(RoomEvent.Timeline, expect.any(Function));
    expect(room.removeListener).toHaveBeenCalledWith(
      RoomEvent.LocalEchoUpdated,
      expect.any(Function)
    );
    expect(mx.removeListener).toHaveBeenCalledWith(RoomStateEvent.Events, expect.any(Function));
  });

  it('keeps bootstrapped false for dirty thread flushes before lazy bootstrap drains', async () => {
    const { room, thread } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });

    await act(async () => {
      room.emit(ThreadEvent.Update, thread);
      await Promise.resolve();
    });

    const dirtySnapshot = store.get(crossRoomThreadIndexAtom);
    expect(dirtySnapshot.entries.size).toBe(1);
    expect(dirtySnapshot.bootstrapped).toBe(false);

    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).bootstrapped).toBe(true);
  });

  it('rebuilds a thread once for a burst of updates inside the flush interval', async () => {
    // The flush interval runs on performance.now, which Vitest fakes only on request.
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'Date',
        'performance',
      ],
    });
    const { room, threads, replies } = makeRoomWithThreadReplies('!room:example.org', 2);
    matrixClientMock.mockReturnValue(makeClient(room));
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    const replyContent = vi.spyOn(replies[0], 'getContent');
    const emitUpdates = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        // Each SDK update arrives in its own task, so each microtask checkpoint passes.
        await act(async () => {
          room.emit(ThreadEvent.Update, threads[0]);
          await Promise.resolve();
        });
      }
      await flushScheduledWork();
    };

    await emitUpdates(1);
    const readsPerRebuild = replyContent.mock.calls.length;
    replyContent.mockClear();
    await emitUpdates(5);

    expect(readsPerRebuild).toBeGreaterThan(0);
    expect(replyContent).toHaveBeenCalledTimes(readsPerRebuild);
    renderer.unmount();
  });

  it('does not re-add a deleted thread from an update queued before the delete', async () => {
    const { room, threads } = makeRoomWithThreadReplies('!room:example.org', 2);
    matrixClientMock.mockReturnValue(makeClient(room));
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    const deletedKey = getCrossRoomThreadIndexKey(room.roomId, '$root-0');
    expect(store.get(crossRoomThreadIndexAtom).entries.has(deletedKey)).toBe(true);

    await act(async () => {
      room.emit(ThreadEvent.Update, threads[0]);
      room.emit(ThreadEvent.Delete, threads[0]);
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.has(deletedKey)).toBe(false);
    renderer.unmount();
  });

  it('includes every bootstrapped thread when the index reports bootstrapped', async () => {
    // Bootstrap scans rooms in chunks of 5 across idle callbacks.
    const rooms = Array.from(
      { length: 7 },
      (_, index) => makeRoomWithThreadReplies(`!room-${index}:example.org`, 1).room
    );
    matrixClientMock.mockReturnValue(makeClient(rooms));
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: rooms.map((room) => room.roomId) });
    let entriesWhenBootstrapped: number | undefined;
    const unsubscribe = store.sub(crossRoomThreadIndexAtom, () => {
      const snapshot = store.get(crossRoomThreadIndexAtom);
      if (snapshot.bootstrapped && entriesWhenBootstrapped === undefined) {
        entriesWhenBootstrapped = snapshot.entries.size;
      }
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    for (let pass = 0; pass < 4; pass += 1) await flushScheduledWork();

    expect(entriesWhenBootstrapped).toBe(7);
    unsubscribe();
    renderer.unmount();
  });

  it('does not index plain live room messages as cross-room threads', async () => {
    const { room } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    await act(async () => {
      room.emit(RoomEvent.Timeline, makeEvent({ id: '$plain', body: 'Plain room message' }), room);
      await Promise.resolve();
    });

    expect(
      store
        .get(crossRoomThreadIndexAtom)
        .entries.has(getCrossRoomThreadIndexKey(room.roomId, '$plain'))
    ).toBe(false);
  });

  it('refreshes a tracked encrypted thread root when it decrypts', async () => {
    const rootContent = { msgtype: 'm.text', body: '[encrypted]' };
    const { room, root } = makeRoom('!room:example.org', { rootContent });
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const key = getCrossRoomThreadIndexKey(room.roomId, '$root');
    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.rootPreviewText).toBe(
      '[encrypted]'
    );

    rootContent.body = 'Decrypted needle root';
    await act(async () => {
      mx.emit(MatrixEventEvent.Decrypted, root);
      await Promise.resolve();
    });
    await flushScheduledWork();

    const entry = store.get(crossRoomThreadIndexAtom).entries.get(key);
    expect(entry?.rootPreviewText).toBe('Decrypted needle root');
    expect(entry?.summaryText).toBe('Decrypted needle root');
    expect(entry?.searchableText).toContain('decrypted needle');
  });

  it('refreshes a tracked entry when one of its visible replies decrypts', async () => {
    const replyContent = {
      msgtype: 'm.text',
      body: 'encrypted reply',
      'm.mentions': { user_ids: [] as string[] },
    };
    const reply = makeEvent({
      id: '$reply',
      content: replyContent,
      sender: '@alice:example.org',
      threadRootId: '$root',
      roomId: '!room:example.org',
    });
    const { room } = makeRoom('!room:example.org', { replies: [reply] });
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const key = getCrossRoomThreadIndexKey(room.roomId, '$root');
    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.isInvolved).toBe(false);

    replyContent['m.mentions'] = { user_ids: ['@me:example.org'] };
    await act(async () => {
      mx.emit(MatrixEventEvent.Decrypted, reply);
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.isInvolved).toBe(true);
  });

  it('uses the reverse event index when decrypted visible replies refresh tracked entries', async () => {
    const { room, replies } = makeRoomWithThreadReplies('!room:example.org', 1000);
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(1000);

    const targetReply = replies[500]!;
    room.getThread.mockClear();

    await act(async () => {
      mx.emit(MatrixEventEvent.Decrypted, targetReply);
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(room.getThread.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('refreshes an edited thread root from a filtered timeline replace event', async () => {
    const rootContent = { msgtype: 'm.text', body: 'Original root' };
    let latestEdit: MatrixEvent | undefined;
    const { room } = makeRoom('!room:example.org', {
      rootContent,
      rootReplacingEvent: () => latestEdit,
    });
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const key = getCrossRoomThreadIndexKey(room.roomId, '$root');
    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.rootPreviewText).toBe(
      'Original root'
    );

    latestEdit = makeEvent({
      id: '$edit',
      content: {
        msgtype: 'm.text',
        body: '* Original root',
        'm.new_content': { msgtype: 'm.text', body: 'Edited root needle' },
      },
      relation: { rel_type: RelationType.Replace, event_id: '$root' },
      roomId: room.roomId,
    });
    await act(async () => {
      room.emit(RoomEvent.Timeline, latestEdit, room);
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.rootPreviewText).toBe(
      'Edited root needle'
    );
  });

  it('refreshes an edited thread root from a decrypted encrypted replace event', async () => {
    let latestEdit: MatrixEvent | undefined;
    const { room } = makeRoom('!room:example.org', {
      rootBody: 'Original encrypted-edit root',
      rootReplacingEvent: () => latestEdit,
    });
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const key = getCrossRoomThreadIndexKey(room.roomId, '$root');
    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.rootPreviewText).toBe(
      'Original encrypted-edit root'
    );

    latestEdit = makeEvent({
      id: '$encrypted-edit',
      eventType: 'm.room.encrypted',
      content: {
        msgtype: 'm.text',
        body: '* Original encrypted-edit root',
        'm.new_content': { msgtype: 'm.text', body: 'edited encrypted needle' },
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$root' },
      },
      roomId: room.roomId,
    });
    await act(async () => {
      mx.emit(MatrixEventEvent.Decrypted, latestEdit);
      await Promise.resolve();
    });
    await flushScheduledWork();

    const entry = store.get(crossRoomThreadIndexAtom).entries.get(key);
    expect(entry?.rootPreviewText).toBe('edited encrypted needle');
    expect(entry?.searchableText).toContain('edited encrypted needle');
  });

  it('refreshes a visible reply when its encrypted replace event decrypts', async () => {
    const replyContent: Record<string, unknown> = {
      msgtype: 'm.notice',
      body: 'Original reply summary',
      'io.mindroom.thread_summary': true,
      'm.mentions': { user_ids: [] },
    };
    const reply = makeEvent({
      id: '$reply',
      content: replyContent,
      sender: '@alice:example.org',
      threadRootId: '$root',
      roomId: '!room:example.org',
    });
    const { room } = makeRoom('!room:example.org', { replies: [reply] });
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const key = getCrossRoomThreadIndexKey(room.roomId, '$root');
    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.isInvolved).toBe(false);
    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.searchableText).toContain(
      'original reply summary'
    );

    const editedReplyContent = {
      msgtype: 'm.notice',
      body: 'Edited encrypted reply needle',
      'io.mindroom.thread_summary': true,
      'm.mentions': { user_ids: ['@me:example.org'] },
    };
    const encryptedReplyEdit = makeEvent({
      id: '$encrypted-reply-edit',
      eventType: 'm.room.encrypted',
      content: {
        msgtype: 'm.notice',
        body: '* Original reply summary',
        'm.new_content': editedReplyContent,
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
      },
      roomId: room.roomId,
    });
    Object.assign(replyContent, editedReplyContent);

    await act(async () => {
      mx.emit(MatrixEventEvent.Decrypted, encryptedReplyEdit);
      await Promise.resolve();
    });
    await flushScheduledWork();

    const entry = store.get(crossRoomThreadIndexAtom).entries.get(key);
    expect(entry?.isInvolved).toBe(true);
    expect(entry?.searchableText).toContain('edited encrypted reply needle');
  });

  it('refreshes involvement when a visible reply edit adds and removes a direct mention', async () => {
    let latestEdit: MatrixEvent | undefined;
    const reply = makeEvent({
      id: '$reply',
      content: {
        msgtype: 'm.text',
        body: 'Original reply',
        'm.mentions': { user_ids: [] },
      },
      sender: '@alice:example.org',
      threadRootId: '$root',
      roomId: '!room:example.org',
      replacingEvent: () => latestEdit,
    });
    const { room } = makeRoom('!room:example.org', { replies: [reply] });
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const key = getCrossRoomThreadIndexKey(room.roomId, '$root');
    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.isInvolved).toBe(false);

    latestEdit = makeEvent({
      id: '$edit-add-mention',
      content: {
        msgtype: 'm.text',
        body: '* Original reply',
        'm.mentions': { user_ids: [] },
        'm.new_content': {
          msgtype: 'm.text',
          body: 'Edited reply @me',
          'm.mentions': { user_ids: ['@me:example.org'] },
        },
      },
      relation: { rel_type: RelationType.Replace, event_id: '$reply' },
      roomId: room.roomId,
    });
    await act(async () => {
      room.emit(RoomEvent.Timeline, latestEdit, room);
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.isInvolved).toBe(true);

    latestEdit = makeEvent({
      id: '$edit-remove-mention',
      content: {
        msgtype: 'm.text',
        body: '* Edited reply @me',
        'm.new_content': {
          msgtype: 'm.text',
          body: 'Edited reply without mention',
        },
      },
      relation: { rel_type: RelationType.Replace, event_id: '$reply' },
      roomId: room.roomId,
    });
    await act(async () => {
      room.emit(RoomEvent.Timeline, latestEdit, room);
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.isInvolved).toBe(false);
  });

  it('refreshes indexed entries when thread summary state changes after bootstrap', async () => {
    const { room } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const key = getCrossRoomThreadIndexKey(room.roomId, '$root');
    expect(store.get(crossRoomThreadIndexAtom).entries.get(key)?.searchableText).not.toContain(
      'cached-only needle'
    );

    await act(async () => {
      storeThreadSummaryInState('session', room.roomId, '$root', {
        summaryText: 'Cached-only needle summary',
        generatedTs: 200,
        messageCount: 2,
      });
      await Promise.resolve();
    });
    await flushScheduledWork();

    const entry = store.get(crossRoomThreadIndexAtom).entries.get(key);
    expect(entry?.summaryText).toBe('Cached-only needle summary');
    expect(entry?.searchableText).toContain('cached-only needle');
  });

  it('publishes one snapshot for one coalesced bootstrap flush instead of one per thread', async () => {
    const { room } = makeRoomWithThreads(
      '!room:example.org',
      Array.from({ length: 20 }, (_, index) => ({ id: `$root-${index}`, body: `Root ${index}` }))
    );
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const snapshot = store.get(crossRoomThreadIndexAtom);
    expect(snapshot.entries.size).toBe(20);
    expect(snapshot.version).toBe(1);
  });

  it('does not publish a new snapshot when a rebuilt thread is semantically unchanged', async () => {
    const { room, thread } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const before = store.get(crossRoomThreadIndexAtom);
    await act(async () => {
      room.emit(ThreadEvent.Update, thread);
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom)).toBe(before);
  });

  it('ignores receipts that carry no receipt for the current user', async () => {
    const { room } = makeRoomWithThreadReplies('!room:example.org', 5);
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const before = store.get(crossRoomThreadIndexAtom);
    room.getThread.mockClear();

    await act(async () => {
      room.emit(
        RoomEvent.Receipt,
        makeEvent({
          id: '$receipt-other',
          eventType: 'm.receipt',
          content: {
            '$reply-1': { 'm.read': { '@alice:example.org': { ts: 200, thread_id: '$root-1' } } },
          },
          roomId: room.roomId,
        }),
        room
      );
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(room.getThread).not.toHaveBeenCalled();
    expect(store.get(crossRoomThreadIndexAtom)).toBe(before);
  });

  it('refreshes only the receipted thread for an own threaded receipt', async () => {
    const { room } = makeRoomWithThreadReplies('!room:example.org', 5);
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    room.getThread.mockClear();

    await act(async () => {
      room.emit(
        RoomEvent.Receipt,
        makeEvent({
          id: '$receipt-own',
          eventType: 'm.receipt',
          content: {
            '$reply-3': { 'm.read': { '@me:example.org': { ts: 200, thread_id: '$root-3' } } },
          },
          roomId: room.roomId,
        }),
        room
      );
      await Promise.resolve();
    });
    await flushScheduledWork();

    const queriedThreadIds = new Set(room.getThread.mock.calls.map(([threadId]) => threadId));
    expect(queriedThreadIds).toEqual(new Set(['$root-3']));
  });

  it('refreshes all room threads for own unthreaded receipts, none for main-timeline ones', async () => {
    const { room } = makeRoomWithThreadReplies('!room:example.org', 3);
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const allRootIds = new Set(['$root-0', '$root-1', '$root-2']);

    room.getThread.mockClear();
    await act(async () => {
      room.emit(
        RoomEvent.Receipt,
        makeEvent({
          id: '$receipt-unthreaded',
          eventType: 'm.receipt',
          content: { '$reply-1': { 'm.read': { '@me:example.org': { ts: 200 } } } },
          roomId: room.roomId,
        }),
        room
      );
      await Promise.resolve();
    });
    await flushScheduledWork();
    expect(new Set(room.getThread.mock.calls.map(([threadId]) => threadId))).toEqual(allRootIds);

    room.getThread.mockClear();
    await act(async () => {
      room.emit(
        RoomEvent.Receipt,
        makeEvent({
          id: '$receipt-main',
          eventType: 'm.receipt',
          content: {
            '$reply-1': { 'm.read': { '@me:example.org': { ts: 300, thread_id: 'main' } } },
          },
          roomId: room.roomId,
        }),
        room
      );
      await Promise.resolve();
    });
    await flushScheduledWork();
    expect(room.getThread).not.toHaveBeenCalled();
  });

  it('rebuilds only the thread whose summary state changed', async () => {
    const { room } = makeRoomWithThreads(
      '!room:example.org',
      Array.from({ length: 5 }, (_, index) => ({ id: `$root-${index}`, body: `Root ${index}` }))
    );
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    room.getThread.mockClear();

    await act(async () => {
      storeThreadSummaryInState('session', room.roomId, '$root-2', {
        summaryText: 'Narrow summary needle',
        generatedTs: 300,
        messageCount: 3,
      });
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(new Set(room.getThread.mock.calls.map(([threadId]) => threadId))).toEqual(
      new Set(['$root-2'])
    );
    const entry = store
      .get(crossRoomThreadIndexAtom)
      .entries.get(getCrossRoomThreadIndexKey(room.roomId, '$root-2'));
    expect(entry?.summaryText).toBe('Narrow summary needle');
  });

  it('removes deleted threads from the index instead of re-upserting stale rows', async () => {
    const { room, thread } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(1);

    await act(async () => {
      room.emit(ThreadEvent.Delete, thread);
      await Promise.resolve();
    });

    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(0);
  });

  it('removes an existing entry when a dirty thread can no longer be rebuilt', async () => {
    const { room, thread } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(1);

    room.getThread.mockReturnValue(null);
    room.findEventById.mockReturnValue(undefined);

    await act(async () => {
      room.emit(ThreadEvent.Update, thread);
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(0);
  });

  it('drops queued dirty writes after unmount', async () => {
    const { room, thread } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const before = store.get(crossRoomThreadIndexAtom);
    await act(async () => {
      room.emit(ThreadEvent.Update, thread);
      renderer?.unmount();
      await Promise.resolve();
    });

    expect(store.get(crossRoomThreadIndexAtom)).toBe(before);
  });

  it('drops queued dirty writes when the Matrix client user changes before the microtask flush', async () => {
    const { room, thread } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const before = store.get(crossRoomThreadIndexAtom);
    await act(async () => {
      room.emit(ThreadEvent.Update, thread);
      mx.getUserId.mockReturnValue('@other:example.org');
      await Promise.resolve();
    });

    expect(store.get(crossRoomThreadIndexAtom)).toBe(before);
  });

  it('clears the previous account index before the next account bootstrap runs', async () => {
    const { room: roomA } = makeRoom('!room-a:example.org');
    const mxA = makeClient(roomA);
    matrixClientMock.mockReturnValue(mxA);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [roomA.roomId] });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(1);

    await act(async () => {
      renderer?.unmount();
    });

    const { room: roomB } = makeRoom('!room-b:example.org');
    const mxB = makeClient(roomB);
    mxB.getUserId.mockReturnValue('@other:example.org');
    matrixClientMock.mockReturnValue(mxB);
    activeSessionMock.mockReturnValue({
      sessionId: 'session-b',
      userId: '@other:example.org',
      baseUrl: 'https://example.org',
      deviceId: 'DEVICE-B',
      accessToken: 'token-b',
      lastUsedAt: 2,
    });
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [roomB.roomId] });

    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
      await Promise.resolve();
    });

    const beforeBootstrap = store.get(crossRoomThreadIndexAtom);
    expect(beforeBootstrap.entries.size).toBe(0);
    expect(beforeBootstrap.bootstrapped).toBe(false);
  });

  it('does not re-register room listeners when recent threads change after bootstrap', async () => {
    const { room } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    room.on.mockClear();
    room.removeListener.mockClear();

    await act(async () => {
      store.set(makeRecentThreadsAtom('@me:example.org'), {
        type: 'BUMP',
        roomId: room.roomId,
        threadId: '$root',
        openedAt: 200,
      });
      await Promise.resolve();
    });

    expect(room.removeListener).not.toHaveBeenCalled();
    expect(room.on).not.toHaveBeenCalled();
  });

  it('only attaches listeners for added rooms when the joined room set grows', async () => {
    const roomFixtures = [
      makeRoom('!room-1:example.org'),
      makeRoom('!room-2:example.org'),
      makeRoom('!room-3:example.org'),
      makeRoom('!room-4:example.org'),
    ];
    const [room1, room2, room3, room4] = roomFixtures.map((fixture) => fixture.room);
    const mx = makeClient([room1, room2, room3, room4]);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, {
      type: 'INITIALIZE',
      rooms: [room1.roomId, room2.roomId, room3.roomId],
    });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    [room1, room2, room3, room4].forEach((room) => {
      room.on.mockClear();
      room.removeListener.mockClear();
    });

    await act(async () => {
      store.set(allRoomsAtom, { type: 'PUT', roomId: room4.roomId });
      await Promise.resolve();
    });

    expect(room1.removeListener).not.toHaveBeenCalled();
    expect(room2.removeListener).not.toHaveBeenCalled();
    expect(room3.removeListener).not.toHaveBeenCalled();
    expect(room1.on).not.toHaveBeenCalled();
    expect(room2.on).not.toHaveBeenCalled();
    expect(room3.on).not.toHaveBeenCalled();
    expect(room4.on).toHaveBeenCalledWith(RoomEvent.Timeline, expect.any(Function));
  });

  it('indexes existing threads in a newly joined room without waiting for a thread event', async () => {
    const { room: roomA } = makeRoom('!room-a:example.org');
    const { room: roomB } = makeRoom('!room-b:example.org');
    const { room: roomC } = makeRoomWithThreads('!room-c:example.org', [
      { id: '$c-root-1', body: 'C root one' },
      { id: '$c-root-2', body: 'C root two' },
    ]);
    const mx = makeClient([roomA, roomB, roomC]);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, {
      type: 'INITIALIZE',
      rooms: [roomA.roomId, roomB.roomId],
    });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(2);

    await act(async () => {
      store.set(allRoomsAtom, { type: 'PUT', roomId: roomC.roomId });
      await Promise.resolve();
    });
    await flushScheduledWork();

    const entries = store.get(crossRoomThreadIndexAtom).entries;
    expect(entries.has(getCrossRoomThreadIndexKey(roomC.roomId, '$c-root-1'))).toBe(true);
    expect(entries.has(getCrossRoomThreadIndexKey(roomC.roomId, '$c-root-2'))).toBe(true);
  });

  it('skips pending local-echo thread roots and indexes the later server event id', async () => {
    const roomId = '!room:example.org';
    const pendingRoot = makeEvent({
      id: `~${roomId}:txn-1`,
      body: 'Pending local root',
      roomId,
      status: 'sending',
    });
    const pendingThread = makeThread(pendingRoot);
    const { room } = makeRoom(roomId, { rootId: pendingRoot.getId() ?? '' });
    room.getThreads.mockReturnValue([pendingThread]);
    room.getThread.mockImplementation((threadRootId: string) =>
      threadRootId === pendingRoot.getId() ? pendingThread : null
    );
    room.findEventById.mockImplementation((eventId: string) =>
      eventId === pendingRoot.getId() ? pendingRoot : undefined
    );

    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(0);

    await act(async () => {
      room.emit(ThreadEvent.New, pendingThread);
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(0);

    const serverRoot = makeEvent({
      id: '$server-root',
      body: 'Server root',
      roomId,
      status: null,
    });
    const serverThread = makeThread(serverRoot);
    room.getThreads.mockReturnValue([serverThread]);
    room.getThread.mockImplementation((threadRootId: string) =>
      threadRootId === '$server-root' ? serverThread : null
    );
    room.findEventById.mockImplementation((eventId: string) =>
      eventId === '$server-root' ? serverRoot : undefined
    );

    await act(async () => {
      room.emit(ThreadEvent.New, serverThread);
      await Promise.resolve();
    });
    await flushScheduledWork();

    const entries = store.get(crossRoomThreadIndexAtom).entries;
    expect(entries.has(getCrossRoomThreadIndexKey(room.roomId, pendingRoot.getId() ?? ''))).toBe(
      false
    );
    expect(entries.has(getCrossRoomThreadIndexKey(room.roomId, '$server-root'))).toBe(true);
  });

  it('promotes an own pending first reply when its local echo arrives before SDK thread events', async () => {
    const roomId = '!room:example.org';
    const relationEvents: MatrixEvent[] = [];
    const pendingReply = makeEvent({
      id: '~pending-reply',
      body: 'Pending reply',
      roomId,
      sender: '@me:example.org',
      status: 'sending',
      threadRootId: '$root',
      ts: Date.now(),
    });
    const { room, thread } = makeRoom(roomId, { relationEvents });
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    expect(thread.events).toHaveLength(0);
    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();

    const initialEntry = store
      .get(crossRoomThreadIndexAtom)
      .entries.get(getCrossRoomThreadIndexKey(room.roomId, '$root'));
    expect(initialEntry?.threadRecord.status.replyCount).toBe(0);
    expect(initialEntry?.threadRecord.status.hasPendingSend).toBe(false);
    expect(isCrossRoomThreadEntryEligible(initialEntry!)).toBe(false);

    await act(async () => {
      relationEvents.push(pendingReply);
      room.emit(RoomEvent.LocalEchoUpdated, pendingReply, room);
      await Promise.resolve();
    });
    await flushScheduledWork();

    const entry = store
      .get(crossRoomThreadIndexAtom)
      .entries.get(getCrossRoomThreadIndexKey(room.roomId, '$root'));
    expect(entry?.threadRecord.status.replyCount).toBe(0);
    expect(entry?.threadRecord.status.hasPendingSend).toBe(true);
    expect(entry?.lastActivityTs).toBe(pendingReply.getTs());
    expect(isCrossRoomThreadEntryEligible(entry!)).toBe(true);
  });

  it('removes a room from the index when membership leaves', async () => {
    const { room } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(1);

    room.getMyMembership.mockReturnValue('leave');
    await act(async () => {
      mx.emit(RoomEvent.MyMembership, room);
      await Promise.resolve();
    });

    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(0);
  });

  it('removes stale entries when a room leaves the joined room set', async () => {
    const { room } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(1);

    await act(async () => {
      store.set(allRoomsAtom, { type: 'DELETE', roomId: room.roomId });
      await Promise.resolve();
    });

    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(0);
    expect(room.removeListener).toHaveBeenCalledWith(RoomEvent.Timeline, expect.any(Function));
  });

  it('does not resurrect a removed room from queued dirty or global state events', async () => {
    const { room, thread } = makeRoom();
    const mx = makeClient(room);
    matrixClientMock.mockReturnValue(mx);
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [room.roomId] });

    await act(async () => {
      create(React.createElement(Provider, { store }, React.createElement(HookProbe)));
    });
    await flushScheduledWork();
    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(1);

    await act(async () => {
      room.emit(ThreadEvent.Update, thread);
      store.set(allRoomsAtom, { type: 'DELETE', roomId: room.roomId });
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(0);

    await act(async () => {
      mx.emit(
        RoomStateEvent.Events,
        makeEvent({
          id: '$tags',
          content: {},
          eventType: MINDROOM_THREAD_TAGS_EVENT,
          roomId: room.roomId,
        }),
        { roomId: room.roomId }
      );
      await Promise.resolve();
    });
    await flushScheduledWork();

    expect(store.get(crossRoomThreadIndexAtom).entries.size).toBe(0);
  });
});
