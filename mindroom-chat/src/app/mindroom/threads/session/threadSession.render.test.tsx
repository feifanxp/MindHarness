import React, { useEffect, useMemo } from 'react';
import { createClient, Direction, MatrixEvent, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useThreadSession } from './useThreadSession';
import { useThreadTimelineState } from '../useThreadTimelineState';
import type { ThreadOpenRuntime } from './threadSessionTypes';
import { loadThreadCachedSnapshot } from '../eventRepository';

vi.mock('../eventRepository', async (original) => ({
  ...(await original<typeof import('../eventRepository')>()),
  loadThreadCachedSnapshot: vi.fn(() => new Promise(() => {})),
}));
afterEach(() => vi.restoreAllMocks());

const mountThreadSession = async ({
  mx,
  room,
  eventId,
}: {
  mx: ReturnType<typeof createClient>;
  room: Room;
  eventId?: string;
}) => {
  let renderer!: ReactTestRenderer;
  function Harness() {
    const session = useThreadSession({ roomId: room.roomId, threadId: '$root', eventId });
    const timeline = useThreadTimelineState({
      room,
      threadId: '$root',
      threadInitialCacheHydrated: session.snapshot.open.initialCacheHydrated,
      threadInitialSdkLoaded: session.snapshot.open.sdkReady,
      timelineRevision: session.snapshot.timelineRevision,
    });
    const runtime = useMemo<ThreadOpenRuntime>(
      () => ({
        mx,
        room,
        sessionId: 'pending-storage',
        beginCacheWrite: () => vi.fn(),
        reconcile: vi.fn(async () => ({
          repaired: false,
          fetchedCount: 0,
          iterations: 0,
          aborted: false,
        })),
        seed: { waitForExistingOrQueued: () => undefined },
        render: {
          reset: timeline.resetThreadRenderState,
          append: timeline.setSupplementalThreadEvents,
          invalidateTimeline: () => undefined,
        },
        viewport: {
          resetForOpen: () => undefined,
          resetAfterLeave: () => undefined,
          requestLatestPin: () => undefined,
        },
      }),
      [timeline.resetThreadRenderState, timeline.setSupplementalThreadEvents]
    );
    useEffect(() => session.commands.startOpen(runtime), [session.commands, runtime]);
    return (
      <>
        {timeline.threadEvents.map((event) => (
          <span key={event.getId()}>{event.getContent().body}</span>
        ))}
      </>
    );
  }
  await act(async () => {
    renderer = create(<Harness />);
  });
  return {
    bodies: () => renderer.root.findAllByType('span').map((node) => node.children.join('')),
    unmount: () => act(() => renderer.unmount()),
  };
};

it.each(['pending', 'missed'] as const)(
  "renders SDK-loaded replies while the open's history refresh stalls and storage is %s",
  async (storage) => {
    const support = Thread.hasServerSideSupport;
    const forwardSupport = Thread.hasServerSideFwdPaginationSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
    let view: Awaited<ReturnType<typeof mountThreadSession>> | undefined;
    try {
      const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
      const room = new Room('!room:example.org', mx, '@alice:example.org', {
        timelineSupport: true,
      });
      vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
      const rawRoot = {
        unsigned: {},
        event_id: '$root',
        room_id: room.roomId,
        sender: '@alice:example.org',
        type: 'm.room.message',
        origin_server_ts: 1,
        content: { body: 'Root', msgtype: 'm.text' },
      };
      const rawReplies = [2, 3].map((index) => ({
        ...rawRoot,
        event_id: `$reply-${index}`,
        origin_server_ts: index,
        content: {
          body: `Reply ${index}`,
          msgtype: 'm.text',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        },
      }));
      rawRoot.unsigned = {
        'm.relations': {
          'm.thread': { count: 2, current_user_participated: true, latest_event: rawReplies[1] },
        },
      };
      const root = new MatrixEvent(rawRoot);
      vi.spyOn(room, 'findEventById').mockImplementation((id) =>
        id === '$root' ? root : undefined
      );
      const thread = room.createThread('$root', root, [], false);
      thread.initialEventsFetched = true;
      thread.replayEvents = null;
      thread.timelineSet.addEventsToTimeline([root], true, false, thread.liveTimeline, null);
      // Cold start on iOS: the reply page arrives late, the SDK then indexes every reply,
      // and the open's next history page stays queued behind background thread fetches.
      let finishReplies!: () => void;
      const replyPage = new Promise<object>((resolve) => {
        finishReplies = () => resolve({ chunk: [...rawReplies].reverse(), next_batch: 'older' });
      });
      vi.spyOn(mx, 'fetchRelations').mockImplementation(((
        _roomId: string,
        _eventId: string,
        _rel: unknown,
        _type: unknown,
        opts?: { dir?: Direction; from?: string }
      ) =>
        opts?.dir === Direction.Backward && !opts.from
          ? replyPage
          : new Promise(() => {})) as never);
      if (storage === 'missed')
        vi.mocked(loadThreadCachedSnapshot).mockResolvedValueOnce(undefined);

      view = await mountThreadSession({ mx, room });
      expect(view.bodies()).not.toContain('Reply 2');
      await act(async () => finishReplies());

      expect(thread.events.map((event) => event.getId()).sort()).toEqual([
        '$reply-2',
        '$reply-3',
        '$root',
      ]);
      expect(view.bodies()).toEqual(['Root', 'Reply 2', 'Reply 3']);
    } finally {
      view?.unmount();
      Thread.hasServerSideSupport = support;
      Thread.hasServerSideFwdPaginationSupport = forwardSupport;
    }
  }
);

