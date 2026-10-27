// @vitest-environment jsdom
//
// Ledger settle contract against the REAL (unmocked) @tanstack/virtual-core.
//
// The settle folds the offset ledger in one synchronous block: clear the
// inner margin, shift scrollTop, zero virtual-core's scrollMargin. The
// scrollTop write's echo event is asynchronous (iOS may coalesce it away),
// so the window recompute inside that block must see a reconciled cached
// offset — otherwise it pairs the zeroed margin with the pre-write offset
// and shifts the computed range by the whole fold, mounting and measuring a
// band of far-away rows in a single frame (the settle-cascade jump: up to
// +1,531px content growth right after rest; ride-traces 1783802452438 /
// 1783804190290, pinned in rideTraceReplay.test.ts).
//
// These tests execute the PRODUCTION settle sequence (applyLedgerSettle)
// against real virtual-core range math — the sufficiency check the fake
// virtualizer in the lifecycle suite cannot provide. The detector test
// proves the harness would catch the defect it was born from.
import { Virtualizer } from '@tanstack/react-virtual';
import { describe, expect, it } from 'vitest';
import { applyLedgerSettle } from './timelineScrollLedgerController';
import { buildMeasurementScrollCorrectionHook } from './threadRenderUtils';
import { createRoomAutomaticFill } from './roomAutomaticFill';

const ROW_ESTIMATE = 50;
const COUNT = 400;
const START_OFFSET = 5000;
// Trace-shaped fold: the frame-192 settle rebased ~3.4k px.
const FOLD_PX = 3400;
const VIEWPORT = { width: 400, height: 600 };

function makeSettledScroller() {
  const element = {
    scrollTop: START_OFFSET,
    scrollLeft: 0,
    scrollHeight: COUNT * ROW_ESTIMATE,
    clientHeight: VIEWPORT.height,
    offsetHeight: VIEWPORT.height,
  };
  // Accrual state: the ledger holds FOLD_PX (scrollMargin -FOLD_PX shifts
  // every measurement start up) while the cached offset still reflects the
  // last real scroll event.
  const virtualizer = new Virtualizer<Element, Element>({
    count: COUNT,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 1,
    scrollMargin: -FOLD_PX,
    getScrollElement: () => element as unknown as Element,
    scrollToFn: () => {},
    observeElementRect: (_instance, cb) => {
      cb(VIEWPORT);
    },
    observeElementOffset: (_instance, cb) => {
      cb(START_OFFSET, false);
    },
  });
  virtualizer._willUpdate();
  virtualizer.getTotalSize();
  const inner = { style: { marginTop: `-${FOLD_PX}px` } };
  return { virtualizer, element, inner };
}

function makeTraceMismatch(paintedLedgerPx: number) {
  const state = makeSettledScroller();
  state.inner.style.marginTop = `-${paintedLedgerPx}px`;
  state.virtualizer.setOptions({
    ...state.virtualizer.options,
    scrollMargin: -paintedLedgerPx,
  });
  return state;
}

const rangeOf = (virtualizer: Virtualizer<Element, Element>): [number, number] => {
  const items = virtualizer.getVirtualItems();
  return [items[0].index, items[items.length - 1].index];
};

