import { expect, test, type Page, type Route } from '@playwright/test';
import {
  buildLoginPath,
  getHomeserver,
  getPrimaryCredentials,
  hasPrimaryCredentials,
} from '../env';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  setAccountData,
} from '../helpers/matrix';

type ViewMode = 'compact' | 'threaded' | 'classic';
type SortMode = {
  sortBy: 'natural' | 'lastReply';
  sortDirection: 'asc' | 'desc';
};

const loginUntilRoomIsVisible = async (
  page: Page,
  homeserver: string,
  username: string,
  password: string,
  roomName: string
) => {
  await page.goto(buildLoginPath(homeserver, false));
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('link', { name: roomName }).first()).toBeVisible({
    timeout: 30_000,
  });
};

test.describe('live room view-mode thread-list load ownership', () => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');

  test('does not multiply SDK thread-list initialization while view and sort modes change', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    await setAccountData(homeserver, accessToken, userId, 'io.mindroom.settings', {
      simpleMode: false,
    });
    const stamp = Date.now();
    const roomName = `View mode load ownership ${stamp}`;
    const fixture = await createThreadFixture(homeserver, accessToken, {
      name: roomName,
      topic: 'Live fixture for thread-list load ownership across room view changes.',
      rootBody: `View mode load root ${stamp}`,
      replyBody: `View mode load reply ${stamp}`,
      txnPrefix: 'view-mode-load-ownership',
    });

    let releaseThreadRequests: (() => void) | undefined;
    const threadRequestsReleased = new Promise<void>((resolve) => {
      releaseThreadRequests = resolve;
    });
    let threadRequestCount = 0;
    const threadListPath = `/rooms/${encodeURIComponent(fixture.roomId)}/threads`;
    const holdFixtureThreadRequests = async (route: Route) => {
      if (!new URL(route.request().url()).pathname.includes(threadListPath)) {
        await route.continue();
        return;
      }
      threadRequestCount += 1;
      await threadRequestsReleased;
      await route.continue();
    };
    await page.route(/\/_matrix\/client\/.*\/rooms\/.*\/threads\b/, holdFixtureThreadRequests);

    await loginUntilRoomIsVisible(page, homeserver, username, password, roomName);
    const naturalSort: SortMode = { sortBy: 'natural', sortDirection: 'desc' };
    const newestSort: SortMode = { sortBy: 'lastReply', sortDirection: 'desc' };
    const oldestSort: SortMode = { sortBy: 'lastReply', sortDirection: 'asc' };
    const setViewAndSort = async (viewMode: ViewMode, sortMode: SortMode) => {
      await seedRoomOverviewState({
        page,
        roomId: fixture.roomId,
        userId,
        viewMode,
        filterState: {
          ...createDefaultThreadFilterState(),
          ...sortMode,
        },
      });
    };

    await setViewAndSort('threaded', naturalSort);
    await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
    await expect(page.locator('[data-room-thread-overview="true"]')).toBeVisible({
      timeout: 30_000,
    });

    try {
      await setViewAndSort('compact', newestSort);
      await expect.poll(() => threadRequestCount, { timeout: 30_000 }).toBe(2);

      const transitions: Array<[ViewMode, SortMode]> = [
        ['threaded', oldestSort],
        ['compact', naturalSort],
        ['classic', newestSort],
        ['compact', oldestSort],
        ['threaded', naturalSort],
        ['compact', newestSort],
      ];
      for (const [viewMode, sortMode] of transitions) {
        await setViewAndSort(viewMode, sortMode);
        if (viewMode === 'classic') {
          await expect(page.locator('[data-room-thread-overview="true"]')).toHaveCount(0);
        } else {
          await expect(
            page.locator(
              `[data-room-thread-overview="true"] [data-view-mode="${viewMode}"][aria-pressed="true"]`
            )
          ).toBeVisible();
        }
      }

      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          })
      );
      await page.evaluate(async () => {
        await fetch(`/runtime-config.js?view-mode-effect-barrier=${Date.now()}`, {
          cache: 'no-store',
        });
      });
      expect(threadRequestCount).toBe(2);
    } finally {
      releaseThreadRequests?.();
    }

    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'view-mode-thread-list-load-ownership');
  });
});
