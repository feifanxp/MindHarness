import type { Page } from '@playwright/test';
import { THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS } from '../../src/app/mindroom/threads/preloadSettings';

/**
 * Shared scroll-ride harness for the virtualized thread timeline.
 *
 * Every device-report class so far (momentum kill, white gaps, snap-back,
 * reverse-flash, blank-screens-under-latency) is visible in ONE per-frame
 * trace: scrollTop, coverage gap, anchor displacement, app writes, thread
 * count. Individual specs kept re-implementing subsets of that sampler and
 * asserting subsets of the budgets — the 2026-07-06 blank-screens
 * regression shipped through a spec that asserted anchor jumps but not
 * coverage. This module is the single driver + analyzer so every ride
 * measures the full invariant set, under realistic environment knobs
 * (relations latency, CPU throttle).
 */

export type RideFrame = {
  t: number;
  scrollTop: number;
  scrollHeight: number;
  // Max uncovered vertical span in the viewport core (10%..90%).
  gapPx: number;
  // Absolute anchor displacement beyond the driven delta for this frame
  // (0 when the anchor was re-picked this frame).
  jumpPx: number;
  // Opt-in signed movement of a surviving visible anchor; positive means upward travel.
  visualDeltaPx?: number;
  // Compositor rides: gapPx at this frame's offset over the PREVIOUS frame's
  // rows, a lower bound of what the compositor shows before the main thread
  // mounts more (undefined when the app wrote the scroll offset in between,
  // which only installScrollWriteProbe records).
  leadGapPx?: number;
  driven: number;
  threadCount: number;
  distFromBottom: number;
  // Live offset-ledger margin on the inner virtual container (0 when a
  // sampler has no ledger context, e.g. gesture rides).
  ledgerPx?: number;
};

export type TileSnap = { i: string | null; id: string | null; top: number; h: number };

export type RideReport = {
  error?: string;
  frames: RideFrame[];
  appWrites: { kind: string; value: number; t: number }[];
  // Tile photographs around frames whose jump exceeded the capture
  // threshold (30px), capped.
  jumpEvents: { t: number; jump: number; before: TileSnap[]; after: TileSnap[] }[];
  threadCountStart: number;
  threadCountEnd: number;
  probes: Record<string, number>;
  boundaryDriver?: {
    startTop: number;
    threadCount: number;
    cycles: number;
    distance: number;
    minTop: number;
  };
};

export type RideBudgets = {
  maxGapPx: number;
  maxJumpPx: number;
  totalJumpPx: number;
  minFrames: number;
};

export const FULL_RIDE_BUDGETS: RideBudgets = {
  // Same numbers as the momentum spec's historical budgets: a gap is a
  // blank band the reader sees; a jump is content shifting under the
  // reader.
  maxGapPx: 120,
  maxJumpPx: 40,
  totalJumpPx: 120,
  minFrames: 60,
};

export type RideViolation = { budget: keyof RideBudgets; actual: number; allowed: number };

export const analyzeRide = (
  report: RideReport,
  budgets: RideBudgets = FULL_RIDE_BUDGETS
): { violations: RideViolation[]; maxGapPx: number; maxJumpPx: number; totalJumpPx: number } => {
  const maxGapPx = Math.round(Math.max(0, ...report.frames.map((f) => f.gapPx)));
  const maxJumpPx = Math.round(Math.max(0, ...report.frames.map((f) => f.jumpPx)));
  const totalJumpPx = Math.round(report.frames.reduce((sum, f) => sum + f.jumpPx, 0));
  const violations: RideViolation[] = [];
  if (report.frames.length < budgets.minFrames) {
    violations.push({
      budget: 'minFrames',
      actual: report.frames.length,
      allowed: budgets.minFrames,
    });
  }
  if (maxGapPx >= budgets.maxGapPx) {
    violations.push({ budget: 'maxGapPx', actual: maxGapPx, allowed: budgets.maxGapPx });
  }
  if (maxJumpPx >= budgets.maxJumpPx) {
    violations.push({ budget: 'maxJumpPx', actual: maxJumpPx, allowed: budgets.maxJumpPx });
  }
  if (totalJumpPx >= budgets.totalJumpPx) {
    violations.push({ budget: 'totalJumpPx', actual: totalJumpPx, allowed: budgets.totalJumpPx });
  }
  return { violations, maxGapPx, maxJumpPx, totalJumpPx };
};

/**
 * Wraps the scroll write surfaces before any app code runs; writes made
 * while `window.__driverDepth > 0` are the test's own and are not
 * recorded. Must be called before page.goto.
 */
