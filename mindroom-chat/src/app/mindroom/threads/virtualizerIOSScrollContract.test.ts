// @vitest-environment jsdom
//
// iOS scroll contract for the timeline virtualizer, against the REAL
// (unmocked, locally patched) @tanstack/virtual-core.
//
// iOS kills flick momentum on any programmatic scroll write issued while a
// scroll is live, and replayed corrections at quiescence land as a visible
// lurch. The physics only reproduces on a device, but the CAUSE is fully
// observable here: every write goes through scrollToFn. These tests pin the
// invariant that keeps the device behavior correct:
//
//   while scroll events are streaming on iOS, the virtualizer must issue
//   ZERO scroll writes for measurement corrections, and must have NOTHING
//   banked to replay when the stream ends.
//
// The "detector" test proves the harness would catch the device bug it was
// born from (task #128 round 3: half-page lurch at end of momentum from
// virtual-core's banked defer-and-replay).
import { Virtualizer, _resetIOSDetectionForTests } from '@tanstack/react-virtual';
import { describe, expect, it, vi } from 'vitest';
import { buildMeasurementScrollCorrectionHook } from './threadRenderUtils';

const ROW_ESTIMATE = 50;
const ROW_ACTUAL = 120;
const COUNT = 200;
const START_OFFSET = 5000;
const FLICKS = 3;
const STEPS_PER_FLICK = 10;
const MEASURED_ROWS = FLICKS * STEPS_PER_FLICK;
const BANKED_ERROR = MEASURED_ROWS * (ROW_ACTUAL - ROW_ESTIMATE);
const COLLAPSED_ROW_SIZE = 60;
const EXPANDED_ROW_DELTA = 4149;

// virtual-core caches its iOS detection at module scope; jsdom's userAgent
// lives on the prototype, so an own property shadows it (same pattern as
// virtual-core's own test suite).
function withFakeIOSUserAgent<T>(fn: () => T): T {
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    configurable: true,
  });
  _resetIOSDetectionForTests();
  try {
    return fn();
  } finally {
    delete (navigator as { userAgent?: string }).userAgent;
    _resetIOSDetectionForTests();
  }
}

type ScrollCallback = (offset: number, isScrolling: boolean) => void;

// virtual-core keeps its banked iOS adjustment compile-time private; the
// contract must observe it (same escape hatch virtual-core's own tests use).
const bankedAdjustment = (virtualizer: Virtualizer<Element, Element>): number =>
  (virtualizer as unknown as { _iosDeferredAdjustment: number })._iosDeferredAdjustment;

function makeVirtualizer(scrollToFn: ReturnType<typeof vi.fn>) {
  let scrollCallback: ScrollCallback | null = null;
  const makeScrollElement = () => ({
    scrollTop: START_OFFSET,
    scrollLeft: 0,
    scrollHeight: COUNT * ROW_ESTIMATE,
    clientHeight: 600,
    offsetHeight: 600,
  });
  const holder = { element: makeScrollElement() };
  const virtualizer = new Virtualizer<Element, Element>({
    count: COUNT,
    estimateSize: () => ROW_ESTIMATE,
    getScrollElement: () => holder.element as unknown as Element,
    scrollToFn,
    observeElementRect: () => {},
    observeElementOffset: (_instance, cb) => {
      scrollCallback = cb;
      cb(START_OFFSET, false);
      return () => {};
    },
  });
  virtualizer._willUpdate();
  // Build the measurements cache so resizeItem can resolve items.
  virtualizer.getTotalSize();
  // _willUpdate issues a mount-sync write; the tests only care about
  // measurement-correction writes after this point.
  scrollToFn.mockClear();
  // A real scroll event reports the element's own scrollTop.
  const scroll: ScrollCallback = (offset, isScrolling) => {
    holder.element.scrollTop = offset;
    scrollCallback!(offset, isScrolling);
  };
  // A new element identity makes the next _willUpdate run cleanup() and
  // re-attach — what a thread switch's scroller remount does in the app.
  const swapToFreshElement = () => {
    holder.element = makeScrollElement();
    virtualizer._willUpdate();
  };
  return { virtualizer, scroll, swapToFreshElement, holder };
}

const adjustmentWrites = (scrollToFn: ReturnType<typeof vi.fn>) =>
  scrollToFn.mock.calls.filter(
    ([, options]) => (options as { adjustments?: number } | undefined)?.adjustments !== undefined
  );

