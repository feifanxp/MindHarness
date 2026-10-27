import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ledger lifecycle pins (mutant audit 2026-07-07):
//  1. settle GENERATION guard — a ledger settle wait armed in a previous
//     thread must not settle the next thread's ledger (mutant #4), and the
//     render-time ledger reset must land ABOVE the useVirtualizer call so
//     the FIRST post-switch render already reads scrollMargin 0 (mutants
//     #7a/#7b — PR #88's stale-scrollMargin major).
//  2. room prepend debt is consumed by exactly one commit and is discarded
//     with its outstanding settle wait when the surface key changes.
//  3. open-at-latest latch keying — the render-time key reset and the
//     stale-pending guard (mutants #11a/#11b).
//
// The quiescence module is mocked with MANUALLY RESOLVED deferreds for the
// ledger settle waits (maxWaitMs: Infinity); ordinary pagination-commit
// waits (no options) auto-resolve so the Load Older pipeline flows.
// Per-thread gate on the open chain's first await: lets a test hold a
// thread's open chain in flight (stale threadLatestOpenPending) while the
// component switches to another thread.
const threadOpenGates = new Map<string, Promise<void>>();
const afterThreadOpenCacheFirst = new Map<string, (requestLatestPin: () => void) => void>();
vi.mock('../threadOpenCacheFirst', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../threadOpenCacheFirst')>();
  return {
    ...actual,
    runThreadOpenCacheFirst: async (opts: Parameters<typeof actual.runThreadOpenCacheFirst>[0]) => {
      const gate = threadOpenGates.get(opts.threadId);
      if (gate) await gate;
      const result = await actual.runThreadOpenCacheFirst(opts);
      afterThreadOpenCacheFirst.get(opts.threadId)?.(opts.pinThreadToBottomOnOpen);
      return result;
    },
  };
});

const settleWaits: { resolve: () => void }[] = [];
// Mutable so the dropped-correction pin can run the component's iOS
// always-drop path (the hook builder captures this function).
let mockIsIOSWebKit = false;
let mockHasActiveTouches = false;
vi.mock('../scrollQuiescence', () => ({
  SCROLL_QUIESCENCE_IDLE_MS: 150,
  isIOSWebKitDevice: () => mockIsIOSWebKit,
  hasActiveWindowTouches: () => mockHasActiveTouches,
  waitForScrollQuiescence: vi.fn((_el: unknown, opts?: { maxWaitMs?: number }): Promise<void> => {
    if (opts?.maxWaitMs === Infinity) {
      return new Promise<void>((resolve) => {
        settleWaits.push({ resolve });
      });
    }
    return Promise.resolve();
  }),
}));

import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getClickableByText,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  roomTimelineVirtualizerState,
  scrollType,
  settingsState,
  threadRenderStateMock,
  virtualPaginatorState,
} from '../test-utils/RoomTimeline.test.shared';

type MockEvent = ReturnType<typeof makeEvent>;

const buildThread = (rootId: string, replyPrefix: string, replyCount: number) => {
  const rootEvent = makeEvent(rootId, { isThreadRoot: true, ts: 0 });
  const makeReply = (index: number) =>
    makeEvent(`${replyPrefix}${index}`, { threadRootId: rootId, ts: index + 1 });
  const initialEvents = [
    rootEvent,
    ...Array.from({ length: 200 }, (_v, index) => makeReply(index + 100)),
  ];
  const prependedEvents = [
    rootEvent,
    ...Array.from({ length: replyCount }, (_v, index) => makeReply(index)),
    ...initialEvents.slice(1),
  ];
  const timeline = makeTimeline(initialEvents, { backwardToken: `tok-back-${rootId}` });
  const timelineSet = {
    getLiveTimeline: () => timeline,
    getTimelineForEvent: () => undefined,
  };
  const model = {
    rootEvent,
    events: initialEvents,
    getUnfilteredTimelineSet: () => timelineSet,
  };
  return { rootEvent, initialEvents, prependedEvents, model };
};

const setThreadEvents = (events: MockEvent[]) => {
  threadRenderStateMock.threadEvents = events as never;
  threadRenderStateMock.threadEventIndexMapRef.current = new Map(
    events.map((event, index) => [event.getId(), index])
  );
};

// Ported from upstream #116/#119 (settle-cause probes + direction-aware
// boundary guard): scroll elements with an app-write log, native-motion
// fireScroll, and the settle-cause probe reader.
const makeLedgerSettleElements = (
  initialScrollTop = 0,
  innerRect = { top: -1000, bottom: 60_000 }
) => {
  let scrollTopValue = initialScrollTop;
  const scrollWrites: number[] = [];
  const scrollListeners: EventListener[] = [];
  const scrollElement = {
    isConnected: true,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'scroll') scrollListeners.push(listener);
    }),
    removeEventListener: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
    querySelector: vi.fn(() => undefined),
    querySelectorAll: vi.fn(() => []),
    // Must contain the trace-shaped offsets (~34.4k) used below: the
    // boundary guard defers settles for offsets outside the physical
    // range (rubber-band overscroll).
    scrollHeight: 40_000,
    clientHeight: 600,
    get scrollTop() {
      return scrollTopValue;
    },
    set scrollTop(value: number) {
      scrollWrites.push(value);
      scrollTopValue = value;
    },
    scrollTo: vi.fn(),
  };
  const innerElement = {
    style: {} as Record<string, string>,
    // With a positive ledger this is inside the two-viewport top guard.
    getBoundingClientRect: vi.fn(() => innerRect),
  };
  const fireScroll = (nextScrollTop = scrollTopValue) => {
    // Native/compositor movement updates the backing value without going
    // through the app-write probe in the property setter.
    scrollTopValue = nextScrollTop;
    scrollListeners.forEach((listener) => listener(new Event('scroll')));
  };
  return { scrollElement, innerElement, scrollWrites, fireScroll };
};