export const installScrollWriteProbe = (page: Page): Promise<void> =>
  page.addInitScript(() => {
    const w = window as Window & {
      __appScrollWrites?: { kind: string; value: number; t: number }[];
      __driverDepth?: number;
    };
    w.__appScrollWrites = [];
    w.__driverDepth = 0;
    const record = (kind: string, el: unknown, value: number) => {
      if ((w.__driverDepth ?? 0) > 0) return;
      if (!(el instanceof HTMLElement) || el.dataset.e2eScroller !== '1') return;
      w.__appScrollWrites!.push({ kind, value, t: performance.now() });
    };
    const scrollTopDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    if (scrollTopDesc?.set && scrollTopDesc.get) {
      Object.defineProperty(Element.prototype, 'scrollTop', {
        configurable: true,
        get() {
          return scrollTopDesc.get!.call(this);
        },
        set(value: number) {
          record('scrollTop', this, value);
          scrollTopDesc.set!.call(this, value);
        },
      });
    }
    (['scrollTo', 'scrollBy'] as const).forEach((name) => {
      const original = Element.prototype[name];
      Element.prototype[name] = function wrapped(this: Element, ...args: unknown[]) {
        const first = args[0];
        const top =
          typeof first === 'object' && first !== null
            ? (first as { top?: number }).top
            : (args[1] as number | undefined);
        if (typeof top === 'number') record(name, this, top);
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      } as typeof Element.prototype[typeof name];
    });
  });

/**
 * Injects realistic latency into /relations continuation pages (the
 * pagination fetches). Local fetches complete in ~30ms, so quiescence-
 * deferred commits always land neatly inside the first pause — on real
 * networks they take seconds and land mid-ride (including through the
 * waitForScrollQuiescence 2.5s force-commit cap). Returns an unroute
 * function.
 */
export const throttleRelationsContinuations = async (
  page: Page,
  delayMs: number
): Promise<() => Promise<void>> => {
  const matcher = (url: URL) =>
    url.pathname.includes('/relations/') && url.searchParams.has('from');
  await page.route(matcher, async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
    await route.continue();
  });
  return () => page.unroute(matcher);
};

/** Aborts /relations continuations — leaves an open with a partial window. */
export const abortRelationsContinuations = async (page: Page): Promise<() => Promise<void>> => {
  const matcher = (url: URL) =>
    url.pathname.includes('/relations/') && url.searchParams.has('from');
  await page.route(matcher, (route) => route.abort());
  return () => page.unroute(matcher);
};

/**
 * Wheel up into the loaded edge's auto-paginate trigger zone before a prepend
 * ride, and return the scroll position once the timeline stops moving.
 */
export const positionThreadForPrepend = async (page: Page) => {
  const bounds = await page
    .locator('[data-message-item]')
    .first()
    .evaluate((row) => {
      let scroller = row.parentElement;
      while (scroller) {
        const { overflowY } = getComputedStyle(scroller);
        if (
          ['auto', 'scroll'].includes(overflowY) &&
          scroller.scrollHeight > scroller.clientHeight
        ) {
          scroller.dataset.e2eScroller = '1';
          const rect = scroller.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
        scroller = scroller.parentElement;
      }
      throw new Error('No thread scroller found');
    });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const readPosition = () =>
    page.locator('[data-e2e-scroller="1"]').evaluate((scroller) => {
      const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-index]'));
      return {
        top: scroller.scrollTop,
        height: scroller.clientHeight,
        firstIndex: Math.min(...rows.map((row) => Number(row.dataset.index))),
        // A nonzero offset-ledger margin means dropped size corrections have not settled yet.
        fold: Number.parseFloat(rows[0]?.parentElement?.style.marginTop ?? '') || 0,
      };
    });
  let position = await readPosition();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (
      position.firstIndex <= THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS &&
      position.top > position.height &&
      position.fold === 0
    ) {
      await page.waitForTimeout(200);
      const settled = await readPosition();
      if (JSON.stringify(settled) === JSON.stringify(position)) return settled;
      // Still settling inside the zone: check again before wheeling further.
      position = settled;
      continue;
    }
    await page.mouse.wheel(0, -720);
    await page.waitForTimeout(300);
    position = await readPosition();
  }
  throw new Error(`Could not establish a settled prepend start: ${JSON.stringify(position)}`);
};

/**
 * CDP CPU throttle: desktop chromium mounts a row batch in one frame
 * where a phone takes several — the difference between "no gap" and a
 * visible blank band.
 */
export const throttleCpu = async (page: Page, rate: number): Promise<void> => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
};

