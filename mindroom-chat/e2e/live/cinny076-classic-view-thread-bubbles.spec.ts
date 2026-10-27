import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  setAccountData,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live cinny-076 classic room timeline', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('switching to classic mode removes MindRoom thread bubbles and shows replies', async ({
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
    const fixture = await createThreadFixture(homeserver, accessToken, {
      name: `CINNY-076 Classic ${stamp}`,
      topic: 'Live fixture for classic room timeline thread-bubble suppression.',
      rootBody: `Classic thread root ${stamp}`,
      replyBody: `Classic thread reply ${stamp}`,
      txnPrefix: 'cinny-076',
    });

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId,
      viewMode: 'threaded',
    });

    await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
    const roomTimeline = page.getByTestId('room-virtual-inner');

    await expect(roomTimeline.getByText(fixture.rootBody, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-room-thread-overview="true"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(`[data-thread-root-id="${fixture.rootId}"]`)).toBeVisible({
      timeout: 30_000,
    });

    await page
      .getByRole('group', { name: 'Room view mode' })
      .getByRole('button', { name: 'Classic', exact: true })
      .click();

    await expect(page.locator('[data-room-thread-overview="true"]')).toHaveCount(0);
    await expect(page.locator(`[data-thread-root-id="${fixture.rootId}"]`)).toHaveCount(0);
    await expect(roomTimeline.getByText(fixture.replyBody, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-076-classic-thread-bubbles');
  });
});
