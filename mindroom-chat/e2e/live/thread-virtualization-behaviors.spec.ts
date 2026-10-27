import { expect, test, type Page, type Route } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';
import { loadAllOlderThreadMessages } from '../helpers/threadTimeline';

/**
 * Live behavior guards for the virtualized thread timeline (PR #44).
 * Each test exercises a behavior that only manifests with real scroll
 * geometry and a real /sync stream:
 *  - open-at-latest lands the viewport at the newest reply
 *  - streaming edits must NOT yank a user who scrolled up back to the bottom
 *  - clicking a reply quote targeting a loaded-but-unmounted row scrolls to it
 *  - expand-all applies to rows that mount only after scrolling
 *  - a manually expanded row stays expanded after a virtualized remount
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = 200;

type Seeded = { roomId: string; rootId: string; replyIds: string[] };

const seedThread = async (
  homeserver: string,
  accessToken: string,
  opts: {
    longBodies?: boolean;
    longBodyLines?: number;
    quoteTargetIndex?: number;
    replyCount?: number;
  } = {}
): Promise<Seeded> => {
  const roomId = await createPrivateRoom(homeserver, accessToken, {
    name: `Virtualization behaviors ${Date.now()}`,
    topic: 'Synthetic thread virtualization regression',
  });
  const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Virtualization behaviors root',
  });
  const replyIds: string[] = [];
  const replyCount = opts.replyCount ?? REPLY_COUNT;
  for (let i = 1; i <= replyCount; i += 1) {
    const longSuffix = opts.longBodies
      ? `\n${Array.from(
          { length: opts.longBodyLines ?? 12 },
          (_v, l) => `long collapsible line ${l} of reply ${i}`
        ).join('\n')}`
      : '';
    const relatesTo: Record<string, unknown> = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    };
    const quoteTarget =
      opts.quoteTargetIndex !== undefined ? replyIds[opts.quoteTargetIndex] : undefined;
    if (quoteTarget && i === replyCount) {
      relatesTo.is_falling_back = false;
      relatesTo['m.in_reply_to'] = { event_id: quoteTarget };
    }
    // eslint-disable-next-line no-await-in-loop
    const id = await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body: `Virt reply ${i}${longSuffix}`,
      'm.relates_to': relatesTo,
    });
    replyIds.push(id);
  }
  return { roomId, rootId, replyIds };
};

const openThread = async (page: Page, seeded: Seeded) => {
  await page.goto(
    `/home/${encodeURIComponent(seeded.roomId)}?threadId=${encodeURIComponent(seeded.rootId)}`
  );
  await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
  await page.waitForTimeout(2_000);
};

const getScrollState = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-message-item]');
    let el: HTMLElement | null = row?.parentElement ?? null;
    while (el) {
      const { overflowY } = window.getComputedStyle(el);
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight)
        break;
      el = el.parentElement;
    }
    const mountedRects = Array.from(el?.querySelectorAll('[data-index]') ?? []).map((tile) =>
      tile.getBoundingClientRect()
    );
    return {
      scrollTop: el?.scrollTop ?? -1,
      scrollHeight: el?.scrollHeight ?? -1,
      clientHeight: el?.clientHeight ?? -1,
      mountedRows: document.querySelectorAll('[data-message-item]').length,
      mountedHeight: mountedRects.length
        ? Math.max(...mountedRects.map((rect) => rect.bottom)) -
          Math.min(...mountedRects.map((rect) => rect.top))
        : 0,
      tallestMountedRow: Math.max(0, ...mountedRects.map((rect) => rect.height)),
    };
  });

test.describe('virtualized thread behaviors', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(420_000);

  test('opening a large thread lands the viewport at the latest reply', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const seeded = await seedThread(homeserver, session.accessToken);

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);

    const lastReply = page.getByText(`Virt reply ${REPLY_COUNT}`, { exact: false }).last();
    await expect(lastReply).toBeInViewport({ timeout: 15_000 });

    const state = await getScrollState(page);
    expect(state.scrollTop + state.clientHeight).toBeGreaterThan(state.scrollHeight - 48);
    expect(state.mountedRows).toBeLessThan(REPLY_COUNT);
    expect(state.mountedHeight).toBeGreaterThan(0);
    // At the bottom, one viewport plus two screens of overscan stays mounted.
    // Bound real geometry: a fixed row count penalizes short, dense messages.
    expect(state.mountedHeight).toBeLessThanOrEqual(
      state.clientHeight * 3 + state.tallestMountedRow * 2
    );
    await expect(page.getByRole('button', { name: 'Jump to Latest' })).toHaveCount(0);
  });

  test('streaming edits do not yank a scrolled-up reader back to the bottom', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const seeded = await seedThread(homeserver, session.accessToken);

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);

    // Real wheel input marks user scroll intent, then leaves the bottom zone.
    const timeline = page.locator('[data-message-item]').first();
    await timeline.hover();
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -900);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(120);
    }
    const before = await getScrollState(page);
    expect(before.scrollTop + before.clientHeight).toBeLessThan(before.scrollHeight - 300);

    for (let step = 1; step <= 10; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, session.accessToken, seeded.roomId, {
        msgtype: 'm.text',
        body: `* streamed chunk ${step}`,
        'm.new_content': { msgtype: 'm.text', body: `streamed chunk ${step}` },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: seeded.replyIds[seeded.replyIds.length - 1],
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1_500);

    const after = await getScrollState(page);
    // The reader must stay where they were (allow small measurement drift).
    expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThan(200);
    expect(after.scrollTop + after.clientHeight).toBeLessThan(after.scrollHeight - 300);
    await expect(page.getByRole('button', { name: 'Jump to Latest' })).toBeVisible();
  });

  test('Jump to Latest reaches the newest reply while older history is still loading', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // More replies than one THREAD_BATCH_SIZE (200), so the thread model
    // still has older history to page in after the open.
    const replyCount = 260;
    const seeded = await seedThread(homeserver, session.accessToken, { replyCount });

    // Older-history pages never complete: a slow mobile network, where
    // each backward /relations page took ~350ms and a long thread needed
    // many of them. Jumping to the newest reply must not depend on them.
    const heldOlderPages: Route[] = [];
    await page.route('**/_matrix/client/**/relations/**', async (route) => {
      if (new URL(route.request().url()).searchParams.has('from')) {
        heldOlderPages.push(route);
        return;
      }
      await route.continue();
    });

    try {
      await loginWithPassword(page, { homeserver, username, password });
      await openThread(page, seeded);

      const timeline = page.locator('[data-message-item]').first();
      await timeline.hover();
      for (let i = 0; i < 12; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await page.mouse.wheel(0, -900);
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(120);
      }
      const before = await getScrollState(page);
      expect(before.scrollTop + before.clientHeight).toBeLessThan(before.scrollHeight - 300);
      expect(heldOlderPages.length).toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Jump to Latest' }).click();

      const lastReply = page.getByText(`Virt reply ${replyCount}`, { exact: true }).last();
      await expect(lastReply).toBeInViewport({ timeout: 5_000 });
      await expect(page.getByRole('button', { name: 'Jump to Latest' })).toHaveCount(0);
      await expect
        .poll(async () => {
          const after = await getScrollState(page);
          return after.scrollHeight - after.scrollTop - after.clientHeight;
        })
        .toBeLessThan(48);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await Promise.all(heldOlderPages.map((route) => route.abort().catch(() => undefined)));
    }
  });

  // Guards two things: (1) the user-facing CONTRACT — older thread
  // history is reachable by real wheel scrolling alone, never
  // requiring a "Load Older Messages" chip tap; (2) the
  // scroll-driven auto-pagination TRIGGER itself, asserted directly
  // through the threadAutoPaginateBackFired probe counter. The
  // counter assertion is what makes this red when the trigger is
  // removed: on this fast local network the CONTENT assertion alone
  // is also satisfiable by background band backfill (verified — it
  // passed with the trigger stashed), which is exactly the loader
  // that lags on the slow mobile networks where the task #125 jag
  // manifests.
  test('scrolling up auto-loads older replies without the Load Older chip (task #125)', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // More replies than one THREAD_BATCH_SIZE (200) so the open leaves
    // older history unloaded — the shape where mobile scroll-up used
    // to hard-stop at the loaded-window edge (task #125).
    const seeded = await seedThread(homeserver, session.accessToken, { replyCount: 460 });

    await loginWithPassword(page, { homeserver, username, password });

    // Slow down the MATRIX API (not the app assets) before opening the
    // thread. On an unthrottled local network the background band
    // backfill loads the ENTIRE thread during the open-settle phase
    // (verified via gate logging: count reached full before
    // openPinPending cleared), leaving the trigger nothing to do — the
    // exact opposite of the slow mobile networks where the task #125
    // jag manifests. Per-request latency on /_matrix/* keeps older
    // history unloaded when the walk starts, so the trigger has a real
    // edge to fire against. (A CDP global throttle is unusable here:
    // page.goto re-navigates and the vite dev bundle cannot boot
    // through it.)
    await page.route('**/_matrix/**', async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 1_200);
      });
      await route.continue();
    });

    await openThread(page, seeded);

    // Target: a reply OLDER than the initially-loaded window (open
    // loads the latest THREAD_BATCH_SIZE=200 → replies 261-460), so
    // reaching it proves back-pagination extended the window. NOT
    // reply 1: the oldest ~30 replies of a large thread are
    // unreachable through the current loader (pre-existing gap,
    // documented at the quote-click test below and filed as task
    // #126) — this test proves the auto-trigger, not that gap.
    const targetReplyId = seeded.replyIds[99]; // "Virt reply 100"

    // Sanity: the target must NOT be rendered at open. If it is, the
    // fixture no longer leaves history unloaded and this test can no
    // longer prove auto-pagination — fail loudly rather than pass
    // vacuously.
    expect(await page.locator(`[data-message-id="${targetReplyId}"]`).count()).toBe(0);

    // Real wheel input, never touching the "Load Older Messages" chip.
    // Bounded walk: each iteration wheels up; auto-pagination must
    // extend the window. Exit condition is the MINIMUM mounted reply
    // number rather than an exact-target mount: prepend anchor
    // restores can hop the viewport across any single row between
    // polls, but the minimum mounted number reaching the target depth
    // proves the loaded window extended ~160+ rows past the initial
    // batch — impossible without back-pagination.
    const timeline = page.locator('[data-message-item]').first();
    await timeline.hover();
    const targetReplyNumber = 100;
    const minMountedReplyNumber = () =>
      page.evaluate(() => {
        let min = Number.POSITIVE_INFINITY;
        document.querySelectorAll('[data-message-item]').forEach((row) => {
          const match = /Virt reply (\d+)\b/.exec(row.textContent ?? '');
          if (match) min = Math.min(min, Number(match[1]));
        });
        return Number.isFinite(min) ? min : undefined;
      });
    let deepest: number | undefined;
    for (let i = 0; i < 160; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -1400);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(120);
      // eslint-disable-next-line no-await-in-loop
      const min = await minMountedReplyNumber();
      if (min !== undefined && (deepest === undefined || min < deepest)) deepest = min;
      if (deepest !== undefined && deepest <= targetReplyNumber) break;
    }
    expect(deepest).toBeLessThanOrEqual(targetReplyNumber);

    // The trigger itself must have fired at least once during the
    // walk — this is the assertion that distinguishes trigger-driven
    // loading from band-backfill-driven loading and goes red if the
    // auto-pagination effect is removed.
    const autoFires = await page.evaluate(() => {
      const w = window as Window & {
        __MINDROOM_CACHE_PROBE__?: { snapshot: () => Record<string, number> };
      };
      return w.__MINDROOM_CACHE_PROBE__?.snapshot()?.threadAutoPaginateBackFired ?? 0;
    });
    expect(autoFires).toBeGreaterThanOrEqual(1);
  });

  test('clicking a reply quote targeting a loaded-but-unmounted row scrolls to it', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // Target a reply that is distant (far outside the mounted window) but
    // within the slice the thread-open pipeline actually loads. The oldest
    // ~30 replies of a large thread are not loaded by the current pipeline
    // (pre-existing loader gap, unrelated to virtualization).
    const QUOTE_TARGET_INDEX = 59;
    const seeded = await seedThread(homeserver, session.accessToken, {
      quoteTargetIndex: QUOTE_TARGET_INDEX,
    });

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);
    await loadAllOlderThreadMessages(page);

    // Jump back to the bottom where the quoting message lives.
    const jump = page.getByRole('button', { name: 'Jump to Latest' });
    if ((await jump.count()) > 0) {
      await jump.first().click();
      await page.waitForTimeout(1_000);
    }

    // The last reply quotes reply #1; its quote block links the early event
    // (the message's own controls also carry data-event-id, so match the
    // quoted id specifically).
    const quote = page
      .locator(
        `[data-message-id="${seeded.replyIds[REPLY_COUNT - 1]}"] [data-event-id="${
          seeded.replyIds[QUOTE_TARGET_INDEX]
        }"]`
      )
      .first();
    await expect(quote).toBeVisible({ timeout: 15_000 });
    await quote.click();

    const earlyRow = page.locator(`[data-message-id="${seeded.replyIds[QUOTE_TARGET_INDEX]}"]`);
    await expect(earlyRow).toBeVisible({ timeout: 10_000 });
    await expect(earlyRow).toBeInViewport({ timeout: 10_000 });
  });

  test('expand-all applies to rows mounted after scrolling', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // Reset the account settings to their defaults.
    await setAccountData(
      homeserver,
      session.accessToken,
      session.userId,
      'io.mindroom.settings',
      {}
    );
    const seeded = await seedThread(homeserver, session.accessToken, { longBodies: true });

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);

    // Sanity: long bodies start collapsed.
    await expect(page.locator('[data-message-item] [aria-expanded="false"]').first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: '[+all]' }).click();
    await page.waitForTimeout(500);
    expect(await page.locator('[data-message-item] [aria-expanded="false"]').count()).toBe(0);

    // Scroll far up so fresh rows mount outside the original window.
    const timeline = page.locator('[data-message-item]').first();
    await timeline.hover();
    for (let i = 0; i < 25; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -1600);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(800);

    expect(await page.locator('[data-message-item]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-message-item] [aria-expanded="false"]').count()).toBe(0);
  });

  test('manual Show full message survives scrolling out of and back into the virtual window', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // Reset the account settings to their defaults.
    await setAccountData(
      homeserver,
      session.accessToken,
      session.userId,
      'io.mindroom.settings',
      {}
    );
    const seeded = await seedThread(homeserver, session.accessToken, {
      longBodies: true,
      replyCount: 80,
    });
    const targetId = seeded.replyIds[seeded.replyIds.length - 1];

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);

    const target = page.locator(`[data-message-id="${targetId}"]`);
    await expect(target).toBeVisible({ timeout: 15_000 });
    await target.getByRole('button', { name: 'Show full message' }).click();
    await expect(target.locator('div[aria-expanded="true"]')).toBeVisible();

    const timeline = page.locator('[data-message-item]').first();
    await timeline.hover();
    for (let i = 0; i < 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      if ((await target.count()) === 0) break;
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -1600);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(80);
    }
    await expect(target).toHaveCount(0);

    await page.getByRole('button', { name: 'Jump to Latest' }).click();
    await expect(target).toBeVisible({ timeout: 15_000 });
    await expect(target.locator('div[aria-expanded="true"]')).toBeVisible();
    await expect(target.getByRole('button', { name: 'Show less' })).toBeVisible();
  });

  test('an above-viewport expansion cannot reverse an upward desktop ride', async ({ page }) => {
    const DRIFT_TOLERANCE_PX = 48;
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // Reset the account settings to their defaults.
    await setAccountData(
      homeserver,
      session.accessToken,
      session.userId,
      'io.mindroom.settings',
      {}
    );
    const seeded = await seedThread(homeserver, session.accessToken, {
      longBodies: true,
      longBodyLines: 100,
      replyCount: 80,
    });

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);

    const timeline = page.locator('[data-message-item]').first();
    await timeline.hover();
    await page.mouse.wheel(0, -500);

    let aboveViewportId: string | undefined;
    await expect
      .poll(async () => {
        aboveViewportId = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>('[data-message-item]');
          let scroller: HTMLElement | null = row?.parentElement ?? null;
          while (scroller) {
            const { overflowY } = window.getComputedStyle(scroller);
            if (
              (overflowY === 'auto' || overflowY === 'scroll') &&
              scroller.scrollHeight > scroller.clientHeight
            ) {
              break;
            }
            scroller = scroller.parentElement;
          }
          if (!scroller) return undefined;
          const viewportTop = scroller.getBoundingClientRect().top;
          return (
            Array.from(document.querySelectorAll<HTMLElement>('[data-message-item]'))
              .filter(
                (candidate) =>
                  candidate.getBoundingClientRect().bottom <= viewportTop - 120 &&
                  candidate.querySelector('[aria-label="Show full message"]')
              )
              .at(0)
              ?.getAttribute('data-message-id') ?? undefined
          );
        });
        return aboveViewportId;
      })
      .toBeTruthy();
    const targetId = aboveViewportId as string;
    const target = page.locator(`[data-message-id="${targetId}"]`);
    const targetHeightBefore = await target.evaluate(
      (element: HTMLElement) => element.getBoundingClientRect().height
    );

    // Wait until a fully visible anchor is available without putting a time
    // limit on the later backward-scroll state that this test must exercise.
    await expect
      .poll(() =>
        page.evaluate((expandedTargetId) => {
          const row = document.querySelector<HTMLElement>('[data-message-item]');
          let scroller: HTMLElement | null = row?.parentElement ?? null;
          while (scroller) {
            const { overflowY } = window.getComputedStyle(scroller);
            if (
              (overflowY === 'auto' || overflowY === 'scroll') &&
              scroller.scrollHeight > scroller.clientHeight
            ) {
              break;
            }
            scroller = scroller.parentElement;
          }
          if (!scroller) return undefined;
          const viewport = scroller.getBoundingClientRect();
          const anchor = Array.from(
            document.querySelectorAll<HTMLElement>('[data-message-item]')
          ).find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return (
              candidate.getAttribute('data-message-id') !== expandedTargetId &&
              rect.top >= viewport.top + 8 &&
              rect.bottom <= viewport.bottom - 8
            );
          });
          const anchorId = anchor?.getAttribute('data-message-id');
          return anchor && anchorId ? anchorId : undefined;
        }, targetId)
      )
      .toBeTruthy();

    // Capture the baseline from the next real upward scroll event and start
    // the keepalive inside that event. This leaves no protocol round-trip in
    // which virtual-core's 150ms backward direction could expire on slow CI.
    await page.evaluate((expandedTargetId) => {
      type RideBaseline = {
        anchorId: string;
        anchorTop: number;
        scrollTop: number;
        keepaliveIntervalId: number;
      };
      const rideWindow = window as typeof window & {
        __mindroomRideBaseline?: Promise<RideBaseline | undefined>;
      };
      const row = document.querySelector<HTMLElement>('[data-message-item]');
      let scroller: HTMLElement | null = row?.parentElement ?? null;
      while (scroller) {
        const { overflowY } = window.getComputedStyle(scroller);
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          scroller.scrollHeight > scroller.clientHeight
        ) {
          break;
        }
        scroller = scroller.parentElement;
      }
      if (!scroller) throw new Error('thread scroller not found');

      rideWindow.__mindroomRideBaseline = new Promise((resolve) => {
        let timeoutId = 0;
        const capture = () => {
          window.clearTimeout(timeoutId);
          const viewport = scroller.getBoundingClientRect();
          const anchor = Array.from(
            document.querySelectorAll<HTMLElement>('[data-message-item]')
          ).find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return (
              candidate.getAttribute('data-message-id') !== expandedTargetId &&
              rect.top >= viewport.top + 8 &&
              rect.bottom <= viewport.bottom - 8
            );
          });
          const anchorId = anchor?.getAttribute('data-message-id');
          if (!anchor || !anchorId) {
            resolve(undefined);
            return;
          }
          const keepaliveIntervalId = window.setInterval(
            () => scroller.dispatchEvent(new Event('scroll')),
            30
          );
          resolve({
            anchorId,
            anchorTop: anchor.getBoundingClientRect().top,
            scrollTop: scroller.scrollTop,
            keepaliveIntervalId,
          });
        };
        timeoutId = window.setTimeout(() => {
          scroller.removeEventListener('scroll', capture);
          resolve(undefined);
        }, 5_000);
        scroller.addEventListener('scroll', capture, { once: true });
      });
    }, targetId);

    await page.mouse.wheel(0, -80);
    const before = await page.evaluate(async () => {
      type RideBaseline = {
        anchorId: string;
        anchorTop: number;
        scrollTop: number;
        keepaliveIntervalId: number;
      };
      const rideWindow = window as typeof window & {
        __mindroomRideBaseline?: Promise<RideBaseline | undefined>;
      };
      const baseline = await rideWindow.__mindroomRideBaseline;
      delete rideWindow.__mindroomRideBaseline;
      return baseline;
    });
    expect(before).toBeTruthy();
    if (!before) throw new Error('upward ride baseline was not captured');
    const rideKeepalive = before.keepaliveIntervalId;

    const readAnchorTop = () =>
      page.evaluate((anchorId) => {
        const anchor = document.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(anchorId)}"]`
        );
        return anchor?.getBoundingClientRect().top;
      }, before.anchorId);
    const readLedgerMargin = () =>
      page
        .locator('[data-thread-count]')
        .evaluate((inner: HTMLElement) => Number.parseFloat(inner.style.marginTop) || 0);
    let measuredAnchorTop: number | undefined;

    try {
      await target
        .locator('[aria-label="Show full message"]')
        .evaluate((button: HTMLElement) => button.click());
      await expect(target.locator('div[aria-expanded="true"]')).toBeAttached();
      await expect
        .poll(() =>
          target.evaluate((element: HTMLElement) => element.getBoundingClientRect().height)
        )
        .toBeGreaterThan(targetHeightBefore + 500);
      // The DOM expansion precedes ResizeObserver delivery. Wait until the
      // real measurement has entered the ledger before sampling a frame.
      await expect.poll(readLedgerMargin).toBeLessThan(-500);

      const duringRide = await getScrollState(page);
      const duringRideAnchorTop = await readAnchorTop();
      // The upward input may continue decreasing scrollTop. It must never be
      // replaced mid-ride by the expanding row's large positive correction.
      expect(duringRide.scrollTop).toBeLessThanOrEqual(before.scrollTop + DRIFT_TOLERANCE_PX);
      const scrollDelta = duringRide.scrollTop - before.scrollTop;
      const visualDrift = (duringRideAnchorTop ?? Infinity) - before.anchorTop + scrollDelta;
      expect(Math.abs(visualDrift)).toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);
      measuredAnchorTop = duringRideAnchorTop;
    } finally {
      await page.evaluate((intervalId) => window.clearInterval(intervalId), rideKeepalive);
    }

    // At true rest the healthy ledger intentionally changes scrollTop while
    // atomically removing its margin. The user-visible anchor must not move.
    await expect.poll(readLedgerMargin).toBe(0);
    await expect
      .poll(async () => Math.abs(((await readAnchorTop()) ?? Infinity) - (measuredAnchorTop ?? 0)))
      .toBeLessThanOrEqual(DRIFT_TOLERANCE_PX);
  });
});