export type FlickCycle = {
  steps: number;
  stepPx: number;
  pauseMs: number;
};

type FlickRideOptions = {
  teleportTo?: number;
  teleportSettleMs?: number;
  cycles: FlickCycle[];
  reachTop?: { maxCycles: number };
  tailSampleMs?: number;
};

type FlickRideHandshake = {
  __flickRideReady?: boolean;
  __flickRideStart?: boolean;
};

const recordFlickRide = (
  page: Page,
  opts: FlickRideOptions & { waitForStart: boolean }
): Promise<RideReport> =>
  page.evaluate(async (rideOpts) => {
    const w = window as Window &
      FlickRideHandshake & {
        __appScrollWrites?: { kind: string; value: number; t: number }[];
        __driverDepth?: number;
        __MINDROOM_CACHE_PROBE__?: { snapshot: () => Record<string, number | undefined> };
      };
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
    const scroller = candidate;
    if (!scroller) {
      return {
        error: 'no scroller found',
        frames: [],
        appWrites: [],
        jumpEvents: [],
        threadCountStart: -1,
        threadCountEnd: -1,
        probes: {},
      };
    }
    scroller.dataset.e2eScroller = '1';

    const raf = () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    const readThreadCount = () =>
      Number(
        (scroller.querySelector('[data-thread-count]') as HTMLElement | null)?.dataset
          .threadCount ?? -1
      );
    const readProbes = (): Record<string, number> => {
      const snapshot = w.__MINDROOM_CACHE_PROBE__?.snapshot() ?? {};
      return Object.fromEntries(
        Object.entries(snapshot).filter(
          ([key, value]) =>
            typeof value === 'number' &&
            (key.startsWith('threadPaginateBack') ||
              key === 'threadAutoPaginateBackFired' ||
              key === 'ledgerQuiescenceSettles' ||
              key === 'ledgerBoundarySettles')
        )
      ) as Record<string, number>;
    };
    type TileSnap = { i: string | null; id: string | null; top: number; h: number };
    const readTileSnaps = (): TileSnap[] =>
      Array.from(scroller.querySelectorAll('[data-index]')).map((tile) => ({
        i: tile.getAttribute('data-index'),
        id:
          tile.querySelector('[data-message-id]')?.getAttribute('data-message-id')?.slice(0, 12) ??
          null,
        top: Math.round((tile as HTMLElement).offsetTop),
        h: Math.round(tile.getBoundingClientRect().height),
      }));
    const readGap = (): number => {
      const rect = scroller.getBoundingClientRect();
      const top = rect.top + rect.height * 0.1;
      const bottom = rect.bottom - rect.height * 0.1;
      const covering = Array.from(scroller.querySelectorAll('[data-index]')).map((tile) =>
        tile.getBoundingClientRect()
      );
      // Content laid out above the virtual list (at the top of a thread: its
      // banner and the "Loading..." divider) is not a blank band. Only content
      // that ends above the list's own box counts, so a missing row or a ledger
      // margin before the list still does.
      const list = scroller.querySelector('[data-thread-count]');
      if (list?.parentElement) {
        const listTop = list.getBoundingClientRect().top;
        Array.from(list.parentElement.children).forEach((child) => {
          const r = child.getBoundingClientRect();
          if (child !== list && r.bottom <= listTop + 0.5) covering.push(r);
        });
      }
      const tiles = covering
        .filter((r) => r.bottom > top && r.top < bottom)
        .sort((a, b) => a.top - b.top);
      let cursor = top;
      let maxGap = 0;
      tiles.forEach((r) => {
        if (r.top > cursor) maxGap = Math.max(maxGap, r.top - cursor);
        cursor = Math.max(cursor, r.bottom);
      });
      if (cursor < bottom) maxGap = Math.max(maxGap, bottom - cursor);
      return maxGap;
    };
    const pickAnchor = (): Element | null => {
      const rows = Array.from(document.querySelectorAll('[data-message-item]'));
      const mid = window.innerHeight / 2;
      let best: Element | null = null;
      let bestDistance = Infinity;
      rows.forEach((r) => {
        const rect = r.getBoundingClientRect();
        const distance = Math.abs((rect.top + rect.bottom) / 2 - mid);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = r;
        }
      });
      return best;
    };

    const frames: {
      t: number;
      scrollTop: number;
      scrollHeight: number;
      gapPx: number;
      jumpPx: number;
      driven: number;
      threadCount: number;
      distFromBottom: number;
    }[] = [];
    const jumpEvents: { t: number; jump: number; before: TileSnap[]; after: TileSnap[] }[] = [];
    let jumpAnchor: Element | null = null;
    let jumpAnchorTop = 0;
    let lastTileSnaps: TileSnap[] = [];
    const sample = (driven: number) => {
      const t = performance.now();
      let jumpPx = 0;
      if (jumpAnchor && jumpAnchor.isConnected) {
        const rect = jumpAnchor.getBoundingClientRect();
        if (rect.bottom > -800 && rect.top < window.innerHeight + 800) {
          jumpPx = Math.abs(rect.top - jumpAnchorTop - driven);
          jumpAnchorTop = rect.top;
          const tiles = readTileSnaps();
          if (jumpPx > 30 && jumpEvents.length < 6) {
            jumpEvents.push({ t, jump: Math.round(jumpPx), before: lastTileSnaps, after: tiles });
          }
          lastTileSnaps = tiles;
        } else {
          jumpAnchor = pickAnchor();
          jumpAnchorTop = jumpAnchor?.getBoundingClientRect().top ?? 0;
          lastTileSnaps = readTileSnaps();
        }
      } else {
        jumpAnchor = pickAnchor();
        jumpAnchorTop = jumpAnchor?.getBoundingClientRect().top ?? 0;
        lastTileSnaps = readTileSnaps();
      }
      const inner = scroller.querySelector('[data-index]')?.parentElement as HTMLElement | null;
      frames.push({
        t,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        gapPx: Math.round(readGap()),
        jumpPx,
        driven,
        threadCount: readThreadCount(),
        distFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        ledgerPx: inner ? Math.round(Number.parseFloat(inner.style.marginTop) || 0) : 0,
      });
    };

    const writes = w.__appScrollWrites ?? [];
    const writesBefore = writes.length;
    const threadCountStart = readThreadCount();
    const probesStart = readProbes();

    if (typeof rideOpts.teleportTo === 'number') {
      w.__driverDepth! += 1;
      scroller.scrollTop = rideOpts.teleportTo;
      w.__driverDepth! -= 1;
      const settleUntil = performance.now() + (rideOpts.teleportSettleMs ?? 600);
      while (performance.now() < settleUntil) {
        // eslint-disable-next-line no-await-in-loop
        await raf();
      }
    }
    const startTop = scroller.scrollTop;
    let cycles = rideOpts.cycles;
    if (rideOpts.reachTop) {
      const cycle = cycles[0];
      const count = Math.max(cycles.length, Math.ceil(startTop / (cycle.steps * cycle.stepPx)) + 1);
      if (count > rideOpts.reachTop.maxCycles)
        throw new Error(`Boundary ride requires ${count} cycles`);
      cycles = Array.from({ length: count }, () => cycle);
    }
    const boundaryDriver = {
      startTop,
      threadCount: readThreadCount(),
      cycles: cycles.length,
      distance: cycles.reduce((sum, cycle) => sum + cycle.steps * cycle.stepPx, 0),
      minTop: startTop,
    };
    sample(0);
    if (rideOpts.waitForStart) {
      w.__flickRideStart = false;
      w.__flickRideReady = true;
      while (!w.__flickRideStart) {
        // eslint-disable-next-line no-await-in-loop
        await raf();
      }
      delete w.__flickRideReady;
      delete w.__flickRideStart;
    }

    for (const cycle of cycles) {
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
      for (let step = 0; step < cycle.steps; step += 1) {
        const prevTop = scroller.scrollTop;
        w.__driverDepth! += 1;
        scroller.scrollTop -= cycle.stepPx;
        w.__driverDepth! -= 1;
        // DRIVER-caused delta only, read before the rAF await: an app
        // write landing inside the frame that is visually
        // self-cancelling by design (a ledger settle pairs a scrollTop
        // shift with the margin removal it cancels) must not inflate the
        // expected anchor movement — the anchor tracks USER intent. The
        // immediate read still accounts for clamping at the window edge.
        const driverDelta = prevTop - scroller.scrollTop;
        boundaryDriver.minTop = Math.min(boundaryDriver.minTop, scroller.scrollTop);
        // eslint-disable-next-line no-await-in-loop
        await raf();
        sample(driverDelta);
      }
      const pauseUntil = performance.now() + cycle.pauseMs;
      while (performance.now() < pauseUntil) {
        // eslint-disable-next-line no-await-in-loop
        await raf();
        sample(0);
      }
    }
    const tailUntil = performance.now() + (rideOpts.tailSampleMs ?? 0);
    while (performance.now() < tailUntil) {
      // eslint-disable-next-line no-await-in-loop
      await raf();
      sample(0);
    }

    const probesEnd = readProbes();
    const probes = Object.fromEntries(
      Object.entries(probesEnd).map(([key, value]) => [key, value - (probesStart[key] ?? 0)])
    );

    return {
      frames,
      ...(rideOpts.reachTop ? { boundaryDriver } : {}),
      appWrites: writes.slice(writesBefore),
      jumpEvents,
      threadCountStart,
      threadCountEnd: readThreadCount(),
      probes,
    };
  }, opts);

