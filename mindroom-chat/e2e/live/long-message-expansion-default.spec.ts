import { expect, test, type Locator, type Page } from '@playwright/test';
import { getRequiredEnv, hasRequiredEnv } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createPrivateRoom,
  loginToMatrix,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';
import {
  analyzeRide,
  FULL_RIDE_BUDGETS,
  installScrollWriteProbe,
  runFlickRide,
  startRideSampling,
  stopRideSampling,
} from '../helpers/rideRecorder';

const hasDeployedFixtureEnv =
  hasRequiredEnv('E2E_DEPLOYED_BASE_URL') &&
  hasRequiredEnv('E2E_DEPLOYED_HOMESERVER') &&
  hasRequiredEnv('E2E_DEPLOYED_USERNAME') &&
  hasRequiredEnv('E2E_DEPLOYED_PASSWORD');

const DEPLOYED_BASE_URL = process.env.E2E_DEPLOYED_BASE_URL ?? 'http://127.0.0.1:28090';
const SETTINGS_EVENT_TYPE = 'io.mindroom.settings';
const REPLY_COUNT = 180;
const ANCHOR_DRIFT_BUDGET_PX = 2;
const MIN_RIDE_TRAVEL_PX = 5_000;

type SeededThread = {
  roomId: string;
  rootId: string;
};

type AnchorSnapshot = {
  fullyVisible: boolean;
  messageId: string;
  top: number;
};

const seedLongThread = async (homeserver: string, accessToken: string): Promise<SeededThread> => {
  const roomId = await createPrivateRoom(homeserver, accessToken, {
    name: `Long-message default live proof ${Date.now()}`,
  });
  const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Long-message expansion default live proof',
  });

  for (let reply = 1; reply <= REPLY_COUNT; reply += 1) {
    const lines = Array.from(
      { length: 34 },
      (_value, line) =>
        `Live proof line ${
          line + 1
        } of reply ${reply}: enough text to exercise real row measurement.`
    ).join('\n');
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body: `Long live reply ${reply}\n${lines}`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }

  return { roomId, rootId };
};

const readScrollState = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-message-item]');
    let candidate = row?.parentElement ?? null;
    while (candidate) {
      const { overflowY } = window.getComputedStyle(candidate);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        candidate.scrollHeight > candidate.clientHeight
      ) {
        break;
      }
      candidate = candidate.parentElement;
    }
    if (!candidate) throw new Error('Thread scroller not found.');
    const scroller = candidate;
    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      mountedRows: scroller.querySelectorAll('[data-message-item]').length,
      viewportCenter: {
        x: scroller.getBoundingClientRect().left + scroller.clientWidth / 2,
        y: scroller.getBoundingClientRect().top + scroller.clientHeight / 2,
      },
    };
  });

// `locator.click()` first scrolls its target into view, and for a control in the thread's sticky
// header that moves the timeline; a real pointer click at the control does not.
const pointerClick = async (control: Locator) => {
  const box = await control.boundingBox();
  if (!box) throw new Error('Control is not rendered.');
  await control.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

const readVisibleAnchor = (page: Page): Promise<AnchorSnapshot | undefined> =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-message-item]');
    let candidate = row?.parentElement ?? null;
    while (candidate) {
      const { overflowY } = window.getComputedStyle(candidate);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        candidate.scrollHeight > candidate.clientHeight
      ) {
        break;
      }
      candidate = candidate.parentElement;
    }
    if (!candidate) throw new Error('Thread scroller not found.');
    const scroller = candidate;
    const viewport = scroller.getBoundingClientRect();
    // The reader's view starts below the sticky headers, as in the app's anchor.
    const readerTop =
      viewport.top +
      (Number.parseFloat(window.getComputedStyle(scroller).scrollPaddingTop) || 0) +
      8;
    const visibleRows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-item]'))
      .map((row) => {
        const rect = row.getBoundingClientRect();
        const visibleTop = Math.max(rect.top, readerTop);
        const visibleBottom = Math.min(rect.bottom, viewport.bottom - 8);
        return {
          row,
          rect,
          visibleTop,
          visibleBottom,
          fullyVisible: rect.top >= readerTop && rect.bottom <= viewport.bottom - 8,
        };
      })
      .filter(({ visibleTop, visibleBottom }) => visibleTop < visibleBottom);
    const fullyVisibleRows = visibleRows.filter(({ fullyVisible }) => fullyVisible);
    const anchorCandidates = fullyVisibleRows.length > 0 ? fullyVisibleRows : visibleRows;
    const center = viewport.top + viewport.height / 2;
    const anchor = anchorCandidates.sort((a, b) => {
      const aCenter = a.fullyVisible
        ? (a.rect.top + a.rect.bottom) / 2
        : (a.visibleTop + a.visibleBottom) / 2;
      const bCenter = b.fullyVisible
        ? (b.rect.top + b.rect.bottom) / 2
        : (b.visibleTop + b.visibleBottom) / 2;
      return Math.abs(aCenter - center) - Math.abs(bCenter - center);
    })[0];
    const messageId = anchor?.row.dataset.messageId;
    return anchor && messageId
      ? {
          fullyVisible: anchor.fullyVisible,
          messageId,
          top: anchor.fullyVisible ? anchor.rect.top : anchor.visibleTop,
        }
      : undefined;
  });