// An upward multi-flick gesture through never-measured territory: scroll
// events stream (isScrolling stays true across the flick boundaries, as on
// a device where the finger comes back down within the debounce window)
// while each newly mounted above-viewport row measures BIGGER than its
// estimate — the exact shape of the device report.
function runUpwardFlickSequence(
  virtualizer: Virtualizer<Element, Element>,
  scroll: ScrollCallback
) {
  let offset = START_OFFSET;
  let index = Math.floor(START_OFFSET / ROW_ESTIMATE) - 1;
  for (let flick = 0; flick < FLICKS; flick += 1) {
    for (let step = 0; step < STEPS_PER_FLICK; step += 1) {
      offset -= 40;
      scroll(offset, true);
      virtualizer.resizeItem(index, ROW_ACTUAL);
      index -= 1;
    }
  }
  return offset;
}

describe('virtualizer iOS scroll contract (production hook)', () => {
  it('issues no scroll writes during the stream and banks nothing to replay at quiescence', () => {
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
      const droppedDeltas: number[] = [];
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook(
        {
          isIOSWebKitDevice: () => true,
          onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
        }
      );

      const endOffset = runUpwardFlickSequence(virtualizer, scroll);
      expect(scrollToFn).not.toHaveBeenCalled();
      expect(bankedAdjustment(virtualizer)).toBe(0);

      // Momentum dies: still nothing to write — no end-of-momentum lurch.
      scroll(endOffset, false);
      expect(scrollToFn).not.toHaveBeenCalled();

      // Measurements were APPLIED, not deferred (the PR #76 white-gap
      // failure mode stays dead): total size reflects the real row heights.
      expect(virtualizer.getTotalSize()).toBe(COUNT * ROW_ESTIMATE + BANKED_ERROR);

      // Every FULLY-ABOVE dropped correction was reported for visual
      // compensation (the transform layer cancels exactly what scrollTop
      // never received). The first four rows of the sequence still
      // straddle the viewport top (row end = 5000-50k vs offset =
      // 4960-40k → fully above only from k=4), and straddling rows
      // reflow in place by design — no compensation.
      const straddlingRows = 4;
      expect(droppedDeltas).toHaveLength(MEASURED_ROWS - straddlingRows);
      expect(droppedDeltas.reduce((sum, deltaPx) => sum + deltaPx, 0)).toBe(
        BANKED_ERROR - straddlingRows * (ROW_ACTUAL - ROW_ESTIMATE)
      );
    });
  });

  it('detector: without the hook, virtual-core banks the whole gesture and replays it as one lurch', () => {
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll } = makeVirtualizer(scrollToFn);

      const endOffset = runUpwardFlickSequence(virtualizer, scroll);
      expect(scrollToFn).not.toHaveBeenCalled();
      expect(bankedAdjustment(virtualizer)).toBe(BANKED_ERROR);

      scroll(endOffset, false);
      expect(scrollToFn).toHaveBeenCalledTimes(1);
      const [, options] = scrollToFn.mock.calls[0] as [
        number,
        { adjustments?: number; behavior?: ScrollBehavior }
      ];
      expect(options.adjustments).toBe(BANKED_ERROR);
    });
  });

  it('never writes on iOS even when quiet — the correction is ledgered instead', () => {
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
      const droppedDeltas: number[] = [];
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook(
        {
          isIOSWebKitDevice: () => true,
          onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
        }
      );

      scroll(START_OFFSET, false);
      virtualizer.resizeItem(10, ROW_ACTUAL);
      // Quiet applies clamp near the top edge during virtual-core's
      // internal bursts (scrollTo(-44) on the prepend one-paint e2e) —
      // on iOS the ledger owns ALL fully-above corrections; scrollTop is
      // written only by the at-rest settle.
      expect(scrollToFn).not.toHaveBeenCalled();
      expect(droppedDeltas).toEqual([ROW_ACTUAL - ROW_ESTIMATE]);
    });
  });

  it('never compensates a visible (straddling) row resize — expanding a tool block must not scroll the view', () => {
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
      const droppedDeltas: number[] = [];
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook(
        {
          isIOSWebKitDevice: () => true,
          onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
        }
      );

      // Quiet viewport whose top edge sits INSIDE row 100 (start 5000):
      // the row straddles the viewport top, exactly like a tall tool-call
      // block whose expand/fold control is on screen.
      scroll(START_OFFSET + 25, false);

      // Expand: the block grows by 400px. The content must unfold in place —
      // no compensating write now, and nothing banked to land 150ms later.
      virtualizer.resizeItem(100, ROW_ESTIMATE + 400);
      expect(scrollToFn).not.toHaveBeenCalled();
      expect(bankedAdjustment(virtualizer)).toBe(0);

      // Fold back: same contract in the other direction.
      virtualizer.resizeItem(100, ROW_ESTIMATE);
      expect(scrollToFn).not.toHaveBeenCalled();
      expect(bankedAdjustment(virtualizer)).toBe(0);
    });
  });

  it('patch guard: cleanup() resets banked iOS deferral state on scroll-element swap', () => {
    // Pins the patch-package fix for TanStack/virtual#1220
    // (patches/@tanstack+virtual-core+3.17.3.patch). If a dependency bump
    // drops the patch without the upstream fix present, the stale bank
    // survives the swap and this fails.
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll, swapToFreshElement } = makeVirtualizer(scrollToFn);

      runUpwardFlickSequence(virtualizer, scroll);
      expect(bankedAdjustment(virtualizer)).toBe(BANKED_ERROR);

      // Thread switch mid-flick: the scroller remounts while a deferral is
      // banked. The bank was computed against the OLD element's content and
      // must not survive into the new one.
      swapToFreshElement();
      expect(bankedAdjustment(virtualizer)).toBe(0);

      // The new element's first quiescence must not replay a stale delta.
      scroll(START_OFFSET, false);
      expect(adjustmentWrites(scrollToFn)).toHaveLength(0);
    });
  });

  it('ledgers a giant desktop correction while scrolling backward instead of snapping down', () => {
    const scrollToFn = vi.fn();
    const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
    const droppedDeltas: number[] = [];

    // Reproduce the trace's cached-collapsed path: this row was measured
    // before it left the virtual window, then remounts expanded during the
    // upward ride. virtual-core's default predicate suppresses this exact
    // backward remeasurement; the production hook must preserve that guard.
    virtualizer.resizeItem(10, COLLAPSED_ROW_SIZE);
    expect(virtualizer.itemSizeCache.get(10)).toBe(COLLAPSED_ROW_SIZE);
    scrollToFn.mockClear();
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
      isIOSWebKitDevice: () => false,
      onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
    });

    scroll(START_OFFSET - 40, true);
    virtualizer.resizeItem(10, COLLAPSED_ROW_SIZE + EXPANDED_ROW_DELTA);

    expect(scrollToFn).not.toHaveBeenCalled();
    expect(droppedDeltas).toEqual([EXPANDED_ROW_DELTA]);
  });

  it.each([
    { motion: 'forward', offset: START_OFFSET + 40, isScrolling: true },
    { motion: 'quiet', offset: START_OFFSET, isScrolling: false },
  ])('keeps immediate desktop correction while $motion', ({ offset, isScrolling }) => {
    const scrollToFn = vi.fn();
    const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
    const droppedDeltas: number[] = [];

    virtualizer.resizeItem(10, COLLAPSED_ROW_SIZE);
    scrollToFn.mockClear();
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
      isIOSWebKitDevice: () => false,
      onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
    });

    scroll(offset, isScrolling);
    virtualizer.resizeItem(10, ROW_ACTUAL);

    expect(scrollToFn).toHaveBeenCalledTimes(1);
    expect(droppedDeltas).toEqual([]);
  });

  it('judges a resize against the live offset right after a programmatic jump', () => {
    // A programmatic scroll writes the element; virtual-core's cached offset
    // only follows on the next scroll event. A row that mounts and resizes in
    // between sits above the stale offset but below the viewport the reader
    // now sees, so it must reflow instead of dragging the view back down.
    const scrollToFn = vi.fn();
    const { virtualizer, holder } = makeVirtualizer(scrollToFn);
    const droppedDeltas: number[] = [];
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
      isIOSWebKitDevice: () => false,
      onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
    });
    holder.element.scrollTop = 1500;
    const belowLiveViewport = 2400 / ROW_ESTIMATE;

    virtualizer.resizeItem(belowLiveViewport, ROW_ESTIMATE - 20);

    expect(adjustmentWrites(scrollToFn)).toHaveLength(0);
    expect(droppedDeltas).toEqual([]);
  });

  it('ledgers a correction that would scroll above the top', () => {
    // A pending fold lays the rows it added above the reader at negative
    // offsets. One that measures smaller than its estimate cannot be undone by
    // scrolling a reader near the top: the browser would clamp the write.
    const droppedDeltas: number[] = [];
    const hook = buildMeasurementScrollCorrectionHook({
      isIOSWebKitDevice: () => false,
      onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
    });

    const apply = hook({ end: -200 }, -100, {
      scrollOffset: 30,
      scrollDirection: null,
      scrollElement: { scrollTop: 30 },
    });

    expect(apply).toBe(false);
    expect(droppedDeltas).toEqual([-100]);
  });

  it('judges and corrects from the live offset, an unseen upward write being a backward scroll', () => {
    // App writes (a jump, a bulk-expansion restore) move the element; rows
    // resize before their scroll event arrives.
    let element: { scrollTop: number } | undefined;
    const scrollToFn = vi.fn((offset: number, options: { adjustments?: number }) => {
      if (element) element.scrollTop = offset + (options.adjustments ?? 0);
    });
    const { virtualizer, scroll, holder } = makeVirtualizer(scrollToFn);
    element = holder.element;
    const droppedDeltas: number[] = [];
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
      isIOSWebKitDevice: () => false,
      onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
    });

    // Down 600px: rows above the reader shrink; each correction lands once,
    // on the live offset.
    holder.element.scrollTop = START_OFFSET + 600;
    virtualizer.resizeItem(1000 / ROW_ESTIMATE, ROW_ESTIMATE - 20);
    virtualizer.resizeItem(1050 / ROW_ESTIMATE, ROW_ESTIMATE - 20);
    expect(holder.element.scrollTop).toBe(START_OFFSET + 560);
    scroll(START_OFFSET + 560, false);
    // Up 600px: a row in view reflows, a row above goes to the ledger, and
    // virtual-core still reads the write's event as backward.
    holder.element.scrollTop = START_OFFSET - 40;
    virtualizer.resizeItem(5000 / ROW_ESTIMATE, ROW_ESTIMATE + 20);
    virtualizer.resizeItem(1100 / ROW_ESTIMATE, ROW_ESTIMATE - 20);
    expect(holder.element.scrollTop).toBe(START_OFFSET - 40);
    expect(droppedDeltas).toEqual([-20]);
    scroll(START_OFFSET - 40, true);
    expect(virtualizer.scrollDirection).toBe('backward');
  });

  it('judges the rest of a batch in the layout its applied corrections have not moved yet', () => {
    // virtual-core reports a batch's rows where they were before the batch,
    // but each applied correction has already moved the offset.
    let element: { scrollTop: number } | undefined;
    const scrollToFn = vi.fn((offset: number, options: { adjustments?: number }) => {
      if (element) element.scrollTop = offset + (options.adjustments ?? 0);
    });
    const { virtualizer, holder } = makeVirtualizer(scrollToFn);
    element = holder.element;
    let unrenderedPx = 0;
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
      isIOSWebKitDevice: () => false,
      onDroppedCorrection: () => {},
      onAppliedCorrection: (deltaPx) => {
        unrenderedPx += deltaPx;
      },
      unrenderedCorrectionPx: () => unrenderedPx,
    });

    // The two rows just above the reader fold by 40px each.
    const lastRowAbove = START_OFFSET / ROW_ESTIMATE - 1;
    virtualizer.resizeItem(lastRowAbove - 1, ROW_ESTIMATE - 40);
    virtualizer.resizeItem(lastRowAbove, ROW_ESTIMATE - 40);

    expect(holder.element.scrollTop).toBe(START_OFFSET - 80);
    expect(unrenderedPx).toBe(-80);
  });

  it('judges a resize against the row painted at the viewport top, below content above the list', () => {
    // 200px of banner and Load Older sit above the list, which virtual-core's
    // offsets do not include: at scrollTop 1500 the reader sees offset 1300.
    // A row that resizes inside those 200px is in view and must reflow.
    const scrollToFn = vi.fn();
    const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
    const droppedDeltas: number[] = [];
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
      isIOSWebKitDevice: () => false,
      onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
      viewportTopOffset: (scrollOffset) => scrollOffset - 200,
    });
    scroll(1500, false);

    virtualizer.resizeItem(1350 / ROW_ESTIMATE, ROW_ACTUAL);
    expect(adjustmentWrites(scrollToFn)).toHaveLength(0);
    // A row that ends above the painted viewport top still keeps the reader.
    virtualizer.resizeItem(1200 / ROW_ESTIMATE, ROW_ACTUAL);
    expect(adjustmentWrites(scrollToFn)).toHaveLength(1);
    expect(droppedDeltas).toEqual([]);
  });

  // OFFSET-LEDGER COHERENCE (device round 10 replacement design): the
  // round-8 transform compensation shifted PAINT while the window math
  // stayed ignorant — the on-device trace showed ±3000px accumulated
  // divergence rendering the viewport blank for 30% of a 40s ride, and a
  // non-atomic settle flashing full-screen jumps. The replacement folds
  // dropped corrections into virtual-core's OWN coordinate space instead:
  // the inner container gets a real layout offset (marginTop ledger) and
  // options.scrollMargin tracks (base container offset + ledger) in the
  // same commit. This contract pins the algebra against the real library:
  // after (drop, ledger += -delta, scrollMargin += -delta), the rendered
  // item set for the SAME scrollOffset is unchanged and every painted
  // position (item.start - scrollMargin) shifts by exactly -ledgerDelta —
  // which the container's ledger margin cancels in the DOM, so the visual
  // outcome is a no-op WITHOUT any scrollTop write and WITHOUT any
  // window/paint divergence, by construction.
  it('offset ledger: scrollMargin absorbs a dropped above-viewport shrink coherently', () => {
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      let scrollCallback: ScrollCallback | null = null;
      const BASE_MARGIN = 300;
      const SHRINK = 100;
      const element = {
        scrollTop: START_OFFSET,
        scrollLeft: 0,
        scrollHeight: COUNT * ROW_ESTIMATE + BASE_MARGIN,
        clientHeight: 600,
        offsetHeight: 600,
      };
      const virtualizer = new Virtualizer<Element, Element>({
        count: COUNT,
        estimateSize: () => ROW_ESTIMATE,
        scrollMargin: BASE_MARGIN,
        getScrollElement: () => element as unknown as Element,
        scrollToFn,
        // The ledger contract reads getVirtualItems(), which needs a real
        // viewport rect (the write-contract tests above never range).
        observeElementRect: (_instance, cb) => {
          cb({ width: 400, height: 600 });
          return () => {};
        },
        observeElementOffset: (_instance, cb) => {
          scrollCallback = cb;
          cb(START_OFFSET, false);
          return () => {};
        },
      });
      virtualizer._willUpdate();
      virtualizer.getTotalSize();
      scrollToFn.mockClear();
      const droppedDeltas: number[] = [];
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook(
        {
          isIOSWebKitDevice: () => true,
          onDroppedCorrection: (deltaPx) => droppedDeltas.push(deltaPx),
        }
      );

      // Live scroll; snapshot the rendered window and painted positions.
      element.scrollTop = START_OFFSET - 40;
      scrollCallback!(START_OFFSET - 40, true);
      const before = virtualizer.getVirtualItems();
      const beforeKeys = before.map((item) => item.key);
      const beforePainted = new Map(
        before.map((item) => [item.key, item.start - virtualizer.options.scrollMargin])
      );

      // A fully-above row shrinks by 100 mid-scroll; the hook drops the
      // correction (no write) and reports the delta.
      const aboveIndex = before[0].index - 5;
      virtualizer.resizeItem(aboveIndex, ROW_ESTIMATE - SHRINK);
      expect(droppedDeltas).toEqual([-SHRINK]);
      expect(adjustmentWrites(scrollToFn)).toHaveLength(0);

      // Fold the delta into the ledger: container margin grows by +100 in
      // the DOM (not modeled here) and scrollMargin tracks it.
      virtualizer.setOptions({
        ...virtualizer.options,
        scrollMargin: BASE_MARGIN + SHRINK,
      });
      virtualizer._willUpdate();
      const after = virtualizer.getVirtualItems();

      // Same scrollOffset → same rendered item set: window math coherent.
      expect(after.map((item) => item.key)).toEqual(beforeKeys);
      // Every painted position shifts by exactly -SHRINK, which the +100
      // container ledger margin cancels in the DOM: net visual no-op.
      after.forEach((item) => {
        const painted = item.start - virtualizer.options.scrollMargin;
        expect(beforePainted.get(item.key)! - painted).toBe(SHRINK);
      });
      // And still no scroll writes anywhere in the sequence.
      expect(adjustmentWrites(scrollToFn)).toHaveLength(0);
    });
  });
});