/**
 * Drives flick/pause cycles on the thread scroller and records the full
 * per-frame trace, INCLUDING through the pauses. `teleportTo` positions
 * the ride start (driver-tagged, settled outside the sampled window).
 * `beforeStart` runs after the first frame is sampled and before the first
 * flick, so network gates change at a known point in the trace.
 * A wheel gesture is dispatched at each cycle start (user intent for the
 * auto-paginate trigger and the settle-cancel paths).
 */
export const runFlickRide = async (
  page: Page,
  { beforeStart, ...opts }: FlickRideOptions & { beforeStart?: () => Promise<void> }
): Promise<RideReport> => {
  const ride = recordFlickRide(page, { ...opts, waitForStart: !!beforeStart });
  if (!beforeStart) return ride;
  // A ride that fails before its first sample never becomes ready.
  const ready = await Promise.race([
    ride.then(() => false),
    page
      .waitForFunction(() => (window as Window & FlickRideHandshake).__flickRideReady === true)
      .then(
        () => true,
        () => false
      ),
  ]);
  if (ready) {
    await beforeStart();
    await page.evaluate(() => {
      (window as Window & FlickRideHandshake).__flickRideStart = true;
    });
  }
  return ride;
};

/**
 * Continuous in-page sampling for COMPOSITOR-driven rides (CDP touch
 * fling): sampling cannot be interleaved with a JS driver loop because
 * the gesture runs outside the page. Start before the first gesture,
 * stop after the last; the jump metric is rect-vs-scrollTop consistency
 * per frame (|Δanchor.top + ΔscrollTop|), which needs no knowledge of
 * who is scrolling.
 */
