import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import { createThreadFixture, loginToMatrix } from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live CINNY-001b root restore', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('visiting the root path restores the last active room thread for a signed-in session', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomWithThread = await createThreadFixture(homeserver, session.accessToken, {
      name: `CINNY-001b Startup ${stamp}`,
      topic: 'Live fixture for restoring the last active room/thread path from root.',
      rootBody: `CINNY-001b root ${stamp}`,
      replyBody: `CINNY-001b reply ${stamp}`,
      txnPrefix: 'cinny-001b',
    });

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);

    await page.goto(
      `/home/${encodeURIComponent(roomWithThread.roomId)}?threadId=${encodeURIComponent(
        roomWithThread.rootId
      )}`
    );

    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(roomWithThread.replyBody)).toBeVisible({ timeout: 30_000 });

    await page.goto('/');

    await expect
      .poll(
        () => ({
          pathname: new URL(page.url()).pathname,
          threadId: new URL(page.url()).searchParams.get('threadId'),
        }),
        {
          timeout: 15_000,
          message: 'Root visits should restore the saved home room/thread path',
        }
      )
      .toEqual({
        pathname: `/home/${encodeURIComponent(roomWithThread.roomId)}`,
        threadId: roomWithThread.rootId,
      });

    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(roomWithThread.replyBody)).toBeVisible({ timeout: 10_000 });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-001b-root-restore');
  });
});
