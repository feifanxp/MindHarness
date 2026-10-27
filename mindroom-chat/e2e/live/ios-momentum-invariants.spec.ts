import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import { positionThreadForPrepend } from '../helpers/rideRecorder';

/**
 * iOS momentum invariants for the virtualized thread timeline, in a real
 * rendered browser under iPhone emulation (chromium engine + iPhone UA /
 * touch / mobile viewport — the UA is what engages the iOS code paths in
 * both the app and virtual-core).
 *
 * iOS kills flick momentum on any programmatic scroll write during a live
 * scroll, and replayed corrections at quiescence land as a visible lurch.
 * The physics needs a device; the CAUSE is asserted here:
 *
 *  1. Zero app-originated scroll writes on the thread scroller while a
 *     scroll stream is live (momentum survives).
 *  2. No white gaps: virtual tiles cover the viewport core every frame of
 *     the stream (the PR #76 failure mode).
 *  3. No lurch: the visible anchor row does not jump when the stream ends
 *     (banked-replay failure mode, task #128 round 3).
 *
 * The scroll stream is driven by writes tagged via window.__driverDepth so
 * the instrumentation counts only writes the APP initiates.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = Number(process.env.IOS_INVARIANT_REPLY_COUNT ?? 220);
const iphone = devices['iPhone 14'];

type AppScrollWrite = { kind: string; value: number; t: number; stack?: string };

type StreamReport = {
  error?: string;
  startTop: number;
  streamEndTop: number;
  settledTop: number;
  travel: number;
  writesDuring: AppScrollWrite[];
  writesAfter: AppScrollWrite[];
  maxGapPx: number;
  gapFrames: number;
  anchorDriftPx: number | null;
  maxJumpPx: number;
  totalJumpPx: number;
  jumpFrames: number;
  jumpEvents: {
    jump: number;
    before: { i: string | null; id: string | null; top: number; h: number }[];
    after: { i: string | null; id: string | null; top: number; h: number }[];
  }[];
};

test.use({
  browserName: 'chromium',
  userAgent: iphone.userAgent,
  hasTouch: iphone.hasTouch,
  deviceScaleFactor: 2,
  // Login happens at a desktop-sized viewport (the auth helpers assume the
  // desktop shell); the test resizes to iPhone dimensions before opening
  // the thread, same pattern as cinny073-recent-threads-mobile.
  viewport: { width: 1280, height: 800 },
});

test.describe('iOS momentum invariants (iPhone-emulated)', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(600_000);

  test('upward multi-flick stream: no app scroll writes, no white gaps, no end lurch', async ({
    page,
  }, testInfo) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `iOS momentum invariants ${Date.now()}`,
      topic: 'Synthetic fast-scroll coverage regression',
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'iOS momentum invariants root',
    });
    for (let i = 1; i <= REPLY_COUNT; i += 1) {
      // Mixed heights on purpose: short one-liners, long fold-worthy walls
      // of text, AND agent-style extras messages (always-expanded, never
      // fold — the tallest rows real threads have). Fresh territory must
      // carry realistic estimate error: that is the condition every device
      // report shared.
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
      await sendRoomMessage(homeserver, session.accessToken, roomId, {
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
                  {
                    title: `Tool call ${i}.2`,
                    content_type: 'text/markdown',
                    content: `tool output for reply ${i}, section 2`,
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

    // Instrumentation must exist before any app code runs: wrap the scroll
    // write surfaces and record app-originated writes on the (later marked)
    // thread scroller.
    await page.addInitScript(() => {
      const w = window as Window & {
        __appScrollWrites?: AppScrollWrite[];
        __driverDepth?: number;
      };
      type AppScrollWrite = { kind: string; value: number; t: number; stack?: string };
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
      const wrapScrollMethod = (name: 'scrollTo' | 'scrollBy') => {
        const original = Element.prototype[name];
        Element.prototype[name] = function wrapped(this: Element, ...args: unknown[]) {
          const first = args[0];
          const top =
            typeof first === 'object' && first !== null
              ? (first as { top?: number }).top
              : (args[1] as number | undefined);
          if (typeof top === 'number') record(name, this, top);
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        } as typeof original;
      };
      wrapScrollMethod('scrollTo');
      wrapScrollMethod('scrollBy');
    });

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    // Let the open-time pin/settle and initial backfill finish; the
    // invariants target the steady state a user scrolls in.
    await page.waitForTimeout(3_000);

    const report = (await page.evaluate(async () => {
      const w = window as Window & {
        __appScrollWrites?: { kind: string; value: number; t: number }[];
        __driverDepth?: number;
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
      if (!scroller) return { error: 'no scroller found' };
      scroller.dataset.e2eScroller = '1';

      const raf = () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms);
        });

      // Per-frame coverage sampler: max uncovered vertical span in the
      // viewport core (10%..90%) — a white gap is uncovered space.
      const gaps: number[] = [];
      let sampling = true;
      const sampleGaps = () => {
        if (!sampling) return;
        const rect = scroller.getBoundingClientRect();
        const top = rect.top + rect.height * 0.1;
        const bottom = rect.bottom - rect.height * 0.1;
        const tiles = Array.from(scroller.querySelectorAll('[data-index]'))
          .map((tile) => tile.getBoundingClientRect())
          .filter((r) => r.bottom > top && r.top < bottom)
          .sort((a, b) => a.top - b.top);
        let cursor = top;
        let maxGap = 0;
        tiles.forEach((r) => {
          if (r.top > cursor) maxGap = Math.max(maxGap, r.top - cursor);
          cursor = Math.max(cursor, r.bottom);
        });
        if (cursor < bottom) maxGap = Math.max(maxGap, bottom - cursor);
        gaps.push(maxGap);
        window.requestAnimationFrame(sampleGaps);
      };
      window.requestAnimationFrame(sampleGaps);

      const writes = w.__appScrollWrites!;
      const writesBefore = writes.length;
      const startTop = scroller.scrollTop;

      // Visible anchor: the row nearest the viewport centre.
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

      // Per-frame visual-jump sampler: with the driver moving scrollTop by
      // exactly -240 per frame, a persisting anchor's viewport top must move
      // by exactly +240. Any residual is content shifting under the reader —
      // the "small jumps opposite to the scroll direction" a rider feels.
      let jumpAnchor: Element | null = null;
      let jumpAnchorTop = 0;
      const jumps: number[] = [];
      type TileSnap = { i: string | null; id: string | null; top: number; h: number };
      const readTileSnaps = (): TileSnap[] =>
        Array.from(scroller.querySelectorAll('[data-index]')).map((tile) => ({
          i: tile.getAttribute('data-index'),
          id:
            tile
              .querySelector('[data-message-id]')
              ?.getAttribute('data-message-id')
              ?.slice(0, 12) ?? null,
          top: Math.round((tile as HTMLElement).offsetTop),
          h: Math.round(tile.getBoundingClientRect().height),
        }));
      let lastTileSnaps = readTileSnaps();
      const jumpEvents: { jump: number; before: TileSnap[]; after: TileSnap[] }[] = [];
      const sampleJump = (drivenDelta: number) => {
        if (jumpAnchor && jumpAnchor.isConnected) {
          const rect = jumpAnchor.getBoundingClientRect();
          if (rect.bottom > -800 && rect.top < window.innerHeight + 800) {
            const jump = Math.abs(rect.top - jumpAnchorTop - drivenDelta);
            jumps.push(jump);
            jumpAnchorTop = rect.top;
            const tiles = readTileSnaps();
            if (jump > 60 && jumpEvents.length < 4) {
              jumpEvents.push({ jump: Math.round(jump), before: lastTileSnaps, after: tiles });
            }
            lastTileSnaps = tiles;
            return;
          }
        }
        jumpAnchor = pickAnchor();
        jumpAnchorTop = jumpAnchor?.getBoundingClientRect().top ?? 0;
        lastTileSnaps = readTileSnaps();
      };
      sampleJump(0);

      // Upward multi-flick stream: 3 flicks, 80ms finger-back-down pauses
      // (below the 150ms isScrolling debounce), driver-tagged writes.
      for (let flick = 0; flick < 3; flick += 1) {
        for (let step = 0; step < 14; step += 1) {
          w.__driverDepth! += 1;
          scroller.scrollTop -= 240;
          w.__driverDepth! -= 1;
          // eslint-disable-next-line no-await-in-loop
          await raf();
          sampleJump(240);
        }
        // eslint-disable-next-line no-await-in-loop
        await wait(80);
        sampleJump(0);
      }

      const streamEndTop = scroller.scrollTop;
      const writesDuring = writes.slice(writesBefore);
      const writesAtStreamEnd = writes.length;
      const anchor = pickAnchor();
      const anchorTopAtEnd = anchor?.getBoundingClientRect().top ?? null;

      // Quiescence: the banked-replay lurch (and the deferred prepend
      // commit) land inside this window if they are going to land at all.
      await wait(1_400);
      sampling = false;

      const anchorDriftPx =
        anchor && anchor.isConnected && anchorTopAtEnd !== null
          ? Math.abs(anchor.getBoundingClientRect().top - anchorTopAtEnd)
          : null;

      return {
        startTop,
        streamEndTop,
        settledTop: scroller.scrollTop,
        travel: startTop - streamEndTop,
        writesDuring,
        writesAfter: writes.slice(writesAtStreamEnd),
        maxGapPx: Math.round(Math.max(...gaps, 0)),
        gapFrames: gaps.length,
        anchorDriftPx,
        maxJumpPx: Math.round(Math.max(...jumps, 0)),
        totalJumpPx: Math.round(jumps.reduce((sum, jump) => sum + jump, 0)),
        jumpFrames: jumps.length,
        jumpEvents,
      };
    })) as StreamReport;

    // eslint-disable-next-line no-console
    console.log(
      `IOS-MOMENTUM-REPORT ${JSON.stringify({
        travel: report.travel,
        maxGapPx: report.maxGapPx,
        maxJumpPx: report.maxJumpPx,
        totalJumpPx: report.totalJumpPx,
        jumpFrames: report.jumpFrames,
        anchorDriftPx: report.anchorDriftPx,
      })}`
    );
    if (report.jumpEvents.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`IOS-MOMENTUM-JUMPS ${JSON.stringify(report.jumpEvents)}`);
    }
    await testInfo.attach('ios-momentum-invariants.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    expect(report.error).toBeUndefined();
    // The stream really moved through fresh territory and was sampled.
    expect(report.travel).toBeGreaterThan(8_000);
    expect(report.gapFrames).toBeGreaterThan(40);

    // 1. Momentum invariant: the app wrote nothing to the scroller while
    // the stream was live — nothing to kill an iOS flick.
    expect(report.writesDuring).toEqual([]);

    // 2. White-gap invariant: tiles covered the viewport core every frame.
    expect(report.maxGapPx).toBeLessThan(120);

    // 3. Lurch invariant: the visible anchor stayed put across quiescence.
    // App writes MAY land here (anchor-restore, quiet-state corrections) —
    // they must be visually invisible, which is what the anchor measures.
    // The null case (anchor unmounted across quiescence) is EXACTLY the
    // worst-lurch shape and used to skip the invariant silently (mutant
    // audit 2026-07-07, e2e static pass): a quiescence event violent
    // enough to unmount the anchored row must fail, not pass.
    expect(report.anchorDriftPx).not.toBeNull();
    expect(report.anchorDriftPx as number).toBeLessThan(60);

    // 4. Ride-smoothness budget: per-frame content jumps are estimate
    // error surfacing under the reader (device reports: "small jumps").
    // History of this metric: 482/2710 every run (fold-capped estimates
    // for always-expanded rows) → 0/0 typical with content-aware
    // estimates, but intermittent ~72-214px residuals remained. The
    // transform-compensation layer now cancels EVERY dropped correction
    // visually regardless of estimate quality, so the budget is tight:
    // under two text lines, per frame and per ride.
    expect(report.jumpFrames).toBeGreaterThan(30);
    expect(report.maxJumpPx).toBeLessThan(40);
    expect(report.totalJumpPx).toBeLessThan(120);
  });

  test('scrolling up from the bottom stays up — no snap back while new replies stream in', async ({
    page,
  }, testInfo) => {
    // Device report 2026-07-06: thread opens pinned to the bottom
    // (correct), but scrolling up a bit on iOS snaps the view back to the
    // bottom. Reproduction: leave the bottom by a clear margin (~640px,
    // far beyond any sticky-bottom threshold), then let new replies land —
    // the view must stay where the user put it.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `iOS snap-back repro ${Date.now()}`,
      topic: 'Synthetic scroll-position regression',
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'iOS snap-back root',
    });
    const sendReply = (body: string) =>
      sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    for (let i = 1; i <= 60; i += 1) {
      const body =
        i % 3 === 0
          ? `short reply ${i}`
          : `long reply ${i}\n${Array.from(
              { length: 16 },
              (_v, line) => `line ${line} of reply ${i} with enough text to wrap on a phone`
            ).join('\n')}`;
      // eslint-disable-next-line no-await-in-loop
      await sendReply(body);
    }

    // Open-time anomaly sampler: record any virtual tile that ever renders
    // taller than 400px (real rows are ~80 short / ~200 folded), with the
    // frame time — catches rows transiently rendering EXPANDED during
    // hydration, whose oversized measurements poison the size cache.
    await page.addInitScript(() => {
      const w = window as Window & {
        __tallTiles?: Record<string, { hMax: number; first: number; last: number }>;
      };
      w.__tallTiles = {};
      const sample = () => {
        document.querySelectorAll('[data-index]').forEach((tile) => {
          const height = tile.getBoundingClientRect().height;
          if (height > 400) {
            const id =
              tile.querySelector('[data-message-id]')?.getAttribute('data-message-id') ??
              `idx${tile.getAttribute('data-index')}`;
            const entry = (w.__tallTiles![id] as {
              hMax: number;
              first: number;
              last: number;
              html?: string;
            }) ?? {
              hMax: 0,
              first: performance.now(),
              last: 0,
            };
            entry.hMax = Math.max(entry.hMax, Math.round(height));
            entry.last = performance.now();
            if (!entry.html) {
              const chain: string[] = [];
              let node: Element | null = tile;
              for (let depth = 0; depth < 7 && node; depth += 1) {
                let tallest: Element | null = null;
                let tallestH = 0;
                Array.from(node.children).forEach((c) => {
                  const ch = c.getBoundingClientRect().height;
                  if (ch > tallestH) {
                    tallestH = ch;
                    tallest = c;
                  }
                });
                if (!tallest || tallestH < 300) break;
                const el = tallest as Element;
                chain.push(
                  `${el.tagName.toLowerCase()}.${(el.className || '')
                    .toString()
                    .slice(0, 40)}=${Math.round(tallestH)}`
                );
                node = tallest;
              }
              entry.html = chain.join(' > ');
            }
            w.__tallTiles![id] = entry;
          }
        });
        window.requestAnimationFrame(sample);
      };
      window.requestAnimationFrame(sample);
    });

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await page.waitForTimeout(3_000);
    const tallTiles = await page.evaluate(
      () => (window as Window & { __tallTiles?: unknown }).__tallTiles
    );
    // eslint-disable-next-line no-console
    console.log(`IOS-SNAP-BACK-TALL ${JSON.stringify(tallTiles)}`);

    // Leave the bottom with a driver-tagged upward stream and start a
    // scrollTop trajectory sampler.
    const scrollUp = await page.evaluate(async () => {
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
      if (!scroller) return { error: 'no scroller found' };
      const w = window as Window & {
        __snapSamples?: { t: number; distFromBottom: number }[];
        __snapScroller?: HTMLElement;
        __snapSampling?: boolean;
      };
      w.__snapScroller = scroller;
      w.__snapSamples = [];
      w.__snapSampling = true;
      const sample = () => {
        if (!w.__snapSampling) return;
        w.__snapSamples!.push({
          t: performance.now(),
          distFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        });
        window.requestAnimationFrame(sample);
      };
      window.requestAnimationFrame(sample);

      const raf = () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      // Gesture fidelity (same pattern as the composer re-pin test): a
      // real drag fires touch events, and the open-at-latest pin-hold
      // deliberately keys on them — a device cannot scroll without a
      // gesture, so a bare programmatic write must not model the user.
      const touch = (type: string) =>
        scroller.dispatchEvent(new TouchEvent(type, { bubbles: true }));
      touch('touchstart');
      const before = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      const scrollTopBefore = scroller.scrollTop;
      const scrollHeightBefore = scroller.scrollHeight;
      const readTiles = () =>
        Array.from(scroller.querySelectorAll('[data-index]')).map((tile) => ({
          i: tile.getAttribute('data-index'),
          id: tile.querySelector('[data-message-id]')?.getAttribute('data-message-id') ?? null,
          top: Math.round((tile as HTMLElement).offsetTop),
          h: Math.round(tile.getBoundingClientRect().height),
        }));
      const readTotal = () =>
        Math.round(
          (scroller.querySelector('[data-index]')?.parentElement as HTMLElement | null)
            ?.offsetHeight ?? -1
        );
      const readThreadCount = () =>
        Number(
          (scroller.querySelector('[data-thread-count]') as HTMLElement | null)?.dataset
            .threadCount ?? -1
        );
      const steps: {
        scrollTop: number;
        scrollHeight: number;
        virtualTotal: number;
        threadCount: number;
        tiles: { i: string | null; h: number }[];
      }[] = [];
      for (let step = 0; step < 8; step += 1) {
        touch('touchmove');
        scroller.scrollTop -= 80;
        // eslint-disable-next-line no-await-in-loop
        await raf();
        steps.push({
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          virtualTotal: readTotal(),
          threadCount: readThreadCount(),
          tiles: readTiles(),
        });
      }
      touch('touchend');
      return {
        distFromBottomBefore: before,
        scrollTopBefore,
        scrollHeightBefore,
        steps,
        scrollTopAfterUp: scroller.scrollTop,
        scrollHeightAfterUp: scroller.scrollHeight,
        distFromBottomAfterUp: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      };
    });
    // Diagnostic detail on failure: did scrollTop get written back down, or
    // did scrollHeight collapse under a fixed scrollTop (content teleport)?
    // eslint-disable-next-line no-console
    console.log(`IOS-SNAP-BACK-SCROLLUP ${JSON.stringify(scrollUp)}`);
    expect((scrollUp as { error?: string }).error).toBeUndefined();
    const up = scrollUp as {
      scrollTopBefore: number;
      steps: { scrollTop: number; scrollHeight: number }[];
      distFromBottomAfterUp: number;
    };
    // THE invariant: the app never moves the user's scroll position. Every
    // step lands exactly where the driver put it — a clamp (scrollHeight
    // collapsing below scrollTop, the adoption-teleport bug) shows up as a
    // step losing more than its driven 80px. Gradual scrollHeight erosion
    // from estimate error is accepted drift and does NOT touch scrollTop.
    up.steps.forEach((step, index) => {
      expect(Math.abs(step.scrollTop - (up.scrollTopBefore - 80 * (index + 1)))).toBeLessThan(4);
    });
    // Belt: even with accepted drift, the viewport must remain clearly
    // away from the bottom after 640px of driving.
    expect(up.distFromBottomAfterUp).toBeGreaterThan(150);

    // Streaming pressure: new replies land while the user is scrolled up.
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendReply(`streamed reply ${i} arriving while the user reads history`);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(2_000);

    const outcome = await page.evaluate(() => {
      const w = window as Window & {
        __snapSamples?: { t: number; distFromBottom: number }[];
        __snapScroller?: HTMLElement;
        __snapSampling?: boolean;
      };
      w.__snapSampling = false;
      const scroller = w.__snapScroller!;
      return {
        finalDistFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        minDistAfterLeavingBottom: Math.min(
          ...w.__snapSamples!.slice(20).map((s) => s.distFromBottom),
          Infinity
        ),
        samples: w.__snapSamples!.length,
      };
    });

    await testInfo.attach('ios-snap-back.json', {
      body: JSON.stringify({ scrollUp, outcome }, null, 2),
      contentType: 'application/json',
    });

    // The view must stay where the user put it: never returning to the
    // bottom region without user input, including while replies land.
    expect(outcome.samples).toBeGreaterThan(40);
    expect(outcome.finalDistFromBottom).toBeGreaterThan(300);
    expect(outcome.minDistAfterLeavingBottom).toBeGreaterThan(150);
  });

  test('composer growth right after leaving the bottom must not re-pin the view', async ({
    page,
  }, testInfo) => {
    // The editor ResizeObserver re-pins to the bottom "if at bottom". The
    // atBottom state's false-transition is debounced ~1s, so a composer
    // resize within that window after scrolling up would yank the reader
    // back down — same stale-state class as the adoption teleport.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Composer re-pin repro ${Date.now()}`,
      topic: 'Synthetic composer scroll-position regression',
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Composer re-pin root',
    });
    for (let i = 1; i <= 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: `reply ${i}\n${Array.from(
          { length: 16 },
          (_v, line) => `line ${line} of reply ${i} with enough text to wrap on a phone`
        ).join('\n')}`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    }

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await page.waitForTimeout(3_000);

    // Leave the bottom...
    const afterUp = await page.evaluate(async () => {
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
      if (!scroller) return { error: 'no scroller found' };
      (window as Window & { __repinScroller?: HTMLElement }).__repinScroller = scroller;
      const raf = () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      // Gesture fidelity: a real drag fires touch events, and the app's
      // "user took over" logic (open-time settle, scroll intent) keys on
      // gestures, not bare scroll events.
      const touch = (type: string) =>
        scroller.dispatchEvent(new TouchEvent(type, { bubbles: true }));
      touch('touchstart');
      const readProbe = () => {
        const snapshot = (
          window as Window & {
            __MINDROOM_CACHE_PROBE__?: {
              snapshot: () => {
                collapsibleVerdictOverflowing?: number;
                collapsibleVerdictNotOverflowing?: number;
              };
            };
          }
        ).__MINDROOM_CACHE_PROBE__?.snapshot();
        return {
          verdictYes: snapshot?.collapsibleVerdictOverflowing ?? -1,
          verdictNo: snapshot?.collapsibleVerdictNotOverflowing ?? -1,
        };
      };
      const readTiles = () =>
        Array.from(scroller.querySelectorAll('[data-index]')).map((tile) => ({
          i: tile.getAttribute('data-index'),
          h: Math.round(tile.getBoundingClientRect().height),
        }));
      const steps: {
        scrollTop: number;
        scrollHeight: number;
        probe: ReturnType<typeof readProbe>;
        tiles: ReturnType<typeof readTiles>;
      }[] = [];
      // Baseline BEFORE the first write (mutant audit 2026-07-07, e2e
      // static pass): anchoring on steps[0].scrollTop made iteration 0 a
      // self-comparison and hid any app write racing the first step —
      // the snap-back spec's pre-drive baseline is the correct form.
      const scrollTopBefore = scroller.scrollTop;
      for (let step = 0; step < 8; step += 1) {
        touch('touchmove');
        scroller.scrollTop -= 80;
        // eslint-disable-next-line no-await-in-loop
        await raf();
        steps.push({
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          probe: readProbe(),
          tiles: readTiles(),
        });
      }
      touch('touchend');
      return {
        scrollTopBefore,
        steps,
        distFromBottomAfterUp: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      };
    });
    // eslint-disable-next-line no-console
    console.log(`COMPOSER-REPIN-SCROLLUP ${JSON.stringify(afterUp)}`);
    expect((afterUp as { error?: string }).error).toBeUndefined();
    const upPhase = afterUp as {
      scrollTopBefore: number;
      steps: { scrollTop: number; scrollHeight: number }[];
      distFromBottomAfterUp: number;
    };
    // Same invariant as the snap-back test: the app never moves the user's
    // scroll position (estimate-drift erodes scrollHeight, never scrollTop).
    upPhase.steps.forEach((step, index) => {
      expect(Math.abs(step.scrollTop - (upPhase.scrollTopBefore - 80 * (index + 1)))).toBeLessThan(
        4
      );
    });
    expect(upPhase.distFromBottomAfterUp).toBeGreaterThan(300);

    // ...and grow the composer INSIDE the debounce window: focus + newlines.
    const composer = page.getByRole('textbox').last();
    await composer.click();
    await composer.press('Shift+Enter');
    await composer.press('Shift+Enter');
    await composer.press('Shift+Enter');
    await page.waitForTimeout(1_500);

    const outcome = await page.evaluate(() => {
      const scroller = (window as Window & { __repinScroller?: HTMLElement }).__repinScroller!;
      return {
        finalDistFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      };
    });
    await testInfo.attach('composer-repin.json', {
      body: JSON.stringify({ afterUp, outcome }, null, 2),
      contentType: 'application/json',
    });

    // The reader stays where they were; only a genuinely bottom-pinned view
    // may follow the growing composer.
    expect(outcome.finalDistFromBottom).toBeGreaterThan(300);
  });

  test('prepend commit during a flick pause lands in one paint — no reverse-flash', async ({
    page,
  }, testInfo) => {
    // Device report (2026-07-06, round 9): momentum right, end position
    // right, but short jumps get "applied again in reverse" mid-ride. The
    // momentum spec's 80ms inter-flick pauses sit BELOW the 150ms scroll
    // quiescence threshold, so the deferred prepend commit never fires
    // inside its measured stream — real thumb pauses exceed 150ms and the
    // commit's anchor restore lands under the reader's eyes. This test
    // makes the pauses realistic (450ms) over a thread that genuinely
    // requires back-pagination and keeps the per-frame anchor sampler
    // running THROUGH the pauses: the prepend commit must land in one
    // paint, with zero visible anchor motion.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `iOS prepend one-paint ${Date.now()}`,
      topic: 'Synthetic history-prepend regression',
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'iOS prepend one-paint root',
    });
    const PREPEND_REPLY_COUNT = 360;
    for (let i = 1; i <= PREPEND_REPLY_COUNT; i += 1) {
      // Same mixed-height fixture as the momentum stream: the prepended
      // page must carry realistic estimate error into the anchor restore.
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
      await sendRoomMessage(homeserver, session.accessToken, roomId, {
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

    // A thread "requiring back-pagination": abort /relations CONTINUATION
    // pages (from= param) during the open, so the open-time drain stops
    // after the first interactive page — the rendered window stays partial
    // with a live backward token, exactly the state a slow real-world
    // connection leaves a long thread in. First pages (no from=) pass, so
    // the open itself renders normally.
    const relationsContinuation = (url: URL) =>
      url.pathname.includes('/relations/') && url.searchParams.has('from');
    await page.route(relationsContinuation, (route) => route.abort());

    // App-originated write log (driver-tagged), for the failure photograph:
    // the coarse/fine anchor-restore two-step shows up here as a scrollTo
    // followed by a scrollBy/scrollTop a frame later.
    await page.addInitScript(() => {
      const w = window as Window & {
        __appScrollWrites?: AppScrollWrite[];
        __driverDepth?: number;
      };
      type AppScrollWrite = { kind: string; value: number; t: number; stack?: string };
      w.__appScrollWrites = [];
      w.__driverDepth = 0;
      const record = (kind: string, el: unknown, value: number) => {
        if ((w.__driverDepth ?? 0) > 0) return;
        if (!(el instanceof HTMLElement) || el.dataset.e2eScroller !== '1') return;
        // Short call stack: when an unexpected write class shows up, the
        // writer is read from the trace instead of guessed at
        // (instrument-before-guessing).
        const stack = (new Error().stack ?? '')
          .split('\n')
          .slice(2, 6)
          .map((line) => line.trim().replace(/^at /, ''))
          .join(' | ')
          .slice(0, 400);
        w.__appScrollWrites!.push({ kind, value, t: performance.now(), stack });
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
      const wrapScrollMethod = (name: 'scrollTo' | 'scrollBy') => {
        const original = Element.prototype[name];
        Element.prototype[name] = function wrapped(this: Element, ...args: unknown[]) {
          const first = args[0];
          const top =
            typeof first === 'object' && first !== null
              ? (first as { top?: number }).top
              : (args[1] as number | undefined);
          if (typeof top === 'number') record(name, this, top);
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        } as typeof original;
      };
      wrapScrollMethod('scrollTo');
      wrapScrollMethod('scrollBy');
    });

    // Timeline debug logs + console capture: the pagination pipeline has
    // several silent early-return paths (no SDK token, stale thread, error)
    // — when the prepend precondition fails, these lines say which one.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('mindroom.debug.timeline', '1');
      } catch {
        // ignore
      }
    });
    const debugLines: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('[timeline-debug]')) debugLines.push(text);
    });
    const relationRequests: { url: string; phase: string; status?: number }[] = [];
    let requestPhase = 'open';
    page.on('response', (response) => {
      const url = response.url();
      if (!url.includes('/relations/')) return;
      relationRequests.push({
        url: url.replace(/^.*\/_matrix/, '/_matrix').slice(0, 160),
        phase: requestPhase,
        status: response.status(),
      });
    });
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (!url.includes('/relations/')) return;
      relationRequests.push({
        url: `FAILED(${request.failure()?.errorText}) ${url
          .replace(/^.*\/_matrix/, '/_matrix')
          .slice(0, 140)}`,
        phase: requestPhase,
      });
    });

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    // Let the (deliberately truncated) open chain finish and the pin settle.
    await page.waitForTimeout(3_000);
    // Back-pagination may fetch again from the stream phase on — but the
    // abort must outlive the rig install: under the one-drain-channel
    // architecture (PR #87) continuations retry back-to-back the moment
    // the abort lifts, and unrouting BEFORE the evaluate let the window
    // fill to 361/361 before threadCountStart was read (battery run
    // 2026-07-07). The evaluate reads its start count immediately; the
    // unroute lands while the drive is arming.

    await positionThreadForPrepend(page);
    const reportPromise = page.evaluate(async () => {
      const w = window as Window & {
        __appScrollWrites?: { kind: string; value: number; t: number }[];
        __driverDepth?: number;
        __MINDROOM_CACHE_PROBE__?: {
          snapshot: () => Record<string, number | undefined>;
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
      if (!scroller) return { error: 'no scroller found' };
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
      const readAutoPaginateFired = () =>
        w.__MINDROOM_CACHE_PROBE__?.snapshot().threadAutoPaginateBackFired ?? 0;
      const readPaginateExitCounters = () => {
        const snapshot = w.__MINDROOM_CACHE_PROBE__?.snapshot() ?? {};
        return Object.fromEntries(
          Object.entries(snapshot).filter(([key]) => key.startsWith('threadPaginateBack'))
        );
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

      type TileSnap = { i: string | null; id: string | null; top: number; h: number };
      const readTileSnaps = (): TileSnap[] =>
        Array.from(scroller.querySelectorAll('[data-index]')).map((tile) => ({
          i: tile.getAttribute('data-index'),
          id:
            tile
              .querySelector('[data-message-id]')
              ?.getAttribute('data-message-id')
              ?.slice(0, 12) ?? null,
          top: Math.round((tile as HTMLElement).offsetTop),
          h: Math.round(tile.getBoundingClientRect().height),
        }));

      let jumpAnchor: Element | null = null;
      let jumpAnchorTop = 0;
      const jumps: number[] = [];
      let lastTileSnaps = readTileSnaps();
      const jumpEvents: { jump: number; before: TileSnap[]; after: TileSnap[] }[] = [];
      const sampleJump = (drivenDelta: number) => {
        if (jumpAnchor && jumpAnchor.isConnected) {
          const rect = jumpAnchor.getBoundingClientRect();
          if (rect.bottom > -800 && rect.top < window.innerHeight + 800) {
            const jump = Math.abs(rect.top - jumpAnchorTop - drivenDelta);
            jumps.push(jump);
            jumpAnchorTop = rect.top;
            const tiles = readTileSnaps();
            if (jump > 30 && jumpEvents.length < 6) {
              jumpEvents.push({ jump: Math.round(jump), before: lastTileSnaps, after: tiles });
            }
            lastTileSnaps = tiles;
            return;
          }
        }
        jumpAnchor = pickAnchor();
        jumpAnchorTop = jumpAnchor?.getBoundingClientRect().top ?? 0;
        lastTileSnaps = readTileSnaps();
      };

      const threadCountStart = readThreadCount();
      const autoPaginateFiredStart = readAutoPaginateFired();
      const writes = w.__appScrollWrites!;
      const writesBefore = writes.length;

      // Native wheel positioning already settled the loaded edge before sampling.
      sampleJump(0);

      // Flick + REALISTIC pause cycles. Pauses exceed the 150ms scroll
      // quiescence threshold, so the deferred prepend commit fires inside
      // the sampled stream — the sampler keeps running through the pauses
      // with an expected anchor movement of exactly zero. Each cycle
      // starts with a fresh gesture (finger back on glass), which is also
      // what re-authorizes the auto-paginate trigger after a barren
      // attempt.
      for (let cycle = 0; cycle < 4; cycle += 1) {
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
        for (let step = 0; step < 8; step += 1) {
          const prevTop = scroller.scrollTop;
          w.__driverDepth! += 1;
          scroller.scrollTop -= 90;
          w.__driverDepth! -= 1;
          // eslint-disable-next-line no-await-in-loop
          await raf();
          // Actual driven delta (the write clamps near the window top
          // until the prepend lands).
          sampleJump(prevTop - scroller.scrollTop);
        }
        const pauseUntil = performance.now() + 500;
        while (performance.now() < pauseUntil) {
          // eslint-disable-next-line no-await-in-loop
          await raf();
          sampleJump(0);
        }
      }

      return {
        threadCountStart,
        threadCountEnd: readThreadCount(),
        autoPaginateFired: readAutoPaginateFired() - autoPaginateFiredStart,
        paginateExits: readPaginateExitCounters(),
        appWrites: writes.slice(writesBefore),
        maxJumpPx: Math.round(Math.max(...jumps, 0)),
        totalJumpPx: Math.round(jumps.reduce((sum, jump) => sum + jump, 0)),
        jumpFrames: jumps.length,
        jumpEvents,
        settledTop: scroller.scrollTop,
      };
    });
    await page.waitForTimeout(1_000);
    await page.unroute(relationsContinuation);
    requestPhase = 'stream';
    const report = (await reportPromise) as {
      error?: string;
      threadCountStart: number;
      threadCountEnd: number;
      autoPaginateFired: number;
      paginateExits: Record<string, number>;
      appWrites: AppScrollWrite[];
      maxJumpPx: number;
      totalJumpPx: number;
      jumpFrames: number;
      jumpEvents: StreamReport['jumpEvents'];
      settledTop: number;
    };

    // eslint-disable-next-line no-console
    console.log(
      `IOS-PREPEND-ONE-PAINT ${JSON.stringify({
        threadCountStart: report.threadCountStart,
        threadCountEnd: report.threadCountEnd,
        autoPaginateFired: report.autoPaginateFired,
        paginateExits: report.paginateExits,
        maxJumpPx: report.maxJumpPx,
        totalJumpPx: report.totalJumpPx,
        jumpFrames: report.jumpFrames,
        appWrites: report.appWrites,
      })}`
    );
    if (report.jumpEvents && report.jumpEvents.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`IOS-PREPEND-JUMPS ${JSON.stringify(report.jumpEvents)}`);
    }
    // eslint-disable-next-line no-console
    console.log(`IOS-PREPEND-RELATIONS ${JSON.stringify(relationRequests)}`);
    await testInfo.attach('ios-prepend-one-paint.json', {
      body: JSON.stringify({ report, relationRequests, debugLines }, null, 2),
      contentType: 'application/json',
    });

    expect(report.error).toBeUndefined();

    // Preconditions — the test proves nothing unless the prepend commit
    // actually landed INSIDE the sampled stream:
    // the open rendered a partial window (the continuation abort worked)...
    expect(report.threadCountStart).toBeGreaterThan(0);
    expect(report.threadCountStart).toBeLessThan(PREPEND_REPLY_COUNT);
    // ...the scroll-driven trigger fired the chip pipeline...
    expect(report.autoPaginateFired).toBeGreaterThan(0);
    // ...and older rows were prepended while the sampler ran.
    expect(report.threadCountEnd).toBeGreaterThan(report.threadCountStart);
    expect(report.jumpFrames).toBeGreaterThan(60);

    // THE invariant: the same ride-smoothness budget as the momentum
    // stream, now measured ACROSS the prepend commit. The anchor restore
    // must land in one paint — a coarse write painted a frame before its
    // fine correction shows up here as a jump pair.
    expect(report.maxJumpPx).toBeLessThan(40);
    expect(report.totalJumpPx).toBeLessThan(120);
  });
});