export const startRideSampling = (
  page: Page,
  { measureVisualTravel = false }: { measureVisualTravel?: boolean } = {}
): Promise<void> =>
  page.evaluate((sampleVisualTravel) => {
    const w = window as Window & {
      __appScrollWrites?: unknown[];
      __rideSampling?: {
        stop: boolean;
        frames: {
          t: number;
          scrollTop: number;
          scrollHeight: number;
          gapPx: number;
          jumpPx: number;
          visualDeltaPx?: number;
          leadGapPx?: number;
          threadCount: number;
          distFromBottom: number;
        }[];
        threadCountStart: number;
      };
    };
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
    const scroller = candidate;
    if (!scroller) return;
    scroller.dataset.e2eScroller = '1';
    const readThreadCount = () =>
      Number(
        (scroller.querySelector('[data-thread-count]') as HTMLElement | null)?.dataset
          .threadCount ?? -1
      );
    type Span = { top: number; bottom: number };
    // A row covers only if its message element (or the row, if it has
    // none) is not hidden there or above by visibility, opacity or display;
    // the banner and the other content above the list are judged on their
    // first child, the banner's content element.
    const shown = (el: Element) =>
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const readCovering = (): Span[] => {
      const covering = Array.from(scroller.querySelectorAll('[data-index]'))
        .filter((tile) => shown(tile.querySelector('[data-message-item]') ?? tile))
        .map((tile) => tile.getBoundingClientRect());
      // Content laid out above the virtual list (at the top of a thread: its
      // banner and the "Loading..." divider) is not a blank band. Only content
      // that ends above the list's own box counts, so a missing row or a ledger
      // margin before the list still does.
      const list = scroller.querySelector('[data-thread-count]');
      if (list?.parentElement) {
        const listTop = list.getBoundingClientRect().top;
        Array.from(list.parentElement.children).forEach((child) => {
          const r = child.getBoundingClientRect();
          const content = child.firstElementChild ?? child;
          if (child !== list && r.bottom <= listTop + 0.5 && shown(content)) covering.push(r);
        });
      }
      return covering.map(({ top, bottom }) => ({ top, bottom }));
    };
    // scrollPx moves the spans as scrolling by that much would.
    const readGap = (covering: Span[], scrollPx = 0): number => {
      const rect = scroller.getBoundingClientRect();
      const top = rect.top + rect.height * 0.1;
      const bottom = rect.bottom - rect.height * 0.1;
      const tiles = covering
        .map((r) => ({ top: r.top - scrollPx, bottom: r.bottom - scrollPx }))
        .filter((r) => r.bottom > top && r.top < bottom)
        .sort((a, b) => a.top - b.top);
      let cursor = top;
      let maxGap = 0;
      tiles.forEach((r) => {
        if (r.top > cursor) maxGap = Math.max(maxGap, r.top - cursor);
        cursor = Math.max(cursor, r.bottom);
      });
      if (cursor < bottom) maxGap = Math.max(maxGap, bottom - cursor);
      return maxGap;
    };
    const pickAnchor = (visibleOnly = false): Element | null => {
      const rows = Array.from(document.querySelectorAll('[data-message-item]'));
      const viewport = visibleOnly ? scroller.getBoundingClientRect() : undefined;
      const mid = viewport ? (viewport.top + viewport.bottom) / 2 : window.innerHeight / 2;
      let best: Element | null = null;
      let bestDistance = Infinity;
      rows.forEach((r) => {
        const rect = r.getBoundingClientRect();
        if (viewport && (rect.bottom <= viewport.top || rect.top >= viewport.bottom)) return;
        const distance = Math.abs((rect.top + rect.bottom) / 2 - mid);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = r;
        }
      });
      return best;
    };
    const state = {
      stop: false,
      frames: [] as {
        t: number;
        scrollTop: number;
        scrollHeight: number;
        gapPx: number;
        jumpPx: number;
        visualDeltaPx?: number;
        leadGapPx?: number;
        threadCount: number;
        distFromBottom: number;
      }[],
      threadCountStart: readThreadCount(),
    };
    w.__rideSampling = state;
    let anchor: Element | null = null;
    let anchorTop = 0;
    let lastScrollTop = scroller.scrollTop;
    let lastWriteCount = w.__appScrollWrites?.length ?? 0;
    let lastCovering: Span[] | undefined;
    let visualAnchor: Element | null = null;
    let visualAnchorTop = 0;
    const loop = () => {
      if (state.stop) return;
      const scrollTop = scroller.scrollTop;
      let jumpPx = 0;
      if (anchor && anchor.isConnected) {
        const rect = anchor.getBoundingClientRect();
        if (rect.bottom > -1200 && rect.top < window.innerHeight + 1200) {
          // Content-shift invariant: with stable content, the anchor's
          // client top moves by exactly -ΔscrollTop each frame.
          jumpPx = Math.abs(rect.top - anchorTop + (scrollTop - lastScrollTop));
          anchorTop = rect.top;
        } else {
          anchor = pickAnchor();
          anchorTop = anchor?.getBoundingClientRect().top ?? 0;
        }
      } else {
        anchor = pickAnchor();
        anchorTop = anchor?.getBoundingClientRect().top ?? 0;
      }
      let visualDeltaPx: number | undefined;
      if (sampleVisualTravel) {
        const viewportTop = scroller.getBoundingClientRect().top;
        if (visualAnchor?.isConnected) {
          visualDeltaPx = visualAnchor.getBoundingClientRect().top - viewportTop - visualAnchorTop;
        }
        // Each handoff starts a new baseline; only motion of the SAME row counts.
        visualAnchor = pickAnchor(true);
        visualAnchorTop = (visualAnchor?.getBoundingClientRect().top ?? viewportTop) - viewportTop;
      }
      const covering = readCovering();
      // An app write (a ledger settle) moves the offset in the same commit
      // as the rows, so the compositor never showed the old rows there.
      const writeCount = w.__appScrollWrites?.length ?? 0;
      const leadGapPx =
        lastCovering && writeCount === lastWriteCount
          ? Math.round(readGap(lastCovering, scrollTop - lastScrollTop))
          : undefined;
      lastCovering = covering;
      lastWriteCount = writeCount;
      lastScrollTop = scrollTop;
      state.frames.push({
        t: performance.now(),
        scrollTop,
        scrollHeight: scroller.scrollHeight,
        gapPx: Math.round(readGap(covering)),
        jumpPx: Math.round(jumpPx),
        ...(sampleVisualTravel ? { visualDeltaPx } : {}),
        leadGapPx,
        threadCount: readThreadCount(),
        distFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      });
      window.requestAnimationFrame(loop);
    };
    window.requestAnimationFrame(loop);
  }, measureVisualTravel);

