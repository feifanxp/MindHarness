import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixClient, MatrixEvent, MemoryStore, Room } from 'matrix-js-sdk';
import { Thread, FeatureSupport } from 'matrix-js-sdk/lib/models/thread';
import { it, expect, vi } from 'vitest';
import { useThreadRenderState } from './useThreadRenderState';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';
import { refreshLatestThreadSlice } from './threadOpenCacheController';
import * as timelineDebug from './timelineDebug';

it.each([
  [1, false, false],
  [120, false, false],
  [1, true, false],
  [120, true, false],
  [1, false, true],
  [1, false, 'failed'],
] as const)(
  'loads and persists %i replies across SDK timeline segments (context fails: %s, sync resets: %s)',
  async (replyCount, contextFails, resetDuringFallback) => {
    const previous = Thread.hasServerSideSupport;
    const previousForward = Thread.hasServerSideFwdPaginationSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
    let renderer: ReactTestRenderer | undefined;
    try {
      const userId = '@alice:example.org';
      const roomId = '!room:example.org';
      const rawReply = {
        unsigned: {},
        event_id: '$reply',
        room_id: roomId,
        sender: userId,
        type: 'm.room.message',
        origin_server_ts: 2,
        content: {
          body: 'Reply',
          msgtype: 'm.text',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        },
      };
      const replies = Array.from({ length: replyCount }, (_, index) => ({
        ...rawReply,
        event_id: `$reply-${index}`,
        origin_server_ts: index + 2,
      }));
      const rawRoot = {
        event_id: '$root',
        room_id: roomId,
        sender: userId,
        type: 'm.room.message',
        origin_server_ts: 1,
        content: { body: 'Root', msgtype: 'm.text' },
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: replyCount,
              current_user_participated: true,
              latest_event: replies[replyCount - 1],
            },
          },
        },
      };
      class Client extends MatrixClient {
        constructor() {
          super({
            baseUrl: 'https://example.org',
            store: new MemoryStore(),
            userId,
            fetchFn: async (url) => {
              if (!new URL(String(url)).pathname.includes('/context/'))
                throw new Error('Unexpected network');
              return new Response(
                JSON.stringify({
                  event: rawRoot,
                  state: [],
                  events_before: [],
                  events_after: [],
                  start: 'before-root',
                  end: 'after-root',
                }),
                { headers: { 'Content-Type': 'application/json' } }
              );
            },
          });
          this.clientOpts = { threadSupport: true };
        }
      }
      const mx = new Client();
      const room = new Room(roomId, mx, userId, { timelineSupport: true });
      mx.store.storeRoom(room);
      vi.spyOn(mx, 'fetchRoomEvent').mockResolvedValue(rawRoot);
      vi.spyOn(mx, 'createMessagesRequest').mockImplementation(async (_room, token) => {
        if (resetDuringFallback === 'failed') throw new Error('Token conversion unavailable');
        return { chunk: [], start: `converted:${token}`, end: `converted:${token}` };
      });
      vi.spyOn(mx, 'fetchRelations').mockImplementation(
        async (_room, _root, _relation, _type, opts) => {
          if (opts?.from === 'before-root') return { chunk: [] };
          if (opts?.from === 'after-root') return { chunk: replies.slice(0, 30) };
          if (resetDuringFallback && _relation === 'm.thread')
            room.resetLiveTimeline('sync-back', 'sync-forward');
          const end = opts?.from ? Number(String(opts.from).slice(5)) : replies.length;
          const start = Math.max(0, end - (opts?.limit ?? 50));
          return {
            chunk: replies.slice(start, end).reverse(),
            ...(start ? { next_batch: `page-${start}` } : {}),
          };
        }
      );
      const thread = room.createThread('$root', new MatrixEvent(rawRoot), [], false);
      thread.initialEventsFetched = true;
      thread.replayEvents = null;
      if (contextFails) {
        await mx.getThreadTimeline(thread.getUnfilteredTimelineSet(), '$root');
        vi.spyOn(mx, 'getThreadTimeline').mockRejectedValue(new Error('Context unavailable'));
      }
      // A separate context window must stay excluded until pagination connects it.
      const timelineSet = thread.getUnfilteredTimelineSet();
      timelineSet.addEventsToTimeline(
        [new MatrixEvent({ ...rawReply, event_id: '$detached' })],
        true,
        false,
        timelineSet.addTimeline()
      );
      const debugLog = vi.spyOn(timelineDebug, 'logTimelineDebug');
      let renderedEvents: MatrixEvent[] = [];
      let renderCount = 0;
      const Harness = ({ revision }: { revision: number }) => {
        const state = useThreadRenderState({
          room,
          roomTimelineSet: room.getUnfilteredTimelineSet(),
          threadTimelineSet: timelineSet,
          threadId: '$root',
          thread,
          threadInitialCacheHydrated: false,
          threadInitialSdkLoaded: true,
          timelineRevision: revision,
        });
        renderedEvents = state.threadEvents;
        renderCount += 1;
        return null;
      };
      if (contextFails) {
        act(() => {
          renderer = create(React.createElement(Harness, { revision: 0 }));
        });
        expect(renderedEvents.map((event) => event.getId())).toEqual(['$root']);
      }
      const persist = vi.fn();
      const result = await runThreadOpenSdkBootstrap({
        mx,
        room,
        threadId: '$root',
        debugTraceId: undefined,
        isMounted: () => true,
        persistThreadEventCache: persist,
        pinThreadToBottomOnOpen: vi.fn(),
        setSupplementalThreadEvents: vi.fn(),
        onBootstrap: vi.fn(),
        shouldScrollToLatestOnOpen: false,
      });
      expect(result).toBe(true);
      const latest = await refreshLatestThreadSlice(
        { mx, room, persistThreadEventCache: persist, shouldAbortRefresh: () => false },
        '$root'
      );
      const loadedIds = latest?.events.map((event) => event.getId()) ?? [];
      for (const reply of replies) expect(loadedIds).toContain(reply.event_id);
      expect(new Set(loadedIds).size).toBe(loadedIds.length);
      expect(persist.mock.lastCall?.[1].map((event: MatrixEvent) => event.getId())).toEqual(
        loadedIds
      );
      expect(persist.mock.lastCall?.[5]).toBe(true);

      act(() => {
        const view = React.createElement(Harness, { revision: 1 });
        if (renderer) renderer.update(view);
        else renderer = create(view);
      });
      expect(renderedEvents.map((event) => event.getId())).toEqual([
        '$root',
        ...replies.map((event) => event.event_id),
      ]);
      expect(debugLog).toHaveBeenCalledWith(
        undefined,
        'render-state',
        expect.objectContaining({ sdkThreadCount: loadedIds.length })
      );
      const firstReply = thread.findEventById(replies[0].event_id)!;
      const beforeEdit = renderCount;
      act(() =>
        firstReply.makeReplaced(
          new MatrixEvent({
            ...rawReply,
            event_id: '$edit',
            origin_server_ts: 2000,
            content: {
              msgtype: 'm.text',
              body: '* Streaming update',
              'm.new_content': { msgtype: 'm.text', body: 'Streaming update' },
              'm.relates_to': { rel_type: 'm.replace', event_id: firstReply.getId() },
            },
          })
        )
      );
      expect(renderCount).toBeGreaterThan(beforeEdit);
      expect(
        renderedEvents.find((event) => event.getId() === firstReply.getId())?.getContent().body
      ).toBe('Streaming update');
      await act(async () => {
        thread.addEvent(
          new MatrixEvent({ ...rawReply, event_id: '$new-live', origin_server_ts: 3000 }),
          false
        );
      });
      expect(renderedEvents.map((event) => event.getId())).toEqual([
        '$root',
        ...replies.map((event) => event.event_id),
        '$new-live',
      ]);
    } finally {
      act(() => renderer?.unmount());
      vi.restoreAllMocks();
      Thread.hasServerSideSupport = previous;
      Thread.hasServerSideFwdPaginationSupport = previousForward;
    }
  }
);
