import { expect, type Locator, type Page, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const TITLE_TEXT_LIMIT = 160;
const TITLE_TEXT_TRUNCATION_BUFFER = 16;
const LONG_UNBREAKABLE_TOKEN = `!cvldK8hdCINNY111${'X'.repeat(32)}$xvtGEulnL0J`;

type ViewportFixture = {
  height: number;
  label: string;
  width: number;
};

const VIEWPORTS: ViewportFixture[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile-wide', width: 480, height: 800 },
  { label: 'mobile-narrow', width: 360, height: 640 },
];

const getCompactRoomView = (page: Page) => page.locator('[data-compact-room-view="true"]');

const expectTitleTextWraps = async (titleText: Locator) => {
  const titleMetrics = await titleText.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize);
    const lineHeight =
      style.lineHeight === 'normal' ? fontSize * 1.2 : Number.parseFloat(style.lineHeight);

    return {
      height: rect.height,
      lineHeight,
    };
  });

  expect(titleMetrics.height).toBeGreaterThan(titleMetrics.lineHeight * 1.5);
};

const prepareThreadFixture = async () => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const stamp = Date.now();
  const rootBody = `CINNY-111 ${LONG_UNBREAKABLE_TOKEN} ${stamp}`;
  expect(rootBody.length).toBeLessThan(TITLE_TEXT_LIMIT - TITLE_TEXT_TRUNCATION_BUFFER);

  const fixture = await createThreadFixture(homeserver, session.accessToken, {
    name: `CINNY-111 Overflow ${stamp}`,
    topic: 'Regression fixture for compact thread list overflow.',
    rootBody,
    replyBody: `CINNY-111 reply ${stamp}`,
    txnPrefix: 'cinny-111',
  });

  return {
    fixture,
    homeserver,
    password,
    session,
    username,
  };
};

test.describe('live cinny111 compact thread list overflow', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  for (const viewport of VIEWPORTS) {
    test(`does not horizontally scroll at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.slow();

      const diagnostics = attachBrowserDiagnostics(page);
      const { fixture, homeserver, password, session, username } = await prepareThreadFixture();

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginWithPassword(page, { homeserver, username, password });
      await expectLoggedInShellStable(page);
      await seedRoomOverviewState({
        page,
        roomId: fixture.roomId,
        userId: session.userId,
        viewMode: 'compact',
        filterState: createDefaultThreadFilterState(),
      });

      await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);

      const compactRoomView = getCompactRoomView(page);
      await expect(compactRoomView).toBeVisible({ timeout: 30_000 });
      const threadCard = page.locator(`[data-thread-root-id="${fixture.rootId}"]`);
      await expect(threadCard).toContainText(LONG_UNBREAKABLE_TOKEN, { timeout: 30_000 });
      const titleText = threadCard
        .locator('[title]')
        .filter({ hasText: LONG_UNBREAKABLE_TOKEN })
        .first();
      await expect(titleText).toBeVisible();

      await expect
        .poll(
          () =>
            compactRoomView
              .evaluate((element) => ({
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
              }))
              .then(({ clientWidth, scrollWidth }) => scrollWidth - clientWidth),
          {
            message: 'compact room view should not expose horizontal overflow',
          }
        )
        .toBeLessThanOrEqual(0);

      const size = await compactRoomView.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);

      const scrollLeft = await compactRoomView.evaluate((element) => {
        element.scrollLeft = 9999;
        return element.scrollLeft;
      });
      expect(scrollLeft).toBe(0);

      if (viewport.width <= 480) {
        await expectTitleTextWraps(titleText);
      }

      await page.screenshot({
        path: test.info().outputPath(`${viewport.width}-after.png`),
        fullPage: true,
      });

      await expectNoUnexpectedBrowserDiagnostics(
        diagnostics,
        `cinny111-thread-list-overflow-${viewport.label}`
      );
    });
  }
});