export const stopRideSampling = (
  page: Page
): Promise<{ frames: RideFrame[]; threadCountStart: number; threadCountEnd: number }> =>
  page.evaluate(() => {
    const w = window as Window & {
      __rideSampling?: {
        stop: boolean;
        frames: (RideFrameShape & { jumpPx: number })[];
        threadCountStart: number;
      };
    };
    type RideFrameShape = {
      t: number;
      scrollTop: number;
      scrollHeight: number;
      gapPx: number;
      threadCount: number;
      distFromBottom: number;
    };
    const state = w.__rideSampling;
    if (!state) return { frames: [], threadCountStart: -1, threadCountEnd: -1 };
    state.stop = true;
    const frames = state.frames.map((frame) => ({ ...frame, driven: 0 }));
    return {
      frames,
      threadCountStart: state.threadCountStart,
      threadCountEnd: frames[frames.length - 1]?.threadCount ?? -1,
    };
  });

/** Native touch strokes with Node-clock delivery, independent of renderer acknowledgements. */
export const synthesizeFlickUp = async (
  page: Page,
  opts: { x: number; y: number; distance: number; speed: number }
): Promise<void> => {
  const geometry = await page.evaluate(({ x, y, distance: requestedDistance }) => {
    const scroller = document.querySelector<HTMLElement>('[data-e2e-scroller="1"]');
    if (!scroller || !scroller.contains(document.elementFromPoint(x, y))) {
      throw new Error('Touch target is outside the timeline scroller');
    }
    const rect = scroller.getBoundingClientRect();
    const minY = Math.max(0, rect.top) + 40;
    const maxY = Math.min(window.innerHeight, rect.bottom) - 40;
    // Floating headers and the composer bound the touchable span. Binary
    // search its edges: a pixel-by-pixel hit-test scan stalls a throttled
    // renderer while the previous fling is still moving on the compositor.
    const findEdge = (limit: number) => {
      const isTouchable = (touchY: number) =>
        scroller.contains(document.elementFromPoint(x, touchY));
      if (isTouchable(limit)) return limit;
      let inside = y;
      let outside = limit;
      while (Math.abs(inside - outside) > 1) {
        const middle = (inside + outside) / 2;
        if (isTouchable(middle)) inside = middle;
        else outside = middle;
      }
      return inside;
    };
    const top = findEdge(minY);
    const bottom = findEdge(maxY);
    const strokeEnd = top + requestedDistance / Math.ceil(requestedDistance / (bottom - top));
    if (
      ![top, strokeEnd].every((touchY) => scroller.contains(document.elementFromPoint(x, touchY)))
    ) {
      throw new Error(
        `Touch stroke leaves the timeline scroller: ${JSON.stringify({
          x,
          top,
          bottom,
          strokeEnd,
        })}`
      );
    }
    return { top, bottom };
  }, opts);
  const available = geometry.bottom - geometry.top;
  if (available <= 0 || opts.distance <= 0 || opts.speed <= 0)
    throw new Error('Invalid touch geometry or workload');
  const strokes = Math.ceil(opts.distance / available);
  const distance = opts.distance / strokes;
  const session = await page.context().newCDPSession(page);
  try {
    for (let stroke = 0; stroke < strokes; stroke += 1) {
      // Only the initial contact waits for acknowledgement. Move and release
      // sends stay ordered but do not wait for the throttled renderer.
      // eslint-disable-next-line no-await-in-loop
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: opts.x, y: geometry.top, id: 1 }],
      });
      const started = performance.now();
      const duration = (distance / opts.speed) * 1000;
      const steps = Math.max(3, Math.ceil(duration / 12));
      const pending: Promise<unknown>[] = [];
      for (let step = 1; step <= steps + 1; step += 1) {
        const deadline = started + (Math.min(step, steps) * duration) / steps;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, Math.max(0, deadline - performance.now()));
        });
        const release = step > steps;
        pending.push(
          session
            .send('Input.dispatchTouchEvent', {
              type: release ? 'touchEnd' : 'touchMove',
              touchPoints: release
                ? []
                : [{ x: opts.x, y: geometry.top + (distance * step) / steps, id: 1 }],
            })
            .then(
              () => undefined,
              (error: unknown) => error
            )
        );
      }
      // eslint-disable-next-line no-await-in-loop
      const acknowledgements = await Promise.all(pending);
      const failure = acknowledgements.find((result) => result !== undefined);
      if (failure) throw failure;
    }
  } finally {
    await session.detach();
  }
};

