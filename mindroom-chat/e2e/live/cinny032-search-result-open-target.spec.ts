import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import { createThreadFixture, loginToMatrix, seedRoomOverviewState } from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live cinny-032 search result open target', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('opening a threaded search result lands in the target thread, not the room overview', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const threadRootBody = `CINNY-032 root ${stamp}`;
    const threadReplyBody = `CINNY-032 reply ${stamp}`;
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `CINNY-032 Search ${stamp}`,
      topic: 'Live fixture for search-result thread navigation.',
      fillerBody: `CINNY-032 filler ${stamp}`,
      rootBody: threadRootBody,
      replyBody: threadReplyBody,
      txnPrefix: 'cinny-032',
    });

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId: session.userId,
    });

    const searchParams = new URLSearchParams({
      term: threadReplyBody,
      rooms: fixture.roomId,
    });

    await page.goto(`/home/search/?${searchParams.toString()}`);

    const openButton = page.locator(
      `[data-event-id="${fixture.replyId}"][data-thread-root-id="${fixture.rootId}"]`
    );
    await expect(openButton).toBeVisible({ timeout: 30_000 });
    await openButton.click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('threadId'), {
        timeout: 10_000,
        message: 'Search result should open the target thread view',
      })
      .toBe(fixture.rootId);

    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(threadReplyBody)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('No threads match current filters.')).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-032-search-result-open-target');
  });
});
