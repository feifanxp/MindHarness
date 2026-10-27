import React, { useLayoutEffect, useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';
import type { ThreadLedgerEvent } from './threadScrollLedger';
import { createRoomAutomaticFill } from './roomAutomaticFill';

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {},
  setOptions: vi.fn(),
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItems: () => [],
  getVirtualItemForOffset: (() => undefined) as (
    offset: number
  ) => { index: number; start: number } | undefined,
}));
const settleWaits = vi.hoisted(() => [] as Array<() => void>);

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizer,
}));

vi.mock('./rideTraceRecorder', () => ({
  installRideTraceRecorder: vi.fn(),
  isRideTraceEnabled: () => false,
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => true,
  waitForScrollQuiescence: () =>
    new Promise<void>((resolve) => {
      settleWaits.push(resolve);
    }),
}));

const event = (eventId: string): ThreadLedgerEvent => ({
  getId: () => eventId,
});

// A 68px root, then 50px replies, in virtual-core coordinates.
const rootThenReplies = (offset: number) => {
  const index = offset < 68 ? 0 : 1 + Math.floor((offset - 68) / 50);
  return { index, start: index === 0 ? 0 : 68 + (index - 1) * 50 };
};

// The scroller's computed scroll-padding-top: the sticky headers' inset.
const scrollPadding = { top: 0 };