export type ScreencastCapture = {
  stop: () => Promise<{ t: number; data: string }[]>;
};

/**
 * Captures downscaled screencast frames for pixel-level analysis: iOS
 * blank screens during momentum are UNRASTERED pixels — the DOM has the
 * tiles, the glass does not — so DOM coverage sampling cannot see them.
 */
export const startScreencast = async (page: Page): Promise<ScreencastCapture> => {
  const session = await page.context().newCDPSession(page);
  const frames: { t: number; data: string }[] = [];
  session.on('Page.screencastFrame', (frame) => {
    // Correlate pixels with their compositor swap, not delayed CDP delivery.
    frames.push({ t: (frame.metadata.timestamp ?? Date.now() / 1000) * 1000, data: frame.data });
    session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
  });
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 45,
    maxWidth: 240,
    maxHeight: 520,
    everyNthFrame: 1,
  });
  return {
    stop: async () => {
      await session.send('Page.stopScreencast').catch(() => undefined);
      await session.detach().catch(() => undefined);
      return frames;
    },
  };
};

/**
 * Pixel blank-band analysis, done inside the page via canvas (no Node
 * image dependency): for each frame, scanlines in the timeline region
 * (vertical 18%..72%, horizontal middle 70%) are classified uniform when
 * their channel spread is tiny; the metric is the tallest consecutive
 * uniform band as a fraction of the analyzed region. Text rows break
 * uniformity; normal message spacing is far below the band threshold.
 */