describe('ledger settle contract (real virtual-core)', () => {
  it('captures the negative-settle target before removing margin clamps the native range', () => {
    const { virtualizer, inner } = makeSettledScroller();
    const debt = -160;
    inner.style.marginTop = '160px';
    virtualizer.setOptions({ ...virtualizer.options, scrollMargin: 160 });
    let nativeOffset = COUNT * ROW_ESTIMATE + 160 - VIEWPORT.height;
    const clamp = (offset: number) =>
      Math.min(
        offset,
        COUNT * ROW_ESTIMATE + (Number.parseFloat(inner.style.marginTop) || 0) - VIEWPORT.height
      );
    const root = {
      get scrollTop() {
        // A layout read after margin removal observes native range clamping.
        nativeOffset = clamp(nativeOffset);
        return nativeOffset;
      },
      set scrollTop(offset: number) {
        nativeOffset = clamp(offset);
      },
    };
    virtualizer.scrollOffset = nativeOffset;
    const anchorBefore = virtualizer.getMeasurements()[COUNT - 1].start - root.scrollTop;
    applyLedgerSettle(inner, root, debt, virtualizer);
    expect(virtualizer.getMeasurements()[COUNT - 1].start - root.scrollTop).toBe(anchorBefore);
    expect(virtualizer.scrollOffset).toBe(COUNT * ROW_ESTIMATE - VIEWPORT.height);
  });

  it.each([
    { direction: null, cancel: false },
    { direction: 'forward' as const, cancel: false },
    { direction: null, cancel: true },
  ])(
    'retains immediate desktop correction outside automatic fill ($direction, cancelled: $cancel)',
    ({ direction, cancel }) => {
      const { virtualizer, element, inner } = makeSettledScroller();
      applyLedgerSettle(inner, element, FOLD_PX, virtualizer);
      const owner = createRoomAutomaticFill({ readGeometry: () => undefined, schedule: () => {} });
      if (cancel) owner.cancel();
      let debt = 0;
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook(
        {
          isIOSWebKitDevice: () => false,
          shouldDeferAutomaticFillCorrection: cancel ? owner.isActive : undefined,
          onDroppedCorrection: (delta) => {
            debt += delta;
          },
        }
      );
      virtualizer.setOptions({
        ...virtualizer.options,
        scrollToFn: (offset, options) => {
          element.scrollTop = offset + (options.adjustments ?? 0);
        },
      });
      virtualizer.scrollDirection = direction;
      const before = element.scrollTop;
      virtualizer.resizeItem(150, 20);
      expect(element.scrollTop).toBe(before - 30);
      expect(debt).toBe(0);
    }
  );

  it('keeps the latest anchor fixed when a visible predecessor finishes its initial measurement', () => {
    const { virtualizer, element, inner } = makeSettledScroller();
    applyLedgerSettle(inner, element, FOLD_PX, virtualizer);
    let debt = 0;
    const policy = {
      isIOSWebKitDevice: () => false,
      shouldDeferAutomaticFillCorrection: (item: { index?: number } = {}) =>
        (item.index ?? Infinity) < 180,
      onDroppedCorrection: (delta: number) => {
        debt += delta;
      },
    };
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange =
      buildMeasurementScrollCorrectionHook(policy);
    const before = virtualizer.getMeasurements()[180].start - element.scrollTop;
    virtualizer.resizeItem(170, 20);
    virtualizer.setOptions({ ...virtualizer.options, scrollMargin: -debt });
    inner.style.marginTop = `${-debt}px`;
    expect(virtualizer.getMeasurements()[180].start - element.scrollTop).toBe(before);
    expect(debt).toBe(-30);
    virtualizer.resizeItem(180, 20);
    expect(debt).toBe(-30);
  });

  it('keeps committed anchors fixed during latest-open shrinks after positive prepend settlement', () => {
    const { virtualizer, element, inner } = makeSettledScroller();
    let debt = 0;
    const policy = {
      isIOSWebKitDevice: () => false,
      shouldDeferAutomaticFillCorrection: () => true,
      onDroppedCorrection: (delta: number) => {
        debt += delta;
      },
    };
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange =
      buildMeasurementScrollCorrectionHook(policy);
    virtualizer.setOptions({
      ...virtualizer.options,
      scrollToFn: (offset, options) => {
        element.scrollTop = Math.max(0, offset + (options.adjustments ?? 0));
      },
    });
    applyLedgerSettle(inner, element, FOLD_PX, virtualizer);
    const anchorIndex = 180;
    const committedTop = virtualizer.getMeasurements()[anchorIndex].start;
    const before = committedTop - element.scrollTop;
    virtualizer.resizeItem(150, 20);
    virtualizer.resizeItem(151, 20);
    // ResizeObserver runs after rAF: native movement here can paint while
    // React still owns the previous row positions.
    expect(committedTop - element.scrollTop).toBe(before);
    expect(debt).toBe(-60);
    virtualizer.setOptions({ ...virtualizer.options, scrollMargin: -debt });
    inner.style.marginTop = `${-debt}px`;
    expect(virtualizer.getMeasurements()[anchorIndex].start - element.scrollTop).toBe(before);
    applyLedgerSettle(inner, element, debt, virtualizer);
    expect(virtualizer.getMeasurements()[anchorIndex].start - element.scrollTop).toBe(before);
  });

  it('keeps the computed window identical across the production settle block', () => {
    const { virtualizer, element, inner } = makeSettledScroller();
    const before = rangeOf(virtualizer);

    const settledScrollTop = applyLedgerSettle(inner, element, FOLD_PX, virtualizer);

    expect(settledScrollTop).toBe(START_OFFSET + FOLD_PX);
    expect(virtualizer.scrollOffset).toBe(START_OFFSET + FOLD_PX);
    expect(inner.style.marginTop).toBe('');
    expect(virtualizer.options.scrollMargin).toBe(0);
    // The window the settle-triggered recompute renders is the SAME rows —
    // no far-away band gets mounted and measured inside the settle frame.
    expect(rangeOf(virtualizer)).toEqual(before);
  });

  it('detector: without the offset reconcile, the recompute shifts the window by the fold', () => {
    const { virtualizer, element, inner } = makeSettledScroller();
    const before = rangeOf(virtualizer);

    // The pre-fix settle: margin cleared, scrollTop written, margin zeroed —
    // but the cached offset left stale until the (async) echo event.
    inner.style.marginTop = '';
    element.scrollTop += FOLD_PX;
    virtualizer.setOptions({ ...virtualizer.options, scrollMargin: 0 });

    const [beforeStart] = before;
    const [afterStart] = rangeOf(virtualizer);
    expect(beforeStart - afterStart).toBe(FOLD_PX / ROW_ESTIMATE);
  });

  it.each([
    { paintedLedgerPx: 512, liveLedgerPx: -5 },
    { paintedLedgerPx: 216, liveLedgerPx: 1 },
  ])(
    'defers a $paintedLedgerPx px painted ledger when the live accumulator has moved to $liveLedgerPx px',
    ({ paintedLedgerPx, liveLedgerPx }) => {
      const { virtualizer, element, inner } = makeTraceMismatch(paintedLedgerPx);
      const before = rangeOf(virtualizer);

      const settledScrollTop = applyLedgerSettle(inner, element, liveLedgerPx, virtualizer);

      expect(settledScrollTop).toBeUndefined();
      expect(element.scrollTop).toBe(START_OFFSET);
      expect(inner.style.marginTop).toBe(`-${paintedLedgerPx}px`);
      expect(virtualizer.options.scrollMargin).toBe(-paintedLedgerPx);
      expect(rangeOf(virtualizer)).toEqual(before);
    }
  );
});
