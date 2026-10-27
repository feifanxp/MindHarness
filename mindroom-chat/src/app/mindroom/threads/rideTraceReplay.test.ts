import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  RideTrace,
  deriveClientHeightFromBottomRest,
  extractDiscardedSettleWrites,
  extractLedgerSettles,
  parseRideTrace,
  replayLedgerBoundaryGuard,
} from './rideTraceReplay';
import { shouldSettleLedgerAtBoundary } from './threadRenderUtils';

/**
 * Device-trace replay corpus. Each entry is a real recorded ride checked
 * into __tests__/traces/. clientHeight comes from clamp physics (bottom
 * rest plateaus; v3 traces omit the field) — the manifest pins the values
 * and a test asserts the derivation still reproduces them, so a fixture
 * swap cannot silently shift every bounds classification.
 *
 * Corpus provenance:
 * - ipadFill (2026-07-11 13:42, pre-overscroll-fix build): thread open at
 *   the bottom + down-fling while the window filled. Contains the
 *   recorded mid-bounce boundary settle (frame 192: written 87px past the
 *   bottom edge, 87px slip) that motivated the rubber-band deferral.
 * - iphoneFixed (2026-07-11 14:10, deferral deployed): same thread, full
 *   bottom-to-top ride. Its one boundary settle landed with a 1px slip.
 * - iphoneOld* (2026-07-10, pre-fix builds): boundary-settle-heavy rides
 *   with 80-311px anchor slips; kept as detector regression material.
 */
const loadTrace = (name: string): RideTrace =>
  parseRideTrace(
    JSON.parse(readFileSync(new URL(`./__tests__/traces/${name}.json`, import.meta.url), 'utf8'))
  );

const ipadFill = loadTrace('ride-trace-1783802452438');
const iphoneFixed = loadTrace('ride-trace-1783804190290');
const iphoneOldA = loadTrace('ride-trace-1783745470971');
const iphoneOldB = loadTrace('ride-trace-1783737737705');
// Same thread and iPad as ipadFill, recorded on the #124 settle-atomicity
// build: the post-cascade-fix good ride.
const ipadCascadeFixed = loadTrace('ride-trace-1783811896380');
// Same thread and iPad, recorded on the #125 touch-gate build: the
// post-touch-gate golden (its open-fill 34k rebase lands untouched).
const ipadTouchGateFixed = loadTrace('ride-trace-1783829722124');
// Independent #125 ride on a different thread. It reproduces the same
// committed/live split settle at a smaller magnitude (216px painted, 1px
// live accumulator).
const secondIpadTouchGateFixed = loadTrace('ride-trace-1783829767914');

const CORPUS: { trace: RideTrace; clientHeight: number }[] = [
  { trace: ipadFill, clientHeight: 469 },
  { trace: iphoneFixed, clientHeight: 465 },
  { trace: iphoneOldA, clientHeight: 500 },
  { trace: iphoneOldB, clientHeight: 469 },
  { trace: ipadCascadeFixed, clientHeight: 469 },
  { trace: ipadTouchGateFixed, clientHeight: 469 },
  { trace: secondIpadTouchGateFixed, clientHeight: 495 },
];