export const analyzeBlankBands = (
  page: Page,
  frames: { t: number; data: string }[]
): Promise<{ t: number; blankPct: number }[]> =>
  page.evaluate(async (encodedFrames) => {
    const results: { t: number; blankPct: number }[] = [];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return results;
    for (const frame of encodedFrames) {
      // eslint-disable-next-line no-await-in-loop
      const image = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = `data:image/jpeg;base64,${frame.data}`;
      });
      if (!image) continue;
      canvas.width = image.width;
      canvas.height = image.height;
      context.drawImage(image, 0, 0);
      const regionTop = Math.floor(image.height * 0.18);
      const regionBottom = Math.floor(image.height * 0.72);
      const regionLeft = Math.floor(image.width * 0.15);
      const regionWidth = Math.floor(image.width * 0.7);
      const pixels = context.getImageData(
        regionLeft,
        regionTop,
        regionWidth,
        regionBottom - regionTop
      ).data;
      let maxRun = 0;
      let run = 0;
      const rows = regionBottom - regionTop;
      for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
        let min = 255;
        let max = 0;
        for (let colIndex = 0; colIndex < regionWidth; colIndex += 2) {
          const offset = (rowIndex * regionWidth + colIndex) * 4;
          // Luma approximation; JPEG noise tolerated by the spread bound.
          const luma = (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
          if (luma < min) min = luma;
          if (luma > max) max = luma;
        }
        if (max - min < 14) {
          run += 1;
          if (run > maxRun) maxRun = run;
        } else {
          run = 0;
        }
      }
      results.push({ t: frame.t, blankPct: Math.round((maxRun / rows) * 100) });
    }
    return results;
  }, frames);

/**
 * Records the open/hydration settle without any user input: from the
 * first rendered message row, samples distance-from-bottom and thread
 * count for `durationMs`. An open pinned to the latest message must STAY
 * at the bottom while backfill grows the content above it.
 */
export const recordOpenSettle = (
  page: Page,
  durationMs: number
): Promise<{
  error?: string;
  samples: {
    t: number;
    distFromBottom: number;
    threadCount: number;
    scrollHeight: number;
    bottomGapPx: number;
  }[];
}> =>
  page.evaluate(async (duration) => {
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
    const scroller = candidate;
    if (!scroller) return { error: 'no scroller found', samples: [] };
    const raf = () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    const readThreadCount = () =>
      Number(
        (scroller.querySelector('[data-thread-count]') as HTMLElement | null)?.dataset
          .threadCount ?? -1
      );
    const samples: {
      t: number;
      distFromBottom: number;
      threadCount: number;
      scrollHeight: number;
      bottomGapPx: number;
    }[] = [];
    const until = performance.now() + duration;
    while (performance.now() < until) {
      // eslint-disable-next-line no-await-in-loop
      await raf();
      // The VISUAL pin: the last message row's bottom edge against the
      // scroller's bottom edge. scrollHeight-derived distance counts the
      // transient offset-ledger margin (invisible to the reader) and
      // false-positives during hydration.
      const rows = scroller.querySelectorAll('[data-message-item]');
      const lastRow = rows[rows.length - 1];
      const bottomGapPx = lastRow
        ? Math.round(
            scroller.getBoundingClientRect().bottom - lastRow.getBoundingClientRect().bottom
          )
        : -9999;
      samples.push({
        t: performance.now(),
        distFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        threadCount: readThreadCount(),
        scrollHeight: scroller.scrollHeight,
        bottomGapPx,
      });
    }
    return { samples };
  }, durationMs);
