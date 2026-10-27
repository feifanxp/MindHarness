import { expect, type Page, test } from '@playwright/test';
import {
  DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT,
  RECENTLY_OPENED_PANEL_RESERVED_HEIGHT,
} from '../../src/app/mindroom/recent-threads/recentlyOpenedPanelHeight';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  addRoomToSpace,
  createDefaultThreadFilterState,
  createPrivateSpace,
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  setAccountData,
  type ThreadFixture,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

type ViewportFixture = {
  height: number;
  label: string;
  width: number;
};

const VIEWPORTS: ViewportFixture[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'desktop-short', width: 1024, height: 480 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile-wide', width: 480, height: 800 },
  { label: 'mobile-narrow', width: 360, height: 640 },
];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getThreadButton = (page: Page, rootBody: string) =>
  page.getByTestId('thread-nav-list').getByRole('button', {
    name: new RegExp(`Open thread: ${escapeRegex(rootBody)}`, 'i'),
  });

const getRecentlyOpenedThreadButton = (page: Page, rootBody: string) =>
  page.getByTestId('recently-opened-nav-list').getByRole('button', {
    name: new RegExp(`Open thread: ${escapeRegex(rootBody)}`, 'i'),
  });

const getRoomsCategoryButton = (page: Page) => page.locator('button[data-category-id="home|room"]');

const getThreadsCategoryButton = (page: Page) =>
  page.locator('button[data-category-id="mindroom|threads"]');

const getRecentlyOpenedCategoryButton = (page: Page) =>
  page.locator('button[data-category-id="mindroom|recently-opened"]');

const getRecentlyOpenedResizeHandle = (page: Page) =>
  page.getByTestId('recently-opened-resize-handle');

const seedRecentThreadsState = async ({
  page,
  userId,
  fixtures,
  openedAtBase = Date.now(),
}: {
  page: Page;
  userId: string;
  fixtures: ThreadFixture[];
  openedAtBase?: number;
}) => {
  const entries = fixtures.map((fixture, index) => ({
    roomId: fixture.roomId,
    threadId: fixture.rootId,
    openedAt: openedAtBase - index,
    summaryText: fixture.rootBody,
  }));

  await page.evaluate(
    ({ nextUserId, nextEntries }) => {
      localStorage.setItem(
        `recentThreads:${nextUserId}`,
        JSON.stringify({ v: 1, entries: nextEntries })
      );
    },
    { nextUserId: userId, nextEntries: entries }
  );
};

const seedExistingNavState = async (page: Page, userId: string) => {
  await page.evaluate((nextUserId) => {
    localStorage.setItem(
      `closedNavCategories${nextUserId}`,
      JSON.stringify(['test|unrelated-category'])
    );
  }, userId);
};

const waitForThreadEntries = async (page: Page, fixtures: ThreadFixture[]) => {
  await Promise.all(
    fixtures.map((fixture) =>
      expect(getThreadButton(page, fixture.rootBody)).toBeVisible({ timeout: 30_000 })
    )
  );
};

const waitForRecentlyOpenedEntries = async (page: Page, fixtures: ThreadFixture[]) => {
  await Promise.all(
    fixtures.map((fixture) =>
      expect(getRecentlyOpenedThreadButton(page, fixture.rootBody)).toBeVisible({
        timeout: 30_000,
      })
    )
  );
};

type RecentlyOpenedRowMetrics = {
  dividerContent: string;
  dividerHeight: string;
  dividerLeft: string;
  dividerRight: string;
  dividerTop: string;
  height: number;
  marginTop: string;
  top: number;
};

const readRecentlyOpenedRowMetrics = async (page: Page): Promise<RecentlyOpenedRowMetrics[]> =>
  page
    .getByTestId('recently-opened-nav-list')
    .getByRole('button', { name: /^Open thread:/i })
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const row = button.parentElement;
        if (!row) throw new Error('Recently Opened row is unavailable');

        const bounds = row.getBoundingClientRect();
        const rowStyle = getComputedStyle(row);
        const dividerStyle = getComputedStyle(row, '::before');
        return {
          dividerContent: dividerStyle.content,
          dividerHeight: dividerStyle.height,
          dividerLeft: dividerStyle.left,
          dividerRight: dividerStyle.right,
          dividerTop: dividerStyle.top,
          height: bounds.height,
          marginTop: rowStyle.marginTop,
          top: bounds.top,
        };
      })
    );