const readAnchorTop = (page: Page, messageId: string): Promise<number | undefined> =>
  page.evaluate((targetMessageId) => {
    const anchor = document.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(targetMessageId)}"]`
    );
    return anchor?.getBoundingClientRect().top;
  }, messageId);

test.use({ baseURL: DEPLOYED_BASE_URL });

test.describe('live long-message expand-all and collapse-all', () => {
  test.skip(
    !hasDeployedFixtureEnv,
    'Deployed preview, Matrix homeserver, and live account credentials are required.'
  );
  test.setTimeout(600_000);

  test('long messages fold by default, the toggles keep the anchor, and expanded scrolling stays stable', async ({
    page,
  }, testInfo) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getRequiredEnv('E2E_DEPLOYED_HOMESERVER');
    const username = getRequiredEnv('E2E_DEPLOYED_USERNAME');
    const password = getRequiredEnv('E2E_DEPLOYED_PASSWORD');
    const session = await loginToMatrix(homeserver, username, password);
    await setAccountData(homeserver, session.accessToken, session.userId, SETTINGS_EVENT_TYPE, {
      simpleMode: false,
    });
    const seeded = await seedLongThread(homeserver, session.accessToken);

    await installScrollWriteProbe(page);
    // The sync status bar sits above the app and comes and goes with the sync,
    // moving the whole app; hide it so anchor measurements compare one layout.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '[data-testid="client-sync-status"] { display: none !important; }';
        document.head.append(style);
      });
    });
    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(
      `/home/${encodeURIComponent(seeded.roomId)}?threadId=${encodeURIComponent(seeded.rootId)}`
    );
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await page.waitForTimeout(3_000);

    const showMore = page.locator('[aria-label="Show full message"]');
    const showLess = page.locator('[aria-label="Show less"]');
    await expect(showMore.first()).toBeVisible();
    const foldedShowMoreCount = await showMore.count();
    expect(foldedShowMoreCount).toBeGreaterThan(1);
    await expect(showLess).toHaveCount(0);

    const foldedScreenshot = testInfo.outputPath('folded-by-default.png');
    await page.screenshot({ path: foldedScreenshot });
    await testInfo.attach('folded-by-default.png', {
      path: foldedScreenshot,
      contentType: 'image/png',
    });

    await page.locator('[data-message-item]').first().hover();
    for (let step = 0; step < 10; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -600);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(500);
    const beforeToggleState = await readScrollState(page);
    expect(beforeToggleState.scrollTop).toBeGreaterThan(1_000);
    expect(
      beforeToggleState.scrollHeight - beforeToggleState.clientHeight - beforeToggleState.scrollTop
    ).toBeGreaterThan(1_000);
    const anchorBeforeToggle = await readVisibleAnchor(page);
    expect(anchorBeforeToggle).toBeTruthy();
    if (!anchorBeforeToggle) throw new Error('No visible anchor before expanding all.');

    const expandAll = page.getByRole('button', { name: '[+all]', exact: true });
    const collapseAll = page.getByRole('button', { name: '[-all]', exact: true });
    await pointerClick(expandAll);
    await expect(collapseAll).toBeVisible();
    await expect.poll(() => showMore.count()).toBe(0);
    await expect.poll(() => showLess.count()).toBeGreaterThan(1);
    await expect.poll(() => readAnchorTop(page, anchorBeforeToggle.messageId)).not.toBeUndefined();

    const anchorTopAfterToggle = await readAnchorTop(page, anchorBeforeToggle.messageId);
    expect(anchorTopAfterToggle).toBeDefined();
    const toggleAnchorDriftPx = Math.abs((anchorTopAfterToggle as number) - anchorBeforeToggle.top);
    expect(toggleAnchorDriftPx).toBeLessThan(ANCHOR_DRIFT_BUDGET_PX);

    const expandedScreenshot = testInfo.outputPath('expanded-all.png');
    await page.screenshot({ path: expandedScreenshot });
    await testInfo.attach('expanded-all.png', {
      path: expandedScreenshot,
      contentType: 'image/png',
    });

    await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('[data-message-item]');
      let candidate = row?.parentElement ?? null;
      while (candidate) {
        const { overflowY } = window.getComputedStyle(candidate);
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          candidate.scrollHeight > candidate.clientHeight
        ) {
          break;
        }
        candidate = candidate.parentElement;
      }
      if (!candidate) throw new Error('Thread scroller not found.');
      candidate.scrollTop = candidate.scrollHeight;
      const probeWindow = window as Window & {
        __appScrollWrites?: { kind: string; value: number; t: number }[];
      };
      probeWindow.__appScrollWrites = [];
    });
    await page.waitForTimeout(800);

    const { viewportCenter } = await readScrollState(page);
    await page.mouse.move(viewportCenter.x, viewportCenter.y);
    const realWheelStart = await readScrollState(page);
    await startRideSampling(page, { measureVisualTravel: true });
    for (let step = 0; step < 45; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -700);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(35);
    }
    await page.waitForTimeout(300);
    const realWheelEnd = await readScrollState(page);
    const wheelSampling = await stopRideSampling(page);
    const wheelIntervals = wheelSampling.frames.slice(1);
    const trackedWheelIntervals = wheelIntervals.filter((frame) =>
      Number.isFinite(frame.visualDeltaPx)
    );
    const realWheelTravelPx = trackedWheelIntervals.reduce(
      (sum, frame) => sum + (frame.visualDeltaPx ?? 0),
      0
    );
    await testInfo.attach('expanded-real-wheel-measurements.json', {
      body: Buffer.from(
        JSON.stringify({ realWheelStart, realWheelEnd, realWheelTravelPx, wheelSampling }, null, 2)
      ),
      contentType: 'application/json',
    });
    expect(wheelSampling.frames.length).toBeGreaterThan(FULL_RIDE_BUDGETS.minFrames);
    expect(trackedWheelIntervals).toHaveLength(wheelIntervals.length);
    expect(realWheelTravelPx).toBeGreaterThan(MIN_RIDE_TRAVEL_PX);
    await expect(showMore).toHaveCount(0);
    await expect(showLess.first()).toBeVisible();

    const wheelScreenshot = testInfo.outputPath('expanded-real-wheel-ride.png');
    await page.screenshot({ path: wheelScreenshot });
    await testInfo.attach('expanded-real-wheel-ride.png', {
      path: wheelScreenshot,
      contentType: 'image/png',
    });

    await page.waitForTimeout(1_000);
    const ride = await runFlickRide(page, {
      teleportTo: Number.MAX_SAFE_INTEGER,
      teleportSettleMs: 800,
      cycles: Array.from({ length: 18 }, () => ({
        steps: 8,
        stepPx: 90,
        pauseMs: 80,
      })),
    });
    const rideAnalysis = analyzeRide(ride, FULL_RIDE_BUDGETS);
    const deterministicTravelPx =
      (ride.frames[0]?.scrollTop ?? 0) - (ride.frames[ride.frames.length - 1]?.scrollTop ?? 0);

    const report = {
      productionBaseUrl: DEPLOYED_BASE_URL,
      homeserver,
      roomId: seeded.roomId,
      rootId: seeded.rootId,
      replyCount: REPLY_COUNT,
      foldedShowMoreCount,
      toggleAnchorDriftPx,
      expandedMountedRows: realWheelEnd.mountedRows,
      realWheelTravelPx,
      deterministicTravelPx,
      scroll: {
        sampledFrames: ride.frames.length,
        maxGapPx: rideAnalysis.maxGapPx,
        maxJumpPx: rideAnalysis.maxJumpPx,
        totalJumpPx: rideAnalysis.totalJumpPx,
        appScrollWrites: ride.appWrites.length,
        violations: rideAnalysis.violations,
      },
    };
    expect(ride.error).toBeUndefined();
    expect(deterministicTravelPx).toBeGreaterThan(10_000);
    expect(ride.frames.length).toBeGreaterThan(FULL_RIDE_BUDGETS.minFrames);
    expect(rideAnalysis.violations).toEqual([]);
    expect(ride.appWrites).toEqual([]);

    const anchorBeforeCollapse = await readVisibleAnchor(page);
    if (!anchorBeforeCollapse) throw new Error('No tall-message anchor before collapsing all.');
    expect(anchorBeforeCollapse.fullyVisible).toBe(false);

    await pointerClick(collapseAll);
    await expect(expandAll).toBeVisible();
    await expect.poll(() => showMore.count()).toBeGreaterThan(1);
    const anchorTopAfterCollapse = await readAnchorTop(page, anchorBeforeCollapse.messageId);
    expect(anchorTopAfterCollapse).toBeDefined();
    const collapseAnchorDriftPx = Math.abs(
      (anchorTopAfterCollapse as number) - anchorBeforeCollapse.top
    );
    expect(collapseAnchorDriftPx).toBeLessThan(ANCHOR_DRIFT_BUDGET_PX);

    const collapsedScreenshot = testInfo.outputPath('folded-from-tall-message.png');
    await page.screenshot({ path: collapsedScreenshot });
    await testInfo.attach('folded-from-tall-message.png', {
      path: collapsedScreenshot,
      contentType: 'image/png',
    });

    Object.assign(report, { collapseAnchorDriftPx });
    // eslint-disable-next-line no-console
    console.log(`LONG-MESSAGE-DEFAULT-LIVE ${JSON.stringify(report)}`);
    await testInfo.attach('long-message-default-live.json', {
      body: JSON.stringify({ report, ride }, null, 2),
      contentType: 'application/json',
    });
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'long-message expand-all live');
  });
});
