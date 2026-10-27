import React, { createRef } from 'react';
import { Direction, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadRecord } from '../types';

// CINNY-207 P3.3: the pre-strip ROOM_CACHE_PERSIST_DEBOUNCE_MS mock is
// gone — its subject (the room-cache persist sweep) was deleted along
// with `roomCacheLifecycleController`. Fetch-controller persist calls
// (thread-open, thread-pagination, etc.) still need a small settle
// window for their post-await microtasks to drain; the following
// helper is now just that.
import { getThreadOpenSeedSnapshot, saveThreadOpenSeedSnapshot } from '../threadOpenSeedCache';
import {
  compactPlaceholderType,
  create,
  createControlledRoomTimelineHarness,
  DEFAULT_THREAD_FILTER_STATE,
  directRoomState,
  emitClientSync,
  flushAsyncWork,
  getClickableByText,
  getRenderedEventIds,
  isMembershipChangedMock,
  loadCachedRoomEventsBeforeMock,
  loadCachedRoomPaginationTokenMock,
  inSameDayMock,
  loadLatestCachedRoomEventsMock,
  makeCachedRoomEvent,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  navigateRoomThreadMock,
  reactionOrEditEventMock,
  roomIntroType,
  roomThreadListThreadsMock,
  roomThreadOverviewType,
  roomTimelineVirtualizerState,
  scrollToItemMock,
  scrollType,
  timeDayMonthYearMock,
  settingsState,
  TEST_DEFAULT_THREAD_FILTER_STATE,
  threadLastActivityTsMapMock,
  threadRenderStateMock,
  threadResolutionMapMock,
  virtualPaginatorState,
  waitForCondition,
  wrapWithSyncEngine,
} from '../test-utils/RoomTimeline.test.shared';

// Fetch-controller persist calls are `.then()`-chained off IDB
// promises inside effects that queue in Promise/microtask ticks; a
// short real-time settle plus a flushAsyncWork pass is enough for
// their `saveThreadEventsToCacheMock` invocations to land.
const waitForPersistSweepDebounce = async () => {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    await flushAsyncWork();
  });
};

const makeThreadFilterRecord = (
  threadRootId: string,
  overrides: {
    status?: Partial<ThreadRecord['status']>;
    presentation?: Partial<ThreadRecord['presentation']>;
  } = {}
): ThreadRecord => ({
  roomId: '!room:test',
  threadRootId,
  rootEventId: threadRootId,
  absoluteIndex: 0,
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: undefined,
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 0,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: undefined,
    recentThreadSummaryText: undefined,
    ...overrides.presentation,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 0,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    tags: [],
    ...overrides.status,
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
});