describe('ride trace corpus', () => {
  it('derives each clientHeight from bottom-rest clamp physics', () => {
    CORPUS.forEach(({ trace, clientHeight }) => {
      expect(deriveClientHeightFromBottomRest(trace.frames, trace.viewport.h)).toBe(clientHeight);
    });
  });

  it('boundary guard never fires outside the physical scroll range on any recorded frame', () => {
    // Property over every frame of every ride, with the ledger forced to
    // settle-worthy magnitudes in both directions so the guard branches
    // are actually exercised (the recorded margin is often 0 while the
    // ledger rides in virtual-core scrollMargin).
    CORPUS.forEach(({ trace, clientHeight }) => {
      [-5000, 5000].forEach((forcedLedgerPx) => {
        const firings = replayLedgerBoundaryGuard(trace.frames, clientHeight, () => forcedLedgerPx);
        const outOfBounds = firings.filter((firing) => firing.outOfBounds);
        expect(outOfBounds).toEqual([]);
      });
    });
  });

  it('defers the recorded mid-bounce settle of ipadFill frame 192 and keeps its landing', () => {
    // The recorded build fired a boundary settle at frame 192 while the
    // scroller sat 87px past the bottom edge mid-bounce (87px visible
    // slip — the write clamped at exactly sh - 469). The trace proves the
    // detector sees it...
    const settles = extractLedgerSettles(ipadFill.frames, 469);
    const outOfBoundsBoundary = settles.filter(
      (settle) => settle.cause === 'boundary' && settle.outOfBoundsBefore
    );
    expect(outOfBoundsBoundary.map((settle) => settle.frameIndex)).toEqual([192]);

    // ...and replaying the pre-settle frames through the CURRENT
    // predicate shows the deferral: no firing on the out-of-bounds
    // bounce-back frames 186-191. The 3439px ledger is recovered from the
    // settle's own scrollTop rewrite — a lower bound, since that write
    // was browser-clamped; any larger value defers the same way.
    const window = ipadFill.frames.slice(185, 192);
    const firings = replayLedgerBoundaryGuard(window, 469, () => 3439);
    expect(firings).toEqual([]);

    // The settle is deferred, not lost: the same geometry at the bounce's
    // in-bounds landing offset still fires.
    const landing = ipadFill.frames[191];
    const innerTop = landing.tr - landing.st;
    expect(
      shouldSettleLedgerAtBoundary({
        ledgerPx: 3439,
        innerTop,
        innerBottom: innerTop + (landing.sh - landing.tr),
        scrollTop: 0,
        scrollBottom: 469,
        scrollOffset: landing.sh - 469,
        clientHeight: 469,
        scrollHeight: landing.sh,
        scrollDirection: 'backward',
      })
    ).toBe(true);
  });

  it('holds the fixed build to its recorded behavior: one clean boundary settle', () => {
    const settles = extractLedgerSettles(iphoneFixed.frames, 465);
    const boundary = settles.filter((settle) => settle.cause === 'boundary');
    expect(boundary).toHaveLength(1);
    expect(boundary[0].outOfBoundsBefore).toBe(false);
    expect(boundary[0].anchorSlipPx).toBeLessThanOrEqual(2);
  });

  it('detects the pre-fix boundary snap class in the 2026-07-10 rides', () => {
    [iphoneOldA, iphoneOldB].forEach((trace, index) => {
      const clientHeight = CORPUS[2 + index].clientHeight;
      const slips = extractLedgerSettles(trace.frames, clientHeight)
        .map((settle) => settle.anchorSlipPx)
        .filter((slip): slip is number => slip !== undefined);
      expect(Math.max(...slips)).toBeGreaterThan(80);
    });
  });

  it('detects the settle-cascade defect in the pre-#124 rides', () => {
    // Fixed by #124 (settle atomicity: the virtualizer's cached offset is
    // reconciled before the setOptions recompute). These goldens keep the
    // PRE-fix rides as detector proof: the quiescence settle's synchronous
    // remount/remeasure grew content far beyond the ledger fold in single
    // 100-240ms frames right after rest, with the anchor row unmounted
    // (anchorSlipPx blind). The post-fix behavior is pinned by the
    // ipadCascadeFixed test below.
    const cascade = (trace: RideTrace, clientHeight: number) =>
      extractLedgerSettles(trace.frames, clientHeight).filter(
        (settle) => settle.cause === 'quiescence' && settle.extraGrowthPx > 200
      );

    const ipadCascade = cascade(ipadFill, 469);
    expect(ipadCascade.map((settle) => settle.frameIndex)).toEqual([698, 1713, 1989, 2469]);
    expect(Math.max(...ipadCascade.map((settle) => settle.extraGrowthPx))).toBe(1531);
    ipadCascade.forEach((settle) => {
      expect(settle.frameMs).toBeGreaterThan(100);
      expect(settle.anchorSlipPx).toBeUndefined();
    });

    const iphoneCascade = cascade(iphoneFixed, 465);
    expect(iphoneCascade.map((settle) => settle.frameIndex)).toEqual([641]);
    expect(iphoneCascade[0].extraGrowthPx).toBe(216);
  });

  it('holds the #124 build to atomic settles: large rest rebases track the anchor with zero slip', () => {
    // Post-fix ride of the SAME thread and device as ipadFill. Pre-fix,
    // every large rest settle was a blind remount burst; now the big
    // quiescence rebases keep the anchor mounted and land pixel-perfect.
    const settles = extractLedgerSettles(ipadCascadeFixed.frames, 469);
    const largeRest = settles.filter(
      (settle) => settle.cause === 'quiescence' && Math.abs(settle.scrollShiftPx) > 400
    );
    expect(largeRest.length).toBe(6);
    // Exactly ONE settle may be anchor-blind, and it is the documented
    // frame-409 fill coincidence (+3,444px growth below the fold, 36ms
    // frame, zero coverage gap — below-viewport window extension re-picks
    // the recorder anchor). Any other blind large rebase is a regression.
    const blind = largeRest.filter((settle) => settle.anchorSlipPx === undefined);
    expect(blind.map((settle) => settle.frameIndex)).toEqual([409]);
    const tracked = largeRest.filter((settle) => settle.anchorSlipPx !== undefined);
    expect(tracked.length).toBe(5);
    tracked.forEach((settle) => {
      expect(settle.anchorSlipPx).toBe(0);
      expect(settle.extraGrowthPx).toBe(0);
    });
    // The 100-240ms settle-cascade stalls are gone; the slowest settle
    // frame is the once-per-open initial fill.
    expect(Math.max(...settles.map((settle) => settle.frameMs))).toBeLessThanOrEqual(130);
  });

  it('detects the under-touch settles the #125 gate eliminates', () => {
    // This pre-#125 ride settled twice under a live finger — the 33k
    // open-fill rebase (frame 137, 98px slip) and a top-bounce boundary
    // settle (frame 1677, 31px slip). The touch gate defers both to the
    // at-rest quiescence settle; the next device trace must show zero
    // touch-frame settles.
    const settles = extractLedgerSettles(ipadCascadeFixed.frames, 469);
    // touchActive alone also catches a benign same-frame coincidence
    // (frame 1198: the touch began in the settle's own rAF sample, slip
    // 0); the harmful class is a settle that MOVED content under the
    // finger.
    const slippedUnderTouch = settles.filter(
      (settle) =>
        settle.touchActive && (settle.anchorSlipPx === undefined || settle.anchorSlipPx > 2)
    );
    expect(slippedUnderTouch.map((settle) => settle.frameIndex)).toEqual([137, 1677]);
  });

  it('holds the #125 build to the touch-gate golden: no settle moves content under a finger', () => {
    // Post-touch-gate ride of the same thread and iPad. The pre-#125
    // trace's two harmful under-touch settles are gone. This golden is
    // deliberately scoped to #125's touch gate; settle atomicity is tested
    // separately below using the committed ledger magnitude, not scrollTop
    // shift (which is the value that went wrong in these rides).
    const settles = extractLedgerSettles(ipadTouchGateFixed.frames, 469);
    const slippedUnderTouch = settles.filter(
      (settle) =>
        settle.touchActive && (settle.anchorSlipPx === undefined || settle.anchorSlipPx > 2)
    );
    expect(slippedUnderTouch).toEqual([]);
  });

  it('detects the committed/live split settles in both #125 validation rides', () => {
    const splitSettles = (trace: RideTrace, clientHeight: number) =>
      extractLedgerSettles(trace.frames, clientHeight).filter(
        (settle) =>
          settle.cause === 'quiescence' &&
          Math.abs(settle.ledgerShiftPx) > 200 &&
          Math.abs(settle.ledgerShiftPx - settle.scrollShiftPx) > 200
      );

    const ipad = splitSettles(ipadTouchGateFixed, 469);
    expect(ipad).toHaveLength(1);
    expect(ipad[0]).toMatchObject({
      frameIndex: 650,
      ledgerShiftPx: 512,
      scrollShiftPx: -5,
      extraGrowthPx: 517,
      anchorSlipPx: 507,
      touchActive: false,
    });

    const secondIpad = splitSettles(secondIpadTouchGateFixed, 495);
    expect(secondIpad).toHaveLength(1);
    expect(secondIpad[0]).toMatchObject({
      frameIndex: 1612,
      ledgerShiftPx: 216,
      scrollShiftPx: 1,
      extraGrowthPx: 215,
      anchorSlipPx: 215,
      touchActive: false,
    });
  });

  it('detects the discarded settle writes in the touchless scrub rides — and nowhere else', () => {
    // Second mechanism in the same two rides: both were touchless scroll
    // sessions (trace 1's failure window travels 20,736px through 9 full
    // stops and 8 re-accelerations with zero touch events — actively
    // driven non-touch input: scrubbing, trackpad, or similar; a fling
    // cannot restart after stopping), whose >150ms pauses
    // pass the idle window while the compositor still owns the position.
    // Settles 491, 617 and 1232 were SNAPSHOT-COHERENT and landed
    // atomically (ledgerShiftPx == scrollShiftPx, slip 0 — invisible to
    // the split metric above), yet the compositor reasserted the exact
    // pre-settle offset 90-588ms later, discarding folds of up to
    // +8,769px wholesale; the delay is the remaining scrub-pause length,
    // surfacing when the scrubber resumes. The split settles 650/1612
    // also register here because their assumed fold write never
    // materialized as one coherent offset. 1631 is the recorded (#125)
    // build's own recovery
    // settle, discarded again by the same still-live session.
    const ipadDiscards = extractDiscardedSettleWrites(ipadTouchGateFixed.frames);
    expect(
      ipadDiscards.map((discard) => [discard.settleFrameIndex, discard.discardFrameIndex])
    ).toEqual([
      [491, 506],
      [525, 535],
      [617, 619],
      [650, 650],
      [1232, 1262],
    ]);
    expect(ipadDiscards.map((discard) => discard.ledgerPx)).toEqual([8769, 292, 1217, 512, 1589]);

    const secondDiscards = extractDiscardedSettleWrites(secondIpadTouchGateFixed.frames);
    expect(
      secondDiscards.map((discard) => [discard.settleFrameIndex, discard.discardFrameIndex])
    ).toEqual([
      [1612, 1612],
      [1631, 1636],
    ]);

    // Detector specificity: all 42 other large settles across the corpus
    // held their write — including 17,864px folds — so a firing is a real
    // platform revert, not momentum noise.
    [ipadFill, iphoneFixed, iphoneOldA, iphoneOldB, ipadCascadeFixed].forEach((trace) => {
      expect(extractDiscardedSettleWrites(trace.frames)).toEqual([]);
    });
  });
});