const readLedgerSettleCounts = async () => {
  const { getCacheProbeSnapshot } = await import('../cacheProbe');
  const snapshot = getCacheProbeSnapshot() as unknown as Record<string, number>;
  return {
    quiescence: snapshot.ledgerQuiescenceSettles ?? 0,
    boundary: snapshot.ledgerBoundarySettles ?? 0,
  };
};

beforeEach(() => {
  settleWaits.length = 0;
});

describe('RoomTimeline ledger lifecycle', () => {
  it('consumes room prepend debt once and drops it when the surface changes', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadId = '$room-ledger-reset-thread';
    const thread = buildThread(threadId, '$room-ledger-reset-', 0);
    const roomEvents = Array.from({ length: 300 }, (_value, index) =>
      makeEvent(`$room-ledger-${index}`, { ts: index })
    );
    const room = makeRoom({ liveEvents: roomEvents });
    room.getThread = (eventId: string) => (eventId === threadId ? (thread.model as never) : null);
    settingsState.prefetchDepth = 200;
    roomTimelineVirtualizerState.virtualIndexes = [0, 1, 2];

    const scrollElement = {
      isConnected: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
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
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const roomElement = () =>
      React.createElement(ControlledRoomTimeline, {
        room,
        initialViewMode: 'classic',
      });
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(roomElement(), {
          createNodeMock: (element) => {
            if (element.type === scrollType) return scrollElement;
            const props = element.props as Record<string, unknown>;
            return props['data-testid'] === 'room-virtual-inner' ||
              props['data-thread-count'] !== undefined
              ? innerElement
              : null;
          },
        });
        await flushAsyncWork();
      });

      expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 100, end: 300 });
      const settleWaitIndex = settleWaits.length;
      await act(async () => {
        virtualPaginatorState.lastOptions?.onRangeChange({ start: 0, end: 300 });
        await flushAsyncWork();
      });
      expect(innerElement.style.marginTop).toBe('-9600px');
      expect(settleWaits.length).toBe(settleWaitIndex + 1);

      // The range debt has moved from the pending bridge into the committed
      // ledger. A normal follow-up render must reuse it, not consume it again.
      await act(async () => {
        renderer!.update(roomElement());
        await flushAsyncWork();
      });
      expect(innerElement.style.marginTop).toBe('-9600px');
      expect(roomTimelineVirtualizerState.lastOptions?.scrollMargin).toBe(-9600);

      // Switching from the room surface to a thread renders a zero ledger in
      // the first frame and invalidates the room's outstanding settle wait.
      roomTimelineVirtualizerState.optionsHistory.length = 0;
      setThreadEvents(thread.initialEvents);
      await act(async () => {
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
            initialViewMode: 'classic',
          })
        );
        await flushAsyncWork();
      });
      expect(innerElement.style.marginTop).toBe('');
      expect(roomTimelineVirtualizerState.optionsHistory[0]?.scrollMargin).toBeCloseTo(0);
      expect(scrollElement.scrollTop).toBe(0);

      await act(async () => {
        settleWaits[settleWaitIndex].resolve();
        await flushAsyncWork(5);
      });
      expect(innerElement.style.marginTop).toBe('');
      expect(scrollElement.scrollTop).toBe(0);
    } finally {
      renderer?.unmount();
    }
  });

  it('a settle wait armed in a previous thread never settles the next thread ledger', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadA = '$ledger-gen-a';
    const threadB = '$ledger-gen-b';
    const a = buildThread(threadA, '$ga-', 100);
    const b = buildThread(threadB, '$gb-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) =>
      eventId === threadA ? (a.model as never) : eventId === threadB ? (b.model as never) : null;
    setThreadEvents(a.initialEvents);

    roomTimelineVirtualizerState.firstVisibleKey = '$ga-100';
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
          React.createElement(ControlledRoomTimeline, { room, threadId: threadA }),
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

      // Thread A: Load Older folds 100 one-liners (compact estimate 26px
      // each) into the ledger and arms a settle wait — which this mock
      // holds open, as a long-momentum ride does in production.
      const loadOlderChip = getClickableByText(renderer!, 'Load Older Messages');
      await act(async () => {
        loadOlderChip.props.onClick();
        await flushAsyncWork(10);
      });
      await act(async () => {
        setThreadEvents(a.prependedEvents);
        renderer!.update(React.createElement(ControlledRoomTimeline, { room, threadId: threadA }));
        await flushAsyncWork(10);
      });
      expect(innerElement.style.marginTop).toBe('-2600px');
      expect(settleWaits.length).toBe(1);
      const staleWait = settleWaits[0];

      // Switch to thread B while A's settle wait is still pending. The
      // render-time reset must zero the ledger for B.
      roomTimelineVirtualizerState.optionsHistory.length = 0;
      await act(async () => {
        roomTimelineVirtualizerState.firstVisibleKey = '$gb-100';
        setThreadEvents(b.initialEvents);
        renderer!.update(React.createElement(ControlledRoomTimeline, { room, threadId: threadB }));
        await flushAsyncWork(10);
      });
      expect(innerElement.style.marginTop).toBe('');
      expect(scrollElement.scrollTop).toBe(0);
      // Mutant 7b: the reset must run ABOVE the useVirtualizer call — a
      // ref-only reset schedules no re-render, so if it ran below, the
      // FIRST post-switch render would hand the virtualizer the stale
      // -2600 scrollMargin and only heal on some later incidental render.
      // `lastOptions` cannot see this (later renders overwrite it); the
      // history can.
      expect(roomTimelineVirtualizerState.optionsHistory.length).toBeGreaterThan(0);
      // toBeCloseTo: the option is computed as -px, which is -0 at zero.
      expect(roomTimelineVirtualizerState.optionsHistory[0]?.scrollMargin).toBeCloseTo(0);

      // Thread B accrues its own ledger: 5 prepended one-liners = 130px.
      const loadOlderChipB = getClickableByText(renderer!, 'Load Older Messages');
      await act(async () => {
        loadOlderChipB.props.onClick();
        await flushAsyncWork(10);
      });
      await act(async () => {
        setThreadEvents(b.prependedEvents);
        renderer!.update(React.createElement(ControlledRoomTimeline, { room, threadId: threadB }));
        await flushAsyncWork(10);
      });
      expect(innerElement.style.marginTop).toBe('-130px');
      expect(settleWaits.length).toBe(2);

      // THE PIN: the STALE wait (generation A) resolves first — in
      // production A's scroll element disconnected, so its quiescence
      // fires long before B is quiet. It must NOT settle B's ledger.
      await act(async () => {
        staleWait.resolve();
        await flushAsyncWork(5);
      });
      expect(innerElement.style.marginTop).toBe('-130px');
      expect(scrollElement.scrollTop).toBe(0);

      // Healthy path: B's own wait settles B's ledger exactly.
      await act(async () => {
        settleWaits[1].resolve();
        await flushAsyncWork(5);
      });
      expect(innerElement.style.marginTop).toBe('');
      expect(scrollElement.scrollTop).toBe(130);
    } finally {
      renderer?.unmount();
    }
  });

  it('preserves a tile measurement correction emitted during a thread switch commit', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadA = '$ledger-switch-measure-a';
    const threadB = '$ledger-switch-measure-b';
    const a = buildThread(threadA, '$switch-a-', 0);
    const b = buildThread(threadB, '$switch-b-', 0);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) =>
      eventId === threadA ? (a.model as never) : eventId === threadB ? (b.model as never) : null;
    setThreadEvents(a.initialEvents);
    roomTimelineVirtualizerState.virtualIndexes = [0, 1, 2];
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
    const tileElement = {};
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, { room, threadId: threadA }),
          {
            createNodeMock: (element) => {
              if (element.type === scrollType) return scrollElement;
              const props = element.props as Record<string, unknown>;
              if (props['data-thread-count'] !== undefined) return innerElement;
              if (props['data-virtual-index'] !== undefined) return tileElement;
              return null;
            },
          }
        );
        await flushAsyncWork();
      });

      const settleWaitIndex = settleWaits.length;
      let injected = false;
      mockIsIOSWebKit = true;
      roomTimelineVirtualizerState.measureElementMock.mockImplementation((node) => {
        if (!node || injected) return;
        const hook = roomTimelineVirtualizerState.lastInstance
          ?.shouldAdjustScrollPositionOnItemSizeChange as
          | ((
              item: { end: number },
              delta: number,
              instance: { scrollOffset: number | null; isScrolling: boolean }
            ) => boolean)
          | undefined;
        if (!hook) return;
        injected = true;
        expect(hook({ end: 100 }, 64, { scrollOffset: 5000, isScrolling: false })).toBe(false);
      });

      await act(async () => {
        setThreadEvents(b.initialEvents);
        renderer!.update(React.createElement(ControlledRoomTimeline, { room, threadId: threadB }));
        await flushAsyncWork(10);
      });

      expect(injected).toBe(true);
      expect(innerElement.style.marginTop).toBe('-64px');
      expect(scrollElement.scrollTop).toBe(0);
      expect(settleWaits).toHaveLength(settleWaitIndex + 1);

      await act(async () => {
        settleWaits[settleWaitIndex].resolve();
        await flushAsyncWork(5);
      });
      expect(innerElement.style.marginTop).toBe('');
      expect(scrollElement.scrollTop).toBe(64);
    } finally {
      roomTimelineVirtualizerState.measureElementMock.mockReset();
      mockIsIOSWebKit = false;
      renderer?.unmount();
    }
  });

  it('a dropped correction forces its own commit: the margin syncs with no other render trigger', async () => {
    // Mutant audit 2026-07-07, survivor 8: react-virtual SKIPS rerenders
    // when the visible range is unchanged and tiles are absolutely
    // positioned, so a dropped correction only materializes if the drop
    // handler forces a commit (setLedgerCommitTick). Without it the
    // ledger ref grows but margin/tiles never move — the paired ±140px
    // flash class. The pin invokes the component-installed
    // shouldAdjustScrollPositionOnItemSizeChange hook directly, outside
    // any React commit, exactly as virtual-core's ResizeObserver does.
    mockIsIOSWebKit = true;
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadA = '$ledger-tick-a';
    const a = buildThread(threadA, '$tick-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadA ? (a.model as never) : null);
    setThreadEvents(a.initialEvents);
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
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, { room, threadId: threadA }),
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

      const hook = roomTimelineVirtualizerState.lastInstance
        ?.shouldAdjustScrollPositionOnItemSizeChange as
        | ((
            item: { end: number },
            delta: number,
            instance: {
              scrollOffset: number | null;
              scrollDirection: 'forward' | 'backward' | null;
            }
          ) => boolean)
        | undefined;
      expect(typeof hook).toBe('function');

      await act(async () => {
        // A row fully above the viewport grew by 64px mid-scroll on iOS:
        // the correction must be DROPPED (return false) and ledgered.
        expect(hook!({ end: 100 }, 64, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        // Desktop backward remeasurements take the same component-level
        // ledger path, while forward/quiet desktop corrections stay owned
        // by virtual-core.
        mockIsIOSWebKit = false;
        expect(hook!({ end: 100 }, 32, { scrollOffset: 5000, scrollDirection: 'backward' })).toBe(
          false
        );
        expect(hook!({ end: 100 }, 16, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          true
        );
        await flushAsyncWork(3);
      });
      // The tick-forced commit synced the margin — with no scroll event,
      // no prop change, and no other state update anywhere.
      expect(innerElement.style.marginTop).toBe('-96px');
      expect(scrollElement.scrollTop).toBe(0);
      expect(scrollElement.scrollTo).not.toHaveBeenCalled();
    } finally {
      mockIsIOSWebKit = false;
      renderer?.unmount();
    }
  });

  it('coasts through positive-ledger top runway and settles at physical exhaustion', async () => {
    mockIsIOSWebKit = true;
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadId = '$ledger-positive-top-runway';
    const thread = buildThread(threadId, '$top-runway-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadId ? (thread.model as never) : null);
    setThreadEvents(thread.initialEvents);
    const innerRect = { top: -1114, bottom: 60_000 };
    const { scrollElement, innerElement, scrollWrites, fireScroll } = makeLedgerSettleElements(
      1139,
      innerRect
    );
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const waitsBefore = settleWaits.length;
    const countsBefore = await readLedgerSettleCounts();
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room, threadId }), {
          createNodeMock: (element) =>
            element.type === scrollType
              ? scrollElement
              : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
              ? innerElement
              : null,
        });
        await flushAsyncWork();
      });

      const hook = roomTimelineVirtualizerState.lastInstance
        ?.shouldAdjustScrollPositionOnItemSizeChange as
        | ((
            item: { end: number },
            delta: number,
            instance: {
              scrollOffset: number | null;
              scrollDirection: 'forward' | 'backward' | null;
            }
          ) => boolean)
        | undefined;
      await act(async () => {
        expect(hook!({ end: 100 }, 89, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        await flushAsyncWork(3);
        // Exact v3 geometry: reachable top is -1114 + 89 = -1025px.
        // Native motion is still backward, but this is valid runway rather
        // than blank space and must not perform an app scrollTop write.
        fireScroll(1081);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([]);
      expect(innerElement.style.marginTop).toBe('-89px');
      expect(await readLedgerSettleCounts()).toEqual(countsBefore);

      await act(async () => {
        // Once Safari reaches its physical minimum, reachable top is zero.
        // Settle there immediately; momentum has already exhausted itself.
        // The fixed normal-flow origin is 56px: -1114 + 89 + 1081.
        // Moving scrollTop 1081 -> 0 therefore moves the rect by +1081,
        // leaving innerTop=-33 rather than fabricating ledger-only motion.
        innerRect.top += 1081;
        innerRect.bottom += 1081;
        fireScroll(0);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([89]);
      expect(innerElement.style.marginTop).toBe('');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 1,
      });

      await act(async () => {
        settleWaits[waitsBefore].resolve();
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([89]);
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 1,
      });
    } finally {
      mockIsIOSWebKit = false;
      renderer?.unmount();
    }
  });

  it('settles only toward a ledger boundary and survives a coalesced write event', async () => {
    mockIsIOSWebKit = true;
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadId = '$ledger-boundary-cause';
    const thread = buildThread(threadId, '$boundary-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadId ? (thread.model as never) : null);
    setThreadEvents(thread.initialEvents);
    // Trace-shaped geometry: the inner bottom is inside the positive-
    // ledger bottom guard while the top is tens of thousands of px away.
    const { scrollElement, innerElement, scrollWrites, fireScroll } = makeLedgerSettleElements(
      34331,
      { top: -34000, bottom: 1500 }
    );
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const waitsBefore = settleWaits.length;
    const countsBefore = await readLedgerSettleCounts();
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room, threadId }), {
          createNodeMock: (element) =>
            element.type === scrollType
              ? scrollElement
              : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
              ? innerElement
              : null,
        });
        await flushAsyncWork();
      });

      const hook = roomTimelineVirtualizerState.lastInstance
        ?.shouldAdjustScrollPositionOnItemSizeChange as
        | ((
            item: { end: number },
            delta: number,
            instance: {
              scrollOffset: number | null;
              scrollDirection: 'forward' | 'backward' | null;
            }
          ) => boolean)
        | undefined;
      const virtualizerInstance = roomTimelineVirtualizerState.lastInstance as unknown as {
        scrollOffset?: number;
        setOptions: (next: unknown) => void;
      };
      const offsetAtSetOptions: (number | undefined)[] = [];
      const originalSetOptions = virtualizerInstance.setOptions.bind(virtualizerInstance);
      virtualizerInstance.setOptions = (next: unknown) => {
        // The settle must reconcile the virtualizer's cached offset BEFORE
        // the setOptions window recompute: stale offset + zeroed margin
        // shifts the computed range by the whole fold — the settle-cascade
        // remeasure burst traced on device (rideTraceReplay.test.ts).
        offsetAtSetOptions.push(virtualizerInstance.scrollOffset);
        originalSetOptions(next);
      };
      await act(async () => {
        // Arm before the listener has seen any scroll event. Its mount-time
        // baseline must classify this very first native frame as forward
        // and preserve the toward-bottom safety guard.
        expect(hook!({ end: 100 }, 72, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        await flushAsyncWork(3);
        // A crossing event under a live finger must NOT settle: rewriting
        // scrollTop mid-drag reverses the gesture frame (the open-fill's
        // 33k rebase slipped 98px landing on a drag's first in-bounds
        // event, ride-trace-1783811896380 frame 137).
        mockHasActiveTouches = true;
        fireScroll(34335);
        await flushAsyncWork(3);
        expect(scrollWrites).toEqual([]);
        mockHasActiveTouches = false;
        fireScroll(34340);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412]);
      expect(innerElement.style.marginTop).toBe('');
      expect(settleWaits).toHaveLength(waitsBefore + 1);
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 1,
      });
      // The cached offset was synced to the clamped post-write scrollTop
      // before the recompute, and stays synced after the settle.
      expect(offsetAtSetOptions).toEqual([34412]);
      expect(virtualizerInstance.scrollOffset).toBe(34412);

      await act(async () => {
        expect(hook!({ end: 100 }, 34, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        await flushAsyncWork(3);
        // Update the direction baseline while the ledger remains below the
        // 48px boundary floor. The next crossing oracle fails if this update
        // is moved below the early return.
        fireScroll(34250);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412]);
      expect(innerElement.style.marginTop).toBe('-34px');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 1,
      });

      await act(async () => {
        // Another measured row brings the ledger to +72px. This small
        // reversal is forward from the correctly remembered 34250, but
        // still backward from the stale pre-subfloor 34412: only the correct
        // baseline recognizes travel toward the nearby bottom boundary.
        expect(hook!({ end: 100 }, 38, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        await flushAsyncWork(3);
        fireScroll(34290);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412, 34362]);
      expect(innerElement.style.marginTop).toBe('');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 2,
      });

      await act(async () => {
        // Re-arm the exact traced +72px case. The mock settlement setter
        // above emitted no scroll event, so this also begins from its
        // synchronously read-back 34362 baseline.
        expect(hook!({ end: 100 }, 72, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        await flushAsyncWork(3);
        fireScroll(34313);
        // A stationary event is not evidence of travel toward either edge.
        fireScroll(34313);
        // Native momentum then continues upward, AWAY from the endangered
        // bottom. The old guard wrote 34278+72=34350 here, visibly reversed
        // the frame, and stopped Safari's fling.
        fireScroll(34278);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412, 34362]);
      expect(innerElement.style.marginTop).toBe('-72px');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 2,
      });

      await act(async () => {
        // Reverse toward the endangered bottom: its guard still performs
        // exactly one atomic safety rebase before any debt is exposed.
        fireScroll(34313);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412, 34362, 34385]);
      expect(innerElement.style.marginTop).toBe('');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 3,
      });

      await act(async () => {
        // The mock setter intentionally emits no scroll event, matching an
        // iOS-coalesced programmatic write. A fresh ledger plus a native
        // upward frame must compare against the read-back 34385 baseline,
        // not the stale pre-settle 34313 offset (which would look forward).
        expect(hook!({ end: 100 }, 72, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        await flushAsyncWork(3);
        fireScroll(34370);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412, 34362, 34385]);
      expect(innerElement.style.marginTop).toBe('-72px');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 3,
      });

      await act(async () => {
        // Approaching the bottom again consumes the fresh ledger; the
        // original pending rest waiter then has nothing left to settle.
        fireScroll(34400);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412, 34362, 34385, 34472]);
      expect(innerElement.style.marginTop).toBe('');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 4,
      });

      await act(async () => {
        settleWaits[waitsBefore].resolve();
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412, 34362, 34385, 34472]);
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 4,
      });
    } finally {
      mockIsIOSWebKit = false;
      renderer?.unmount();
    }
  });

  it('restores a discarded settle write to the ledger and refolds it at true rest', async () => {
    // PR #126 second mechanism: a touchless scroll session (scrubber/
    // trackpad) still owns the position when a settle write lands in one
    // of its pauses; the compositor discards the write and reasserts the
    // pre-settle offset as one large scroll event (matched-snapshot folds
    // up to +8,769px reverted on device — rideTraceReplay.test.ts). The
    // watchdog must recognize that reassertion, restore the fold to the
    // ledger without writing scrollTop, and let the pending true-rest
    // wait refold it.
    mockIsIOSWebKit = true;
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadId = '$ledger-discard-watchdog';
    const thread = buildThread(threadId, '$discard-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadId ? (thread.model as never) : null);
    setThreadEvents(thread.initialEvents);
    const { scrollElement, innerElement, scrollWrites, fireScroll } = makeLedgerSettleElements(
      34331,
      { top: -34000, bottom: 1500 }
    );
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const waitsBefore = settleWaits.length;
    const countsBefore = await readLedgerSettleCounts();
    const readDiscardProbe = async () => {
      const { getCacheProbeSnapshot } = await import('../cacheProbe');
      return (getCacheProbeSnapshot() as unknown as Record<string, number>)
        .ledgerSettleWriteDiscarded;
    };
    const discardsBefore = await readDiscardProbe();
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room, threadId }), {
          createNodeMock: (element) =>
            element.type === scrollType
              ? scrollElement
              : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
              ? innerElement
              : null,
        });
        await flushAsyncWork();
      });

      const hook = roomTimelineVirtualizerState.lastInstance
        ?.shouldAdjustScrollPositionOnItemSizeChange as
        | ((
            item: { end: number },
            delta: number,
            instance: {
              scrollOffset: number | null;
              scrollDirection: 'forward' | 'backward' | null;
            }
          ) => boolean)
        | undefined;

      await act(async () => {
        expect(hook!({ end: 100 }, 72, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        await flushAsyncWork(3);
        // Boundary settle: one atomic 72px fold + write (34340 + 72).
        fireScroll(34340);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412]);
      expect(innerElement.style.marginTop).toBe('');

      await act(async () => {
        // The compositor reasserts the pre-settle offset: a single event
        // teleporting back to 34338 (2px from the pre-settle 34340 — the
        // session kept drifting during the ping-pong on device).
        fireScroll(34338);
        await flushAsyncWork(3);
      });
      // The fold is back in the ledger — margin restored, NO scrollTop
      // write fighting the live session, probe attributes the revert.
      expect(scrollWrites).toEqual([34412]);
      expect(innerElement.style.marginTop).toBe('-72px');
      expect(await readDiscardProbe()).toBe(discardsBefore + 1);
      // No new boundary settle fired on the reassertion event itself.
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence,
        boundary: countsBefore.boundary + 1,
      });

      await act(async () => {
        // The still-pending true-rest wait refolds the restored ledger.
        settleWaits[waitsBefore].resolve();
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412, 34410]);
      expect(innerElement.style.marginTop).toBe('');
      expect(await readLedgerSettleCounts()).toEqual({
        quiescence: countsBefore.quiescence + 1,
        boundary: countsBefore.boundary + 1,
      });
    } finally {
      mockIsIOSWebKit = false;
      renderer?.unmount();
    }
  });

  it('watchdog stands down when motion resumes from the settled offset or a finger arrives', async () => {
    mockIsIOSWebKit = true;
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadId = '$ledger-discard-standdown';
    const thread = buildThread(threadId, '$standdown-', 5);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadId ? (thread.model as never) : null);
    setThreadEvents(thread.initialEvents);
    const { scrollElement, innerElement, scrollWrites, fireScroll } = makeLedgerSettleElements(
      34331,
      { top: -34000, bottom: 1500 }
    );
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const readDiscardProbe = async () => {
      const { getCacheProbeSnapshot } = await import('../cacheProbe');
      return (getCacheProbeSnapshot() as unknown as Record<string, number>)
        .ledgerSettleWriteDiscarded;
    };
    const discardsBefore = await readDiscardProbe();
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room, threadId }), {
          createNodeMock: (element) =>
            element.type === scrollType
              ? scrollElement
              : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
              ? innerElement
              : null,
        });
        await flushAsyncWork();
      });

      const hook = roomTimelineVirtualizerState.lastInstance
        ?.shouldAdjustScrollPositionOnItemSizeChange as
        | ((
            item: { end: number },
            delta: number,
            instance: {
              scrollOffset: number | null;
              scrollDirection: 'forward' | 'backward' | null;
            }
          ) => boolean)
        | undefined;

      await act(async () => {
        expect(hook!({ end: 100 }, 72, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        await flushAsyncWork(3);
        fireScroll(34340);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412]);

      await act(async () => {
        // Motion resumes FROM the settled offset (the write held): the
        // first event past the settled neighborhood retires the watch, so
        // the later pass through the pre-settle offset is recognized as
        // ordinary travel, not a reassertion.
        fireScroll(34390);
        fireScroll(34360);
        fireScroll(34338);
        await flushAsyncWork(3);
      });
      expect(await readDiscardProbe()).toBe(discardsBefore);
      expect(innerElement.style.marginTop).toBe('');
      expect(scrollWrites).toEqual([34412]);

      await act(async () => {
        // Second settle, then a REAL finger lands before any reassertion:
        // the gesture owns all subsequent motion — never the watchdog.
        expect(hook!({ end: 100 }, 72, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
          false
        );
        await flushAsyncWork(3);
        fireScroll(34340);
        await flushAsyncWork(3);
      });
      expect(scrollWrites).toEqual([34412, 34412]);
      const touchStartListener = (
        scrollElement.addEventListener as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === 'touchstart')?.[1] as EventListener;
      expect(typeof touchStartListener).toBe('function');
      await act(async () => {
        touchStartListener(new Event('touchstart'));
        fireScroll(34338);
        await flushAsyncWork(3);
      });
      expect(await readDiscardProbe()).toBe(discardsBefore);
      expect(innerElement.style.marginTop).toBe('');
      expect(scrollWrites).toEqual([34412, 34412]);
    } finally {
      mockIsIOSWebKit = false;
      renderer?.unmount();
    }
  });

  // The open-at-latest pin is observable through the scrollToBottom dom
  // util, which the shared harness mocks module-wide.
  const getScrollToBottomMock = async () => {
    const domUtils = await import('../../../utils/dom');
    return vi.mocked(domUtils.scrollToBottom);
  };

  const makePinHarnessElements = (initialScrollTop = 0) => {
    let scrollTop = initialScrollTop;
    const listeners = new Map<string, Set<EventListener>>();
    const scrollElement = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        const eventListeners = listeners.get(type) ?? new Set<EventListener>();
        eventListeners.add(listener);
        listeners.set(type, eventListeners);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      }),
      dispatch: (type: string) => {
        listeners.get(type)?.forEach((listener) => listener(new Event(type)));
      },
      setNativeScrollTop: (nextScrollTop: number) => {
        scrollTop = nextScrollTop;
      },
      getBoundingClientRect: vi.fn(() => ({ top: 0, bottom: 600 })),
      querySelector: vi.fn(() => undefined),
      querySelectorAll: vi.fn(() => []),
      scrollHeight: 4000,
      clientHeight: 600,
      offsetHeight: 600,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(nextScrollTop: number) {
        scrollTop = nextScrollTop;
      },
      scrollTo: vi.fn(),
    };
    const innerElement = {
      style: {} as Record<string, string>,
      getBoundingClientRect: () => ({ top: 0 }),
    };
    return { scrollElement, innerElement };
  };

  it('keeps the first user wheel movement after focus and session opening pins queue', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('../cacheStore');
    const threadId = '$opening-input-ownership';
    const thread = buildThread(threadId, '$opening-input-', 0);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) => (eventId === threadId ? (thread.model as never) : null);
    setThreadEvents(thread.initialEvents);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [],
      hasMoreBefore: false,
      rootEvent: {
        content: { body: 'root', msgtype: 'm.text' },
        event_id: threadId,
        origin_server_ts: 1,
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);

    let releaseOpen!: () => void;
    threadOpenGates.set(
      threadId,
      new Promise<void>((resolve) => {
        releaseOpen = resolve;
      })
    );
    const { scrollElement, innerElement } = makePinHarnessElements(3400);
    const scrollToBottomMock = await getScrollToBottomMock();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    let sessionOpeningPinQueued = false;

    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room, threadId }), {
          createNodeMock: (element) =>
            element.type === scrollType
              ? scrollElement
              : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
              ? innerElement
              : null,
        });
        await flushAsyncWork(5);
      });

      // The focus producer has already pinned the opening band while the
      // cache-first session producer remains parked at its controlled await.
      expect(scrollToBottomMock.mock.calls.length).toBeGreaterThan(0);
      scrollToBottomMock.mockClear();
      afterThreadOpenCacheFirst.set(threadId, (requestLatestPin) => {
        requestLatestPin();
        sessionOpeningPinQueued = true;
        scrollElement.dispatch('wheel');
        // Model the browser's trusted default movement without recording an
        // application scroll write. Consumers run only after this callback.
        scrollElement.setNativeScrollTop(3320);
      });

      await act(async () => {
        releaseOpen();
        await flushAsyncWork(10);
      });

      expect(sessionOpeningPinQueued).toBe(true);
      expect(scrollElement.scrollTop).toBe(3320);
      expect(scrollToBottomMock.mock.calls).toEqual([]);

      // A late hydration-shaped band must remain reader-owned after the
      // session open has completed and after later animation frames.
      await act(async () => {
        setThreadEvents([
          ...thread.initialEvents,
          makeEvent('$opening-input-late-band', { threadRootId: threadId, ts: 999 }),
        ]);
        renderer!.update(React.createElement(ControlledRoomTimeline, { room, threadId }));
        await flushAsyncWork(5);
      });
      expect(scrollElement.scrollTop).toBe(3320);
      expect(scrollToBottomMock.mock.calls).toEqual([]);
    } finally {
      releaseOpen();
      afterThreadOpenCacheFirst.delete(threadId);
      threadOpenGates.delete(threadId);
      renderer?.unmount();
    }
  });

  it('render-time latch keying: a stale open-at-latest latch never pins the next thread', async () => {
    // Pins mutant #11b (latch reset removed from the key-change branch):
    // thread A legitimately latched open-at-latest; switching to thread B
    // (opened to a FOCUSED EVENT, so B must NOT pin) must drop the latch
    // in the SAME render — B never gets bottom-pinned.
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadA = '$latch-key-a';
    const threadB = '$latch-key-b';
    const a = buildThread(threadA, '$ka-', 0);
    const b = buildThread(threadB, '$kb-', 0);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) =>
      eventId === threadA ? (a.model as never) : eventId === threadB ? (b.model as never) : null;
    setThreadEvents(a.initialEvents);
    const { scrollElement, innerElement } = makePinHarnessElements();
    const scrollToBottomMock = await getScrollToBottomMock();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      // Open A at latest and let the whole open chain complete: pending
      // clears, the latch stays TRUE (it must survive for hydration
      // bands), and the pin fired for A (sanity).
      scrollToBottomMock.mockClear();
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, { room, threadId: threadA }),
          {
            createNodeMock: (element) =>
              element.type === scrollType
                ? scrollElement
                : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
                ? innerElement
                : null,
          }
        );
        await flushAsyncWork(10);
      });
      expect(scrollToBottomMock.mock.calls.length).toBeGreaterThan(0);

      // Switch to B, opened to a focused event: pending stays false and
      // the latch must reset AT RENDER TIME — no commit of B may see A's
      // latch, so the bottom pin must never fire for B.
      scrollToBottomMock.mockClear();
      await act(async () => {
        setThreadEvents(b.initialEvents);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: threadB,
            eventId: '$kb-150',
          })
        );
        await flushAsyncWork(10);
      });
      // Drive a hydration-band-shaped commit (the pin effect keys on
      // threadEventsLength): still no pin.
      await act(async () => {
        setThreadEvents([
          ...b.initialEvents,
          makeEvent('$kb-band', { threadRootId: threadB, ts: 999 }),
        ]);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: threadB,
            eventId: '$kb-150',
          })
        );
        await flushAsyncWork(5);
      });
      expect(scrollToBottomMock.mock.calls).toEqual([]);
    } finally {
      renderer?.unmount();
    }
  });

  it('switch render with a stale pending flag must not re-latch the new thread', async () => {
    // Pins mutant #11a (the `else` on the stale-pending guard): switching
    // away while A's open chain is still in flight leaves
    // threadLatestOpenPending stale-true on the switch render (A's
    // finally skips the clear once threadIdRef moved on). That stale flag
    // must not latch open-at-latest for B.
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const threadA = '$latch-pend-a';
    const threadB = '$latch-pend-b';
    const a = buildThread(threadA, '$pa-', 0);
    const b = buildThread(threadB, '$pb-', 0);
    const room = makeRoom({ liveEvents: [] });
    room.getThread = (eventId: string) =>
      eventId === threadA ? (a.model as never) : eventId === threadB ? (b.model as never) : null;
    setThreadEvents(a.initialEvents);
    const { scrollElement, innerElement } = makePinHarnessElements();
    const scrollToBottomMock = await getScrollToBottomMock();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    // Hold A's open chain at its first await: pending stays true while
    // the test switches to B, and A's finally (which would clear it) only
    // runs after threadIdRef has moved on — the stale-flag state greptile
    // flagged on PR #83.
    let releaseThreadAOpen!: () => void;
    threadOpenGates.set(
      threadA,
      new Promise<void>((resolve) => {
        releaseThreadAOpen = resolve;
      })
    );
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, { room, threadId: threadA }),
          {
            createNodeMock: (element) =>
              element.type === scrollType
                ? scrollElement
                : (element.props as Record<string, unknown>)?.['data-thread-count'] !== undefined
                ? innerElement
                : null,
          }
        );
        await flushAsyncWork(5);
      });

      // Switch to B (focused-event open) while A's chain is parked: the
      // switch render sees the stale pending flag.
      await act(async () => {
        setThreadEvents(b.initialEvents);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: threadB,
            eventId: '$pb-150',
          })
        );
        await flushAsyncWork(10);
      });
      // Release A's chain; its finally must skip the pending clear
      // (threadIdRef is B) — the flag was already cleared by B's effect.
      await act(async () => {
        releaseThreadAOpen();
        await flushAsyncWork(10);
      });

      // Pending has been cleared by B's own open effect by now. If the
      // stale flag re-latched on the switch render, the pin fires on
      // every later commit; latch-free it must stay silent.
      scrollToBottomMock.mockClear();
      await act(async () => {
        setThreadEvents([
          ...b.initialEvents,
          makeEvent('$pb-band', { threadRootId: threadB, ts: 999 }),
        ]);
        renderer!.update(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: threadB,
            eventId: '$pb-150',
          })
        );
        await flushAsyncWork(5);
      });
      expect(scrollToBottomMock.mock.calls).toEqual([]);
    } finally {
      threadOpenGates.clear();
      renderer?.unmount();
    }
  });
});