beforeEach(() => {
  scrollPadding.top = 0;
  vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingTop: `${scrollPadding.top}px` }));
  virtualizer.itemSizeCache = new Map();
  virtualizer.options = {};
  virtualizer.setOptions.mockClear();
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
  virtualizer.getVirtualItemForOffset = () => undefined;
  settleWaits.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTimelineScrollLedgerController', () => {
  it('commits shrink compensation before child layout reads can clamp the native offset', () => {
    let scrollTop = 3400;
    let height = 4000;
    const inner = { style: { marginTop: '' } };
    const root = {
      addEventListener: () => {},
      removeEventListener: () => {},
      get scrollTop() {
        const margin = Number.parseFloat(inner.style.marginTop) || 0;
        scrollTop = Math.min(scrollTop, height + margin - 600);
        return scrollTop;
      },
    } as unknown as HTMLDivElement;
    const seen: number[] = [];
    const ReadLayout = ({ debt }: { debt: number }) => {
      React.useLayoutEffect(() => {
        // Host height is committed before child callback refs/layout effects.
        height = 4000 + debt;
        seen.push(root.scrollTop);
      });
      return null;
    };
    const Harness = () => {
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 100,
        getItemKey: (index) => index,
        getScrollElement: () => root,
        itemCount: 40,
        pendingRoomFoldPxRef: useRef(0),
        roomFoldPriceRef: useRef(() => 100),
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(),
        threadEvents: [],
        threadInitialRenderMode: 'live',
      });
      return React.createElement(
        'inner',
        { ref: controller.virtualInnerRef },
        React.createElement(ReadLayout, { debt: controller.ledgerPxAtRender })
      );
    };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness), { createNodeMock: () => inner });
    });
    expect(seen).toEqual([3400]);
    const correction = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as (
      item: { end: number },
      delta: number,
      instance: { scrollOffset: number; scrollDirection: null }
    ) => boolean;
    act(() => {
      correction({ end: 100 }, -200, { scrollOffset: 3400, scrollDirection: null });
    });
    expect(seen.at(-1)).toBe(3400);
    expect(inner.style.marginTop).toBe('200px');
    // Settlement can clear the imperative margin. An equal snapshot must
    // restore it on the next commit even if React props would compare equal.
    inner.style.marginTop = '';
    act(() => renderer.update(React.createElement(Harness)));
    expect(seen.at(-1)).toBe(3400);
    expect(inner.style.marginTop).toBe('200px');
    act(() => renderer.unmount());
  });

  it('allows a measured empty room to request its initial history', () => {
    const checks: (() => void)[] = [];
    const geometryReader = { current: (): string | undefined => undefined };
    const owner = createRoomAutomaticFill({
      readGeometry: () => geometryReader.current(),
      schedule: (check) => {
        checks.push(check);
      },
    });
    const root = {
      scrollTop: 0,
      scrollHeight: 600,
      clientHeight: 600,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLDivElement;
    const inner = { style: { marginTop: '' } };
    const Harness = () => {
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 144,
        getItemKey: (index) => index,
        getScrollElement: () => root,
        itemCount: 0,
        pendingRoomFoldPxRef: useRef(0),
        roomFoldPriceRef: useRef(() => 144),
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(),
        threadEvents: [],
        threadInitialRenderMode: 'live',
        automaticFill: { ...owner, geometryReader },
      });
      return React.createElement('inner', { ref: controller.virtualInnerRef });
    };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness), { createNodeMock: () => inner });
    });
    let requests = 0;
    owner.defer(() => {
      requests += 1;
      return false;
    });
    checks.shift()?.();
    checks.shift()?.();
    expect(requests).toBe(1);
    act(() => renderer.unmount());
  });

  it('defers a settle until the painted margin catches up with the live ledger', async () => {
    let scrollTop = 5000;
    const writes: number[] = [];
    const scrollElement = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
      clientHeight: 600,
      scrollHeight: 20_000,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        writes.push(value);
        scrollTop = value;
      },
    } as unknown as HTMLDivElement;
    const innerElement = {
      style: { marginTop: '' } as CSSStyleDeclaration,
      getBoundingClientRect: () => ({ top: -5000, bottom: 15_000 }),
    } as unknown as HTMLDivElement;

    const Harness = () => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 10,
        getItemKey: (index) => index,
        getScrollElement: () => scrollElement,
        itemCount: 1,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(),
        threadEvents: [],
        threadId: '$root',
        threadInitialRenderMode: 'live',
      });
      return React.createElement('inner', { ref: controller.virtualInnerRef });
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness), {
        createNodeMock: () => innerElement,
      });
    });
    const adjustment = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as (
      item: { end: number },
      delta: number,
      instance: { scrollOffset: number | null; scrollDirection: 'forward' | 'backward' | null }
    ) => boolean;
    act(() => {
      expect(adjustment({ end: 100 }, -5, { scrollOffset: 5000, scrollDirection: null })).toBe(
        false
      );
    });
    expect(innerElement.style.marginTop).toBe('5px');
    expect(settleWaits).toHaveLength(1);

    // Exact trace shape: React has not yet painted the accumulator's newer
    // -5px snapshot, so the DOM still carries the previous 512px ledger.
    innerElement.style.marginTop = '-512px';
    await act(async () => {
      settleWaits[0]();
      await Promise.resolve();
    });
    expect(writes).toEqual([]);
    expect(innerElement.style.marginTop).toBe('5px');
    expect(settleWaits).toHaveLength(2);

    await act(async () => {
      settleWaits[1]();
      await Promise.resolve();
    });
    expect(writes).toEqual([4995]);
    expect(innerElement.style.marginTop).toBe('');

    act(() => renderer.unmount());
  });

  it('resets the boundary direction baseline at touch start', () => {
    let scrollTop = 34_331;
    const writes: number[] = [];
    const listeners = new Map<string, EventListener>();
    const scrollElement = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
      clientHeight: 600,
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        writes.push(value);
        scrollTop = value;
      },
    } as unknown as HTMLDivElement;
    const innerElement = {
      style: {} as CSSStyleDeclaration,
      getBoundingClientRect: () => ({ top: -34_000, bottom: 1600 }),
    } as unknown as HTMLDivElement;
    const getScrollElement = () => scrollElement;

    const Harness = () => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 10,
        getItemKey: (index) => index,
        getScrollElement,
        itemCount: 1,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(),
        threadEvents: [],
        threadId: '$root',
        threadInitialRenderMode: 'live',
      });
      return React.createElement('inner', { ref: controller.virtualInnerRef });
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness), {
        createNodeMock: () => innerElement,
      });
    });

    expect(scrollElement.addEventListener).toHaveBeenCalledWith(
      'touchstart',
      expect.any(Function),
      { capture: true, passive: true }
    );
    const adjustment = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as (
      item: { end: number },
      delta: number,
      instance: { scrollOffset: number | null; scrollDirection: 'forward' | 'backward' | null }
    ) => boolean;
    act(() => {
      expect(adjustment({ end: 100 }, 72, { scrollOffset: 5000, scrollDirection: 'forward' })).toBe(
        false
      );
    });

    // The compositor advances without a scroll event, then a new touch
    // reverses. Comparing the first reversed frame with the old 34331px
    // baseline would misclassify it as forward and settle the +72px ledger.
    scrollTop = 34_431;
    listeners.get('touchstart')?.(new Event('touchstart'));
    scrollTop = 34_396;
    listeners.get('scroll')?.(new Event('scroll'));
    expect(writes).toEqual([]);

    // A later genuine move toward the guarded bottom still settles.
    scrollTop = 34_420;
    listeners.get('scroll')?.(new Event('scroll'));
    expect(writes).toEqual([34_492]);

    const touchStartListener = listeners.get('touchstart');
    act(() => renderer.unmount());
    expect(scrollElement.removeEventListener).toHaveBeenCalledWith(
      'touchstart',
      touchStartListener,
      true
    );
  });

  it("folds rows that land above the reader's first visible row, whoever adds them", () => {
    const root = event('$root');
    const reader = event('$reader');
    const older = event('$older');
    const newer = event('$newer');
    virtualizer.itemSizeCache = new Map([['$older', 30]]);
    // The row at the reader's top; it follows the reader's row.
    let readerIndex = 1;
    virtualizer.getVirtualItemForOffset = (offset) => ({ index: readerIndex, start: offset });
    const scroller = {
      getBoundingClientRect: () => ({ top: 0 }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      scrollTop: 0,
    };
    const inner = { getBoundingClientRect: () => ({ top: 0 }), style: { marginTop: '' } };
    let latestLedgerPx = 0;

    const Harness = ({ events }: { events: ThreadLedgerEvent[] }) => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 10,
        getItemKey: (index) => events[index]?.getId() ?? index,
        getScrollElement: () => scroller as unknown as HTMLDivElement,
        itemCount: events.length,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(events.map((entry, index) => [entry.getId() ?? '', index])),
        threadEvents: events,
        threadId: '$root',
        threadInitialRenderMode: 'live',
      });
      (controller.virtualInnerRef as { current: unknown }).current = inner;
      latestLedgerPx = controller.ledgerPxAtRender;
      return null;
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness, { events: [root, reader] }));
    });
    // A reply below the reader moves nothing.
    act(() => {
      renderer.update(React.createElement(Harness, { events: [root, reader, newer] }));
    });
    expect(latestLedgerPx).toBe(0);
    // An older row above the reader folds at its measured height.
    readerIndex = 2;
    act(() => {
      renderer.update(React.createElement(Harness, { events: [root, older, reader, newer] }));
    });
    expect(latestLedgerPx).toBe(30);
    renderer!.unmount();
  });

  it('anchors on the row painted at the viewport top, even above the list start', () => {
    // virtual-core's range ignores the content above the list (header inset,
    // Load Older), so it can name a reply while the root is still visible.
    const root = event('$root');
    const first = event('$first');
    const older = event('$older');
    virtualizer.itemSizeCache = new Map([['$older', 30]]);
    virtualizer.getVirtualItemForOffset = rootThenReplies;
    const rect = (top: number) => ({
      getBoundingClientRect: () => ({ top }),
      style: { marginTop: '' },
    });
    const scroller = {
      ...rect(100),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      scrollTop: 0,
    };
    // The list paints virtual coordinate 0 at 70px: the viewport top is 30px into the root.
    const inner = rect(70);
    let latestLedgerPx = 0;

    const Harness = ({ events }: { events: ThreadLedgerEvent[] }) => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 10,
        getItemKey: (index) => events[index]?.getId() ?? index,
        getScrollElement: () => scroller as unknown as HTMLDivElement,
        itemCount: events.length,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(events.map((entry, index) => [entry.getId() ?? '', index])),
        threadEvents: events,
        threadId: '$root',
        threadInitialRenderMode: 'live',
      });
      (controller.virtualInnerRef as { current: unknown }).current = inner;
      latestLedgerPx = controller.ledgerPxAtRender;
      return null;
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness, { events: [root, first] }));
    });
    // Older history lands between the visible root and the first reply.
    act(() => {
      renderer.update(React.createElement(Harness, { events: [root, older, first] }));
    });
    expect(latestLedgerPx).toBe(0);
    renderer!.unmount();
  });

  it('follows the painted row through a scroll that commits nothing', () => {
    // virtual-core notifies React only when its own range changes; scrolling
    // the root back into view under the header can leave that range as is.
    const root = event('$root');
    const first = event('$first');
    const older = event('$older');
    virtualizer.itemSizeCache = new Map([['$older', 30]]);
    virtualizer.getVirtualItemForOffset = rootThenReplies;
    const scrollListeners: EventListener[] = [];
    const scroller = {
      getBoundingClientRect: () => ({ top: 100 }),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === 'scroll') scrollListeners.push(listener);
      }),
      removeEventListener: vi.fn(),
      scrollTop: 300,
    };
    // The viewport top is 100px into the list: the first reply.
    const inner = { getBoundingClientRect: () => ({ top: 0 }), style: { marginTop: '' } };
    let latestLedgerPx = 0;

    const Harness = ({ events }: { events: ThreadLedgerEvent[] }) => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 10,
        getItemKey: (index) => events[index]?.getId() ?? index,
        getScrollElement: () => scroller as unknown as HTMLDivElement,
        itemCount: events.length,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(events.map((entry, index) => [entry.getId() ?? '', index])),
        threadEvents: events,
        threadId: '$root',
        threadInitialRenderMode: 'live',
      });
      (controller.virtualInnerRef as { current: unknown }).current = inner;
      latestLedgerPx = controller.ledgerPxAtRender;
      return null;
    };

    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Harness, { events: [root, first] }));
    });
    // Scroll up 70px: the viewport top is now 30px into the root.
    scroller.scrollTop = 230;
    scrollListeners.forEach((listener) => listener(new Event('scroll')));
    act(() => {
      renderer.update(React.createElement(Harness, { events: [root, older, first] }));
    });
    expect(latestLedgerPx).toBe(0);
    renderer!.unmount();
  });

  describe('content between the banner and the rows', () => {
    const root = event('$root');
    const first = event('$first');
    const leading = { offsetHeight: 48 };
    const listTopRef = { current: 0 };
    const scroller = {
      getBoundingClientRect: () => ({ top: 100 }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      scrollTop: 300,
    };
    // The ledger's margin moves the list it paints.
    const inner = {
      getBoundingClientRect: () => ({
        top: listTopRef.current + (parseFloat(inner.style.marginTop) || 0),
      }),
      style: { marginTop: '' },
    };
    const ledgerPxs: number[] = [];
    const latestLedgerPx = () => ledgerPxs[ledgerPxs.length - 1];
    // virtual-core judging a row it measured, through the installed hook.
    const correct = (end: number, delta: number) =>
      act(() => {
        (
          virtualizer.shouldAdjustScrollPositionOnItemSizeChange as (
            item: { end: number },
            delta: number,
            instance: { scrollOffset: number; scrollDirection: null }
          ) => boolean
        )({ end }, delta, { scrollOffset: scroller.scrollTop, scrollDirection: null });
      });
    // Row measurement refs fire inside the commit, before the parent's layout effects.
    let measureInCommit: (() => void) | undefined;
    let holdBanner: (deltaPx: number, scrollTop: number) => void = () => undefined;
    const MeasuredRow = () => {
      useLayoutEffect(() => measureInCommit?.());
      return null;
    };

    const Harness = ({ leadingKey }: { leadingKey: string }) => {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
        () => 10
      );
      const events = [root, first];
      const controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 10,
        getItemKey: (index) => events[index]?.getId() ?? index,
        getScrollElement: () => scroller as unknown as HTMLDivElement,
        itemCount: events.length,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap: new Map(events.map((entry, index) => [entry.getId() ?? '', index])),
        threadEvents: events,
        threadId: '$root',
        threadInitialRenderMode: 'live',
        threadLeadingKey: leadingKey,
      });
      (controller.threadLeadingRef as { current: unknown }).current = leading;
      (controller.virtualInnerRef as { current: unknown }).current = inner;
      ledgerPxs.push(controller.ledgerPxAtRender);
      holdBanner = controller.holdThreadBannerResize;
      return React.createElement(MeasuredRow);
    };
    let renderer: ReturnType<typeof create>;
    const show = (leadingKey: string, offsetHeight: number) => {
      leading.offsetHeight = offsetHeight;
      act(() => {
        if (renderer) renderer.update(React.createElement(Harness, { leadingKey }));
        else renderer = create(React.createElement(Harness, { leadingKey }));
      });
    };

    beforeEach(() => {
      virtualizer.getVirtualItemForOffset = rootThenReplies;
      // The viewport top is 100px into the list: the first reply.
      scroller.scrollTop = 300;
      listTopRef.current = 0;
      ledgerPxs.length = 0;
      measureInCommit = undefined;
    });
    afterEach(() => {
      renderer?.unmount();
      renderer = undefined as unknown as ReturnType<typeof create>;
    });

    it('holds a reader in the rows when it goes, shrinks or grows', () => {
      show('error|older', 96);
      // The load error clears: the render folds all of it, then the commit
      // folds what remains before paint, so nothing can clamp in between.
      show('older', 48);
      expect(ledgerPxs.slice(-2)).toEqual([-96, -48]);
      // Load Older goes with the last page.
      show('', 0);
      expect(latestLedgerPx()).toBe(-96);
      // A load error appears.
      show('error', 40);
      expect(latestLedgerPx()).toBe(-56);
    });

    it('lets a reader looking at it see it go', () => {
      // The list starts 50px below the viewport top: no row to hold.
      listTopRef.current = 150;
      show('older', 48);
      show('', 0);
      expect(latestLedgerPx()).toBe(0);
    });

    it("starts the reader's view below the sticky headers", () => {
      // 150px of headers: the reader sees the first reply, not Load Older.
      listTopRef.current = 150;
      scrollPadding.top = 150;
      show('older', 48);
      show('', 0);
      expect(latestLedgerPx()).toBe(-48);
    });

    it("judges measurement corrections against the reader's top", () => {
      show('older', 48);
      // Ends 50px below the reader's top: in view, reflows.
      correct(150, 200);
      expect(latestLedgerPx()).toBe(0);
      // Ends above it: held (dropped into the ledger on iOS).
      correct(90, 200);
      expect(latestLedgerPx()).toBe(200);
      // The reader's top stays put while that fold waits to settle.
      correct(150, 10);
      expect(latestLedgerPx()).toBe(200);
    });

    it('judges a row measured in the commit that drops it against the moved list', () => {
      show('older', 48);
      measureInCommit = () => {
        measureInCommit = undefined;
        // The list moved up 48px: this row now ends above the reader's top.
        correct(130, 200);
      };
      show('', 0);
      expect(latestLedgerPx()).toBe(152);
    });

    it('holds a reader in the rows when the banner above them changes height', () => {
      show('', 0);
      holdBanner(22, 300);
      expect(scroller.scrollTop).toBe(322);
      // At the bottom, the layout of the shrunk header has clamped the live offset.
      scroller.scrollTop = 310;
      holdBanner(-22, 322);
      expect(scroller.scrollTop).toBe(300);
      // A single change, not a ledger debt left to settle at rest.
      expect(latestLedgerPx()).toBe(0);
    });

    it('lets a reader above the rows see the banner change', () => {
      listTopRef.current = 150;
      show('', 0);
      holdBanner(22, 300);
      expect(scroller.scrollTop).toBe(300);
    });

    it('leaves a reader at the very top there', () => {
      // The reader's line is the root's top: the root is the anchor.
      scroller.scrollTop = 0;
      listTopRef.current = 100;
      show('', 0);
      holdBanner(22, 0);
      expect(scroller.scrollTop).toBe(0);
    });

    it('does not take the banner write for a reverted settle', async () => {
      scroller.addEventListener.mockClear();
      show('', 0);
      // A row above the reader shrinks by 48px into the ledger; it settles at rest.
      correct(90, -48);
      expect(inner.style.marginTop).toBe('48px');
      await act(async () => {
        settleWaits.forEach((resolve) => resolve());
      });
      expect(scroller.scrollTop).toBe(252);
      expect(inner.style.marginTop).toBe('');
      // The banner then grows by about as much, inside the discard watch.
      holdBanner(40, 252);
      act(() => {
        scroller.addEventListener.mock.calls
          .filter(([type]) => type === 'scroll')
          .forEach(([, listener]) => (listener as EventListener)(new Event('scroll')));
      });
      // A reverted settle would restore its margin.
      expect(inner.style.marginTop).toBe('');
    });
  });
});
