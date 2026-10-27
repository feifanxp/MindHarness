import React, { useLayoutEffect } from 'react';
import { createClient, Direction, EventStatus, MatrixEvent, Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useThreadSession } from './useThreadSession';
import type { ThreadOpenRuntime, ThreadRoute, ThreadSession } from './threadSessionTypes';
import { useThreadOpenLifecycleController } from '../threadOpenLifecycleController';
import { loadThreadCachedSnapshot } from '../eventRepository';
import * as timelineDebug from '../timelineDebug';

vi.mock('../eventRepository', async (original) => ({
  ...(await original<typeof import('../eventRepository')>()),
  loadThreadCachedSnapshot: vi.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const openFixture = () => {
  const mx = createClient({ baseUrl: 'https://example.org' });
  const room = new Room('!room:example.org', mx, '@user:example.org');
  const root = new MatrixEvent({
    event_id: '$a',
    room_id: room.roomId,
    sender: '@user:example.org',
    origin_server_ts: 1,
    type: 'm.room.message',
    content: { body: 'Root', msgtype: 'm.text' },
  });
  const reply = new MatrixEvent({
    event_id: '$reply',
    room_id: room.roomId,
    sender: '@user:example.org',
    origin_server_ts: 2,
    type: 'm.room.message',
    content: {
      body: 'Reply',
      msgtype: 'm.text',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$a' },
    },
  });
  const timeline = room.getLiveTimeline();
  const thread = {
    rootEvent: root,
    events: [reply],
    initialize: () => undefined,
    getUnfilteredTimelineSet: () => room.getUnfilteredTimelineSet(),
  };
  vi.spyOn(room, 'getThread').mockImplementation(() => thread as never);
  vi.spyOn(room, 'findEventById').mockImplementation((id) => (id === '$a' ? root : undefined));
  const bootstrap = vi.spyOn(mx, 'getThreadTimeline').mockResolvedValue(timeline);
  const context = vi.spyOn(mx, 'getEventTimeline').mockResolvedValue(timeline);
  vi.spyOn(mx, 'fetchRelations').mockResolvedValue({ chunk: [] });
  const rendered = new Map<string, MatrixEvent>();
  const persist = vi.fn();
  const runtime: ThreadOpenRuntime = {
    mx,
    room,
    sessionId: 'session',
    beginCacheWrite: () => persist,
    reconcile: vi.fn(async () => ({
      repaired: false,
      fetchedCount: 0,
      iterations: 1,
      aborted: false,
    })),
    seed: { waitForExistingOrQueued: () => undefined },
    render: {
      reset: vi.fn(() => rendered.clear()),
      append: vi.fn((_id, events) =>
        events.forEach((event) => rendered.set(event.getId()!, event))
      ),
      invalidateTimeline: vi.fn(),
    },
    viewport: { resetForOpen: vi.fn(), resetAfterLeave: vi.fn(), requestLatestPin: vi.fn() },
  };
  const cache = (complete = true) => ({
    events: [root, reply],
    cachedPage: {
      events: [reply.event],
      rootEvent: root.event,
      hasMoreBefore: !complete,
      beforeToken: complete ? null : 'older',
      tailLoaded: complete,
      snapshotComplete: complete,
      relationSnapshotComplete: complete,
      expectedReplyCount: 1,
    },
  });
  return { runtime, root, reply, timeline, bootstrap, context, rendered, cache };
};

const renderOpen = (runtime: ThreadOpenRuntime, initialRoute: ThreadRoute) => {
  let session!: ThreadSession;
  let renderer!: ReactTestRenderer;
  const index = new Map<string, number>();
  const targetIndexes: Array<number | undefined> = [];
  function Harness({ route }: { route: ThreadRoute }) {
    session = useThreadSession(route);
    useLayoutEffect(() => {
      index.set('$reply', 7);
    });
    useThreadOpenLifecycleController({ route, commands: session.commands, runtime });
    useLayoutEffect(() => {
      const pending = session.targets.getPending();
      if (pending) targetIndexes.push(index.get(pending.eventId));
    });
    return null;
  }
  act(() => {
    renderer = create(<Harness route={initialRoute} />);
  });
  return {
    get session() {
      return session;
    },
    targetIndexes,
    rerender(route: ThreadRoute) {
      act(() => renderer.update(<Harness route={route} />));
    },
    unmount() {
      act(() => renderer.unmount());
    },
  };
};

function renderSession(initialRoute: ThreadRoute) {
  let session: ThreadSession;
  let renderer: ReactTestRenderer;
  function Harness({ route }: { route: ThreadRoute }) {
    session = useThreadSession(route);
    return null;
  }
  act(() => {
    renderer = create(<Harness route={initialRoute} />);
  });
  return {
    get session() {
      return session;
    },
    rerender(route: ThreadRoute) {
      act(() => renderer.update(<Harness route={route} />));
    },
    unmount() {
      act(() => renderer.unmount());
    },
  };
}

describe('thread session targets', () => {
  it('keeps replacement targets safe from an older completion and retry', () => {
    const view = renderSession({ roomId: '!room', threadId: '$a' });
    const onScroll = vi.fn();
    const { targets, commands } = view.session;
    act(() => targets.queue({ threadId: '$a', eventId: '$reply', highlight: true, onScroll }));
    const first = targets.getPending()!;
    act(() => targets.advanceAttempt(first.requestId));
    expect(targets.getPending()?.attempts).toBe(1);
    act(() => targets.queue({ threadId: '$a', eventId: '$next', highlight: false }));
    const revision = view.session.snapshot.targetRevision;
    act(() => {
      targets.complete(first.requestId, true);
      targets.wakeRetry(first.requestId);
    });
    expect(targets.getPending()?.eventId).toBe('$next');
    expect(view.session.snapshot.targetRevision).toBe(revision);
    expect(onScroll).not.toHaveBeenCalled();
    expect(view.session.targets).toBe(targets);
    expect(view.session.commands).toBe(commands);
    view.unmount();
  });

  it('completes exact requests once and discards silently', () => {
    const view = renderSession({ roomId: '!room', threadId: '$a' });
    const { targets } = view.session;
    const onScroll = vi.fn();
    act(() => targets.queue({ threadId: '$a', eventId: '$reply', highlight: true, onScroll }));
    const first = targets.getPending()!;
    expect(first).not.toHaveProperty('onScroll');
    const revision = view.session.snapshot.targetRevision;
    act(() => targets.wakeRetry(first.requestId));
    expect(view.session.snapshot.targetRevision).toBe(revision + 1);
    act(() => {
      targets.complete(first.requestId, false);
      targets.complete(first.requestId, true);
    });
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onScroll).toHaveBeenCalledWith(false);
    expect(targets.getPending()).toBeUndefined();
    act(() => targets.queue({ threadId: '$a', eventId: '$reply', highlight: true, onScroll }));
    act(() => targets.discard(targets.getPending()!.requestId));
    expect(targets.getPending()).toBeUndefined();
    expect(onScroll).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('does not expose a usable data lease before runtime binding', () => {
    const view = renderSession({ roomId: '!room', threadId: '$a' });
    expect(view.session.commands.captureLease()).toBeUndefined();
    view.unmount();
  });
});

describe('thread session opening', () => {
  it('rejects SDK publication after route ownership changes before cleanup', async () => {
    const fixture = openFixture();
    vi.mocked(fixture.runtime.room.getThread).mockReturnValue(undefined);
    vi.mocked(fixture.runtime.room.findEventById).mockReturnValue(undefined);
    const context = deferred<typeof fixture.timeline>();
    fixture.context.mockReturnValue(context.promise);
    vi.mocked(loadThreadCachedSnapshot)
      .mockReset()
      .mockReturnValue(new Promise(() => {}));
    const route = { roomId: fixture.runtime.room.roomId, threadId: '$a' };
    const view = renderSession(route);
    let cleanup!: () => void;
    act(() => {
      cleanup = view.session.commands.startOpen(fixture.runtime);
    });
    view.rerender({ ...route, threadId: '$b' });
    try {
      await act(async () => context.reject(new Error('Old request failed')));
      expect(view.session.snapshot.open.loadError).toBe(false);
      expect(fixture.runtime.render.invalidateTimeline).not.toHaveBeenCalled();
    } finally {
      cleanup();
      view.unmount();
    }
  });

  it.each([true, false])(
    'joins complete cache coverage with a stale server backward cursor (relations proven: %s)',
    async (relationSnapshotComplete) => {
      const fixture = openFixture();
      const bootstrap = deferred<typeof fixture.timeline>();
      fixture.bootstrap.mockReturnValue(bootstrap.promise);
      fixture.timeline.setPaginationToken('stale-older', Direction.Backward);
      const cache = fixture.cache();
      vi.mocked(loadThreadCachedSnapshot)
        .mockReset()
        .mockResolvedValue({
          ...cache,
          // A count-proven page records its known start as hasMoreBefore: false, without a cursor.
          cachedPage: relationSnapshotComplete
            ? cache.cachedPage
            : { ...cache.cachedPage, relationSnapshotComplete, beforeToken: undefined },
        });
      const view = renderOpen(fixture.runtime, {
        roomId: fixture.runtime.room.roomId,
        threadId: '$a',
      });
      try {
        await act(async () => undefined);
        expect(view.session.snapshot.history.hasMoreCachedBack).toBe(false);
        await act(async () => bootstrap.resolve(fixture.timeline));
        expect(fixture.timeline.getPaginationToken(Direction.Backward)).toBeNull();
        expect(view.session.snapshot.history.hasMoreCachedBack).toBe(false);
      } finally {
        view.unmount();
      }
    }
  );

  it('keeps the server cursor when the complete cache starts after the loaded replies', async () => {
    const fixture = openFixture();
    const bootstrap = deferred<typeof fixture.timeline>();
    fixture.bootstrap.mockReturnValue(bootstrap.promise);
    fixture.timeline.setPaginationToken('server-older', Direction.Backward);
    const cache = fixture.cache();
    const laterReply = { ...fixture.reply.event, event_id: '$later', origin_server_ts: 3 };
    vi.mocked(loadThreadCachedSnapshot)
      .mockReset()
      .mockResolvedValue({
        ...cache,
        cachedPage: {
          ...cache.cachedPage,
          events: [laterReply],
          relationSnapshotComplete: false,
          beforeToken: undefined,
        },
      });
    const view = renderOpen(fixture.runtime, {
      roomId: fixture.runtime.room.roomId,
      threadId: '$a',
    });
    try {
      await act(async () => undefined);
      await act(async () => bootstrap.resolve(fixture.timeline));
      expect(fixture.timeline.getPaginationToken(Direction.Backward)).toBe('server-older');
      expect(view.session.snapshot.history.hasMoreCachedBack).toBe(true);
    } finally {
      view.unmount();
    }
  });

  it('reports server failure while storage remains pending', async () => {
    const fixture = openFixture();
    vi.mocked(fixture.runtime.room.getThread).mockReturnValue(undefined);
    vi.mocked(fixture.runtime.room.findEventById).mockReturnValue(undefined);
    fixture.context.mockRejectedValue(new Error('server unavailable'));
    vi.mocked(loadThreadCachedSnapshot)
      .mockReset()
      .mockReturnValue(new Promise(() => {}));
    const view = renderOpen(fixture.runtime, {
      roomId: fixture.runtime.room.roomId,
      threadId: '$a',
    });
    try {
      await act(async () => undefined);
      expect(view.session.snapshot.open.loadError).toBe(true);
      expect(view.session.snapshot.open.latestPending).toBe(false);
    } finally {
      view.unmount();
    }
  });

  it.each([false, true])(
    'late cache preserves server pagination (complete=%s)',
    async (complete) => {
      const fixture = openFixture();
      const pending = deferred<ReturnType<typeof fixture.cache>>();
      vi.mocked(loadThreadCachedSnapshot).mockReset().mockReturnValue(pending.promise);
      fixture.timeline.setPaginationToken('server-older', Direction.Backward);
      vi.spyOn(fixture.runtime.mx, 'paginateEventTimeline').mockResolvedValue(false);
      const view = renderOpen(fixture.runtime, {
        roomId: fixture.runtime.room.roomId,
        threadId: '$a',
      });
      try {
        await act(async () => undefined);
        const history = view.session.snapshot.history;
        expect(history).toEqual({ hasMoreCachedBack: true, tailLoaded: true });
        await act(async () => pending.resolve(fixture.cache(complete)));
        expect(fixture.timeline.getPaginationToken(Direction.Backward)).toBe('server-older');
        expect(view.session.snapshot.history).toEqual(history);
        expect(fixture.rendered.get('$reply')).toBe(fixture.reply);
      } finally {
        view.unmount();
      }
    }
  );

  it.each(['cache-first', 'network-first'] as const)(
    'keeps a complete offline cache usable after server failure (%s)',
    async (order) => {
      const fixture = openFixture();
      Object.assign(fixture.runtime.room.getThread('$a')!, { events: [fixture.root] });
      const cache = deferred<ReturnType<typeof fixture.cache>>();
      const network = deferred<typeof fixture.timeline>();
      vi.mocked(loadThreadCachedSnapshot).mockReset().mockReturnValue(cache.promise);
      fixture.bootstrap.mockReturnValue(network.promise);
      vi.mocked(fixture.runtime.mx.fetchRelations).mockRejectedValue(new Error('offline'));
      const view = renderOpen(fixture.runtime, {
        roomId: fixture.runtime.room.roomId,
        threadId: '$a',
      });
      try {
        const settleCache = () => act(async () => cache.resolve(fixture.cache()));
        const settleNetwork = () => act(async () => network.reject(new Error('offline')));
        if (order === 'cache-first') {
          await settleCache();
          await settleNetwork();
        } else {
          await settleNetwork();
          await settleCache();
        }
        expect(fixture.rendered.get('$reply')).toBe(fixture.reply);
        expect(view.session.snapshot.history.tailLoaded).toBe(true);
        expect(view.session.snapshot.open.loadError).toBe(false);
        expect(view.session.snapshot.open.latestPending).toBe(false);
      } finally {
        view.unmount();
      }
    }
  );

  it('ignores a late cache read after leaving and reopening the same thread', async () => {
    const fixture = openFixture();
    const oldCache = deferred<ReturnType<typeof fixture.cache>>();
    const newCache = deferred<ReturnType<typeof fixture.cache>>();
    vi.mocked(loadThreadCachedSnapshot)
      .mockReset()
      .mockReturnValueOnce(oldCache.promise)
      .mockReturnValueOnce(newCache.promise);
    const route = { roomId: fixture.runtime.room.roomId, threadId: '$a' };
    const view = renderOpen(fixture.runtime, route);
    try {
      view.rerender({ roomId: route.roomId });
      view.rerender(route);
      await act(async () => undefined);
      const stale = fixture.cache();
      stale.events.push(new MatrixEvent({ event_id: '$stale', origin_server_ts: 3 }));
      await act(async () => oldCache.resolve(stale));
      expect(fixture.rendered.has('$stale')).toBe(false);
      expect(view.session.snapshot.open.initialCacheHydrated).toBe(false);
      expect(fixture.runtime.reconcile).not.toHaveBeenCalled();
      await act(async () => newCache.resolve(fixture.cache()));
      expect(view.session.snapshot.open.initialCacheHydrated).toBe(true);
    } finally {
      view.unmount();
    }
  });

  it('loads and publishes server replies while the cache read is still pending', async () => {
    const fixture = openFixture();
    const pending = deferred<ReturnType<typeof fixture.cache>>();
    const thread = fixture.runtime.room.getThread('$a')!;
    Object.assign(thread, { events: [fixture.root] });
    fixture.bootstrap.mockImplementation(async () => {
      Object.assign(thread, { events: [fixture.root, fixture.reply] });
      return fixture.timeline;
    });
    vi.mocked(loadThreadCachedSnapshot).mockReset().mockReturnValue(pending.promise);
    const view = renderOpen(fixture.runtime, {
      roomId: fixture.runtime.room.roomId,
      threadId: '$a',
    });
    try {
      await act(async () => undefined);
      expect(fixture.rendered.get('$reply')).toBe(fixture.reply);
      expect(view.session.snapshot.open.latestPending).toBe(false);
      expect(view.session.snapshot.history.tailLoaded).toBe(true);
    } finally {
      view.unmount();
      await act(async () => pending.resolve(fixture.cache()));
    }
  });

  it('paints cached replies while the SDK is still converting a sync gap token', async () => {
    const fixture = openFixture();
    const reset = deferred<void>();
    Object.assign(fixture.runtime.room.getThread('$a')!, {
      events: [],
      flushPendingTimelineReset: vi.fn().mockReturnValueOnce(reset.promise),
    });
    vi.mocked(loadThreadCachedSnapshot).mockReset().mockResolvedValue(fixture.cache());
    const view = renderOpen(fixture.runtime, {
      roomId: fixture.runtime.room.roomId,
      threadId: '$a',
    });
    try {
      await act(async () => undefined);
      expect(fixture.rendered.get('$reply')).toBe(fixture.reply);
      expect(fixture.bootstrap).not.toHaveBeenCalled();
      await act(async () => reset.resolve());
      expect(view.session.snapshot.open.initialCacheHydrated).toBe(true);
      expect(fixture.runtime.reconcile).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      await act(async () => reset.resolve());
    }
  });

  it('publishes SDK root-ready tail coverage and one timeline revision/invalidation for a confirmed pending root', async () => {
    vi.mocked(loadThreadCachedSnapshot).mockReset();
    const fixture = openFixture();
    fixture.root.setStatus(EventStatus.SENDING);
    const cache = deferred<undefined>();
    vi.mocked(loadThreadCachedSnapshot).mockReturnValue(cache.promise);
    const view = renderOpen(fixture.runtime, {
      roomId: fixture.runtime.room.roomId,
      threadId: '$a',
    });
    expect(view.session.snapshot.history.tailLoaded).toBe(true);
    await act(async () => cache.resolve(undefined));
    expect(view.session.snapshot.history.tailLoaded).toBe(true);
    expect(view.session.snapshot.timelineRevision).toBe(1);
    expect(fixture.runtime.render.invalidateTimeline).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.viewport.requestLatestPin).toHaveBeenCalledTimes(1);
    expect(view.session.snapshot.open.sdkReady).toBe(true);
    expect(fixture.bootstrap).not.toHaveBeenCalled();
    expect(fixture.context).not.toHaveBeenCalled();
    expect(fixture.runtime.reconcile).toHaveBeenCalledTimes(1);
    expect(view.session.snapshot.open.latestPending).toBe(false);
    view.unmount();
  });

  it.each(['navigate', 'leave', 'unmount'] as const)(
    'rejects latest refresh UI publication after synchronous %s while retaining completed persistence',
    async (transition) => {
      const fixture = openFixture();
      const route = { roomId: fixture.runtime.room.roomId, threadId: '$a' };
      const view = renderSession(route);
      let refresh!: Promise<boolean>;
      act(() => {
        refresh = view.session.commands.refreshLatest('$a', fixture.runtime);
        if (transition === 'unmount') view.unmount();
        else
          view.rerender(
            transition === 'leave' ? { roomId: route.roomId } : { ...route, threadId: '$b' }
          );
      });
      // No token means the helper has already persisted, before its owner's continuation.
      expect(fixture.runtime.beginCacheWrite()).toHaveBeenCalledTimes(1);
      const snapshot = view.session.snapshot;
      await act(async () => {
        expect(await refresh).toBe(false);
      });
      expect(fixture.runtime.render.append).not.toHaveBeenCalled();
      expect(fixture.rendered.size).toBe(0);
      expect(view.session.snapshot.history).toEqual(snapshot.history);
      expect(view.session.snapshot.timelineRevision).toBe(snapshot.timelineRevision);
      expect(fixture.runtime.render.invalidateTimeline).not.toHaveBeenCalled();
      if (transition !== 'unmount') view.unmount();
    }
  );

  it('commits cache pages by identity and rejects pages from a departed data lifetime', async () => {
    vi.mocked(loadThreadCachedSnapshot).mockReset();
    const fixture = openFixture();
    const pending = deferred<ReturnType<typeof fixture.cache>>();
    vi.mocked(loadThreadCachedSnapshot).mockReturnValue(pending.promise);
    const route = { roomId: fixture.runtime.room.roomId, threadId: '$a' };
    const view = renderOpen(fixture.runtime, route);
    const lease = view.session.commands.captureLease()!;
    act(() => view.session.commands.beginManualHistoryRead());
    expect(view.session.snapshot.open.latestPending).toBe(false);
    act(() => {
      expect(
        view.session.commands.commitPage(lease, {
          kind: 'back-cache',
          events: [fixture.reply],
          hasMoreCachedBack: true,
        })
      ).toBe(true);
    });
    expect(fixture.rendered.get('$reply')).toBe(fixture.reply);
    expect(view.session.snapshot.history.hasMoreCachedBack).toBe(true);
    act(() => view.session.commands.markBackwardExhausted(lease));
    expect(view.session.snapshot.history.hasMoreCachedBack).toBe(false);
    view.rerender({ roomId: route.roomId });
    act(() => {
      expect(
        view.session.commands.commitPage(lease, { kind: 'front-network', tailLoaded: true })
      ).toBe(false);
    });
    expect(view.session.snapshot.history.tailLoaded).toBe(false);
    view.unmount();
    await act(async () => pending.resolve(fixture.cache()));
  });

  it('reports a missing SDK context and settles latest-open loading after cache miss', async () => {
    vi.mocked(loadThreadCachedSnapshot).mockReset().mockResolvedValue(undefined);
    const fixture = openFixture();
    vi.mocked(fixture.runtime.room.getThread).mockReturnValue(undefined);
    vi.mocked(fixture.runtime.room.findEventById).mockReturnValue(undefined);
    fixture.context.mockRejectedValue(new Error('context unavailable'));
    const view = renderOpen(fixture.runtime, {
      roomId: fixture.runtime.room.roomId,
      threadId: '$a',
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.session.snapshot.open).toMatchObject({
      loadError: true,
      initialCacheHydrated: true,
      latestPending: false,
    });
    expect(fixture.runtime.reconcile).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('seeds local echo roots without server-thread resets or cache/bootstrap requests', () => {
    const log = vi.spyOn(timelineDebug, 'logTimelineDebug');
    vi.mocked(loadThreadCachedSnapshot).mockReset();
    const fixture = openFixture();
    const local = new MatrixEvent({ ...fixture.root.event, event_id: '~local' });
    vi.mocked(fixture.runtime.room.findEventById).mockReturnValue(local);
    const view = renderOpen(fixture.runtime, {
      roomId: fixture.runtime.room.roomId,
      threadId: '~local',
    });
    expect(fixture.rendered.get('~local')).toBe(local);
    expect(view.session.snapshot.open.editResetEpoch).toBe(0);
    expect(fixture.runtime.viewport.resetForOpen).not.toHaveBeenCalled();
    expect(loadThreadCachedSnapshot).not.toHaveBeenCalled();
    expect(fixture.bootstrap).not.toHaveBeenCalled();
    view.unmount();
    const phases = log.mock.calls.map((call) => call[1]);
    log.mockRestore();
    expect(phases).toEqual([
      'thread-open-start',
      'thread-open-complete',
      'thread-open-settled',
      'thread-open-close',
    ]);
  });

  it('refreshes latest while closed only when requested and retains hydrated event identities', async () => {
    const fixture = openFixture();
    const view = renderSession({ roomId: fixture.runtime.room.roomId });
    let refreshed = false;
    await act(async () => {
      refreshed = await view.session.commands.refreshLatest('$a', fixture.runtime);
    });
    expect(refreshed).toBe(false);
    await act(async () => {
      refreshed = await view.session.commands.refreshLatest('$a', fixture.runtime, {
        allowWhenThreadClosed: true,
      });
    });
    expect(refreshed).toBe(true);
    expect(fixture.rendered.get('$reply')).toBe(fixture.reply);
    expect(view.session.snapshot.history.tailLoaded).toBe(true);
    expect(fixture.runtime.beginCacheWrite()).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('paints exact cache instances, schedules one repair, and does not restart for snapshot updates', async () => {
    vi.mocked(loadThreadCachedSnapshot).mockReset();
    const fixture = openFixture();
    const pending = deferred<ReturnType<typeof fixture.cache>>();
    vi.mocked(loadThreadCachedSnapshot).mockReturnValue(pending.promise);
    const route = { roomId: fixture.runtime.room.roomId, threadId: '$a' };
    const view = renderOpen(fixture.runtime, route);
    expect(view.session.snapshot.open.latestPending).toBe(true);
    expect(view.session.snapshot.open.editResetEpoch).toBe(1);
    const lease = view.session.commands.captureLease()!;
    act(() => view.session.commands.notifyEventsChanged());
    expect(loadThreadCachedSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(fixture.cache()));
    expect(view.session.snapshot.open.initialCacheHydrated).toBe(true);
    expect(view.session.snapshot.open.latestPending).toBe(false);
    expect(view.session.snapshot.history).toEqual({ hasMoreCachedBack: false, tailLoaded: true });
    expect(fixture.rendered.get('$reply')).toBe(fixture.reply);
    expect(fixture.runtime.reconcile).toHaveBeenCalledTimes(1);
    const args = vi.mocked(fixture.runtime.reconcile).mock.calls[0][0];
    expect(args.cachedPage?.hydratedEvents?.[1]).toBe(fixture.reply);
    expect(fixture.bootstrap).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.viewport.requestLatestPin).toHaveBeenCalled();
    expect(view.session.commands.isCurrent(lease)).toBe(true);
    view.unmount();
    expect(view.session.commands.isCurrent(lease)).toBe(false);
  });

  it.each(['partial', 'error'] as const)(
    'falls through %s cache to deferred SDK bootstrap',
    async (mode) => {
      vi.mocked(loadThreadCachedSnapshot).mockReset();
      const fixture = openFixture();
      const pending = deferred<ReturnType<typeof fixture.cache>>();
      const sdk = deferred<typeof fixture.timeline>();
      vi.mocked(loadThreadCachedSnapshot).mockReturnValue(pending.promise);
      fixture.bootstrap.mockReturnValue(sdk.promise);
      const view = renderOpen(fixture.runtime, {
        roomId: fixture.runtime.room.roomId,
        threadId: '$a',
        eventId: '$reply',
      });
      await act(async () => {
        if (mode === 'error') pending.reject(new Error('cache unavailable'));
        else pending.resolve(fixture.cache(false));
      });
      expect(view.session.snapshot.open.initialCacheHydrated).toBe(true);
      expect(view.session.snapshot.open.loadError).toBe(false);
      expect(fixture.bootstrap).toHaveBeenCalledTimes(1);
      expect(fixture.runtime.reconcile).toHaveBeenCalledTimes(1);
      if (mode === 'partial') {
        expect(fixture.rendered.get('$reply')).toBe(fixture.reply);
        expect(view.session.snapshot.history.hasMoreCachedBack).toBe(true);
      }
      await act(async () => sdk.resolve(fixture.timeline));
      expect(view.session.snapshot.history.tailLoaded).toBe(true);
      expect(view.session.targets.getPending()?.eventId).toBe('$reply');
      expect(view.targetIndexes.length).toBeGreaterThan(0);
      expect(new Set(view.targetIndexes)).toEqual(new Set([7]));
      view.unmount();
    }
  );

  it('leaves, reopens the same ID, and keeps event-only navigation in the same data lifetime', async () => {
    vi.mocked(loadThreadCachedSnapshot).mockReset();
    const fixture = openFixture();
    const first = deferred<ReturnType<typeof fixture.cache>>();
    vi.mocked(loadThreadCachedSnapshot)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(fixture.cache());
    const route = { roomId: fixture.runtime.room.roomId, threadId: '$a' };
    const view = renderOpen(fixture.runtime, route);
    const firstLease = view.session.commands.captureLease()!;
    view.rerender({ roomId: route.roomId });
    expect(view.session.snapshot.open.editResetEpoch).toBe(2);
    expect(view.session.snapshot.history).toEqual({ hasMoreCachedBack: false, tailLoaded: false });
    expect(view.session.commands.isCurrent(firstLease)).toBe(false);
    expect(fixture.runtime.viewport.resetAfterLeave).toHaveBeenCalledTimes(1);
    view.rerender(route);
    await act(async () => {
      await Promise.resolve();
    });
    const reopened = view.session.commands.captureLease()!;
    expect(reopened.generation).toBeGreaterThan(firstLease.generation);
    expect(view.session.snapshot.open.editResetEpoch).toBe(3);
    await act(async () => first.resolve(fixture.cache()));
    expect(fixture.runtime.reconcile).toHaveBeenCalledTimes(1);
    expect(fixture.rendered.get('$reply')).toBe(fixture.reply);
    view.rerender({ ...route, eventId: '$reply' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.session.commands.isCurrent(reopened)).toBe(true);
    expect(view.session.snapshot.open.editResetEpoch).toBe(4);
    view.unmount();
  });
});
