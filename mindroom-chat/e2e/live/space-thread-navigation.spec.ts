import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createDefaultThreadFilterState,
  createPrivateSpace,
  createThreadFixture,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  setAccountData,
} from '../helpers/matrix';

for (const simpleMode of [true, false]) {
  test(`thread navigation retains the selected space with simple mode ${simpleMode}`, async ({
    page,
  }, testInfo) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    test.skip(
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
      'Local fixture only'
    );
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const savedSettings = await matrixFetch<Record<string, unknown>>(
      homeserver,
      `/user/${encodeURIComponent(session.userId)}/account_data/io.mindroom.settings`,
      { accessToken: session.accessToken }
    ).catch((error: Error) => {
      if (error.message.startsWith('Matrix API 404')) return {};
      throw error;
    });
    try {
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        {
          ...savedSettings,
          simpleMode,
        }
      );
      const fixture = await createThreadFixture(homeserver, session.accessToken, {
        name: 'Space navigation room',
        topic: 'Local selected-space thread navigation regression fixture',
        rootBody: 'Keep this thread in its space',
        replyBody: 'Thread navigation regression fixture',
        txnPrefix: 'space-thread-navigation',
      });
      const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
        name: 'Thread navigation space',
        topic: 'Local selected-space thread navigation regression fixture',
      });
      await addRoomToSpace(homeserver, session.accessToken, spaceId, fixture.roomId);

      await loginWithPassword(page, { homeserver, ...credentials });
      await seedRoomOverviewState({
        page,
        roomId: fixture.roomId,
        userId: session.userId,
        viewMode: 'compact',
        filterState: createDefaultThreadFilterState(),
      });
      const roomPath = `/${encodeURIComponent(spaceId)}/${encodeURIComponent(fixture.roomId)}`;
      await page.goto(roomPath);
      const panel = page.getByTestId('resizable-page-nav');
      const spaceHeader = panel
        .locator('header')
        .getByText('Thread navigation space', { exact: true });
      const roomLink = panel.getByRole('link', { name: 'Space navigation room', exact: true });
      const assertSpace = async () => {
        await expect(spaceHeader).toBeVisible();
        await expect(roomLink).toHaveAttribute('href', roomPath);
        expect(new URL(page.url()).pathname).toBe(roomPath);
        expect(new URL(page.url()).searchParams.get('threadId')).toBe(fixture.rootId);
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible();
        await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
      };

      await page
        .getByTestId('thread-nav-list')
        .getByRole('button', { name: /^Open thread: Keep this thread in its space/ })
        .click();
      await assertSpace();

      await page.goto(roomPath);
      await page.locator(`[data-thread-root-id="${fixture.rootId}"]`).click();
      await assertSpace();

      await page.goto(roomPath);
      const recentlyOpened = page.locator('button[data-category-id="mindroom|recently-opened"]');
      if ((await recentlyOpened.getAttribute('aria-expanded')) !== 'true') {
        await recentlyOpened.click();
      }
      await page
        .getByTestId('recently-opened-nav-list')
        .getByRole('button', { name: /^Open thread: Keep this thread in its space/ })
        .click();
      await assertSpace();
      await page.screenshot({ path: testInfo.outputPath('space-retained.png') });
    } finally {
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        savedSettings
      );
    }
  });
}