it.each(['reply', 'root', 'joined-reply', 'pending-bootstrap'] as const)(
  'renders the available %s through the real render hook while storage stays pending',
  async (mode) => {
    const support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport =
      mode === 'joined-reply' || mode === 'pending-bootstrap'
        ? FeatureSupport.Stable
        : FeatureSupport.None;
    const mx = createClient({
      baseUrl: 'https://example.org',
      userId: '@alice:example.org',
    });
    const room = new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true });
    vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
    const rawRoot = {
      unsigned: {},
      event_id: '$root',
      room_id: room.roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { body: 'Root', msgtype: 'm.text' },
    };
    const root = new MatrixEvent(rawRoot);
    const rawReply = {
      ...rawRoot,
      event_id: '$reply',
      origin_server_ts: 2,
      content: {
        body: 'Fetched reply',
        msgtype: 'm.text',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    };
    const reply = new MatrixEvent(rawReply);
    vi.spyOn(mx, 'fetchRoomEvent').mockImplementation(() =>
      mode === 'pending-bootstrap' ? new Promise(() => {}) : Promise.resolve(rawRoot)
    );
    let finishFallback!: () => void;
    const fallback = new Promise<{ chunk: typeof rawReply[] }>((resolve) => {
      finishFallback = () => resolve({ chunk: [rawReply] });
    });
    vi.spyOn(mx, 'fetchRelations').mockImplementation(() => fallback);
    vi.spyOn(room, 'findEventById').mockImplementation((id) => (id === '$root' ? root : undefined));
    const thread =
      mode === 'reply' || mode === 'pending-bootstrap'
        ? room.createThread('$root', root, [], false)
        : undefined;
    vi.spyOn(mx, 'getThreadTimeline').mockImplementation(async () => {
      if (mode === 'joined-reply') {
        const createdThread = room.getThread('$root')!;
        const existing = createdThread.timelineSet.getTimelineForEvent('$root');
        if (existing) return existing;
        const detached = createdThread.timelineSet.addTimeline();
        createdThread.timelineSet.addEventsToTimeline([reply, root], true, false, detached, null);
        return detached;
      }
      if (!thread) return new Promise(() => {});
      // getThreadTimeline fills the timeline directly, without Thread.NewReply.
      thread.timelineSet.addEventsToTimeline([reply], true, false, thread.liveTimeline, null);
      return thread.liveTimeline;
    });
    vi.spyOn(mx, 'getEventTimeline').mockResolvedValue(room.getLiveTimeline());
    const persist = vi.fn();
    let renderer!: ReactTestRenderer;
    let sdkReady = false;
    let cacheHydrated = false;
    function Harness() {
      const session = useThreadSession({
        roomId: room.roomId,
        threadId: '$root',
        eventId: mode !== 'root' ? '$reply' : undefined,
      });
      sdkReady = session.snapshot.open.sdkReady;
      cacheHydrated = session.snapshot.open.initialCacheHydrated;
      const timeline = useThreadTimelineState({
        room,
        threadId: '$root',
        threadInitialCacheHydrated: session.snapshot.open.initialCacheHydrated,
        threadInitialSdkLoaded: session.snapshot.open.sdkReady,
        timelineRevision: session.snapshot.timelineRevision,
      });
      const runtime = useMemo<ThreadOpenRuntime>(
        () => ({
          mx,
          room,
          sessionId: 'pending-storage',
          beginCacheWrite: () => persist,
          reconcile: vi.fn(async () => ({
            repaired: false,
            fetchedCount: 0,
            iterations: 0,
            aborted: false,
          })),
          seed: { waitForExistingOrQueued: () => undefined },
          render: {
            reset: timeline.resetThreadRenderState,
            append: timeline.setSupplementalThreadEvents,
            invalidateTimeline: () => undefined,
          },
          viewport: {
            resetForOpen: () => undefined,
            resetAfterLeave: () => undefined,
            requestLatestPin: () => undefined,
          },
        }),
        [timeline.resetThreadRenderState, timeline.setSupplementalThreadEvents]
      );
      useEffect(() => session.commands.startOpen(runtime), [session.commands, runtime]);
      return (
        <>
          {timeline.threadEvents.map((event) => (
            <span key={event.getId()}>{event.getContent().body}</span>
          ))}
        </>
      );
    }
    try {
      await act(async () => {
        renderer = create(<Harness />);
      });
      expect(vi.mocked(loadThreadCachedSnapshot)).toHaveBeenCalled();
      if (mode === 'joined-reply') {
        expect(renderer.root.findAllByType('span').map((node) => node.children.join(''))).toEqual([
          'Root',
        ]);
        expect(mx.fetchRelations).toHaveBeenCalled();
        await act(async () => finishFallback());
        expect(
          room
            .getThread('$root')!
            .timelineSet.getLiveTimeline()
            .getNeighbouringTimeline(Direction.Backward)
        ).toBeTruthy();
      }
      if (mode === 'pending-bootstrap') {
        // The open waits for the SDK's own initialization, whose root request never returns.
        expect(mx.getThreadTimeline).not.toHaveBeenCalled();
        await act(async () => {
          thread!.timelineSet.addEventsToTimeline([reply], true, false, thread!.liveTimeline, null);
        });
        expect(sdkReady).toBe(false);
        expect(cacheHydrated).toBe(false);
      }
      if (thread) expect(thread.events).toContain(reply);
      expect(renderer.root.findAllByType('span').map((node) => node.children.join(''))).toContain(
        mode !== 'root' ? 'Fetched reply' : 'Root'
      );
    } finally {
      if (renderer) act(() => renderer.unmount());
      Thread.hasServerSideSupport = support;
    }
  }
);