const expectRecentlyOpenedRowGrouping = async (page: Page, expectedRowCount: number) => {
  await expect
    .poll(async () => (await readRecentlyOpenedRowMetrics(page)).length)
    .toBe(expectedRowCount);

  const rows = await readRecentlyOpenedRowMetrics(page);
  expect.soft(rows[0].marginTop).toBe('0px');
  expect.soft(rows[0].dividerContent).toBe('none');
  expect.soft(rows[0].height).toBe(38);

  for (let index = 1; index < rows.length; index += 1) {
    const previousRow = rows[index - 1];
    const row = rows[index];
    expect.soft(row.top - previousRow.top).toBe(42);
    expect.soft(row.top - (previousRow.top + previousRow.height)).toBe(4);
    expect.soft(row.height).toBe(38);
    expect.soft(row.marginTop).toBe('4px');
    expect.soft(row.dividerContent).toBe('""');
    expect.soft(row.dividerHeight).toBe('1px');
    expect.soft(row.dividerTop).toBe('-2px');
    expect.soft(row.dividerLeft).toBe('8px');
    expect.soft(row.dividerRight).toBe('12px');
  }

  expect(rows.filter((row) => row.dividerContent === '""')).toHaveLength(
    Math.max(0, rows.length - 1)
  );
};

const expectRecentlyOpenedAtViewportBottom = async (page: Page, viewportHeight: number) => {
  await expect
    .poll(async () => {
      const bounds = await page.getByTestId('recently-opened-nav-panel').boundingBox();
      if (!bounds) return Number.POSITIVE_INFINITY;
      return Math.abs(bounds.y + bounds.height - viewportHeight);
    })
    .toBeLessThanOrEqual(1);
};

const expectExpandedRecentlyOpenedSize = async (
  page: Page,
  viewportHeight: number,
  expectedHeight?: number
) => {
  if (expectedHeight !== undefined) {
    await expect
      .poll(async () => {
        const bounds = await page.getByTestId('recently-opened-nav-panel').boundingBox();
        if (!bounds) return Number.POSITIVE_INFINITY;
        return Math.abs(bounds.height - expectedHeight);
      })
      .toBeLessThanOrEqual(1);
  }
  await expect
    .poll(async () => {
      const bounds = await page.getByTestId('recently-opened-nav-panel').boundingBox();
      if (!bounds) return Number.POSITIVE_INFINITY;
      return bounds.height;
    })
    .toBeLessThanOrEqual(viewportHeight - RECENTLY_OPENED_PANEL_RESERVED_HEIGHT + 1);
};

const dragRecentlyOpenedPanel = async (page: Page, deltaY: number, viewportHeight: number) => {
  const panelBounds = await page.getByTestId('recently-opened-nav-panel').boundingBox();
  const handleBounds = await getRecentlyOpenedResizeHandle(page).boundingBox();
  if (!panelBounds || !handleBounds) {
    throw new Error('Recently Opened resize target is unavailable');
  }

  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2 + deltaY,
    { steps: 4 }
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      const resizedBounds = await page.getByTestId('recently-opened-nav-panel').boundingBox();
      if (!resizedBounds) return 0;
      return deltaY < 0
        ? resizedBounds.height - panelBounds.height
        : panelBounds.height - resizedBounds.height;
    })
    .toBeGreaterThan(0);
  await expectExpandedRecentlyOpenedSize(page, viewportHeight);
  return (await page.getByTestId('recently-opened-nav-panel').boundingBox())!.height;
};

const expectCollapsedRecentlyOpenedVisible = async (page: Page, viewportHeight: number) => {
  await expect
    .poll(async () => {
      const bounds = await getRecentlyOpenedCategoryButton(page).boundingBox();
      if (!bounds) return Number.POSITIVE_INFINITY;
      return Math.max(0, bounds.y + bounds.height - viewportHeight);
    })
    .toBeLessThanOrEqual(1);
};

const prepareThreadFixtures = async (threadCount: number) => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const stamp = Date.now();
  const fixtures: ThreadFixture[] = [];
  const roomNames: string[] = [];

  for (let index = 0; index < threadCount; index += 1) {
    const roomName = `CINNY-073 ${index} ${stamp}`;
    roomNames.push(roomName);
    fixtures.push(
      await createThreadFixture(homeserver, session.accessToken, {
        name: roomName,
        topic: 'Regression fixture for persistent thread navigation coverage.',
        rootBody: `CINNY-073 thread nav root ${index} ${stamp}`,
        replyBody: `CINNY-073 thread nav reply ${index} ${stamp}`,
        txnPrefix: 'cinny-073',
      })
    );
  }

  const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
    name: `CINNY-073 Space ${stamp}`,
    topic: 'Regression fixture for persistent Recently Opened placement.',
  });
  await addRoomToSpace(homeserver, session.accessToken, spaceId, fixtures[0].roomId);

  return { fixtures, homeserver, password, roomNames, session, spaceId, username };
};

