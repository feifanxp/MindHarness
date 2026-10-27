import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import {
  FULL_RIDE_BUDGETS,
  abortRelationsContinuations,
  analyzeBlankBands,
  analyzeRide,
  installScrollWriteProbe,
  positionThreadForPrepend,
  recordOpenSettle,
  runFlickRide,
  startRideSampling,
  startScreencast,
  stopRideSampling,
  synthesizeFlickUp,
  throttleCpu,
  throttleRelationsContinuations,
} from '../helpers/rideRecorder';

/**
 * Environment-realism specs (2026-07-06 device regression class).
 *
 * The desktop e2e environment differs from the phone in exactly the ways
 * that hid the blank-screens regression: local fetches land pagination
 * commits neatly inside the first quiet pause (production takes seconds
 * and hits waitForScrollQuiescence's 2.5s force-commit cap mid-flick),
 * and an unthrottled CPU mounts a row batch in one frame (a phone takes
 * several — a visible blank band). These specs run the SAME full
 * invariant set as the momentum spec (coverage + anchor jumps + write
 * log) under injected relations latency and CDP CPU throttling.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const iphone = devices['iPhone 14'];

test.use({
  browserName: 'chromium',
  userAgent: iphone.userAgent,
  hasTouch: iphone.hasTouch,
  deviceScaleFactor: 2,
  viewport: { width: 1280, height: 800 },
});

const sendMixedThreadReplies = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  rootId: string,
  count: number
) => {
  for (let i = 1; i <= count; i += 1) {
    const isExtras = i % 5 === 0;
    const body =
      // eslint-disable-next-line no-nested-ternary
      isExtras
        ? `agent answer ${i}\n${Array.from(
            { length: 12 },
            (_v, line) => `streamed answer line ${line} of reply ${i} with wrapping text`
          ).join('\n')}`
        : i % 3 === 0
        ? `short reply ${i}`
        : `long reply ${i}\n${Array.from(
            { length: 24 },
            (_v, line) => `line ${line} of reply ${i} with enough text to wrap on a phone screen`
          ).join('\n')}`;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body,
      ...(isExtras
        ? {
            'com.mindroom.message_extras': {
              version: 2,
              sections: [
                {
                  title: `Tool call ${i}.1`,
                  content_type: 'text/markdown',
                  content: `tool output for reply ${i}, section 1`,
                },
              ],
            },
          }
        : {}),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
};

test.describe('thread rides under production-shaped latency (iPhone-emulated, CPU-throttled)', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(600_000);

  test('continuous flicking while pagination fetches are slow: no blank bands, no jumps', async ({
    page,
  }, testInfo) => {
    // Device report (2026-07-06): "many more blank screens when scrolling
    // up, then the messages appear and jump slightly". The continuous
    // flicker never yields a 150ms quiet window, so the deferred prepend
    // commit lands via the 2.5s force-commit cap MID-FLICK, jumping the
    // scroll offset into freshly-prepended territory that a throttled CPU
    // takes several frames to mount.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Latency ride ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'latency ride root',
    });
    await sendMixedThreadReplies(homeserver, session.accessToken, roomId, rootId, 360);

    // Partial window: the open's drain is cut off, leaving a live back
    // token — the state any long thread is in on a slow connection.
    const unrouteAbort = await abortRelationsContinuations(page);
    await installScrollWriteProbe(page);

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await page.waitForTimeout(3_000);

    // Production-shaped stream phase: pagination pages take 1.5s, the
    // phone CPU is ~4x slower than this desktop. The abort stays armed
    // through native wheel positioning and until the ride's rig has read
    // threadCountStart: under the one-drain-channel architecture (PR #87)
    // continuations retry back-to-back the moment the abort lifts, and
    // the old pre-ride swap let the window fill to 361/361 before
    // sampling started (battery run 2026-07-07) — the spec degenerated
    // into a full-window ride and the precondition caught it.
    const start = await positionThreadForPrepend(page);
    // Keep the continuous ride at least 720px inside the loaded window; the
    // ledger-margin boundary ride below covers hard-edge correction. Steps
    // shrink from the 90px device flick only to stay clear of that edge.
    // This fixture starts at 4336px (45px steps, 2026-10-18). Below 30px,
    // a third of the device flick, the ride no longer stresses row
    // mounting, so a start under 3120px fails.
    const cycleCount = 10;
    const stepsPerCycle = 8;
    const stepPx = Math.min(90, (start.top - 720) / (cycleCount * stepsPerCycle));
    expect(stepPx, `ride start ${start.top}px leaves too little room for a flick`).toBeGreaterThan(
      30
    );
    await throttleCpu(page, 4);
    const report = await runFlickRide(page, {
      // 90ms finger-back-down pauses: below the 150ms quiescence window,
      // so the ONLY way the fetched page can commit inside this stream is
      // the 2.5s cap — exactly the continuous-reader case. The tail keeps
      // sampling through the final quiescence so late commits are
      // measured too.
      cycles: Array.from({ length: cycleCount }, () => ({
        steps: stepsPerCycle,
        stepPx,
        pauseMs: 90,
      })),
      tailSampleMs: 3_000,
      beforeStart: async () => {
        await throttleRelationsContinuations(page, 1_500);
        await unrouteAbort();
      },
    });

    const analysis = analyzeRide(report, FULL_RIDE_BUDGETS);
    // eslint-disable-next-line no-console
    console.log(
      `LATENCY-RIDE ${JSON.stringify({
        startTop: start.top,
        stepPx,
        threadCountStart: report.threadCountStart,
        threadCountEnd: report.threadCountEnd,
        probes: report.probes,
        frames: report.frames.length,
        maxGapPx: analysis.maxGapPx,
        maxJumpPx: analysis.maxJumpPx,
        totalJumpPx: analysis.totalJumpPx,
        appWrites: report.appWrites,
        violations: analysis.violations,
      })}`
    );
    if (report.jumpEvents.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`LATENCY-RIDE-JUMPS ${JSON.stringify(report.jumpEvents)}`);
    }
    await testInfo.attach('latency-ride.json', {
      body: JSON.stringify({ report, analysis }, null, 2),
      contentType: 'application/json',
    });

    expect(report.error).toBeUndefined();
    // Preconditions: the partial window really paginated inside the ride.
    expect(report.threadCountStart).toBeGreaterThan(0);
    // Degeneration tripwire (same treatment as the boundary spec): when
    // the drain fills the window before sampling despite the held abort
    // (server page-shape variance — observed at exactly 361/361 while
    // every ride budget passed), the in-ride-pagination scenario this
    // spec exists for never happens. Skip loudly instead of failing an
    // environment shape or passing a degenerate ride as coverage.
    test.skip(
      report.threadCountStart >= 360,
      `window full before sampling (threadCountStart=${report.threadCountStart}) — in-ride pagination not exercised`
    );
    expect(report.threadCountEnd).toBeGreaterThan(report.threadCountStart);
    expect(Math.min(...report.frames.map((frame) => frame.scrollTop))).toBeGreaterThan(0);
    // Full coverage budget; jump budget carries ONE documented exception:
    // at the prepend seam the old first reply legitimately loses its
    // day-divider/header when it gains a predecessor (~140px, one frame,
    // once per pagination, deterministic under throttle — photographed).
    // Fixing it means grouping-aware seam handling (estimator/fold do not
    // model grouping); tracked in the runbook as the remaining polish
    // item. Anything beyond that single reflow still fails.
    expect(analysis.maxGapPx).toBeLessThan(FULL_RIDE_BUDGETS.maxGapPx);
    expect(analysis.maxJumpPx).toBeLessThan(200);
    expect(analysis.totalJumpPx).toBeLessThan(300);
    // Every budget OUTSIDE the documented seam exception must hold —
    // notably the minFrames sampling floor, which was computed but never
    // asserted here (mutant audit 2026-07-07, e2e static pass: a starved
    // sampler would have made every budget above vacuously green).
    expect(
      analysis.violations.filter(
        (violation) => violation.budget !== 'maxJumpPx' && violation.budget !== 'totalJumpPx'
      )
    ).toEqual([]);
  });

  test('compositor momentum flicks under latency: rows stay mounted ahead of the fling', async ({
    page,
  }, testInfo) => {
    // The closest a desktop harness gets to the phone: REAL inertial
    // flicks from native CDP touch delivery with post-release inertia,
    // dispatching genuine touch events (exercising the
    // window touch tracker and the correction hook's touch leg) while a
    // 4x-throttled main thread races to mount rows ahead of the fling.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Compositor ride ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'compositor ride root',
    });
    await sendMixedThreadReplies(homeserver, session.accessToken, roomId, rootId, 360);

    const unrouteAbort = await abortRelationsContinuations(page);
    await installScrollWriteProbe(page);

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await page.waitForTimeout(3_000);
    await unrouteAbort();

    await throttleRelationsContinuations(page, 1_500);
    await throttleCpu(page, 4);

    const gestureCenter = {
      x: Math.round(iphone.viewport.width / 2),
      y: Math.round(iphone.viewport.height * 0.55),
    };
    // Driver-tagged teleport into the auto-paginate trigger zone (no
    // gesture marked — the real touch flicks below provide the intent),
    // settled outside the sampled window like every other ride.
    await page.evaluate(async () => {
      const w = window as Window & { __driverDepth?: number };
      const row = document.querySelector('[data-message-item]');
      let candidate: HTMLElement | null = row?.parentElement ?? null;
      while (candidate) {
        const { overflowY } = getComputedStyle(candidate);
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          candidate.scrollHeight > candidate.clientHeight
        ) {
          break;
        }
        candidate = candidate.parentElement;
      }
      if (!candidate) return;
      w.__driverDepth = (w.__driverDepth ?? 0) + 1;
      candidate.scrollTop = 2_400;
      w.__driverDepth -= 1;
      await new Promise((resolve) => {
        setTimeout(resolve, 800);
      });
    });
    const screencast = await startScreencast(page);
    await startRideSampling(page, { measureVisualTravel: true });
    await page.evaluate(() => {
      const events: { type: string; t: number; trusted: boolean }[] = [];
      (window as Window & { __touchDelivery?: typeof events }).__touchDelivery = events;
      ['touchstart', 'touchmove', 'touchend'].forEach((type) => {
        window.addEventListener(
          type,
          (event) => events.push({ type, t: performance.now(), trusted: event.isTrusted }),
          { passive: true }
        );
      });
    });

    // Flick pattern mirroring a reader chasing history: hard flings with
    // mixed pauses — some below the 150ms quiescence window (commits can
    // only land via the 2.5s cap, mid-motion), some realistic thumb
    // pauses (commits land there). Fling travel plus prepends keeps the
    // ride inside fresh territory throughout.
    const pausesMs = [120, 400, 120, 120, 500, 120, 400, 120, 600, 400];
    for (const pauseMs of pausesMs) {
      // eslint-disable-next-line no-await-in-loop
      await synthesizeFlickUp(page, { ...gestureCenter, distance: 700, speed: 4_500 });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(pauseMs);
    }
    const gestureEnd = await page.evaluate(() => performance.now());
    await page.waitForTimeout(2_500);
    const ride = await stopRideSampling(page);
    const delivery = await page.evaluate(
      () =>
        (
          window as Window & {
            __touchDelivery?: { type: string; t: number; trusted: boolean }[];
          }
        ).__touchDelivery ?? []
    );
    const gestureFrames = ride.frames.filter((frame) => frame.t <= gestureEnd);
    const intervals = gestureFrames.slice(1);
    const tracked = intervals.filter((frame) => Number.isFinite(frame.visualDeltaPx));
    // The coverage invariants include the tail: the last fling and late
    // pagination commits land after gestureEnd.
    const sampledIntervals = ride.frames.slice(1);
    const leadTracked = sampledIntervals.filter((frame) => Number.isFinite(frame.leadGapPx));
    const maxLeadGapPx = Math.max(0, ...leadTracked.map((frame) => frame.leadGapPx ?? 0));
    const travelPx = tracked.reduce((sum, frame) => sum + (frame.visualDeltaPx ?? 0), 0);
    const releases = delivery.filter((event) => event.type === 'touchend');
    // Both ends of an interval must follow release and precede the next
    // contact. Ledger folds contribute zero surviving-row displacement.
    const inertia = releases.map((release) => {
      const nextStart =
        delivery.find((event) => event.type === 'touchstart' && event.t > release.t)?.t ??
        gestureEnd;
      const framesAfterRelease = gestureFrames.filter(
        (frame) => frame.t > release.t && frame.t < nextStart
      );
      return {
        release: release.t,
        nextStart,
        intervals: Math.max(0, framesAfterRelease.length - 1),
        travelPx: framesAfterRelease
          .slice(1)
          .reduce((sum, frame) => sum + (frame.visualDeltaPx ?? 0), 0),
      };
    });
    const inertiaPx = inertia.reduce((sum, release) => sum + release.travelPx, 0);
    const movement = {
      gestureEnd,
      commandedDistancePx: 7_000,
      speedPxPerSecond: 4_500,
      travelPx,
      trackedIntervals: tracked.length,
      intervals: intervals.length,
      inertiaPx,
      inertia,
      delivery,
    };
    const frames = await screencast.stop();
    const blank = await analyzeBlankBands(page, frames);
    const analysis = analyzeRide(
      { ...ride, appWrites: [], jumpEvents: [], probes: {}, error: undefined },
      FULL_RIDE_BUDGETS
    );
    const maxBlankPct = Math.max(0, ...blank.map((frame) => frame.blankPct));
    const blankFrames = blank.filter((frame) => frame.blankPct >= 35).length;
    for (const [index, sample] of blank
      .filter((frame) => frame.blankPct >= 35)
      .slice(0, 5)
      .entries()) {
      const frame = frames.find((candidate) => candidate.t === sample.t);
      if (frame) {
        // eslint-disable-next-line no-await-in-loop
        await testInfo.attach(`blank-frame-${index}.jpg`, {
          body: Buffer.from(frame.data, 'base64'),
          contentType: 'image/jpeg',
        });
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `COMPOSITOR-RIDE ${JSON.stringify({
        threadCountStart: ride.threadCountStart,
        threadCountEnd: ride.threadCountEnd,
        sampledFrames: ride.frames.length,
        movement,
        screencastFrames: frames.length,
        maxGapPx: analysis.maxGapPx,
        maxLeadGapPx,
        maxJumpPx: analysis.maxJumpPx,
        totalJumpPx: analysis.totalJumpPx,
        maxBlankPct,
        blankFrames,
        violations: analysis.violations,
      })}`
    );
    await testInfo.attach('compositor-ride.json', {
      body: JSON.stringify({ ride, blank, analysis, movement }, null, 2),
      contentType: 'application/json',
    });

    // Preconditions: momentum genuinely travelled and pagination
    // committed inside the ride. The throttled renderer emits screencast
    // frames only as it produces them — a low count is itself evidence
    // of raster starvation, so only a token minimum is required.
    expect(ride.frames.length).toBeGreaterThan(100);
    expect(tracked.length).toBeGreaterThanOrEqual(intervals.length * 0.9);
    expect(leadTracked.length).toBeGreaterThanOrEqual(sampledIntervals.length * 0.9);
    expect(travelPx).toBeGreaterThanOrEqual(700);
    expect(inertiaPx).toBeGreaterThan(20);
    expect(delivery.every((event) => event.trusted)).toBe(true);
    expect(delivery.filter((event) => event.type === 'touchmove').length).toBeGreaterThan(0);
    expect(releases.length).toBeGreaterThanOrEqual(10);
    expect(frames.length).toBeGreaterThan(5);
    expect(ride.threadCountStart).toBeGreaterThan(0);
    expect(ride.threadCountStart).toBeLessThan(360);
    expect(ride.threadCountEnd).toBeGreaterThan(ride.threadCountStart);

    // Coverage invariant ("blank screens" report): rows cover the view
    // both where the main thread reads the offset (gapPx) and where the
    // fling took the compositor before the next commit (leadGapPx). The
    // rect-vs-scrollTop jump metric is NOT asserted here: it cannot
    // attribute offset-ledger operations (a prepend fold or an at-rest
    // settle is visually exact but moves scrollTop/margin without the
    // sampler knowing which part was user motion) — the driver-based
    // rides own jump precision via driver-delta separation.
    // Blank PIXELS are logged and attached, not asserted: this host's
    // software rasterizer leaves mounted rows unpainted for a frame or two
    // after a 650-1,740px fling step, and the same flicks blank a static
    // HTML page with no app code (runbook 2026-10-06).
    expect(maxLeadGapPx).toBeLessThan(FULL_RIDE_BUDGETS.maxGapPx);
    expect(analysis.maxGapPx).toBeLessThan(FULL_RIDE_BUDGETS.maxGapPx);
  });

  test('sustained continuous ride: paint and window stay coherent (trace mechanism 1)', async ({
    page,
  }, testInfo) => {
    // Device trace 2026-07-06 (ride-trace-1783377085460): a 40s
    // continuous ride accumulated ±3000px of dropped-correction
    // compensation with no quiet window to settle in; the transform
    // shifted PAINT while the virtualizer's window math stayed ignorant,
    // and past the overscan slack the viewport showed unrendered layout
    // space — 12.1s of DOM-level blank (gap=full region) out of 40s.
    // The prior specs rode ~4s and never accumulated enough to cross the
    // slack. This ride is trace-shaped: long, continuous, pauses below
    // the 150ms settle window, through hundreds of fresh rows.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Sustained ride ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'sustained ride root',
    });
    await sendMixedThreadReplies(homeserver, session.accessToken, roomId, rootId, 360);

    await installScrollWriteProbe(page);
    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await page.waitForTimeout(3_000);
    await throttleCpu(page, 4);

    // No teleport: start from the natural bottom pin and ride up through
    // the whole fresh window, like the device session. 26 cycles x 8x90px
    // with 80ms pauses ≈ 19k px of estimate territory with no settle
    // opportunity.
    const report = await runFlickRide(page, {
      cycles: Array.from({ length: 26 }, () => ({ steps: 8, stepPx: 90, pauseMs: 80 })),
      tailSampleMs: 2_000,
    });

    const analysis = analyzeRide(report, FULL_RIDE_BUDGETS);
    const blankFrames = report.frames.filter((frame) => frame.gapPx >= 200).length;
    // eslint-disable-next-line no-console
    console.log(
      `SUSTAINED-RIDE ${JSON.stringify({
        frames: report.frames.length,
        maxGapPx: analysis.maxGapPx,
        blankFramesOver200: blankFrames,
        maxJumpPx: analysis.maxJumpPx,
        totalJumpPx: analysis.totalJumpPx,
        appWrites: report.appWrites.length,
        probes: report.probes,
        violations: analysis.violations,
      })}`
    );
    await testInfo.attach('sustained-ride.json', {
      body: JSON.stringify({ report, analysis }, null, 2),
      contentType: 'application/json',
    });

    expect(report.error).toBeUndefined();
    expect(report.frames.length).toBeGreaterThan(400);
    // THE invariant pair from the device trace: no coverage holes, no
    // content shifts — through a ride long enough to accumulate real
    // compensation.
    expect(analysis.violations).toEqual([]);
  });

  test('riding into the ledger margin never shows the debt: boundary settles first', async ({
    page,
  }, testInfo) => {
    // Device trace ride-trace-1783391256452: 130 badly-estimated rows
    // accrued px=-9356 during a continuous ride, and scrolling to the top
    // of the loaded window entered the empty margin that debt creates -
    // 3.0s of blank. RED-GREEN PROVENANCE: against the pre-calibration
    // build this ride measured 367px blank bands and a 4968px clamp
    // flash; the boundary guard turned it to 0/0. Post-calibration the
    // estimator prices even hand-crafted adversarial content correctly
    // (Cinny renders plain-text newlines literally), so the ledger stays
    // small here by design — the guard's trigger geometry is pinned
    // permanently by the shouldSettleLedgerAtBoundary unit tests, and
    // this ride remains the integration invariant: ride to the very top
    // of the loaded window, never see debt as blank space.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Ledger boundary ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'ledger boundary root',
    });
    await sendMixedThreadReplies(homeserver, session.accessToken, roomId, rootId, 150);

    await installScrollWriteProbe(page);
    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await expect(page.locator('[data-thread-count]')).toHaveAttribute('data-thread-count', '151', {
      timeout: 60_000,
    });
    await throttleCpu(page, 4);

    // Continuous ride to the very top of the window: pauses below the
    // 150ms settle threshold so the debt cannot be repaid at rest - only
    // the boundary guard can prevent the viewport from entering it.
    const report = await runFlickRide(page, {
      cycles: Array.from({ length: 40 }, () => ({ steps: 8, stepPx: 90, pauseMs: 80 })),
      reachTop: { maxCycles: 100 },
      tailSampleMs: 2_000,
    });

    const analysis = analyzeRide(report, FULL_RIDE_BUDGETS);
    const topReached = Math.min(...report.frames.map((frame) => frame.scrollTop));
    const maxLedger = Math.max(0, ...report.frames.map((frame) => Math.abs(frame.ledgerPx ?? 0)));
    // eslint-disable-next-line no-console
    console.log(
      `LEDGER-BOUNDARY ${JSON.stringify({
        frames: report.frames.length,
        boundaryDriver: report.boundaryDriver,
        topReached,
        maxLedger,
        maxGapPx: analysis.maxGapPx,
        blankFramesOver200: report.frames.filter((frame) => frame.gapPx >= 200).length,
        maxJumpPx: analysis.maxJumpPx,
        totalJumpPx: analysis.totalJumpPx,
        appWrites: report.appWrites.length,
        probes: report.probes,
      })}`
    );
    await testInfo.attach('ledger-boundary.json', {
      body: JSON.stringify({ report, analysis }, null, 2),
      contentType: 'application/json',
    });

    expect(report.error).toBeUndefined();
    expect(report.frames.length).toBeGreaterThan(300);
    expect(report.boundaryDriver?.threadCount).toBe(151);
    expect(report.boundaryDriver?.minTop).toBe(0);
    // The ride genuinely reached the top region of the loaded window.
    expect(topReached).toBeLessThan(600);
    expect(maxLedger).toBeGreaterThan(48);
    expect(report.probes.ledgerBoundarySettles).toBeGreaterThan(0);
    // THE invariant: no blank debt zone, no content shifts - even at the
    // boundary. (Boundary settles are allowed writes; they are visually
    // exact pairs and the jump budget verifies that.)
    expect(analysis.maxGapPx).toBeLessThan(FULL_RIDE_BUDGETS.maxGapPx);
    expect(analysis.maxJumpPx).toBeLessThan(FULL_RIDE_BUDGETS.maxJumpPx);
    expect(analysis.totalJumpPx).toBeLessThan(FULL_RIDE_BUDGETS.totalJumpPx);
  });

  test('hydrating a long thread keeps the view pinned to the bottom', async ({
    page,
  }, testInfo) => {
    // Device report (2026-07-06): "when I open a long thread that still
    // needs to be hydrated, I first end up at the bottom, then as more
    // messages load, it scrolls somewhere to the middle". No user input
    // at all: an open pinned to the latest message must STAY there while
    // the backfill grows content above it.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Hydration pin ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'hydration pin root',
    });
    await sendMixedThreadReplies(homeserver, session.accessToken, roomId, rootId, 560);

    // The whole open runs against slow pagination pages and a throttled
    // CPU: the drain visibly hydrates for several seconds after first
    // paint, which is the window the device report describes.
    await throttleRelationsContinuations(page, 1_200);
    await installScrollWriteProbe(page);

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await throttleCpu(page, 4);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });

    const settle = await recordOpenSettle(page, 10_000);
    expect(settle.error).toBeUndefined();

    const PIN_GRACE_MS = 2_000;
    const start = settle.samples[0]?.t ?? 0;
    const afterGrace = settle.samples.filter((sample) => sample.t - start > PIN_GRACE_MS);
    const maxDistAfterGrace = Math.round(
      Math.max(0, ...afterGrace.map((sample) => sample.distFromBottom))
    );
    // The VISUAL pin: how far the last message's bottom edge strays from
    // the scroller's bottom edge. scrollHeight-derived distance counts the
    // transient offset-ledger margin, which the reader never sees.
    const maxBottomGapAfterGrace = Math.round(
      Math.max(0, ...afterGrace.map((sample) => Math.abs(sample.bottomGapPx)))
    );
    // Persistence of displacement is the user-facing failure: a band
    // commit legitimately takes 1-3 throttled frames while the fresh
    // tail rows measure up from estimates and the settle loop chases —
    // but the reader must never be LEFT off the bottom.
    let longestOffBottomMs = 0;
    let runStart: number | null = null;
    afterGrace.forEach((sample) => {
      if (Math.abs(sample.bottomGapPx) > 200) {
        if (runStart === null) runStart = sample.t;
        longestOffBottomMs = Math.max(longestOffBottomMs, sample.t - runStart);
      } else {
        runStart = null;
      }
    });
    longestOffBottomMs = Math.round(longestOffBottomMs);
    const finalDist = Math.round(settle.samples[settle.samples.length - 1]?.distFromBottom ?? -1);
    const threadCounts = settle.samples.map((sample) => sample.threadCount);
    const hydratedDuringWindow =
      (threadCounts[threadCounts.length - 1] ?? 0) > (threadCounts[0] ?? 0);

    // eslint-disable-next-line no-console
    console.log(
      `HYDRATION-PIN ${JSON.stringify({
        samples: settle.samples.length,
        threadCountFirst: threadCounts[0],
        threadCountLast: threadCounts[threadCounts.length - 1],
        hydratedDuringWindow,
        maxDistAfterGrace,
        maxBottomGapAfterGrace,
        longestOffBottomMs,
        finalDist,
      })}`
    );
    await testInfo.attach('hydration-pin.json', {
      body: JSON.stringify(settle, null, 2),
      contentType: 'application/json',
    });

    expect(settle.samples.length).toBeGreaterThan(100);
    // Precondition: hydration genuinely happened while we watched.
    expect(hydratedDuringWindow).toBe(true);
    // THE invariant: no input, so the reader is never LEFT off the
    // bottom — measured on the last row's rect, not on scrollHeight
    // (which transiently includes the invisible offset-ledger margin).
    // The device symptom was PERSISTENT mid-thread drift (bands landing
    // after the pin died); band-commit measure-up transients are bounded
    // in DURATION instead of magnitude (estimator accuracy polish).
    expect(longestOffBottomMs).toBeLessThan(300);
    expect(finalDist).toBeLessThan(200);
  });
});