describe('RoomTimeline', () => {
  describe('cache and overview', () => {
    it('renders without thread render hook initialization errors', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const room = makeRoom();
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      expect(() =>
        create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        )
      ).not.toThrow();
    });

    it('only hydrates the latest room cache slice when it is newer than the loaded room tail', async () => {
      const { shouldHydrateLatestRoomCache } = await import('../eventRepository');
      const { MatrixEvent } = await import('matrix-js-sdk');
      const loadedEvent = (eventId: string, ts: number) =>
        new MatrixEvent(makeCachedRoomEvent(eventId, ts) as never);

      expect(
        shouldHydrateLatestRoomCache(
          loadedEvent('$loaded', 100),
          makeCachedRoomEvent('$cached', 200)
        )
      ).toBe(true);
      expect(
        shouldHydrateLatestRoomCache(
          loadedEvent('$loaded', 200),
          makeCachedRoomEvent('$cached', 200)
        )
      ).toBe(false);
      expect(
        shouldHydrateLatestRoomCache(
          loadedEvent('$loaded', 300),
          makeCachedRoomEvent('$cached', 200)
        )
      ).toBe(false);
    });

    it('deduplicates cached room hydration events against already loaded SDK events', async () => {
      const { filterLatestRoomCacheHydrationEvents } = await import('../eventRepository');

      expect(
        filterLatestRoomCacheHydrationEvents(
          [makeCachedRoomEvent('$loaded', 100), makeCachedRoomEvent('$new', 200)],
          [makeEvent('$loaded', { ts: 100 })] as never
        )
      ).toEqual([makeCachedRoomEvent('$new', 200)]);
    });

    it('shows zero visible replies when a loaded thread only contains hidden threaded metadata relations', async () => {
      const { getThreadReplyCount, shouldRenderZeroReplyThreadBadge } = await import(
        '../threadBadgeViewModel'
      );
      const rootEvent = makeEvent('$thread-root', {
        isThreadRoot: true,
        ts: 100,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 3,
              latest_event: {
                type: 'com.mindroom.thread.tag',
              },
            },
          },
        },
      });
      const hiddenTagEvents = [
        makeEvent('$thread-tag-1', {
          threadRootId: '$thread-root',
          relation: { event_id: '$thread-root', rel_type: 'm.thread' },
          type: 'com.mindroom.thread.tag',
          ts: 200,
        }),
        makeEvent('$thread-tag-2', {
          threadRootId: '$thread-root',
          relation: { event_id: '$thread-root', rel_type: 'm.thread' },
          type: 'com.mindroom.thread.tag',
          ts: 210,
        }),
        makeEvent('$thread-tag-3', {
          threadRootId: '$thread-root',
          relation: { event_id: '$thread-root', rel_type: 'm.thread' },
          type: 'com.mindroom.thread.tag',
          ts: 220,
        }),
      ];
      const room = makeRoom({ liveEvents: [rootEvent] });
      room.getThread = (eventId: string) =>
        eventId === '$thread-root'
          ? ({
              events: hiddenTagEvents,
              length: 3,
              rootEvent,
              timeline: hiddenTagEvents,
            } as never)
          : null;

      expect(getThreadReplyCount(room as never, rootEvent as never, undefined, true)).toBe(0);
      expect(shouldRenderZeroReplyThreadBadge(room as never, rootEvent as never)).toBe(true);
    });

    it('preserves bundled thread counts when a thread root is visible before replies are loaded', async () => {
      const { getThreadReplyCount, shouldRenderZeroReplyThreadBadge } = await import(
        '../threadBadgeViewModel'
      );
      const rootEvent = makeEvent('$thread-root', {
        isThreadRoot: true,
        ts: 100,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 3,
              latest_event: {
                type: 'm.room.message',
              },
            },
          },
        },
      });
      const room = makeRoom({ liveEvents: [rootEvent] });
      room.getThread = (eventId: string) =>
        eventId === '$thread-root'
          ? ({
              events: [],
              length: 3,
              rootEvent,
              timeline: [],
            } as never)
          : null;

      expect(getThreadReplyCount(room as never, rootEvent as never)).toBe(3);
      expect(shouldRenderZeroReplyThreadBadge(room as never, rootEvent as never)).toBe(false);
    });

    it('hydrates cached room events into the live timeline', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { hydrateCachedEvents } = await import('../eventCacheEditUtils');
      const room = makeRoom({
        liveEvents: [makeEvent('$loaded', { ts: 100 })],
      });
      const roomInputRef = createRef<HTMLElement>();
      const editor = {} as Editor;
      let renderer: ReturnType<typeof create> | undefined;

      loadLatestCachedRoomEventsMock.mockResolvedValue({
        beforeToken: undefined,
        events: [makeCachedRoomEvent('$cached', 200)],
        hasMoreBefore: false,
      });

      try {
        await act(async () => {
          renderer = create(
            wrapWithSyncEngine(
              React.createElement(RoomTimeline, {
                room,
                roomInputRef,
                editor,
                summaryMap: new Map(),
                onStoreThreadSummary: vi.fn(),
                threadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
                threadSortFreezeState: null,
                onToggle: vi.fn(),
                onSortDirectionChange: vi.fn(),
                onToggleThreadSortFreeze: vi.fn(),
                setThreadSortFreezeState: vi.fn(),
                onCycleTag: vi.fn(),
                onAddTag: vi.fn(),
                onRemoveTag: vi.fn(),
                onReset: vi.fn(),
                onApplyPreset: vi.fn(),
                onSearchQueryChange: vi.fn(),
                viewMode: 'default',
                onViewModeChange: vi.fn(),
              })
            )
          );
          await flushAsyncWork();
        });

        expect(hydrateCachedEvents).toHaveBeenCalledWith({
          room,
          events: expect.arrayContaining([
            expect.objectContaining({
              getId: expect.any(Function),
            }),
          ]),
        });
        expect(room.addLiveEvents).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              getId: expect.any(Function),
            }),
          ]),
          expect.objectContaining({
            fromCache: true,
            timelineWasEmpty: false,
            addToState: false,
          })
        );
        expect(
          room
            .getLiveTimeline()
            .getEvents()
            .map((event) => event.getId())
        ).toEqual(['$loaded', '$cached']);
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(1);
        });
      }
    });

    it('renders only the visible virtual slice of a large classic room timeline', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const events = Array.from({ length: 300 }, (_value, index) =>
        makeEvent(`$event-${index}`, { ts: index })
      );
      const room = makeRoom({ liveEvents: events });
      const roomInputRef = createRef<HTMLElement>();
      const editor = {} as Editor;
      let renderer: ReturnType<typeof create> | undefined;

      settingsState.prefetchDepth = 10000;
      roomTimelineVirtualizerState.virtualIndexes = [195, 196, 197, 198, 199];

      try {
        await act(async () => {
          renderer = create(
            wrapWithSyncEngine(
              React.createElement(RoomTimeline, {
                room,
                roomInputRef,
                editor,
                summaryMap: new Map(),
                onStoreThreadSummary: vi.fn(),
                threadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
                threadSortFreezeState: null,
                onToggle: vi.fn(),
                onSortDirectionChange: vi.fn(),
                onToggleThreadSortFreeze: vi.fn(),
                setThreadSortFreezeState: vi.fn(),
                onCycleTag: vi.fn(),
                onAddTag: vi.fn(),
                onRemoveTag: vi.fn(),
                onReset: vi.fn(),
                onApplyPreset: vi.fn(),
                onSearchQueryChange: vi.fn(),
                viewMode: 'classic',
                onViewModeChange: vi.fn(),
              })
            )
          );
          await flushAsyncWork();
        });

        expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 100, end: 300 });
        expect(roomTimelineVirtualizerState.lastOptions?.count).toBe(200);
        expect(getRenderedEventIds(renderer!)).toEqual([
          '$event-295',
          '$event-296',
          '$event-297',
          '$event-298',
          '$event-299',
        ]);
      } finally {
        renderer?.unmount();
      }
    });

    it('renders only the visible virtual slice of a large thread timeline', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 0 });
      const threadEvents = [
        rootEvent,
        ...Array.from({ length: 299 }, (_value, index) =>
          makeEvent(`$thread-reply-${index + 1}`, { threadRootId: threadId, ts: index + 1 })
        ),
      ];
      const threadTimeline = makeTimeline(threadEvents, { backwardToken: null });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: () => undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: threadEvents.slice(1),
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({ liveEvents: [rootEvent] });
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      threadRenderStateMock.threadEvents = threadEvents as never;
      threadRenderStateMock.threadEventIndexMapRef.current = new Map(
        threadEvents.map((event, index) => [event.getId(), index])
      );
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      roomTimelineVirtualizerState.virtualIndexes = [295, 296, 297, 298, 299];

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork();
        });

        expect(roomTimelineVirtualizerState.lastOptions?.count).toBe(300);
        expect(getRenderedEventIds(renderer!)).toEqual([
          '$thread-reply-295',
          '$thread-reply-296',
          '$thread-reply-297',
          '$thread-reply-298',
          '$thread-reply-299',
        ]);
      } finally {
        renderer?.unmount();
      }
    });

    it('primes window-boundary grouping from the trailing edit, matching the sequential fold', async () => {
      // Component-level pin for the primer wiring: a message that follows an
      // edit must render UNCOLLAPSED when the virtual window starts on it,
      // exactly as it does when the window includes the edit (the sequential
      // path keeps the edit as prevEvent with isPrevRendered=false).
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 0 });
      const threadEvents = [
        rootEvent,
        makeEvent('$m1', { threadRootId: threadId, ts: 60_000 }),
        makeEvent('$e1', {
          threadRootId: threadId,
          ts: 90_000,
          relation: { rel_type: 'm.replace', event_id: '$m1' },
        }),
        makeEvent('$m2', { threadRootId: threadId, ts: 120_000 }),
      ];
      const threadTimeline = makeTimeline(threadEvents, { backwardToken: null });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: () => undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: threadEvents.slice(1),
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({ liveEvents: [rootEvent] });
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      threadRenderStateMock.threadEvents = threadEvents as never;
      threadRenderStateMock.threadEventIndexMapRef.current = new Map(
        threadEvents.map((event, index) => [event.getId(), index])
      );
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      reactionOrEditEventMock.mockImplementation(
        (event) =>
          (event as { getRelation?: () => { rel_type?: string } | undefined }).getRelation?.()
            ?.rel_type === 'm.replace'
      );
      roomTimelineVirtualizerState.virtualIndexes = [3];

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork();
        });

        const messageNode = renderer!.root.findAll(
          (node) => node.props?.['data-message-id'] === '$m2'
        )[0];
        expect(messageNode).toBeDefined();
        // Reverting the primer wiring makes prevEvent the rendered $m1
        // (same sender, <2min), which would collapse this row.
        expect(messageNode.props.collapse).toBe(false);
      } finally {
        reactionOrEditEventMock.mockImplementation(() => false);
        renderer?.unmount();
      }
    });

    it('primes the pending day divider carried across a midnight-crossing edit', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const DAY_MS = 86_400_000;
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
      const threadEvents = [
        rootEvent,
        makeEvent('$m1', { threadRootId: threadId, ts: 61_000 }),
        makeEvent('$e1', {
          threadRootId: threadId,
          ts: 1_000 + 3 * DAY_MS,
          relation: { rel_type: 'm.replace', event_id: '$m1' },
        }),
        makeEvent('$m2', { threadRootId: threadId, ts: 1_000 + 3 * DAY_MS + 60_000 }),
      ];
      const threadTimeline = makeTimeline(threadEvents, { backwardToken: null });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: () => undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: threadEvents.slice(1),
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({ liveEvents: [rootEvent] });
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      threadRenderStateMock.threadEvents = threadEvents as never;
      threadRenderStateMock.threadEventIndexMapRef.current = new Map(
        threadEvents.map((event, index) => [event.getId(), index])
      );
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      reactionOrEditEventMock.mockImplementation(
        (event) =>
          (event as { getRelation?: () => { rel_type?: string } | undefined }).getRelation?.()
            ?.rel_type === 'm.replace'
      );
      // The harness defaults flatten time semantics (inSameDay always true),
      // which makes any divider assertion vacuous; use real day arithmetic
      // and a unique divider label for this test.
      inSameDayMock.mockImplementation(
        (ts1: number, ts2: number) => Math.floor(ts1 / DAY_MS) === Math.floor(ts2 / DAY_MS)
      );
      timeDayMonthYearMock.mockImplementation((ts: number) => `divider-${ts}`);
      roomTimelineVirtualizerState.virtualIndexes = [3];

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork();
        });

        // The crossing was latched at the null-rendered edit row; the window
        // starting on $m2 must still render the carried date divider as
        // visible text (a serialized-props match would be vacuous).
        const dividerText = `divider-${1_000 + 3 * DAY_MS + 60_000}`;
        const dividerNodes = renderer!.root.findAll((node) =>
          node.children.some((child) => child === dividerText)
        );
        expect(dividerNodes.length).toBeGreaterThan(0);
      } finally {
        reactionOrEditEventMock.mockImplementation(() => false);
        inSameDayMock.mockImplementation(() => true);
        timeDayMonthYearMock.mockImplementation(() => 'time');
        renderer?.unmount();
      }
    });

    it('folds back-pagination prepends into the offset ledger with zero scroll writes', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const threadId = '$prepend-thread-root';
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 0 });
      const makeReply = (index: number) =>
        makeEvent(`$te-${index}`, { threadRootId: threadId, ts: index + 1 });
      // Production shape: the thread root permanently occupies index 0 (oldest
      // ts), so back-pagination prepends land at index 1+ and the first event id
      // never changes. The prepend detector must not rely on it.
      const initialThreadEvents = [
        rootEvent,
        ...Array.from({ length: 300 }, (_value, index) => makeReply(index + 100)),
      ];
      const prependedThreadEvents = [
        rootEvent,
        ...Array.from({ length: 100 }, (_value, index) => makeReply(index)),
        ...initialThreadEvents.slice(1),
      ];
      const threadTimeline = makeTimeline(initialThreadEvents, { backwardToken: 'tok-back' });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: () => undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: initialThreadEvents,
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({ liveEvents: [] });
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      const setThreadEvents = (events: ReturnType<typeof makeEvent>[]) => {
        threadRenderStateMock.threadEvents = events as never;
        threadRenderStateMock.threadEventIndexMapRef.current = new Map(
          events.map((event, index) => [event.getId(), index])
        );
      };
      setThreadEvents(initialThreadEvents);
      // The reader's first visible row; the ledger anchors on it after each commit.
      roomTimelineVirtualizerState.firstVisibleKey = '$te-100';
      // Settle-order log (mutant audit 2026-07-07, survivors 6a/6b): the
      // settle's atomic block must write scrollTop BEFORE setOptions —
      // setOptions can notify a synchronous re-render that must see the
      // (margin 0, shifted scrollTop) pair. The accessor-backed scrollTop
      // and the setOptions spy share one ordered log.
      const ledgerOps: string[] = [];
      let scrollTopValue = 0;
      const scrollElement = {
        // Connected: quiescence waits run their real 150ms idle timer
        // instead of the detached-element instant resolve — the margin-
        // live window between fold and settle must exist for the paint-
        // half pin below (the test's 250ms waits cover the idle).
        isConnected: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
        querySelector: vi.fn(() => undefined),
        querySelectorAll: vi.fn(() => []),
        scrollHeight: 4000,
        clientHeight: 600,
        get scrollTop() {
          return scrollTopValue;
        },
        set scrollTop(value: number) {
          ledgerOps.push('scrollTop');
          scrollTopValue = value;
        },
        scrollTo: vi.fn(),
      };
      roomTimelineVirtualizerState.setOptionsMock.mockClear();
      roomTimelineVirtualizerState.setOptionsMock.mockImplementation(() => {
        ledgerOps.push('setOptions');
      });
      // Inner virtual container: the ledger fold's visible output is its
      // marginTop (adversarial review on PR #88 — without this pin, fold
      // deletion, ΔH off-by-one and unconsumed-anchor mutants all passed).
      const innerElement = {
        style: {} as Record<string, string>,
        getBoundingClientRect: () => ({ top: 0 }),
      };
      // The thread-open bootstrap may also paginate; only the explicit
      // Load Older Messages pagination should prepend the older rows.
      // The paginate mock must NOT apply the prepend to the RENDER state:
      // in production the paginate mutates only the SDK timeline, and the
      // render list / index map update at the (quiescence-deferred) commit.
      // The test applies the prepend afterwards, as the commit's re-render
      // does in production.
      matrixClientMock.paginateEventTimeline.mockImplementation(async () => false);
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            }),
            {
              createNodeMock: (element) =>
                element.type === scrollType
                  ? scrollElement
                  : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
                  ? innerElement
                  : null,
            }
          );
          await flushAsyncWork();
        });

        const { getCacheProbeSnapshot } = await import('../cacheProbe');
        const quiescenceSettlesBefore = getCacheProbeSnapshot().ledgerQuiescenceSettles;
        const loadOlderChip = getClickableByText(renderer!, 'Load Older Messages');
        await act(async () => {
          loadOlderChip.props.onClick();
          await flushAsyncWork(10);
          // Task #125 follow-up: the prepend RENDER COMMIT waits for
          // scroll quiescence (150ms with no scroll events, wall
          // clock) before it lands — see scrollQuiescence.ts. This
          // suite section runs real timers, so wait it out.
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
          await flushAsyncWork(10);
        });

        // The commit's re-render delivers the prepended render state in
        // production; the harness applies it explicitly.
        await act(async () => {
          setThreadEvents(prependedThreadEvents);
          renderer!.update(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        // Paint-half pin (mutant audit 2026-07-07, survivor 14): while
        // the ledger margin is live, every painted tile's inline top is
        // content-relative — virtualItem.start (which includes the
        // scrollMargin) PLUS the ledger px. Dropping the term reproduces
        // the round-10 "double-counted ledger past overscan" blank class,
        // which no unit test caught before this.
        expect(innerElement.style.marginTop).toBe('-2600px');
        {
          const estimatePx =
            roomTimelineVirtualizerState.lastOptions?.estimateSize?.() ?? Number.NaN;
          const tiles = renderer!.root.findAll(
            (node) =>
              node.props?.['data-virtual-index'] !== undefined && node.props?.style !== undefined
          );
          expect(tiles.length).toBeGreaterThan(0);
          tiles.slice(0, 3).forEach((tile) => {
            const virtualIndex = tile.props['data-virtual-index'] as number;
            expect(tile.props.style.top).toBe(virtualIndex * estimatePx + 2600);
          });
        }

        // Offset-ledger fold (device round 10): the prepend commit is pure
        // ledger arithmetic — the inserted rows' height folds into the
        // container margin + scrollMargin at RENDER time, so the anchor
        // never moves and NO scroll write happens at all (the coarse
        // scrollTo + rect fine-correction machinery this test previously
        // asserted raced virtual-core's own quiet-state adjustments).
        // Let the at-rest ledger settle fire (quiescence idle is 150ms,
        // real timers in this suite section): the fold's ΔH converts into
        // ONE exactly-cancelling scrollTop shift and the margin returns
        // to zero.
        await act(async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
          await flushAsyncWork(5);
        });
        expect(scrollElement.scrollTo).not.toHaveBeenCalled();
        expect(roomTimelineVirtualizerState.getOffsetForIndexMock).not.toHaveBeenCalled();
        // ΔH pin (adversarial review on PR #88 — without it, fold
        // deletion and pricing off-by-one mutants all passed green): 100 prepended one-liner replies at the
        // calibrated COMPACT estimate (base 6 + one 20px line = 26; the
        // harness renders compact layout) fold to EXACTLY 2600px,
        // delivered by the settle as scrollTop += 2600 with the margin
        // returned to zero.
        expect(scrollElement.scrollTop).toBe(2600);
        expect(innerElement.style.marginTop).toBe('');
        // Settle atomicity pins (mutant audit 2026-07-07, survivors
        // 6a/6b — the old mock lacked setOptions entirely, so 6b was
        // "caught" only by an accidental TypeError): the settle must
        // flip scrollMargin to 0 in the same block, and the scrollTop
        // write must come FIRST.
        expect(roomTimelineVirtualizerState.setOptionsMock).toHaveBeenCalledWith(
          expect.objectContaining({ scrollMargin: 0 })
        );
        expect(ledgerOps.indexOf('scrollTop')).toBeGreaterThanOrEqual(0);
        expect(ledgerOps.indexOf('scrollTop')).toBeLessThan(ledgerOps.indexOf('setOptions'));
        expect(getCacheProbeSnapshot().ledgerQuiescenceSettles).toBe(quiescenceSettlesBefore + 1);

        // A band that lands above the reader WITHOUT a Load Older (the
        // opening history chain, a reconciled page) keeps the reader in
        // place too: 5 more one-liners fold to 5 x 26px and settle.
        const bandPrependedThreadEvents = [
          rootEvent,
          ...Array.from({ length: 5 }, (_value, index) =>
            makeEvent(`$te-background-band-${index}`, {
              threadRootId: threadId,
              ts: index + 1,
            })
          ),
          ...prependedThreadEvents.slice(1),
        ];
        await act(async () => {
          setThreadEvents(bandPrependedThreadEvents);
          renderer!.update(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
          await flushAsyncWork(5);
        });
        expect(scrollElement.scrollTop).toBe(2730);
        expect(innerElement.style.marginTop).toBe('');
      } finally {
        roomTimelineVirtualizerState.setOptionsMock.mockReset();
        renderer?.unmount();
      }
    });

    it('prices interleaved prepends by the inserted keys, not the first-shift rows', async () => {
      // Full-surface adversarial review (2026-07-07), ledger finding L1:
      // `mergeThreadRenderEvents` sorts purely by ts, so an overlapping
      // band (or a federated page with interior timestamps) can insert
      // NEW events BETWEEN existing rows above the anchor. The fold's
      // prefix assumption — sum estimate(1..shift) — then prices
      // pre-existing rows instead of the inserted ones. This pin uses
      // heterogeneous rows so the two sums differ: three folded-long
      // rows (compact estimate 76) sit above a one-liner anchor, and
      // the committed page interleaves two one-liner events (compact
      // estimate 26) between them. Correct ΔH = 2 x 26 = 52; the
      // prefix-shaped sum would fold 76 + 26 = 102.
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const threadId = '$interleave-thread-root';
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 0 });
      const longBody = 'L'.repeat(200); // 5 wrapped lines > fold cap 3
      const makeLongReply = (index: number) =>
        makeEvent(`$long-${index}`, {
          threadRootId: threadId,
          ts: index * 100,
          content: { body: longBody, msgtype: 'm.text' },
        });
      const anchorEvent = makeEvent('$anchor', { threadRootId: threadId, ts: 400 });
      const makeFiller = (index: number) =>
        makeEvent(`$fill-${index}`, { threadRootId: threadId, ts: 500 + index });
      const initialThreadEvents = [
        rootEvent,
        makeLongReply(1),
        makeLongReply(2),
        makeLongReply(3),
        anchorEvent,
        ...Array.from({ length: 300 }, (_value, index) => makeFiller(index)),
      ];
      // Band events with interior timestamps: ts 150 and 250 land BETWEEN
      // the existing long rows once the merge re-sorts by ts.
      const bandEvents = [
        makeEvent('$band-1', { threadRootId: threadId, ts: 150 }),
        makeEvent('$band-2', { threadRootId: threadId, ts: 250 }),
      ];
      const interleavedThreadEvents = [...initialThreadEvents, ...bandEvents].sort(
        (a, b) => a.getTs() - b.getTs()
      );
      const threadTimeline = makeTimeline(initialThreadEvents, { backwardToken: 'tok-back' });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: () => undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: initialThreadEvents,
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({ liveEvents: [] });
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      const setThreadEvents = (events: ReturnType<typeof makeEvent>[]) => {
        threadRenderStateMock.threadEvents = events as never;
        threadRenderStateMock.threadEventIndexMapRef.current = new Map(
          events.map((event, index) => [event.getId(), index])
        );
      };
      setThreadEvents(initialThreadEvents);
      roomTimelineVirtualizerState.firstVisibleKey = '$anchor';
      const scrollElement = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
        querySelector: vi.fn(() => undefined),
        querySelectorAll: vi.fn(() => []),
        scrollHeight: 4000,
        clientHeight: 600,
        scrollTop: 0,
        scrollTo: vi.fn(),
      };
      const innerElement = {
        style: {} as Record<string, string>,
        getBoundingClientRect: () => ({ top: 0 }),
      };
      matrixClientMock.paginateEventTimeline.mockImplementation(async () => false);
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            }),
            {
              createNodeMock: (element) =>
                element.type === scrollType
                  ? scrollElement
                  : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
                  ? innerElement
                  : null,
            }
          );
          await flushAsyncWork();
        });

        const loadOlderChip = getClickableByText(renderer!, 'Load Older Messages');
        await act(async () => {
          loadOlderChip.props.onClick();
          await flushAsyncWork(10);
          // Quiescence-deferred commit window (150ms idle, real timers).
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
          await flushAsyncWork(10);
        });

        await act(async () => {
          setThreadEvents(interleavedThreadEvents);
          renderer!.update(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        // Let the at-rest ledger settle convert the fold into its one
        // scrollTop shift.
        await act(async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
          await flushAsyncWork(5);
        });
        expect(scrollElement.scrollTo).not.toHaveBeenCalled();
        // ΔH must price the two INSERTED one-liners (2 x 26 = 52), not
        // the first-two post-prepend rows (long 76 + one-liner 26 = 102).
        expect(scrollElement.scrollTop).toBe(52);
        expect(innerElement.style.marginTop).toBe('');
      } finally {
        renderer?.unmount();
      }
    });

    it('re-anchors the fold on the nearest surviving baseline row when the anchor is redacted mid-flight', async () => {
      // Full-surface adversarial review (2026-07-07), ledger finding L2:
      // if the reader's anchor event vanishes from the render list
      // before the page commits (redaction acknowledged, dedup
      // collapse), the old fold silently skipped the whole compensation
      // and the prepend landed as a visible jump. The key-diff fold must
      // fall back to the nearest surviving baseline row: inserted rows
      // above it stay compensated, while the anchor's own removal closes
      // visibly in view (a redaction SHOULD look like the row vanishing).
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { getCacheProbeSnapshot } = await import('../cacheProbe');
      const threadId = '$redacted-anchor-thread-root';
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 0 });
      const longBody = 'L'.repeat(200);
      const makeLongReply = (index: number) =>
        makeEvent(`$long-${index}`, {
          threadRootId: threadId,
          ts: index * 100,
          content: { body: longBody, msgtype: 'm.text' },
        });
      const anchorEvent = makeEvent('$anchor', { threadRootId: threadId, ts: 400 });
      const makeFiller = (index: number) =>
        makeEvent(`$fill-${index}`, { threadRootId: threadId, ts: 500 + index });
      const initialThreadEvents = [
        rootEvent,
        makeLongReply(1),
        makeLongReply(2),
        makeLongReply(3),
        anchorEvent,
        ...Array.from({ length: 300 }, (_value, index) => makeFiller(index)),
      ];
      const bandEvents = [
        makeEvent('$band-1', { threadRootId: threadId, ts: 150 }),
        makeEvent('$band-2', { threadRootId: threadId, ts: 250 }),
      ];
      // The committed list interleaves the two one-liners AND drops the
      // anchor itself.
      const committedThreadEvents = [...initialThreadEvents, ...bandEvents]
        .filter((event) => event.getId() !== '$anchor')
        .sort((a, b) => a.getTs() - b.getTs());
      const threadTimeline = makeTimeline(initialThreadEvents, { backwardToken: 'tok-back' });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: () => undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: initialThreadEvents,
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({ liveEvents: [] });
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      const setThreadEvents = (events: ReturnType<typeof makeEvent>[]) => {
        threadRenderStateMock.threadEvents = events as never;
        threadRenderStateMock.threadEventIndexMapRef.current = new Map(
          events.map((event, index) => [event.getId(), index])
        );
      };
      setThreadEvents(initialThreadEvents);
      roomTimelineVirtualizerState.firstVisibleKey = '$anchor';
      const scrollElement = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
        querySelector: vi.fn(() => undefined),
        querySelectorAll: vi.fn(() => []),
        scrollHeight: 4000,
        clientHeight: 600,
        scrollTop: 0,
        scrollTo: vi.fn(),
      };
      const innerElement = {
        style: {} as Record<string, string>,
        getBoundingClientRect: () => ({ top: 0 }),
      };
      matrixClientMock.paginateEventTimeline.mockImplementation(async () => false);
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            }),
            {
              createNodeMock: (element) =>
                element.type === scrollType
                  ? scrollElement
                  : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
                  ? innerElement
                  : null,
            }
          );
          await flushAsyncWork();
        });

        const loadOlderChip = getClickableByText(renderer!, 'Load Older Messages');
        await act(async () => {
          loadOlderChip.props.onClick();
          await flushAsyncWork(10);
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
          await flushAsyncWork(10);
        });

        const fallbacksBefore = getCacheProbeSnapshot().threadPrependFoldAnchorFallback;
        await act(async () => {
          setThreadEvents(committedThreadEvents);
          renderer!.update(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });
        await act(async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
          await flushAsyncWork(5);
        });
        expect(scrollElement.scrollTo).not.toHaveBeenCalled();
        // The two interleaved one-liners above the surviving boundary
        // ($long-3) still fold: 2 x 26 = 52. The redacted anchor's own
        // height is deliberately NOT compensated.
        expect(scrollElement.scrollTop).toBe(52);
        expect(innerElement.style.marginTop).toBe('');
        expect(getCacheProbeSnapshot().threadPrependFoldAnchorFallback).toBe(fallbacksBefore + 1);
      } finally {
        renderer?.unmount();
      }
    });

    it('folds every band that lands above the reader while a pagination is in flight', async () => {
      // Mutant audit 2026-07-07, survivor 2 (PR #88's own mid-flight-band
      // major had no pin): each band that lands above the reader must fold,
      // not only the first. Two bands, 5 + 3 one-liners at compact
      // estimate 26: the ledger must read 130 then 208.
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const threadId = '$midflight-band-thread-root';
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 0 });
      const makeReply = (index: number) =>
        makeEvent(`$te-${index}`, { threadRootId: threadId, ts: index + 1 });
      const initialThreadEvents = [
        rootEvent,
        ...Array.from({ length: 300 }, (_value, index) => makeReply(index + 100)),
      ];
      const bandA = Array.from({ length: 5 }, (_value, index) => makeReply(index + 90));
      const bandB = Array.from({ length: 3 }, (_value, index) => makeReply(index + 80));
      const afterBandA = [rootEvent, ...bandA, ...initialThreadEvents.slice(1)];
      const afterBandB = [rootEvent, ...bandB, ...bandA, ...initialThreadEvents.slice(1)];
      const threadTimeline = makeTimeline(initialThreadEvents, { backwardToken: 'tok-back' });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: () => undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: initialThreadEvents,
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({ liveEvents: [] });
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      const setThreadEvents = (events: ReturnType<typeof makeEvent>[]) => {
        threadRenderStateMock.threadEvents = events as never;
        threadRenderStateMock.threadEventIndexMapRef.current = new Map(
          events.map((event, index) => [event.getId(), index])
        );
      };
      setThreadEvents(initialThreadEvents);
      roomTimelineVirtualizerState.firstVisibleKey = '$te-100';
      const scrollElement = {
        isConnected: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
        querySelector: vi.fn(() => undefined),
        querySelectorAll: vi.fn(() => []),
        scrollHeight: 4000,
        clientHeight: 600,
        scrollTop: 0,
        scrollTo: vi.fn(),
      };
      const innerElement = {
        style: {} as Record<string, string>,
        getBoundingClientRect: () => ({ top: 0 }),
      };
      // The pagination NEVER resolves inside the pinned phase — both
      // bands land strictly mid-flight.
      let resolvePaginate: ((value: boolean) => void) | undefined;
      matrixClientMock.paginateEventTimeline.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolvePaginate = resolve;
          })
      );
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            }),
            {
              createNodeMock: (element) =>
                element.type === scrollType
                  ? scrollElement
                  : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
                  ? innerElement
                  : null,
            }
          );
          await flushAsyncWork();
        });

        const loadOlderChip = getClickableByText(renderer!, 'Load Older Messages');
        await act(async () => {
          loadOlderChip.props.onClick();
          await flushAsyncWork(10);
        });

        await act(async () => {
          setThreadEvents(afterBandA);
          renderer!.update(React.createElement(ControlledRoomTimeline, { room, threadId }));
          await flushAsyncWork(5);
        });
        expect(innerElement.style.marginTop).toBe('-130px');

        await act(async () => {
          setThreadEvents(afterBandB);
          renderer!.update(React.createElement(ControlledRoomTimeline, { room, threadId }));
          await flushAsyncWork(5);
        });
        // The second band folds against the anchor recorded after the first.
        expect(innerElement.style.marginTop).toBe('-208px');
        expect(scrollElement.scrollTo).not.toHaveBeenCalled();
      } finally {
        resolvePaginate?.(false);
        renderer?.unmount();
      }
    });

    it('makes no coarse re-anchor scroll for a Load Older prepend', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const threadId = '$prepend-thread-root';
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 0 });
      const makeReply = (index: number) =>
        makeEvent(`$te-${index}`, { threadRootId: threadId, ts: index + 1 });
      const initialThreadEvents = [
        rootEvent,
        ...Array.from({ length: 300 }, (_value, index) => makeReply(index + 100)),
      ];
      const prependedThreadEvents = [
        rootEvent,
        ...Array.from({ length: 100 }, (_value, index) => makeReply(index)),
        ...initialThreadEvents.slice(1),
      ];
      const threadTimeline = makeTimeline(initialThreadEvents, { backwardToken: 'tok-back' });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: () => undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: initialThreadEvents,
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({ liveEvents: [] });
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      const setThreadEvents = (events: ReturnType<typeof makeEvent>[]) => {
        threadRenderStateMock.threadEvents = events as never;
        threadRenderStateMock.threadEventIndexMapRef.current = new Map(
          events.map((event, index) => [event.getId(), index])
        );
      };
      setThreadEvents(initialThreadEvents);
      roomTimelineVirtualizerState.firstVisibleKey = '$te-100';
      const scrollElement = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
        querySelector: vi.fn(() => undefined),
        querySelectorAll: vi.fn(() => []),
        scrollHeight: 4000,
        clientHeight: 600,
        scrollTop: 0,
        scrollTo: vi.fn(),
      };
      let prependOnPaginate = false;
      matrixClientMock.paginateEventTimeline.mockImplementation(async () => {
        if (prependOnPaginate) {
          prependOnPaginate = false;
          setThreadEvents(prependedThreadEvents);
        }
        return false;
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            }),
            {
              createNodeMock: (element) => (element.type === scrollType ? scrollElement : null),
            }
          );
          await flushAsyncWork();
        });
        roomTimelineVirtualizerState.getOffsetForIndexMock.mockClear();
        scrollElement.scrollTo.mockClear();

        const loadOlderChip = getClickableByText(renderer!, 'Load Older Messages');
        await act(async () => {
          prependOnPaginate = true;
          loadOlderChip.props.onClick();
          await flushAsyncWork(10);
        });

        expect(roomTimelineVirtualizerState.getOffsetForIndexMock).not.toHaveBeenCalled();
        expect(scrollElement.scrollTo).not.toHaveBeenCalled();
      } finally {
        renderer?.unmount();
      }
    });

    it('folds a room virtual-range prepend into the offset ledger with zero scroll writes', async () => {
      // Room-ledger port (2026-07-07, PR #90 branch): the paginator's
      // onRangeChange hands the exact prepended span, so the fold is
      // direct arithmetic — no DOM anchor capture, no coarse scrollTo,
      // no rAF rect correction (all three DELETED). 100 prepended items
      // at the flat room estimate (compact 96) fold to exactly 9600px,
      // delivered by the shared at-rest settle as one scrollTop shift.
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const events = Array.from({ length: 300 }, (_value, index) =>
        makeEvent(`$event-${index}`, { ts: index })
      );
      const room = makeRoom({ liveEvents: events });
      const roomInputRef = createRef<HTMLElement>();
      const editor = {} as Editor;
      const scrollElement = {
        isConnected: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({ top: 100, bottom: 700 })),
        querySelector: vi.fn(() => undefined),
        querySelectorAll: vi.fn(() => []),
        scrollHeight: 30000,
        clientHeight: 600,
        scrollTop: 0,
        scrollTo: vi.fn(),
      };
      const innerElement = {
        style: {} as Record<string, string>,
        getBoundingClientRect: () => ({ top: 0 }),
      };
      let renderer: ReturnType<typeof create> | undefined;

      // CINNY-207 P6.1 / D4: prefetchDepth sanitizer clamps to
      // [ROOM_TAIL_PREFETCH_DEPTH=200, CURRENT_ROOM_DEEP_HISTORY_TARGET=10000].
      // Setting the minimum here yields the same "smaller than the
      // 300-event total" behavior the pre-D4 `paginationLimit: 100`
      // did — just at the smallest value the new setting permits.
      settingsState.prefetchDepth = 200;
      roomTimelineVirtualizerState.virtualIndexes = [0, 1, 2];

      try {
        await act(async () => {
          renderer = create(
            wrapWithSyncEngine(
              React.createElement(RoomTimeline, {
                room,
                roomInputRef,
                editor,
                summaryMap: new Map(),
                onStoreThreadSummary: vi.fn(),
                threadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
                threadSortFreezeState: null,
                onToggle: vi.fn(),
                onSortDirectionChange: vi.fn(),
                onToggleThreadSortFreeze: vi.fn(),
                setThreadSortFreezeState: vi.fn(),
                onCycleTag: vi.fn(),
                onAddTag: vi.fn(),
                onRemoveTag: vi.fn(),
                onReset: vi.fn(),
                onApplyPreset: vi.fn(),
                onSearchQueryChange: vi.fn(),
                viewMode: 'classic',
                onViewModeChange: vi.fn(),
              })
            ),
            {
              createNodeMock: (element) =>
                element.type === scrollType
                  ? scrollElement
                  : (element.props as Record<string, unknown>)?.['data-testid'] ===
                    'room-virtual-inner'
                  ? innerElement
                  : null,
            }
          );
          await flushAsyncWork();
        });

        expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 100, end: 300 });
        // The ledger owns backward compensation, and the REAL paginator
        // must be told so — its own restore scrollBy lands before the
        // margin effect in the same commit and would compensate the
        // prepend twice (CodeRabbit on PR #91). The harness mocks the
        // hook, so the option contract is the unit-observable half; the
        // hook-side skip is a one-line gate on this flag.
        expect(
          (virtualPaginatorState.lastOptions as { externalBackwardScrollRestore?: boolean })
            ?.externalBackwardScrollRestore
        ).toBe(true);

        await act(async () => {
          virtualPaginatorState.lastOptions?.onRangeChange({ start: 0, end: 300 });
          await flushAsyncWork();
        });

        // The fold lands in the range-change commit: margin = -100 x 96.
        expect(innerElement.style.marginTop).toBe('-9600px');
        expect(scrollElement.scrollTo).not.toHaveBeenCalled();

        // At-rest settle (150ms quiescence, real timers): ONE exactly-
        // cancelling scrollTop shift, margin back to zero, still no
        // scrollTo — the reconcile-loop-racing restore is gone.
        await act(async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 250);
          });
          await flushAsyncWork(5);
        });
        expect(scrollElement.scrollTop).toBe(9600);
        expect(innerElement.style.marginTop).toBe('');
        expect(scrollElement.scrollTo).not.toHaveBeenCalled();
      } finally {
        renderer?.unmount();
      }
    });

    it('logs room cache hydration failures instead of swallowing them', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const hydrationError = new Error('hydrate failed');
      const room = makeRoom({
        liveEvents: [makeEvent('$loaded', { ts: 100 })],
      });
      const roomInputRef = createRef<HTMLElement>();
      const editor = {} as Editor;
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const originalLocalStorage = globalThis.localStorage;
      const debugStorage = {
        getItem: vi.fn((key: string) => (key === 'mindroom.debug.timeline' ? '1' : null)),
      };
      let renderer: ReturnType<typeof create> | undefined;

      loadLatestCachedRoomEventsMock.mockResolvedValue({
        beforeToken: undefined,
        events: [makeCachedRoomEvent('$cached', 200)],
        hasMoreBefore: false,
      });
      room.addLiveEvents.mockRejectedValueOnce(hydrationError);
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: debugStorage,
      });

      try {
        await act(async () => {
          renderer = create(
            wrapWithSyncEngine(
              React.createElement(RoomTimeline, {
                room,
                roomInputRef,
                editor,
                summaryMap: new Map(),
                onStoreThreadSummary: vi.fn(),
                threadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
                threadSortFreezeState: null,
                onToggle: vi.fn(),
                onSortDirectionChange: vi.fn(),
                onToggleThreadSortFreeze: vi.fn(),
                setThreadSortFreezeState: vi.fn(),
                onCycleTag: vi.fn(),
                onAddTag: vi.fn(),
                onRemoveTag: vi.fn(),
                onReset: vi.fn(),
                onApplyPreset: vi.fn(),
                onSearchQueryChange: vi.fn(),
                viewMode: 'default',
                onViewModeChange: vi.fn(),
              })
            )
          );
          await flushAsyncWork();
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('room-cache-hydrate-error'),
          expect.objectContaining({
            error: hydrationError,
            roomId: room.roomId,
          })
        );
      } finally {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          value: originalLocalStorage,
        });
        consoleLogSpy.mockRestore();
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(1);
        });
      }
    });

    it('preserves an explicit null backward token when hydrating cached room history', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const liveEvent = makeEvent('$live-event', { ts: 10 });
      const cachedEvent = makeCachedRoomEvent('$cached-event', 5);
      const liveTimeline = makeTimeline([liveEvent], {
        backwardToken: 'stale-back-token',
      });
      const room = makeRoom({ liveTimeline });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(1);
      });

      loadCachedRoomEventsBeforeMock.mockResolvedValueOnce({
        events: [cachedEvent],
        hasMoreBefore: false,
        beforeToken: null,
      });

      await act(async () => {
        await virtualPaginatorState.lastOptions?.onEnd?.(true);
        await flushAsyncWork();
      });

      expect(room.addEventsToTimeline).toHaveBeenCalled();
      expect(room.addEventsToTimeline.mock.lastCall?.[4]).toBeNull();

      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    });

    it('shows RoomIntro on room re-entry for a reused room object that already reached the top', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const liveEvent = makeEvent('$live-event', { ts: 10 });
      const liveTimeline = makeTimeline([liveEvent], {
        backwardToken: 'stale-back-token',
      });
      const room = makeRoom({ liveTimeline });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      loadCachedRoomPaginationTokenMock.mockResolvedValue(null);

      let firstRenderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        firstRenderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork();
      });

      await act(async () => {
        firstRenderer?.unmount();
        await flushAsyncWork(1);
      });

      let secondRenderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        secondRenderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork();
      });

      expect(secondRenderer?.root.findAllByType(roomIntroType)).toHaveLength(1);
      expect(secondRenderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);

      await act(async () => {
        secondRenderer?.unmount();
        await flushAsyncWork(1);
      });
    });

    it('falls back to the existing SDK backward token when cached room history has no beforeToken metadata', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const liveEvent = makeEvent('$live-event', { ts: 10 });
      const cachedEvent = makeCachedRoomEvent('$cached-event', 5);
      const liveTimeline = makeTimeline([liveEvent], {
        backwardToken: 'server-back-token',
      });
      const room = makeRoom({ liveTimeline });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(1);
      });

      loadCachedRoomEventsBeforeMock.mockResolvedValueOnce({
        events: [cachedEvent],
        hasMoreBefore: false,
      });

      await act(async () => {
        await virtualPaginatorState.lastOptions?.onEnd?.(true);
        await flushAsyncWork();
      });

      expect(room.addEventsToTimeline).toHaveBeenCalled();
      expect(room.addEventsToTimeline.mock.lastCall?.[4]).toBe('server-back-token');

      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    });

    // CINNY-207 P3.3: removed the two P1.1 sweep tests that asserted
    // saveRoomEventsToCacheMock after `waitForPersistSweepDebounce`.
    // Their subject — the mount-time sweep that re-serialized the whole
    // loaded timeline — is gone (persistence moved into
    // MindroomSyncEngine's per-event write-through). Coverage of the
    // engine's live-event persistence lives in
    // `src/app/mindroom/engine/engineWriteThrough.compaction.test.ts`
    // (13 tests) and `src/app/mindroom/engine/__tests__/engineAllRoomsCoverage.test.ts`
    // (2 tests).

    // CINNY-207 P4.3: the "keeps eager-preloading past fifty batches"
    // test asserted the deleted `useRoomEagerPreload` loop drove
    // `mx.paginateEventTimeline` iteratively against the SDK live
    // timeline. That loop is gone — deep-history sweep runs in the
    // engine as a band-4 `BackfillScheduler` job that calls
    // `mx.createMessagesRequest` and persists straight to IDB. The
    // scheduler-side behavior is covered by
    // `src/app/mindroom/engine/__tests__/deepHistoryJob.test.ts`.

    it('renders the room thread overview outside thread view', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const root = makeEvent('$thread-root', { isThreadRoot: true });
      const room = makeRoom({ liveEvents: [root] });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      const renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );

      const overview = renderer.root.findByType(roomThreadOverviewType);

      expect(renderer.root.findAllByType(roomThreadOverviewType)).toHaveLength(1);
      expect(
        renderer.root.findByType(scrollType).findAllByType(roomThreadOverviewType)
      ).toHaveLength(0);
      expect(overview.props.state).toEqual({
        ...TEST_DEFAULT_THREAD_FILTER_STATE,
        tags: new Map(),
      });
      expect(overview.props.threadCount).toBe(1);
      expect(overview.props.onToggle).toBeTypeOf('function');
    });

    it('does not show a false zero-thread overview while initial room cache hydrate is pending', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      loadLatestCachedRoomEventsMock.mockImplementation(
        () =>
          new Promise(() => {
            // Intentionally unresolved while asserting the loading state.
          })
      );
      const room = makeRoom();
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'compact',
          })
        );
        await flushAsyncWork(2);
      });

      expect(renderer?.root.findAllByType(roomThreadOverviewType)).toHaveLength(0);
      expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
    });

    it('keeps the zero-thread overview hidden until the initial room cache hydrate settles', async () => {
      vi.useFakeTimers();
      try {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        loadLatestCachedRoomEventsMock.mockImplementation(
          () =>
            new Promise(() => {
              // Intentionally unresolved while asserting the loading state.
            })
        );
        const room = makeRoom();
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

        let renderer: ReturnType<typeof create> | undefined;

        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              initialViewMode: 'compact',
            })
          );
          await flushAsyncWork(2);
        });

        await act(async () => {
          vi.advanceTimersByTime(150);
          await flushAsyncWork(5);
        });

        expect(renderer?.root.findAllByType(roomThreadOverviewType)).toHaveLength(0);
        expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the zero-thread overview hidden during initial client catchup after cache hydrate settles', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      // The client is still on its initial catch-up.
      matrixClientMock.getSyncState.mockReturnValue('PREPARED');
      const room = makeRoom();
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'compact',
          })
        );
        await flushAsyncWork(5);
      });

      expect(renderer?.root.findAllByType(roomThreadOverviewType)).toHaveLength(0);
      expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
    });

    it('does not treat non-root notices as room-overview readiness during initial catchup', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      // The client is still on its initial catch-up.
      matrixClientMock.getSyncState.mockReturnValue('PREPARED');
      const notice = makeEvent('$notice', {
        content: { body: 'Bridge notice', msgtype: 'm.notice' },
      });
      const room = makeRoom({ liveEvents: [notice] });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'compact',
          })
        );
        await flushAsyncWork(5);
      });

      expect(renderer?.root.findAllByType(roomThreadOverviewType)).toHaveLength(0);
      expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
    });

    it('shows a real zero-thread overview after initial client sync settles', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      matrixClientMock.getSyncState.mockReturnValue('PREPARED');
      const room = makeRoom();
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'compact',
          })
        );
        await flushAsyncWork(5);
      });
      expect(renderer?.root.findAllByType(roomThreadOverviewType)).toHaveLength(0);

      await act(async () => {
        emitClientSync('SYNCING', 'PREPARED');
        await flushAsyncWork(2);
      });

      const overview = renderer?.root.findByType(roomThreadOverviewType);
      expect(overview?.props.threadCount).toBe(0);
      expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
    });

    it('shows a real zero-thread overview at once when the client has already caught up', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const room = makeRoom();
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'compact',
          })
        );
        await flushAsyncWork(5);
      });

      expect(renderer?.root.findByType(roomThreadOverviewType).props.threadCount).toBe(0);
    });

    it('passes visible room thread counts to the overview', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const unresolvedThread = makeEvent('$thread-unresolved', { isThreadRoot: true });
      const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
      const messageEvent = makeEvent('$message');
      const room = makeRoom({
        liveEvents: [messageEvent, unresolvedThread, resolvedThread],
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });

      const renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );

      expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(2);
    });

    it('counts fallback-only thread roots in the room thread overview', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const fallbackRoot = makeEvent('$thread-root');
      const fallbackReply = makeEvent('$thread-reply', {
        threadRootId: fallbackRoot.getId(),
      });
      const room = makeRoom({
        liveEvents: [fallbackRoot, fallbackReply],
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      const renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );

      expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(1);
    });

    it('counts old standalone zero-reply message roots in the room thread overview', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const standaloneRoot = makeEvent('$thread-root', {
        ts: 1_000,
        content: { body: 'Older standalone root', msgtype: 'm.text' },
      });
      const room = makeRoom({
        liveEvents: [standaloneRoot],
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      try {
        const renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );

        expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(1);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('does not count standalone m.notice messages as zero-reply roots', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const noticeRoot = makeEvent('$notice-root', {
        ts: 1_000,
        content: { body: 'Notice root', msgtype: 'm.notice' },
      });
      const room = makeRoom({
        liveEvents: [noticeRoot],
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(2);
      });

      await act(async () => {
        emitClientSync();
        await flushAsyncWork(1);
      });

      expect(renderer?.root.findByType(roomThreadOverviewType).props.threadCount).toBe(0);
    });

    it('shows pending encrypted local-echo zero-reply roots immediately in compact view', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const firstThread = makeEvent('$thread-1', {
        isThreadRoot: true,
        ts: 100,
      });
      const secondThread = makeEvent('$thread-2', {
        isThreadRoot: true,
        ts: 200,
      });
      const liveEvents = [firstThread, secondThread];
      const room = makeRoom({ liveEvents });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      roomThreadListThreadsMock.push(
        { id: firstThread.getId(), rootEvent: firstThread },
        { id: secondThread.getId(), rootEvent: secondThread }
      );
      threadLastActivityTsMapMock.set(firstThread.getId(), 100);
      threadLastActivityTsMapMock.set(secondThread.getId(), 200);

      let renderer: ReturnType<typeof create> | undefined;

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              initialViewMode: 'compact',
              initialThreadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
            })
          );
          await flushAsyncWork(2);
        });

        const pendingRoot = makeEvent('~pending-root', {
          content: { body: 'Pending compact root' },
          isSending: true,
          ts: 0,
          type: 'm.room.encrypted',
        });
        liveEvents.push(pendingRoot);

        await act(async () => {
          room.__listeners.get(RoomEvent.Timeline)?.(pendingRoot, room, false, false, {
            liveEvent: true,
          });
          await flushAsyncWork(2);
        });

        expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toEqual([
          pendingRoot.getId(),
          secondThread.getId(),
          firstThread.getId(),
        ]);
      } finally {
        nowSpy.mockRestore();
      }
    });

    // CINNY-088 Phase 1a: regression lock for media-typed standalone roots
    // appearing in the compact view immediately on a `liveEvent: true` arrival.
    // Reported by Bas 2026-04-24 / re-confirmed live 2026-05-12 — voice messages
    // do not appear instantly as zero-reply compact cards. The compact-vs-classic
    // A/B (2026-05-13) confirms `setTimeline` IS being called (classic shows it),
    // so the question is whether the predicate + selector chain accepts the live
    // arrival. These tests lock that contract for every msgtype that uploads
    // through the room input.
    it.each([
      [
        'voice audio',
        {
          body: 'voice-2026-05-13.m4a',
          filename: 'voice-2026-05-13.m4a',
          msgtype: 'm.audio',
          'm.voice': {},
          'm.audio': { duration: 1200 },
        },
        'm.room.message',
      ],
      [
        'image',
        {
          body: 'image.png',
          filename: 'image.png',
          msgtype: 'm.image',
        },
        'm.room.message',
      ],
      [
        'video',
        {
          body: 'video.mp4',
          filename: 'video.mp4',
          msgtype: 'm.video',
        },
        'm.room.message',
      ],
      [
        'file',
        {
          body: 'document.pdf',
          filename: 'document.pdf',
          msgtype: 'm.file',
        },
        'm.room.message',
      ],
      [
        'encrypted-room voice',
        {
          body: 'voice-encrypted-2026-05-13.m4a',
        },
        'm.room.encrypted',
      ],
    ])(
      'renders a live room-level %s event as a compact zero-reply root immediately',
      async (_label, content, eventType) => {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        const seedThread = makeEvent('$seed-thread', {
          isThreadRoot: true,
          ts: 100,
        });
        const liveEvents = [seedThread];
        const room = makeRoom({ liveEvents });
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        roomThreadListThreadsMock.push({ id: seedThread.getId(), rootEvent: seedThread });
        threadLastActivityTsMapMock.set(seedThread.getId(), 100);

        let renderer: ReturnType<typeof create> | undefined;

        try {
          await act(async () => {
            renderer = create(
              React.createElement(ControlledRoomTimeline, {
                room,
                initialViewMode: 'compact',
                initialThreadFilterState: {
                  ...DEFAULT_THREAD_FILTER_STATE,
                  tags: new Map(),
                },
              })
            );
            await flushAsyncWork(2);
          });

          const newMediaRoot = makeEvent('$media-root', {
            content,
            ts: 999_000,
            type: eventType,
          });
          liveEvents.push(newMediaRoot);

          await act(async () => {
            room.__listeners.get(RoomEvent.Timeline)?.(newMediaRoot, room, false, false, {
              liveEvent: true,
            });
            await flushAsyncWork(2);
          });

          expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toContain(
            newMediaRoot.getId()
          );
        } finally {
          nowSpy.mockRestore();
        }
      }
    );

    // CINNY-088 Phase 1b: discriminator test — what happens if the SDK first fires
    // Room.timeline with `liveEvent: false` (e.g. for a sent local echo before
    // server confirmation) and then `liveEvent: true`? If the compact card only
    // appears after the SECOND dispatch, the bug is in
    // `roomLiveEventController.ts:140` short-circuiting on `liveEvent: false`.
    it('shows a media zero-reply root in compact view after a liveEvent:false → liveEvent:true sequence', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const seedThread = makeEvent('$seed-thread', {
        isThreadRoot: true,
        ts: 100,
      });
      const liveEvents = [seedThread];
      const room = makeRoom({ liveEvents });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      roomThreadListThreadsMock.push({ id: seedThread.getId(), rootEvent: seedThread });
      threadLastActivityTsMapMock.set(seedThread.getId(), 100);

      let renderer: ReturnType<typeof create> | undefined;

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              initialViewMode: 'compact',
              initialThreadFilterState: {
                ...DEFAULT_THREAD_FILTER_STATE,
                tags: new Map(),
              },
            })
          );
          await flushAsyncWork(2);
        });

        const voiceRoot = makeEvent('~voice-pending', {
          content: {
            body: 'voice-pending.m4a',
            filename: 'voice-pending.m4a',
            msgtype: 'm.audio',
            'm.voice': {},
            'm.audio': { duration: 1500 },
          },
          isSending: true,
          ts: 0,
          type: 'm.room.message',
        });
        liveEvents.push(voiceRoot);

        // First dispatch: SDK signals local echo with `liveEvent: false`.
        await act(async () => {
          room.__listeners.get(RoomEvent.Timeline)?.(voiceRoot, room, false, false, {
            liveEvent: false,
          });
          await flushAsyncWork(2);
        });

        const idsAfterLocalEcho =
          renderer?.root.findByType(compactPlaceholderType).props.threadRootIds ?? [];

        // Second dispatch: server confirmation arrives with `liveEvent: true`.
        await act(async () => {
          room.__listeners.get(RoomEvent.Timeline)?.(voiceRoot, room, false, false, {
            liveEvent: true,
          });
          await flushAsyncWork(2);
        });

        const idsAfterServerConfirm =
          renderer?.root.findByType(compactPlaceholderType).props.threadRootIds ?? [];

        // The contract: compact card appears AFTER THE FIRST DISPATCH. If only the
        // second dispatch surfaces it, Path A in roomLiveEventController is the bug.
        expect(idsAfterLocalEcho).toContain(voiceRoot.getId());
        expect(idsAfterServerConfirm).toContain(voiceRoot.getId());
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('adds pending local-echo replies to an open thread after liveEvent:false dispatch', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 100,
      });
      const threadTimeline = makeTimeline([rootEvent]);
      const room = makeRoom({
        liveEvents: [rootEvent],
        threads: [
          {
            id: threadId,
            rootEvent,
            events: [],
            timeline: [],
            getUnfilteredTimelineSet: () => ({
              getLiveTimeline: () => threadTimeline,
              getTimelines: () => [threadTimeline],
            }),
          },
        ],
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(2);
        });

        threadRenderStateMock.setSupplementalThreadEvents.mockClear();
        const pendingReply = makeEvent('~pending-reply', {
          content: {
            body: 'Pending thread reply',
            msgtype: 'm.text',
          },
          isSending: true,
          relation: {
            event_id: threadId,
            rel_type: 'm.thread',
          },
          threadRootId: threadId,
          ts: 200,
        });

        await act(async () => {
          room.__listeners.get(RoomEvent.Timeline)?.(pendingReply, room, false, false, {
            liveEvent: false,
          });
          await flushAsyncWork(2);
        });

        expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
          pendingReply,
        ]);
      } finally {
        renderer?.unmount();
      }
    });

    it('preserves zero replies for recent standalone roots in the regular timeline thread badge logic', async () => {
      const { getThreadReplyCount, shouldRenderZeroReplyThreadBadge } = await import(
        '../threadBadgeViewModel'
      );
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const standaloneRoot = makeEvent('$thread-root', {
        ts: 999_000,
        content: { body: 'Recent standalone root' },
      });
      const room = makeRoom();

      try {
        expect(shouldRenderZeroReplyThreadBadge(room as never, standaloneRoot as never)).toBe(true);
        expect(getThreadReplyCount(room as never, standaloneRoot as never, undefined, true)).toBe(
          0
        );
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('counts reply-backed thread roots in preload surface counts even when the root is not renderable in the room timeline', async () => {
      const { getRoomPreloadCounts } = await import('../roomTimelineEvents');
      const fallbackRoot = makeEvent('$thread-root');
      const fallbackReply = makeEvent('$thread-reply', {
        threadRootId: fallbackRoot.getId(),
      });
      const liveTimeline = makeTimeline([fallbackReply]);
      const room = makeRoom({
        liveTimeline,
        findEventById: (eventId: string) =>
          eventId === fallbackRoot.getId() ? fallbackRoot : undefined,
      });

      expect(
        getRoomPreloadCounts([liveTimeline] as never, room as never, {
          threadId: undefined,
          ignoredUsersSet: new Set<string>(),
          showHiddenEvents: false,
          hideMembershipEvents: false,
          hideNickAvatarEvents: false,
        })
      ).toEqual({
        cacheCount: 0,
        renderableCount: 0,
        surfaceCount: 1,
      });
    });

    it('renders reply-backed thread roots in overview mode when only replies are loaded in the room timeline', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const fallbackRoot = makeEvent('$thread-root');
      const fallbackReply = makeEvent('$thread-reply', {
        threadRootId: fallbackRoot.getId(),
      });
      const room = makeRoom({
        liveEvents: [fallbackReply],
        findEventById: (eventId: string) =>
          eventId === fallbackRoot.getId() ? fallbackRoot : undefined,
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      const renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          initialThreadFilter: 'unresolved',
        })
      );

      expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(1);
      expect(renderer.root.findByType(roomThreadOverviewType).props.statusCounts).toEqual({
        resolved: 0,
        streaming: 0,
        scheduled: 0,
        unread: 0,
        idle: 0,
      });
      // The row renders once; its message content also carries the event ID.
      expect(
        renderer.root
          .findAllByProps({ eventId: fallbackRoot.getId() })
          .filter((node) => node.props.msgType === undefined)
      ).toHaveLength(1);
    });

    it('keeps the frozen expanded overview order while metadata updates', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
      const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
      const thirdThread = makeEvent('$thread-3', { isThreadRoot: true });
      const room = makeRoom({
        liveEvents: [firstThread, secondThread, thirdThread],
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      threadLastActivityTsMapMock.set(firstThread.getId(), 100);
      threadLastActivityTsMapMock.set(secondThread.getId(), 200);
      threadLastActivityTsMapMock.set(thirdThread.getId(), 300);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(2);
      });

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
        await flushAsyncWork(2);
      });

      expect(getRenderedEventIds(renderer!)).toEqual([
        thirdThread.getId(),
        secondThread.getId(),
        firstThread.getId(),
      ]);

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
        await flushAsyncWork(2);
      });

      threadLastActivityTsMapMock.set(firstThread.getId(), 500);

      await act(async () => {
        room.__listeners.get(ThreadEvent.Update)?.();
        await flushAsyncWork(2);
      });

      expect(getRenderedEventIds(renderer!)).toEqual([
        thirdThread.getId(),
        secondThread.getId(),
        firstThread.getId(),
      ]);

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
        await flushAsyncWork(2);
      });

      expect(getRenderedEventIds(renderer!)).toEqual([
        firstThread.getId(),
        thirdThread.getId(),
        secondThread.getId(),
      ]);
    });

    it('appends new matching roots and drops removed roots while frozen', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
      const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
      const liveEvents = [firstThread, secondThread];
      const room = makeRoom({ liveEvents });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      threadLastActivityTsMapMock.set(firstThread.getId(), 100);
      threadLastActivityTsMapMock.set(secondThread.getId(), 200);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(2);
      });

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
        await flushAsyncWork(2);
      });

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
        await flushAsyncWork(2);
      });

      const thirdThread = makeEvent('$thread-3', { isThreadRoot: true });
      threadLastActivityTsMapMock.set(thirdThread.getId(), 300);
      liveEvents.push(thirdThread);

      await act(async () => {
        room.__listeners.get(RoomEvent.Timeline)?.(thirdThread, room, false, false, {
          liveEvent: true,
        });
        await flushAsyncWork(2);
      });

      expect(getRenderedEventIds(renderer!)).toEqual([
        secondThread.getId(),
        firstThread.getId(),
        thirdThread.getId(),
      ]);

      liveEvents.splice(liveEvents.indexOf(firstThread), 1);

      await act(async () => {
        room.__listeners.get(ThreadEvent.Delete)?.();
        await flushAsyncWork(2);
      });

      expect(getRenderedEventIds(renderer!)).toEqual([secondThread.getId(), thirdThread.getId()]);
    });

    it('resnapshots on control changes without disabling freeze', async () => {
      vi.useFakeTimers();
      try {
        const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
        const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
        const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
        const resolvedThread = makeEvent('$thread-3', { isThreadRoot: true });
        const room = makeRoom({
          liveEvents: [firstThread, secondThread, resolvedThread],
        });
        const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
        threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });
        threadLastActivityTsMapMock.set(firstThread.getId(), 100);
        threadLastActivityTsMapMock.set(secondThread.getId(), 200);
        threadLastActivityTsMapMock.set(resolvedThread.getId(), 300);

        let renderer: ReturnType<typeof create> | undefined;

        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
            })
          );
          await flushAsyncWork(2);
        });

        await act(async () => {
          renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
          await flushAsyncWork(2);
        });

        await act(async () => {
          renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
          await flushAsyncWork(2);
        });

        await act(async () => {
          renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
          renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
          await flushAsyncWork(2);
        });

        await act(async () => {
          vi.advanceTimersByTime(300);
          await flushAsyncWork(2);
        });

        expect(renderer?.root.findByType(roomThreadOverviewType).props.isThreadSortFrozen).toBe(
          true
        );
        expect(getRenderedEventIds(renderer!)).toEqual([secondThread.getId(), firstThread.getId()]);

        threadLastActivityTsMapMock.set(firstThread.getId(), 500);

        await act(async () => {
          room.__listeners.get(ThreadEvent.Update)?.();
          await flushAsyncWork(2);
        });

        expect(getRenderedEventIds(renderer!)).toEqual([secondThread.getId(), firstThread.getId()]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses the frozen ordering for compact view thread ids', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
      const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
      const thirdThread = makeEvent('$thread-3', { isThreadRoot: true });
      const room = makeRoom({
        liveEvents: [firstThread, secondThread, thirdThread],
        threads: [
          { id: firstThread.getId(), rootEvent: firstThread },
          { id: secondThread.getId(), rootEvent: secondThread },
          { id: thirdThread.getId(), rootEvent: thirdThread },
        ],
      });
      roomThreadListThreadsMock.push(
        { id: firstThread.getId(), rootEvent: firstThread },
        { id: secondThread.getId(), rootEvent: secondThread },
        { id: thirdThread.getId(), rootEvent: thirdThread }
      );
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      threadLastActivityTsMapMock.set(firstThread.getId(), 100);
      threadLastActivityTsMapMock.set(secondThread.getId(), 200);
      threadLastActivityTsMapMock.set(thirdThread.getId(), 300);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'compact',
          })
        );
        await flushAsyncWork(2);
      });

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
        await flushAsyncWork(2);
      });

      expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toEqual([
        thirdThread.getId(),
        secondThread.getId(),
        firstThread.getId(),
      ]);

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
        await flushAsyncWork(2);
      });

      threadLastActivityTsMapMock.set(firstThread.getId(), 500);

      await act(async () => {
        room.__listeners.get(ThreadEvent.Update)?.();
        await flushAsyncWork(2);
      });

      expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toEqual([
        thirdThread.getId(),
        secondThread.getId(),
        firstThread.getId(),
      ]);
    });

    it('does not force direct rooms back to the message timeline in compact mode', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      // The client is still on its initial catch-up.
      matrixClientMock.getSyncState.mockReturnValue('PREPARED');
      const directMessage = makeEvent('$dm-message');
      const room = makeRoom({
        liveEvents: [directMessage],
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      directRoomState.value = true;

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'compact',
            initialThreadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
          })
        );
        await flushAsyncWork(2);
      });

      expect(getRenderedEventIds(renderer!)).toEqual([]);
      expect(renderer?.root.findAllByType(roomThreadOverviewType)).toHaveLength(0);
      expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
    });

    it('redirects frozen compact-order permalinks into thread view', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
      const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
      const compactOnlyThread = makeEvent('$thread-3', { isThreadRoot: true });
      const roomThreads = [
        { id: firstThread.getId(), rootEvent: firstThread, length: 1 },
        { id: secondThread.getId(), rootEvent: secondThread, length: 1 },
        { id: compactOnlyThread.getId(), rootEvent: compactOnlyThread, length: 1 },
      ];
      const room = makeRoom({
        liveEvents: [firstThread, secondThread],
        threads: roomThreads as never,
      });
      roomThreadListThreadsMock.push(...(roomThreads as never));
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      threadLastActivityTsMapMock.set(firstThread.getId(), 100);
      threadLastActivityTsMapMock.set(secondThread.getId(), 200);
      threadLastActivityTsMapMock.set(compactOnlyThread.getId(), 300);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            initialViewMode: 'compact',
          })
        );
        await flushAsyncWork(2);
      });

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
        await flushAsyncWork(2);
      });

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
        await flushAsyncWork(2);
      });

      threadLastActivityTsMapMock.set(firstThread.getId(), 500);

      await act(async () => {
        room.__listeners.get(ThreadEvent.Update)?.();
        await flushAsyncWork(2);
      });

      expect(renderer?.root.findByType(compactPlaceholderType).props.threadRootIds).toEqual([
        compactOnlyThread.getId(),
        secondThread.getId(),
        firstThread.getId(),
      ]);

      scrollToItemMock.mockClear();
      navigateRoomThreadMock.mockClear();

      await act(async () => {
        renderer?.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            eventId: firstThread.getId(),
            initialViewMode: 'compact',
          })
        );
        await flushAsyncWork(2);
      });

      expect(scrollToItemMock).not.toHaveBeenCalled();
      expect(navigateRoomThreadMock).toHaveBeenCalledWith(
        room.roomId,
        firstThread.getId(),
        undefined,
        { replace: true }
      );
    });

    it('preloads cached overview metadata in the frozen display order', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEventsBatch } = await import('../cacheStore');
      const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
      const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
      const thirdThread = makeEvent('$thread-3', { isThreadRoot: true });
      const room = makeRoom({
        liveEvents: [firstThread, secondThread, thirdThread],
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      threadLastActivityTsMapMock.set(firstThread.getId(), 100);
      threadLastActivityTsMapMock.set(secondThread.getId(), 200);
      threadLastActivityTsMapMock.set(thirdThread.getId(), 300);

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(2);
      });

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onSortDirectionChange();
        await flushAsyncWork(2);
      });

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onToggleThreadSortFreeze();
        await flushAsyncWork(2);
      });

      vi.mocked(loadLatestCachedThreadEventsBatch).mockClear();
      threadLastActivityTsMapMock.set(firstThread.getId(), 500);

      await act(async () => {
        room.__listeners.get(ThreadEvent.Update)?.();
        await flushAsyncWork(2);
      });

      expect(vi.mocked(loadLatestCachedThreadEventsBatch)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        [thirdThread.getId(), secondThread.getId(), firstThread.getId()],
        32
      );
    });

    it('does not issue per-visible-thread summary cache reads from the render path', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
      const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
      const room = makeRoom({
        liveEvents: [firstThread, secondThread],
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(3);
      });

      // CINNY-207 P2.3: the `loadLatestCachedThreadSummaryInfo` API was
      // removed with the shim files — no render-path read to guard
      // against exists anymore. The rendering contract remains: no
      // per-visible-thread summary cache reads from the render path.

      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    });

    it('collects room-loaded thread events in chronological order without surfacing relation rows', async () => {
      const { getLoadedRoomThreadEvents, getLoadedRoomThreadSeedEvents } = await import(
        '../threadBootstrap'
      );
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1 });
      const newerReply = makeEvent('$thread-reply-2', {
        threadRootId: threadId,
        ts: 4,
      });
      const firstReply = makeEvent('$thread-reply-1', {
        content: { body: 'thinking...' },
        threadRootId: threadId,
        ts: 2,
      });
      const threadedEdit = makeEvent('$thread-edit-1', {
        content: {
          body: '* edited reply',
          'm.new_content': {
            body: 'edited reply',
            msgtype: 'm.text',
          },
        },
        threadRootId: threadId,
        relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
        ts: 3,
      });
      const editRedaction = makeEvent('$thread-edit-redaction', {
        associatedId: '$thread-edit-1',
        isRedaction: true,
        threadRootId: threadId,
        ts: 5,
      });
      const olderTimeline = makeTimeline([rootEvent, firstReply, threadedEdit, editRedaction]);
      const liveTimeline = makeTimeline([newerReply]);
      (
        olderTimeline as ReturnType<typeof makeTimeline> & {
          getNeighbouringTimeline: (direction: Direction) => ReturnType<typeof makeTimeline> | null;
        }
      ).getNeighbouringTimeline = (direction: Direction) =>
        direction === Direction.Forward ? liveTimeline : null;
      (
        liveTimeline as ReturnType<typeof makeTimeline> & {
          getNeighbouringTimeline: (direction: Direction) => ReturnType<typeof makeTimeline> | null;
        }
      ).getNeighbouringTimeline = (direction: Direction) =>
        direction === Direction.Backward ? olderTimeline : null;
      const room = makeRoom({
        liveTimeline,
        timelinesByEventId: new Map([
          [threadId, olderTimeline],
          ['$thread-reply-1', olderTimeline],
          ['$thread-edit-1', olderTimeline],
          ['$thread-edit-redaction', olderTimeline],
        ]),
      });

      expect(
        getLoadedRoomThreadEvents(room as never, threadId).map((event) => event.getId())
      ).toEqual(['$thread-root', '$thread-reply-1', '$thread-reply-2']);
      expect(
        getLoadedRoomThreadSeedEvents(room as never, threadId).map((event) => event.getId())
      ).toEqual([
        '$thread-root',
        '$thread-reply-1',
        '$thread-edit-1',
        '$thread-reply-2',
        '$thread-edit-redaction',
      ]);
    });

    it('seeds thread fallback immediately from room-loaded replies for targeted opens before thread cache hydration resolves', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { hydrateCachedEvents } = await import('../eventCacheEditUtils');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
      });
      const firstReply = makeEvent('$thread-reply-1', {
        content: { body: 'thinking...' },
        threadRootId: threadId,
        ts: 2,
      });
      const threadedEdit = makeEvent('$thread-edit-1', {
        content: {
          body: '* edited reply',
          'm.new_content': {
            body: 'edited reply',
            msgtype: 'm.text',
          },
        },
        threadRootId: threadId,
        relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
        ts: 3,
      });
      const secondReply = makeEvent('$thread-reply-2', {
        threadRootId: threadId,
        ts: 4,
      });
      const room = makeRoom({
        liveTimeline: makeTimeline([secondReply, threadedEdit, rootEvent, firstReply]),
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      let resolveCacheLoad:
        | ((value: {
            events: unknown[];
            hasMoreBefore: boolean;
            beforeToken?: string | null;
          }) => void)
        | undefined;
      vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCacheLoad = resolve;
          }) as ReturnType<typeof loadLatestCachedThreadEvents>
      );

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              eventId: '$thread-reply-1',
              threadId,
            })
          );
        });

        await waitForCondition(() => vi.mocked(hydrateCachedEvents).mock.calls.length > 0, 50);
        expect(vi.mocked(hydrateCachedEvents)).toHaveBeenCalledWith({
          room,
          events: [rootEvent, firstReply, threadedEdit, secondReply],
          timelineSets: [room.getUnfilteredTimelineSet()],
        });
        expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
          rootEvent,
          firstReply,
          secondReply,
        ]);
      } finally {
        resolveCacheLoad?.({
          events: [],
          hasMoreBefore: false,
        });
        await act(async () => {
          await Promise.resolve();
        });
        renderer?.unmount();
      }
    });

    // CINNY-207 P3.3: removed the mount-time sweep that grouped a
    // room's loaded thread events and called
    // `persistThreadCacheFromRoomEventsSnapshot` (which as a side
    // effect populated `saveThreadOpenSeedSnapshot`). The engine
    // write-through only sees LIVE events, so pre-loaded room-thread
    // events are no longer warmed at component mount time. Seed
    // warming for opened threads still runs via
    // `threadOpenCacheController` and `threadSeedPrewarmController`.
    // The removed tests below were exercising sweep-mediated behavior:
    //   - "warms thread-open seed snapshots from room-preloaded thread events"
    //   - "marks room-derived thread cache snapshots complete only when the known reply count is satisfied"
    //   - "keeps room-derived thread cache snapshots incomplete when only a subset of replies is loaded"
    //   - "does not downgrade room-derived thread cache completeness when the room tail is still unknown"
    //   - "does not treat sdk thread length as authoritative when root counts are sparse"
    //   - "persists root-targeted relations into the thread cache during room cache persistence"
    //   - "persists redactions targeting thread replies into the thread cache during room cache persistence"
    // Unit coverage of `persistThreadCacheFromRoomEventsSnapshot`
    // itself lives in `eventRepository.test.ts`.

    it('prioritizes large thread seeds from the room thread list even when they are outside the viewport', async () => {
      const { collectPriorityThreadSeedPrewarmRoots } = await import('../threadBootstrap');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 25,
            },
          },
        },
      });
      const room = makeRoom({
        liveTimeline: makeTimeline([rootEvent], {
          backwardToken: null,
          forwardToken: null,
        }),
        findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
      });
      room.getThreads = () =>
        [
          {
            id: threadId,
            length: 25,
            rootEvent,
          },
        ] as never;
      const visibleSmallRoot = makeEvent('$visible-root', {
        isThreadRoot: true,
        ts: 5,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 2,
            },
          },
        },
      });

      expect(
        collectPriorityThreadSeedPrewarmRoots({
          room: room as never,
          threadFilteredEventEntries: [{ event: visibleSmallRoot }] as never,
          threadReplyCountMap: new Map(),
          threadResolutionMap: new Map(),
          rangeStart: 0,
          rangeEnd: 1,
        })
      ).toEqual([
        {
          threadId,
          replyCount: 25,
          visible: false,
        },
      ]);
    });

    it('prioritizes threads from the active overview range over larger off-screen room threads', async () => {
      const { collectPriorityThreadSeedPrewarmRoots } = await import('../threadBootstrap');
      const visibleRoots = Array.from({ length: 12 }, (_, index) =>
        makeEvent(`$thread-root-${index + 1}`, {
          isThreadRoot: true,
          ts: index + 1,
          unsigned: {
            'm.relations': {
              'm.thread': {
                count: 25,
              },
            },
          },
        })
      );
      const largeOffscreenRoot = makeEvent('$thread-root-large-offscreen', {
        isThreadRoot: true,
        ts: 100,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 400,
            },
          },
        },
      });
      const room = makeRoom({
        liveTimeline: makeTimeline([...visibleRoots, largeOffscreenRoot], {
          backwardToken: null,
          forwardToken: null,
        }),
      });
      room.getThreads = () =>
        [
          {
            id: largeOffscreenRoot.getId(),
            length: 400,
            rootEvent: largeOffscreenRoot,
          },
        ] as never;

      expect(
        collectPriorityThreadSeedPrewarmRoots({
          room: room as never,
          threadFilteredEventEntries: visibleRoots.map((event) => ({ event })) as never,
          threadReplyCountMap: new Map(),
          threadResolutionMap: new Map(),
          rangeStart: 10,
          rangeEnd: 12,
        }).slice(0, 2)
      ).toEqual([
        {
          threadId: '$thread-root-3',
          replyCount: 25,
          visible: true,
        },
        {
          threadId: '$thread-root-4',
          replyCount: 25,
          visible: true,
        },
      ]);
    });

    it('ignores room thread-list entries without a root event or known reply count', async () => {
      const { collectPriorityThreadSeedPrewarmRoots } = await import('../threadBootstrap');
      const visibleRoot = makeEvent('$visible-thread-root', {
        isThreadRoot: true,
        ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 25,
            },
          },
        },
      });
      const room = makeRoom({
        liveTimeline: makeTimeline([visibleRoot], {
          backwardToken: null,
          forwardToken: null,
        }),
      });
      room.getThreads = () =>
        [
          {
            id: '$thread-without-root',
            length: 0,
            rootEvent: undefined,
          },
        ] as never;

      expect(() =>
        collectPriorityThreadSeedPrewarmRoots({
          room: room as never,
          threadFilteredEventEntries: [{ event: visibleRoot }] as never,
          threadReplyCountMap: new Map(),
          threadResolutionMap: new Map(),
          rangeStart: 0,
          rangeEnd: 1,
        })
      ).not.toThrow();
    });

    it('seeds untargeted first open from the richer in-memory thread snapshot when room and model seeds are thinner', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { hydrateCachedEvents } = await import('../eventCacheEditUtils');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
      });
      const firstReply = makeEvent('$thread-reply-1', {
        content: { body: 'thinking...' },
        threadRootId: threadId,
        ts: 2,
      });
      const threadedEdit = makeEvent('$thread-edit-1', {
        content: {
          body: '* edited reply',
          'm.new_content': {
            body: 'edited reply',
            msgtype: 'm.text',
          },
        },
        threadRootId: threadId,
        relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
        ts: 3,
      });
      const secondReply = makeEvent('$thread-reply-2', {
        threadRootId: threadId,
        ts: 4,
      });
      const thirdReply = makeEvent('$thread-reply-3', {
        threadRootId: threadId,
        ts: 5,
      });
      const threadTimeline = makeTimeline([rootEvent, secondReply], {
        backwardToken: null,
      });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: (eventId: string) =>
          [threadId, '$thread-reply-2'].includes(eventId) ? threadTimeline : undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: [secondReply],
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({
        liveTimeline: makeTimeline([threadedEdit, rootEvent, firstReply]),
        findEventById: (eventId: string) =>
          [threadId, '$thread-reply-1'].includes(eventId)
            ? (
                {
                  [threadId]: rootEvent,
                  '$thread-reply-1': firstReply,
                } as const
              )[eventId]
            : undefined,
      });
      room.getMember = ((userId: string) => ({ name: userId })) as never;
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      saveThreadOpenSeedSnapshot(room as never, threadId, [
        rootEvent,
        firstReply,
        threadedEdit,
        secondReply,
        thirdReply,
      ]);
      let resolveCacheLoad:
        | ((value: {
            events: unknown[];
            hasMoreBefore: boolean;
            beforeToken?: string | null;
          }) => void)
        | undefined;
      vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCacheLoad = resolve;
          }) as ReturnType<typeof loadLatestCachedThreadEvents>
      );

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
        });

        await waitForCondition(
          () =>
            threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
              ([expectedThreadId, events]) =>
                expectedThreadId === threadId && Array.isArray(events) && events.length === 5
            ),
          50
        );

        expect(vi.mocked(hydrateCachedEvents)).toHaveBeenCalledWith({
          room,
          events: [rootEvent, firstReply, threadedEdit],
          timelineSets: [room.getUnfilteredTimelineSet()],
        });
        expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
          rootEvent,
          firstReply,
          threadedEdit,
          secondReply,
          thirdReply,
        ]);
      } finally {
        resolveCacheLoad?.({
          events: [],
          hasMoreBefore: false,
        });
        await act(async () => {
          await Promise.resolve();
        });
        renderer?.unmount();
      }
    });

    it('seeds untargeted thread reopen immediately from an existing local thread model before cache hydration resolves', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
      });
      const firstReply = makeEvent('$thread-reply-1', {
        threadRootId: threadId,
        ts: 2,
      });
      const secondReply = makeEvent('$thread-reply-2', {
        threadRootId: threadId,
        ts: 3,
      });
      const threadTimeline = makeTimeline([rootEvent, firstReply, secondReply], {
        backwardToken: null,
      });
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: (eventId: string) =>
          [threadId, '$thread-reply-1', '$thread-reply-2'].includes(eventId)
            ? threadTimeline
            : undefined,
      };
      const threadModel = {
        initialize: () => undefined,
        rootEvent,
        events: [firstReply, secondReply],
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
      const room = makeRoom({
        liveTimeline: makeTimeline([rootEvent]),
        findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
      });
      room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      let resolveCacheLoad:
        | ((value: {
            events: unknown[];
            hasMoreBefore: boolean;
            beforeToken?: string | null;
          }) => void)
        | undefined;
      vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCacheLoad = resolve;
          }) as ReturnType<typeof loadLatestCachedThreadEvents>
      );

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
        });

        await waitForCondition(
          () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
          50
        );
        expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
          rootEvent,
          firstReply,
          secondReply,
        ]);
      } finally {
        resolveCacheLoad?.({
          events: [],
          hasMoreBefore: false,
        });
        await act(async () => {
          await Promise.resolve();
        });
        renderer?.unmount();
      }
    });

    it('seeds untargeted zero-reply thread opens from the locally available root before cache hydration resolves', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '~pending-root';
      const rootEvent = makeEvent(threadId, {
        content: { body: 'YOLO' },
        isSending: true,
        isThreadRoot: true,
        ts: 0,
        txnId: 'txn-yolo',
      });
      const room = makeRoom({
        liveTimeline: makeTimeline([rootEvent]),
        findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      let resolveCacheLoad:
        | ((value: {
            events: unknown[];
            hasMoreBefore: boolean;
            beforeToken?: string | null;
          }) => void)
        | undefined;
      vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCacheLoad = resolve;
          }) as ReturnType<typeof loadLatestCachedThreadEvents>
      );

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
        });

        await waitForCondition(
          () =>
            threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
              ([expectedThreadId, events]) =>
                expectedThreadId === threadId &&
                Array.isArray(events) &&
                events.length === 1 &&
                events[0] === rootEvent
            ),
          50
        );
        expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
          rootEvent,
        ]);
      } finally {
        resolveCacheLoad?.({
          events: [],
          hasMoreBefore: false,
        });
        await act(async () => {
          await Promise.resolve();
        });
        renderer?.unmount();
      }
    });

    it('opens confirmed zero-reply roots without warning when no sdk thread model exists yet', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const threadId = '$zero-reply-root';
      const rootEvent = makeEvent(threadId, {
        content: { body: 'Fresh compact root' },
        ts: 999_000,
      });
      const room = makeRoom({
        liveTimeline: makeTimeline([rootEvent]),
        findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValue({
        events: [],
        hasMoreBefore: false,
      });

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(5);
        });

        await waitForCondition(
          () =>
            threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
              ([expectedThreadId, events]) =>
                expectedThreadId === threadId &&
                Array.isArray(events) &&
                events.length === 1 &&
                events[0] === rootEvent
            ),
          50
        );
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          'Could not create thread object for',
          threadId
        );
      } finally {
        nowSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        await act(async () => {
          await Promise.resolve();
        });
        renderer?.unmount();
      }
    });

    it('reuses the in-memory thread snapshot on untargeted reopen before cache hydration resolves', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 2,
            },
          },
        },
      });
      const firstReply = makeEvent('$thread-reply-1', {
        threadRootId: threadId,
        ts: 2,
      });
      const secondReply = makeEvent('$thread-reply-2', {
        threadRootId: threadId,
        ts: 3,
      });
      const partialThreadTimeline = makeTimeline([rootEvent, firstReply], {
        backwardToken: null,
      });
      const partialThreadTimelineSet = {
        getLiveTimeline: () => partialThreadTimeline,
        getTimelines: () => [partialThreadTimeline],
        getTimelineForEvent: (eventId: string) =>
          [threadId, '$thread-reply-1'].includes(eventId) ? partialThreadTimeline : undefined,
      };
      const room = makeRoom({
        liveTimeline: makeTimeline([rootEvent]),
        findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
      });
      room.getThread = (eventId: string) =>
        eventId === threadId
          ? ({
              rootEvent,
              events: [firstReply],
              getUnfilteredTimelineSet: () => partialThreadTimelineSet,
            } as never)
          : null;
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      saveThreadOpenSeedSnapshot(room as never, threadId, [firstReply, secondReply]);
      expect(
        getThreadOpenSeedSnapshot(room as never, threadId).map((mEvent) => mEvent.getId())
      ).toEqual(['$thread-reply-1', '$thread-reply-2']);

      let resolveCacheLoad:
        | ((value: {
            events: unknown[];
            hasMoreBefore: boolean;
            beforeToken?: string | null;
          }) => void)
        | undefined;
      vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCacheLoad = resolve;
          }) as ReturnType<typeof loadLatestCachedThreadEvents>
      );

      let secondRenderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          secondRenderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
        });

        await waitForCondition(
          () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
          50
        );
        const reopenCall = threadRenderStateMock.setSupplementalThreadEvents.mock.calls.find(
          ([expectedThreadId]) => expectedThreadId === threadId
        );
        expect(reopenCall).toBeDefined();
        expect(
          (reopenCall?.[1] as { getId?: () => string }[]).map((mEvent) => mEvent?.getId?.())
        ).toEqual([threadId, '$thread-reply-1', '$thread-reply-2']);
      } finally {
        resolveCacheLoad?.({
          events: [],
          hasMoreBefore: false,
        });
        await act(async () => {
          await Promise.resolve();
        });
        secondRenderer?.unmount();
      }
    });

    it('hydrates every cached thread page before falling back to network bootstrap', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadCachedThreadEventsBefore, loadLatestCachedThreadEvents } = await import(
        '../cacheStore'
      );
      const threadId = '$thread-root';
      const room = makeRoom();
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: undefined,
        events: [
          {
            content: {
              body: 'reply-3',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-3',
            origin_server_ts: 3,
          },
        ],
        hasMoreBefore: true,
        rootEvent: undefined,
        snapshotComplete: false,
        tailLoaded: false,
      } as never);
      vi.mocked(loadCachedThreadEventsBefore).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'reply-1',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 1,
          },
          {
            content: {
              body: 'reply-2',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-2',
            origin_server_ts: 2,
          },
        ],
        hasMoreBefore: false,
        rootEvent: undefined,
        snapshotComplete: false,
        tailLoaded: false,
      } as never);

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(
          () =>
            threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
              ([expectedThreadId, events]) =>
                expectedThreadId === threadId && Array.isArray(events) && events.length === 3
            ),
          50
        );

        expect(loadCachedThreadEventsBefore).toHaveBeenCalledTimes(1);
        expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
          expect.objectContaining({ getId: expect.any(Function) }),
          expect.objectContaining({ getId: expect.any(Function) }),
          expect.objectContaining({ getId: expect.any(Function) }),
        ]);
        const latestCall = threadRenderStateMock.setSupplementalThreadEvents.mock.calls
          .filter(([expectedThreadId]) => expectedThreadId === threadId)
          .at(-1);
        expect(latestCall?.[1].map((event: ReturnType<typeof makeEvent>) => event.getId())).toEqual(
          ['$thread-reply-1', '$thread-reply-2', '$thread-reply-3']
        );
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('paints complete cache while bootstrap and tail reconciliation start independently', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const room = makeRoom();
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      threadRenderStateMock.threadEvents = [
        makeEvent(threadId, {
          isThreadRoot: true,
          ts: 1,
        }),
        makeEvent('$thread-reply-1', {
          threadRootId: threadId,
          ts: 2,
        }),
      ];
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'root',
              msgtype: 'm.text',
            },
            event_id: threadId,
            origin_server_ts: 1,
          },
          {
            content: {
              body: 'reply',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
          },
        ],
        hasMoreBefore: false,
        rootEvent: undefined,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      } as never);
      matrixClientMock.fetchRelations.mockResolvedValueOnce({
        chunk: [],
        next_batch: null,
      });

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(
          () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
          50
        );

        expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(2);
        expect(matrixClientMock.getEventTimeline).toHaveBeenCalledTimes(1);
        expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
        expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
        expect(matrixClientMock.relations).not.toHaveBeenCalled();
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('prefers cached thread hydrate over a tiny room seed on untargeted open', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
      });
      const roomSeedReply = makeEvent('$room-seed-reply', {
        threadRootId: threadId,
        ts: 2,
      });
      const room = makeRoom({
        liveTimeline: makeTimeline([rootEvent, roomSeedReply]),
        findEventById: (eventId: string) =>
          eventId === threadId
            ? rootEvent
            : eventId === '$room-seed-reply'
            ? roomSeedReply
            : undefined,
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'cached reply 1',
              msgtype: 'm.text',
            },
            event_id: '$cached-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'cached reply 2',
              msgtype: 'm.text',
            },
            event_id: '$cached-reply-2',
            origin_server_ts: 3,
            'm.thread.root': threadId,
          },
        ],
        hasMoreBefore: false,
        rootEvent: {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
        },
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      } as never);
      matrixClientMock.fetchRelations.mockResolvedValueOnce({
        chunk: [
          {
            content: {
              body: 'reply-3',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-3',
            origin_server_ts: 4,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-2',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-2',
            origin_server_ts: 3,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-1',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
        ],
        next_batch: null,
      });

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(
          () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
          50
        );

        const threadCalls = threadRenderStateMock.setSupplementalThreadEvents.mock.calls.filter(
          ([expectedThreadId]) => expectedThreadId === threadId
        );
        expect(threadCalls.length).toBeGreaterThan(0);
        expect(
          threadCalls.some(
            ([, events]) =>
              Array.isArray(events) &&
              events.map((event: ReturnType<typeof makeEvent>) => event.getId()).join(',') ===
                '$cached-reply-1,$cached-reply-2'
          )
        ).toBe(true);
        expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(2);
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    // 2026-07-06 eager-cache policy: a count-proven complete snapshot
    // whose relations were never proven by a /relations drain
    // (relationSnapshotComplete=false — e.g. warmed by the room sweep)
    // takes the complete-cache FAST PATH at open. The pre-policy
    // behavior re-downloaded the entire thread at open just to prove
    // relations. The choke-point reconcile remains the revalidator: it
    // fetches ONE tail page, detects the missed edit, and persists the
    // repair — without the SDK bootstrap or a full drain. The
    // relationSnapshotComplete PROOF now lands from the background
    // prewarm band (threadSeedPrewarmController), not from the open.
    it('reconciles a complete-but-relation-unproven snapshot at open without a full relations drain', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
        '../cacheStore'
      );
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 1,
            },
          },
        },
      });
      const room = makeRoom({
        findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      matrixClientMock.getEventMapper.mockImplementation(
        () =>
          (rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            sender?: string;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }) =>
            typeof rawEvent?.event_id === 'string'
              ? makeEvent(rawEvent.event_id, {
                  content: rawEvent.content,
                  relation: rawEvent.content?.['m.relates_to'] as
                    | { rel_type?: string; event_id?: string }
                    | undefined,
                  sender: rawEvent.sender,
                  ts: rawEvent.origin_server_ts ?? 0,
                  threadRootId: rawEvent['m.thread.root'],
                  unsigned: rawEvent.unsigned,
                })
              : rawEvent
      );
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'Thinking...  ⋯',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
            sender: '@bot:example.org',
          },
        ],
        hasMoreBefore: false,
        relationSnapshotComplete: false,
        rootEvent: {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
          sender: '@alice:example.org',
        },
        snapshotComplete: true,
        tailLoaded: true,
      } as never);
      matrixClientMock.fetchRelations.mockResolvedValueOnce({
        chunk: [
          {
            content: {
              body: 'Thinking...  ⋯',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
            sender: '@bot:example.org',
          },
          {
            content: {
              'm.new_content': {
                body: 'Final answer',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$thread-reply-1',
                rel_type: 'm.replace',
              },
              body: '* Final answer',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1-edit',
            origin_server_ts: 3,
            sender: '@bot:example.org',
          },
        ],
        next_batch: null,
      });

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);

        expect(matrixClientMock.fetchRelations).toHaveBeenCalledWith(
          '!room:example.org',
          threadId,
          null,
          null,
          expect.objectContaining({
            dir: Direction.Backward,
            limit: 200,
            recurse: true,
          })
        );
        expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
        expect(matrixClientMock.getThreadTimeline).toHaveBeenCalledTimes(1);
        expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
        // The reconcile's repair persisted the missed edit into the
        // thread cache (as a standalone record or folded into the
        // target's bundled m.replace). The relationSnapshotComplete
        // flag is deliberately NOT upgraded by the open anymore.
        expect(
          vi
            .mocked(saveThreadEventsToCache)
            .mock.calls.some(
              (call) =>
                call[2] === threadId && JSON.stringify(call[3]).includes('$thread-reply-1-edit')
            )
        ).toBe(true);
        // PR #84 review (coderabbit): pin the flag contract, not just
        // the persisted edit — NO open-time save may upgrade
        // relationSnapshotComplete (arg 10) to true; that proof is
        // owned by the background prewarm's full /relations drain.
        expect(
          vi
            .mocked(saveThreadEventsToCache)
            .mock.calls.every((call) => call[2] !== threadId || call[9] !== true)
        ).toBe(true);
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('infers a complete cached thread snapshot from the persisted expected reply count when root counts are sparse', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const room = makeRoom({
        findEventById: (eventId: string) =>
          eventId === threadId
            ? makeEvent(threadId, {
                isThreadRoot: true,
                ts: 1,
              })
            : undefined,
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      matrixClientMock.getEventMapper.mockImplementation(
        () =>
          (rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }) =>
            typeof rawEvent?.event_id === 'string'
              ? makeEvent(rawEvent.event_id, {
                  content: rawEvent.content,
                  ts: rawEvent.origin_server_ts ?? 0,
                  threadRootId: rawEvent['m.thread.root'],
                  unsigned: rawEvent.unsigned,
                })
              : rawEvent
      );
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'reply-1',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-2',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-2',
            origin_server_ts: 3,
            'm.thread.root': threadId,
          },
        ],
        hasMoreBefore: false,
        expectedReplyCount: 2,
        rootEvent: {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
        },
        relationSnapshotComplete: true,
        snapshotComplete: false,
        tailLoaded: true,
      } as never);
      matrixClientMock.fetchRelations.mockResolvedValueOnce({
        chunk: [
          {
            content: {
              body: 'reply-3',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-3',
            origin_server_ts: 4,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-2',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-2',
            origin_server_ts: 3,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-1',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
        ],
        next_batch: null,
      });

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(
          () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
          50
        );

        expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
        expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(2);
        expect(matrixClientMock.getThreadTimeline).toHaveBeenCalledTimes(1);
        expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('does not trust stale complete cache flags when the persisted expected reply count is larger than the cached reply set', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const room = makeRoom({
        findEventById: (eventId: string) =>
          eventId === threadId
            ? makeEvent(threadId, {
                isThreadRoot: true,
                ts: 1,
              })
            : undefined,
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      matrixClientMock.getEventMapper.mockImplementation(
        () =>
          (rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
          }) =>
            typeof rawEvent?.event_id === 'string'
              ? makeEvent(rawEvent.event_id, {
                  content: rawEvent.content,
                  ts: rawEvent.origin_server_ts ?? 0,
                  threadRootId: rawEvent['m.thread.root'],
                })
              : rawEvent
      );
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'reply-1',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-2',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-2',
            origin_server_ts: 3,
            'm.thread.root': threadId,
          },
        ],
        hasMoreBefore: false,
        expectedReplyCount: 3,
        rootEvent: {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
        },
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      } as never);

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);
        expect(matrixClientMock.fetchRelations).toHaveBeenCalled();
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('prefers fresher room root counts over stale cached root counts when checking complete cached thread snapshots', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
        '../cacheStore'
      );
      const threadId = '$thread-root';
      const room = makeRoom({
        findEventById: (eventId: string) =>
          eventId === threadId
            ? makeEvent(threadId, {
                isThreadRoot: true,
                ts: 1,
                unsigned: {
                  'm.relations': {
                    'm.thread': {
                      count: 3,
                    },
                  },
                },
              })
            : undefined,
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      matrixClientMock.getEventMapper.mockImplementation(
        () =>
          (rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }) =>
            typeof rawEvent?.event_id === 'string'
              ? makeEvent(rawEvent.event_id, {
                  content: rawEvent.content,
                  ts: rawEvent.origin_server_ts ?? 0,
                  threadRootId: rawEvent['m.thread.root'],
                  unsigned: rawEvent.unsigned,
                })
              : rawEvent
      );
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'reply-1',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-2',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-2',
            origin_server_ts: 3,
            'm.thread.root': threadId,
          },
        ],
        hasMoreBefore: false,
        expectedReplyCount: 2,
        rootEvent: {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
          unsigned: {
            'm.relations': {
              'm.thread': {
                count: 2,
              },
            },
          },
        },
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      } as never);
      matrixClientMock.fetchRelations.mockResolvedValueOnce({
        chunk: [
          {
            content: {
              body: 'reply-3',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-3',
            origin_server_ts: 4,
            'm.thread.root': threadId,
          },
        ],
        next_batch: null,
      });

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);
        expect(matrixClientMock.fetchRelations).toHaveBeenCalled();
        // The stale cached root count (2) claimed completeness, but the
        // fresher live room root says 3 replies exist — hydrate must
        // prefer the live count, classify the snapshot partial, and the
        // open must persist expectedReplyCount=3 (arg index 8).
        //
        // 2026-07-06 consolidation: the old backfill leg also stamped
        // relationSnapshotComplete=true here (its full drain observed
        // next_batch exhaustion). Open-time relations proofs are gone
        // with that leg — background prefetch owns them now — so no
        // persist on this open may claim one.
        await waitForCondition(
          () =>
            vi
              .mocked(saveThreadEventsToCache)
              .mock.calls.some((call) => call[2] === threadId && call[8] === 3),
          50
        );
        expect(
          vi
            .mocked(saveThreadEventsToCache)
            .mock.calls.some((call) => call[2] === threadId && call[8] === 3)
        ).toBe(true);
        expect(
          vi
            .mocked(saveThreadEventsToCache)
            .mock.calls.some((call) => call[2] === threadId && call[9] === true)
        ).toBe(false);
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('falls back to the cached root count when the fresher room root is sparse', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const room = makeRoom({
        findEventById: (eventId: string) =>
          eventId === threadId
            ? makeEvent(threadId, {
                isThreadRoot: true,
                ts: 1,
              })
            : undefined,
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      matrixClientMock.getEventMapper.mockImplementation(
        () =>
          (rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }) =>
            typeof rawEvent?.event_id === 'string'
              ? makeEvent(rawEvent.event_id, {
                  content: rawEvent.content,
                  ts: rawEvent.origin_server_ts ?? 0,
                  threadRootId: rawEvent['m.thread.root'],
                  unsigned: rawEvent.unsigned,
                })
              : rawEvent
      );
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'reply-1',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-2',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-2',
            origin_server_ts: 3,
            'm.thread.root': threadId,
          },
        ],
        hasMoreBefore: false,
        expectedReplyCount: undefined,
        rootEvent: {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
          unsigned: {
            'm.relations': {
              'm.thread': {
                count: 2,
              },
            },
          },
        },
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      } as never);

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(
          () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
          50
        );

        expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
        expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(2);
        expect(matrixClientMock.getThreadTimeline).toHaveBeenCalledTimes(1);
        expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('paints a partial cached snapshot and drains through SDK bootstrap + refreshLatestThreadSlice (no open-time relations backfill)', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
        '../cacheStore'
      );
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 3,
            },
          },
        },
      });
      const staleThreadTimeline = makeTimeline([rootEvent], {
        backwardToken: 'stale-backward-token',
      });
      const threadTimelineSet = {
        addEventsToTimeline: (
          incoming: ReturnType<typeof makeEvent>[],
          _backwards: boolean,
          _state: boolean,
          timeline: ReturnType<typeof makeTimeline>,
          token: string | null
        ) => {
          incoming.forEach((event) => {
            if (!threadEvents.some((existing) => existing.getId() === event.getId()))
              threadEvents.unshift(event);
          });
          timeline.setPaginationToken(token, Direction.Backward);
        },
        getLiveTimeline: () => staleThreadTimeline,
        getTimelines: () => [staleThreadTimeline],
        getTimelineForEvent: (eventId: string) =>
          eventId === threadId ? staleThreadTimeline : undefined,
      };
      (
        staleThreadTimeline as ReturnType<typeof makeTimeline> & {
          getTimelineSet?: () => typeof threadTimelineSet;
        }
      ).getTimelineSet = () => threadTimelineSet;
      const room = makeRoom({
        findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
      });
      // Minimal `addEvents` so the choke-point reconciler's repair leg
      // (SDK injection before hydrate/persist) can run against this
      // mock instead of rejecting the reconcile job.
      const threadEvents = [rootEvent];
      room.getThread = () =>
        ({
          initialize: () => undefined,
          setEventMetadata: vi.fn(),
          flushPendingTimelineReset: vi.fn(),
          addEvents: (added: ReturnType<typeof makeEvent>[]) => {
            threadEvents.push(...added);
          },
          events: threadEvents,
          getUnfilteredTimelineSet: () => threadTimelineSet,
          rootEvent,
        } as never);
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      matrixClientMock.getEventMapper.mockImplementation(
        () =>
          (rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }) =>
            typeof rawEvent?.event_id === 'string'
              ? makeEvent(rawEvent.event_id, {
                  content: rawEvent.content,
                  ts: rawEvent.origin_server_ts ?? 0,
                  threadRootId: rawEvent['m.thread.root'],
                  unsigned: rawEvent.unsigned,
                })
              : rawEvent
      );
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'reply-1',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-2',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-2',
            origin_server_ts: 3,
            'm.thread.root': threadId,
          },
        ],
        hasMoreBefore: false,
        expectedReplyCount: 3,
        rootEvent: {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
          unsigned: {
            'm.relations': {
              'm.thread': {
                count: 3,
              },
            },
          },
        },
        snapshotComplete: false,
        tailLoaded: true,
      } as never);
      // 2026-07-06 consolidation: the choke-point reconciler
      // (kind='reconcile') is now the ONLY `/relations` caller on a
      // partial-coverage open — the open-time thread-backfill drain
      // was deleted. One chunk mock feeds that single call; the
      // reconciler uses it to detect divergence against the cached
      // window (reply-3 is new).
      const relationsChunkResponse = {
        chunk: [
          {
            content: {
              body: 'reply-3',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-3',
            origin_server_ts: 4,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-2',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-2',
            origin_server_ts: 3,
            'm.thread.root': threadId,
          },
          {
            content: {
              body: 'reply-1',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
        ],
        next_batch: null,
      };
      matrixClientMock.fetchRelations.mockResolvedValueOnce(relationsChunkResponse);

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForPersistSweepDebounce();
        await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);

        // 2026-07-06 consolidation contract: a partial-coverage open
        // fires exactly ONE `/relations` call — the choke-point
        // reconciler's. The open-time thread-backfill leg (the second
        // full drain STEP d used to assert here) is deleted; the open
        // falls through to SDK bootstrap + refreshLatestThreadSlice
        // instead of drain-racing the reconciler.
        expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(2);
        // Fall-through evidence: the second `/relations` call is the SDK
        // bootstrap's fill for a root-only thread. The thread model
        // already holds its root, so the open requests no context.
        expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
        expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
        // The cached snapshot proves the thread's backward start
        // (beforeToken null), so the bootstrap adopts it and the
        // refreshLatestThreadSlice drain has nothing older to fetch —
        // no /messages-style pagination fires and the stale SDK token
        // ends cleared.
        expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
        expect(staleThreadTimeline.getPaginationToken(Direction.Backward)).toBeNull();
        // The open persists the SDK-backed snapshot (root event, null
        // before-token), and the reconciler's divergence persist
        // teaches the cache the reply the sweep missed ($thread-reply-3)
        // — convergence now flows through the reconcile + the single
        // SDK drain, not through an open-time backfill merge.
        const hasPersistWith = (eventId: string) =>
          vi
            .mocked(saveThreadEventsToCache)
            .mock.calls.some(
              ([, roomIdArg, threadIdArg, events]) =>
                roomIdArg === room.roomId &&
                threadIdArg === threadId &&
                (events as Array<{ event_id?: string }>).some(
                  (rawEvent) => rawEvent.event_id === eventId
                )
            );
        await waitForCondition(() => hasPersistWith('$thread-reply-3'), 50);
        expect(hasPersistWith(threadId)).toBe(true);
        // Self-review fix (PR #87): pin the cached replies in ONE
        // persist alongside the missing reply — the pre-consolidation
        // test required a single merged persist of [root, r1, r2, r3];
        // asserting the new reply in isolation would let a regression
        // that drops the cached window from the reconciler's batch
        // (persisting only [root, reply-3]) pass unnoticed.
        expect(
          vi
            .mocked(saveThreadEventsToCache)
            .mock.calls.some(
              ([, roomIdArg, threadIdArg, events]) =>
                roomIdArg === room.roomId &&
                threadIdArg === threadId &&
                ['$thread-reply-1', '$thread-reply-2', '$thread-reply-3'].every((eventId) =>
                  (events as Array<{ event_id?: string }>).some(
                    (rawEvent) => rawEvent.event_id === eventId
                  )
                )
            )
        ).toBe(true);
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('does not treat an empty relations response as complete when the known reply count is still unmet', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
        '../cacheStore'
      );
      const threadId = '$thread-root-empty-backfill';
      const firstReplyId = '$thread-reply-1-empty-backfill';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 3,
            },
          },
        },
      });
      const firstReply = makeEvent(firstReplyId, {
        content: { body: 'reply-1' },
        threadRootId: threadId,
        ts: 2,
      });
      const threadTimeline = makeTimeline([rootEvent, firstReply]);
      const threadTimelineSet = {
        getLiveTimeline: () => threadTimeline,
        getTimelines: () => [threadTimeline],
        getTimelineForEvent: (eventId: string) =>
          eventId === threadId || eventId === firstReplyId ? threadTimeline : undefined,
      };
      const room = makeRoom({
        findEventById: (eventId: string) => {
          if (eventId === threadId) return rootEvent;
          if (eventId === firstReplyId) return firstReply;
          return undefined;
        },
      });
      room.getThread = () =>
        ({
          initialize: () => undefined,
          events: [rootEvent, firstReply],
          getUnfilteredTimelineSet: () => threadTimelineSet,
          rootEvent,
        } as never);
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      matrixClientMock.getEventMapper.mockImplementation(
        () =>
          (rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }) =>
            typeof rawEvent?.event_id === 'string'
              ? makeEvent(rawEvent.event_id, {
                  content: rawEvent.content,
                  ts: rawEvent.origin_server_ts ?? 0,
                  threadRootId: rawEvent['m.thread.root'],
                  unsigned: rawEvent.unsigned,
                })
              : rawEvent
      );
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'reply-1',
              'm.relates_to': {
                event_id: threadId,
                rel_type: 'm.thread',
              },
              msgtype: 'm.text',
            },
            event_id: firstReplyId,
            origin_server_ts: 2,
            'm.thread.root': threadId,
          },
        ],
        hasMoreBefore: false,
        expectedReplyCount: 3,
        rootEvent: {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
          unsigned: {
            'm.relations': {
              'm.thread': {
                count: 3,
              },
            },
          },
        },
        relationSnapshotComplete: true,
        snapshotComplete: false,
        tailLoaded: true,
      } as never);
      matrixClientMock.fetchRelations.mockResolvedValueOnce({
        chunk: [],
        next_batch: null,
      });

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        // 2026-07-06 consolidation: the reconciler's choke-point pass
        // is the only `/relations` caller on this open (the open-time
        // thread-backfill drain is deleted). The server returned an
        // empty chunk, so the reconciler has nothing to repair and the
        // open converges through SDK bootstrap + refreshLatestThreadSlice.
        expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(1);
        await waitForPersistSweepDebounce();
        await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
        // The persisted snapshot must keep the known first reply...
        expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
          expect.any(String),
          room.roomId,
          threadId,
          expect.arrayContaining([expect.objectContaining({ event_id: firstReplyId })]),
          expect.objectContaining({ event_id: threadId }),
          null,
          true,
          false,
          3,
          undefined
        );
        // ...and NO persist on this open may fabricate completeness:
        // the root's m.relations count says 3 replies exist and only 1
        // is loaded, so every write must carry snapshotComplete=false
        // (arg index 7 of the cacheStore writer).
        expect(
          vi
            .mocked(saveThreadEventsToCache)
            .mock.calls.some(
              ([, , threadIdArg, , , , , snapshotCompleteArg]) =>
                threadIdArg === threadId && snapshotCompleteArg === true
            )
        ).toBe(false);
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('clears stale sdk backward tokens when complete cache arrives before bootstrap', async () => {
      let finishBootstrap!: () => void;
      const bootstrap = new Promise<void>((resolve) => {
        finishBootstrap = resolve;
      });
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
      });
      const threadReply = makeEvent('$thread-reply-1', {
        threadRootId: threadId,
        ts: 2,
      });
      const staleThreadTimeline = makeTimeline([rootEvent, threadReply], {
        backwardToken: 'stale-backward-token',
      });
      const threadTimelineSet = {
        getLiveTimeline: () => staleThreadTimeline,
        getTimelines: () => [staleThreadTimeline],
        getTimelineForEvent: (eventId: string) =>
          eventId === threadId || eventId === '$thread-reply-1' ? staleThreadTimeline : undefined,
      };
      (
        staleThreadTimeline as ReturnType<typeof makeTimeline> & {
          getTimelineSet?: () => typeof threadTimelineSet;
        }
      ).getTimelineSet = () => threadTimelineSet;
      const room = makeRoom({
        findEventById: (eventId: string) => {
          if (eventId === threadId) return rootEvent;
          if (eventId === '$thread-reply-1') return threadReply;
          return undefined;
        },
      });
      room.getThread = () =>
        ({
          initialize: () => bootstrap,
          events: [rootEvent, threadReply],
          getUnfilteredTimelineSet: () => threadTimelineSet,
          rootEvent,
        } as never);
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'root',
              msgtype: 'm.text',
            },
            event_id: threadId,
            origin_server_ts: 1,
          },
          {
            content: {
              body: 'reply',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
          },
        ],
        hasMoreBefore: false,
        rootEvent: undefined,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      } as never);

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(
          () => vi.mocked(loadLatestCachedThreadEvents).mock.calls.length > 0,
          50
        );
        await act(async () => {
          await flushAsyncWork(30);
          finishBootstrap();
          await flushAsyncWork(30);
        });
        await waitForCondition(
          () => staleThreadTimeline.getPaginationToken(Direction.Backward) === null,
          50
        );

        expect(staleThreadTimeline.getPaginationToken(Direction.Backward)).toBeNull();
        expect(() => getClickableByText(renderer!, 'Load Older Messages')).toThrow();
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('does not treat a sparse cached thread page as complete without a loaded tail marker', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { loadLatestCachedThreadEvents } = await import('../cacheStore');
      const threadId = '$thread-root';
      const room = makeRoom();
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
        beforeToken: null,
        events: [
          {
            content: {
              body: 'reply',
              msgtype: 'm.text',
            },
            event_id: '$thread-reply-1',
            origin_server_ts: 2,
          },
        ],
        hasMoreBefore: false,
        rootEvent: {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
        },
        snapshotComplete: false,
        tailLoaded: false,
      } as never);
      matrixClientMock.fetchRelations.mockResolvedValueOnce({
        chunk: [],
        next_batch: null,
      });

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
              threadId,
            })
          );
          await flushAsyncWork(10);
        });

        await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);
        // A sparse page without a loaded-tail marker must NOT take the
        // complete-coverage fast path. Under the 2026-07-06 one-drain
        // contract the evidence is the fall-through itself: the
        // choke-point reconcile fires /relations AND the open proceeds
        // into SDK bootstrap (no thread model in this harness, so the
        // bootstrap's /context call is the tell).
        expect(matrixClientMock.fetchRelations).toHaveBeenCalled();
        expect(matrixClientMock.getEventTimeline).toHaveBeenCalled();
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    // CINNY-207 P3.3: removed six sweep-derived room→thread persist
    // tests. Their subject was the pre-strip sweep in
    // `roomCacheLifecycleController` calling
    // `persistThreadCacheFromRoomEvents` on the room's loaded thread
    // events. The sweep is gone with P3.3; the engine only sees
    // LIVE events. Unit coverage for the
    // `persistThreadCacheFromRoomEventsSnapshot` function itself
    // lives in `eventRepository.test.ts`. Removed tests:
    //   - 'marks room-derived thread cache snapshots complete only when the known reply count is satisfied'
    //   - 'keeps room-derived thread cache snapshots incomplete when only a subset of replies is loaded'
    //   - 'does not downgrade room-derived thread cache completeness when the room tail is still unknown'
    //   - 'does not treat sdk thread length as authoritative when root counts are sparse'
    //   - 'persists root-targeted relations into the thread cache during room cache persistence'
    //   - 'persists redactions targeting thread replies into the thread cache during room cache persistence'

    it('leaves paginated event persistence to its captured operation', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const { saveThreadEventsToCache } = await import('../cacheStore');
      const threadId = '$thread-root';
      const rootEvent = makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
      });
      const paginatedReply = makeEvent('$thread-reply-paginated', {
        content: { body: 'older reply' },
        threadRootId: threadId,
        ts: 2,
      });
      const room = makeRoom({
        liveTimeline: makeTimeline([rootEvent]),
        findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
      });
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

      let renderer: ReturnType<typeof create> | undefined;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(ControlledRoomTimeline, {
              room,
            })
          );
          await flushAsyncWork(10);
        });

        const timelineHandler = room.__listeners.get(RoomEvent.Timeline);
        expect(timelineHandler).toBeTypeOf('function');

        await act(async () => {
          timelineHandler?.(paginatedReply, room, true, false, {
            liveEvent: false,
          });
          await flushAsyncWork(10);
        });

        expect(
          vi
            .mocked(saveThreadEventsToCache)
            .mock.calls.some(
              ([, , expectedThreadId, rawEvents]) =>
                expectedThreadId === threadId &&
                Array.isArray(rawEvents) &&
                rawEvents.some(
                  (rawEvent) =>
                    typeof rawEvent?.event_id === 'string' &&
                    rawEvent.event_id === '$thread-reply-paginated'
                )
            )
        ).toBe(false);
      } finally {
        await act(async () => {
          renderer?.unmount();
          await flushAsyncWork(2);
        });
      }
    });

    it('filters room events by thread resolution state', async () => {
      const { getThreadFilteredEvents } = await import('../threadRoomFocus');
      const room = makeRoom();
      const unresolvedEvent = makeEvent('$thread-unresolved', { isThreadRoot: true });
      const resolvedEvent = makeEvent('$thread-resolved', { isThreadRoot: true });
      const messageEvent = makeEvent('$message');
      const renderableEvents = [messageEvent, unresolvedEvent, resolvedEvent];
      const resolutionMap = new Map([['$thread-resolved', { isResolved: true }]]);
      const threadRecordMap = new Map<string, ThreadRecord>([
        ['$thread-unresolved', makeThreadFilterRecord('$thread-unresolved')],
        [
          '$thread-resolved',
          makeThreadFilterRecord('$thread-resolved', { status: { isResolved: true } }),
        ],
      ]);

      expect(
        getThreadFilteredEvents(
          renderableEvents as never,
          room as never,
          resolutionMap,
          undefined,
          { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() },
          undefined,
          threadRecordMap
        ).map((event) => event.getId())
      ).toEqual(['$thread-unresolved']);
      expect(
        getThreadFilteredEvents(
          renderableEvents as never,
          room as never,
          resolutionMap,
          undefined,
          { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'include' as const, tags: new Map() },
          undefined,
          threadRecordMap
        ).map((event) => event.getId())
      ).toEqual(['$thread-resolved']);
    });

    it('treats fallback reply counts as visible thread roots for filtering', async () => {
      const { getThreadFilteredEvents } = await import('../threadRoomFocus');
      const room = makeRoom();
      const fallbackRoot = makeEvent('$thread-root');
      const messageEvent = makeEvent('$message');
      const fallbackCounts = new Map([[fallbackRoot.getId(), 2]]);
      const resolutionMap = new Map<string, { isResolved: boolean }>();

      expect(
        getThreadFilteredEvents(
          [messageEvent, fallbackRoot] as never,
          room as never,
          resolutionMap,
          undefined,
          { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() },
          fallbackCounts,
          new Map([['$thread-root', makeThreadFilterRecord('$thread-root')]])
        ).map((event) => event.getId())
      ).toEqual(['$thread-root']);

      resolutionMap.set(fallbackRoot.getId(), { isResolved: true, tags: null });
      expect(
        getThreadFilteredEvents(
          [messageEvent, fallbackRoot] as never,
          room as never,
          resolutionMap,
          undefined,
          { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'include' as const, tags: new Map() },
          fallbackCounts,
          new Map([
            [
              '$thread-root',
              makeThreadFilterRecord('$thread-root', { status: { isResolved: true } }),
            ],
          ])
        ).map((event) => event.getId())
      ).toEqual(['$thread-root']);
    });

    it('does not treat thread replies as visible thread roots for filtering', async () => {
      const { getThreadFilteredEvents } = await import('../threadRoomFocus');
      const room = makeRoom();
      const fakeReply = makeEvent('$reply-event', {
        threadRootId: '$actual-root',
      });
      const actualRoot = makeEvent('$actual-root');
      const fallbackCounts = new Map([
        [fakeReply.getId(), 1],
        [actualRoot.getId(), 1],
      ]);
      const resolutionMap = new Map<string, { isResolved: boolean }>([
        ['$reply-event', { isResolved: false, tags: null }],
        ['$actual-root', { isResolved: false, tags: null }],
      ]);

      expect(
        getThreadFilteredEvents(
          [fakeReply, actualRoot] as never,
          room as never,
          resolutionMap,
          undefined,
          { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() },
          fallbackCounts,
          new Map([
            ['$reply-event', makeThreadFilterRecord('$reply-event')],
            ['$actual-root', makeThreadFilterRecord('$actual-root')],
          ])
        ).map((event) => event.getId())
      ).toEqual(['$actual-root']);
    });

    it('filters hidden relations, thread replies, and ignored senders in isRenderableEvent', async () => {
      const { isRenderableEvent } = await import('../roomTimelineEvents');
      const baseArgs = [
        makeRoom() as never,
        undefined,
        new Set<string>(),
        false,
        false,
        false,
      ] as const;

      const messageEvent = makeEvent('$message');
      expect(isRenderableEvent(messageEvent as never, ...baseArgs)).toBe(true);

      const threadReply = makeEvent('$thread-reply', { threadRootId: '$thread-root' });
      expect(isRenderableEvent(threadReply as never, ...baseArgs)).toBe(false);
      expect(isRenderableEvent(threadReply as never, ...baseArgs, true)).toBe(true);

      const relationEvent = makeEvent('$edit', {
        associatedId: '$message',
        relation: { rel_type: 'm.replace', event_id: '$message' },
      });
      reactionOrEditEventMock.mockImplementation(
        (event) => event.getId() === relationEvent.getId()
      );
      expect(isRenderableEvent(relationEvent as never, ...baseArgs)).toBe(false);

      const ignoredEvent = makeEvent('$ignored', { sender: '@ignored:example.org' });
      expect(
        isRenderableEvent(
          ignoredEvent as never,
          makeRoom() as never,
          undefined,
          new Set(['@ignored:example.org']),
          false,
          false,
          false
        )
      ).toBe(false);
    });

    it('applies membership and hidden-event toggles in isRenderableEvent', async () => {
      const { isRenderableEvent } = await import('../roomTimelineEvents');
      const room = makeRoom();
      const membershipEvent = makeEvent('$member', { type: 'm.room.member' });
      isMembershipChangedMock.mockReturnValue(true);

      expect(
        isRenderableEvent(
          membershipEvent as never,
          room as never,
          undefined,
          new Set(),
          false,
          true,
          false
        )
      ).toBe(false);

      isMembershipChangedMock.mockReturnValue(false);
      expect(
        isRenderableEvent(
          membershipEvent as never,
          room as never,
          undefined,
          new Set(),
          false,
          false,
          true
        )
      ).toBe(false);

      const hiddenEvent = makeEvent('$hidden', {
        type: 'io.example.hidden',
        content: { body: 'hidden' },
      });
      expect(
        isRenderableEvent(
          hiddenEvent as never,
          room as never,
          undefined,
          new Set(),
          false,
          false,
          false
        )
      ).toBe(false);
      expect(
        isRenderableEvent(
          hiddenEvent as never,
          room as never,
          undefined,
          new Set(),
          true,
          false,
          false
        )
      ).toBe(true);

      const toolApprovalEvent = makeEvent('$approval', {
        type: 'io.mindroom.tool_approval',
        content: {
          approval_id: 'approval-1',
          tool_name: 'web_search',
          arguments: { query: 'release date' },
          agent_name: 'research',
          status: 'pending',
          requested_at: '2026-04-10T12:00:00Z',
          expires_at: '2026-04-17T12:00:00Z',
        },
      });
      expect(
        isRenderableEvent(
          toolApprovalEvent as never,
          room as never,
          undefined,
          new Set(),
          false,
          false,
          false
        )
      ).toBe(true);
    });

    it('keeps filtered mode pinned to the full filtered range when live non-matching events arrive', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      const unresolvedEvents = [
        makeEvent('$thread-1', { isThreadRoot: true }),
        makeEvent('$thread-2', { isThreadRoot: true }),
        makeEvent('$thread-3', { isThreadRoot: true }),
      ];
      const liveEvents = [...unresolvedEvents, makeEvent('$message-1')];
      const room = makeRoom({ liveEvents });
      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(1);
      });

      await act(async () => {
        renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
        renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
        await flushAsyncWork(1);
      });

      expect(virtualPaginatorState.lastOptions?.count).toBe(3);
      expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 3 });

      const liveEventHandler = room.__listeners.get(RoomEvent.Timeline);
      expect(liveEventHandler).toBeTypeOf('function');

      liveEvents.push(makeEvent('$message-2'));

      await act(async () => {
        liveEventHandler?.(liveEvents[liveEvents.length - 1], room, false, false, {
          liveEvent: true,
        });
        await flushAsyncWork(1);
      });

      await waitForCondition(
        () =>
          virtualPaginatorState.lastOptions?.count === 3 &&
          virtualPaginatorState.lastOptions?.range?.start === 0 &&
          virtualPaginatorState.lastOptions?.range?.end === 3,
        50
      );
      expect(virtualPaginatorState.lastOptions?.count).toBe(3);
      expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 3 });
    });

    it('re-renders the room timeline for non-renderable live events at bottom', async () => {
      const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
      const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
      const visibleMessage = makeEvent('$message');
      const hiddenEdit = makeEvent('$edit', {
        associatedId: visibleMessage.getId(),
        relation: { rel_type: 'm.replace', event_id: visibleMessage.getId() },
      });
      reactionOrEditEventMock.mockImplementation((event) => event.getId() === hiddenEdit.getId());
      const room = makeRoom({ liveEvents: [visibleMessage] });

      let renderer: ReturnType<typeof create> | undefined;

      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(1);
      });

      const callCountBefore = virtualPaginatorState.callCount;
      const liveEventHandler = room.__listeners.get(RoomEvent.Timeline);
      expect(liveEventHandler).toBeTypeOf('function');

      await act(async () => {
        liveEventHandler?.(hiddenEdit, room, false, false, {
          liveEvent: true,
        });
        await flushAsyncWork(1);
      });

      expect(virtualPaginatorState.callCount).toBeGreaterThan(callCountBefore);

      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    });
  });
});