test.describe('live cinny073 persistent thread navigation', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('keeps two-line rows grouped at a 42px pitch with dividers only between entries', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const { fixtures, homeserver, password, session, username } = await prepareThreadFixtures(2);
    await setAccountData(homeserver, session.accessToken, session.userId, 'io.mindroom.settings', {
      simpleMode: false,
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await seedExistingNavState(page, session.userId);
    await loginWithPassword(page, { homeserver, username, password });

    for (const fixture of fixtures) {
      await seedRoomOverviewState({
        page,
        roomId: fixture.roomId,
        userId: session.userId,
        viewMode: 'threaded',
        filterState: createDefaultThreadFilterState(),
      });
    }
    const now = Date.now();
    await page.clock.setFixedTime(now);
    await seedRecentThreadsState({
      page,
      userId: session.userId,
      fixtures,
      openedAtBase: now - 35_000,
    });

    await page.goto('/home/');
    await waitForLoggedInShell(page);
    await getRecentlyOpenedCategoryButton(page).click();
    await waitForRecentlyOpenedEntries(page, fixtures);
    await expectRecentlyOpenedRowGrouping(page, 2);

    await seedRecentThreadsState({
      page,
      userId: session.userId,
      fixtures: fixtures.slice(0, 1),
      openedAtBase: now - 35_000,
    });
    await page.reload();
    await waitForLoggedInShell(page);
    await waitForRecentlyOpenedEntries(page, fixtures.slice(0, 1));
    await expectRecentlyOpenedRowGrouping(page, 1);

    await expectNoUnexpectedBrowserDiagnostics(
      diagnostics,
      'cinny133-recently-opened-row-grouping'
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`keeps Recently Opened at the bottom at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.slow();

      const diagnostics = attachBrowserDiagnostics(page);
      const threadCount =
        viewport.label === 'mobile-narrow'
          ? 10
          : viewport.label === 'desktop'
          ? 8
          : viewport.label === 'desktop-short'
          ? 1
          : 2;
      const { fixtures, homeserver, password, roomNames, session, spaceId, username } =
        await prepareThreadFixtures(threadCount);
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        {
          simpleMode: false,
        }
      );

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await seedExistingNavState(page, session.userId);
      await loginWithPassword(page, { homeserver, username, password });

      for (const fixture of fixtures) {
        await seedRoomOverviewState({
          page,
          roomId: fixture.roomId,
          userId: session.userId,
          viewMode: 'threaded',
          filterState: createDefaultThreadFilterState(),
        });
      }
      await seedRecentThreadsState({ page, userId: session.userId, fixtures });

      await page.goto('/home/');
      await waitForLoggedInShell(page);

      const roomsCategory = page.getByTestId('room-nav-category');
      const threadsCategory = page.getByTestId('thread-nav-category');
      const recentlyOpenedCategory = page.getByTestId('recently-opened-nav-category');
      const recentlyOpenedPanel = page.getByTestId('recently-opened-nav-panel');
      await expect(roomsCategory).toBeVisible();
      await expect(threadsCategory).toBeVisible();
      await expect(recentlyOpenedCategory).toBeVisible();
      await expect(recentlyOpenedPanel).toBeVisible();
      await expect(
        page.locator('[data-testid="room-nav-category"] + [data-testid="thread-nav-category"]')
      ).toHaveCount(1);
      await expect(
        page.locator(
          '[data-testid="thread-nav-category"] + [data-testid="recently-opened-nav-panel"]'
        )
      ).toHaveCount(0);
      await expect(getRoomsCategoryButton(page)).toHaveText('Rooms');
      await expect(getThreadsCategoryButton(page)).toHaveText('Threads');
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveText('Recently Opened');
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await waitForThreadEntries(page, fixtures);
      await expect(page.getByTestId('recently-opened-nav-list')).toHaveCount(0);
      await expect(getRecentlyOpenedResizeHandle(page)).toHaveCount(0);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);
      await expectCollapsedRecentlyOpenedVisible(page, viewport.height);

      await getRecentlyOpenedCategoryButton(page).click();
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute('aria-expanded', 'true');
      await waitForRecentlyOpenedEntries(page, fixtures);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);
      await expectExpandedRecentlyOpenedSize(
        page,
        viewport.height,
        viewport.label === 'desktop' || viewport.label === 'mobile-narrow'
          ? DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT
          : undefined
      );
      let expectedExpandedHeight =
        (await recentlyOpenedPanel.boundingBox())?.height ?? DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT;
      await expect(getRecentlyOpenedResizeHandle(page)).toHaveAttribute(
        'aria-label',
        'Resize Recently Opened'
      );
      if (viewport.label === 'desktop') {
        expectedExpandedHeight = await dragRecentlyOpenedPanel(page, -80, viewport.height);
        expectedExpandedHeight = await dragRecentlyOpenedPanel(page, 40, viewport.height);
        await page.reload();
        await waitForLoggedInShell(page);
        await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute(
          'aria-expanded',
          'true'
        );
        await waitForRecentlyOpenedEntries(page, fixtures);
        await expectExpandedRecentlyOpenedSize(page, viewport.height, expectedExpandedHeight);
      }
      if (viewport.label === 'mobile-narrow') {
        const oldestThreadButton = getRecentlyOpenedThreadButton(
          page,
          fixtures[fixtures.length - 1].rootBody
        );
        await expect
          .poll(async () => (await recentlyOpenedPanel.boundingBox())?.height ?? Infinity)
          .toBeLessThanOrEqual(viewport.height - RECENTLY_OPENED_PANEL_RESERVED_HEIGHT + 1);
        await expect(oldestThreadButton).not.toBeInViewport();
        await oldestThreadButton.scrollIntoViewIfNeeded();
        await expect(oldestThreadButton).toBeInViewport();
        await expect
          .poll(() =>
            page.getByTestId('recently-opened-nav-list').evaluate((list) => list.scrollTop)
          )
          .toBeGreaterThan(0);
      }

      await getRoomsCategoryButton(page).click();
      await expect(getRoomsCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(roomsCategory.getByText(roomNames[0], { exact: true })).toHaveCount(0);
      await waitForThreadEntries(page, fixtures);
      await waitForRecentlyOpenedEntries(page, fixtures);

      await page.screenshot({
        path: test.info().outputPath(`cinny073-thread-nav-${viewport.width}.png`),
        fullPage: true,
      });

      await getThreadsCategoryButton(page).click();
      await expect(getThreadsCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('thread-nav-list')).toHaveCount(0);
      await waitForRecentlyOpenedEntries(page, fixtures);
      await getThreadsCategoryButton(page).click();
      await waitForThreadEntries(page, fixtures);

      await getRecentlyOpenedCategoryButton(page).click();
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('recently-opened-nav-list')).toHaveCount(0);
      await expect(getRecentlyOpenedResizeHandle(page)).toHaveCount(0);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);
      await expectCollapsedRecentlyOpenedVisible(page, viewport.height);

      await page.reload();
      await waitForLoggedInShell(page);
      await expect(getRoomsCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await waitForThreadEntries(page, fixtures);
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('recently-opened-nav-list')).toHaveCount(0);
      await expect(getRecentlyOpenedResizeHandle(page)).toHaveCount(0);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);
      await expectCollapsedRecentlyOpenedVisible(page, viewport.height);
      await getRecentlyOpenedCategoryButton(page).click();
      await waitForRecentlyOpenedEntries(page, fixtures);
      await expectExpandedRecentlyOpenedSize(page, viewport.height, expectedExpandedHeight);

      await getRoomsCategoryButton(page).click();
      await expect(getRoomsCategoryButton(page)).toHaveAttribute('aria-expanded', 'true');

      await page.goto('/direct/');
      await waitForLoggedInShell(page);
      await waitForRecentlyOpenedEntries(page, fixtures);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);
      await expectExpandedRecentlyOpenedSize(page, viewport.height, expectedExpandedHeight);

      await getRecentlyOpenedCategoryButton(page).click();
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('recently-opened-nav-list')).toHaveCount(0);
      await expect(getRecentlyOpenedResizeHandle(page)).toHaveCount(0);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);
      await expectCollapsedRecentlyOpenedVisible(page, viewport.height);

      await page.goto(`/${encodeURIComponent(spaceId)}/`);
      await waitForLoggedInShell(page);
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('recently-opened-nav-list')).toHaveCount(0);
      await expect(getRecentlyOpenedResizeHandle(page)).toHaveCount(0);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);
      await expectCollapsedRecentlyOpenedVisible(page, viewport.height);

      await getRecentlyOpenedCategoryButton(page).click();
      await waitForRecentlyOpenedEntries(page, fixtures);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);
      await expectExpandedRecentlyOpenedSize(page, viewport.height, expectedExpandedHeight);

      await expectNoUnexpectedBrowserDiagnostics(
        diagnostics,
        `cinny073-persistent-thread-navigation-${viewport.label}`
      );
    });
  }
});
