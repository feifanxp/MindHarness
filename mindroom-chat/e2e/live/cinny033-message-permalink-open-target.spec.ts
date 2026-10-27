import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createThreadFixture,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

const getMatrixToRoomEvent = (roomId: string, eventId: string) =>
  `https://matrix.to/#/${roomId}/${eventId}`;

test.describe('live cinny-033 message permalink open target', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('clicking a Matrix permalink inside a message opens the target thread instead of the room overview', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const targetFixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `CINNY-033 Target ${stamp}`,
      topic: 'Live fixture for message permalink thread navigation.',
      rootBody: `CINNY-033 root ${stamp}`,
      replyBody: `CINNY-033 reply ${stamp}`,
      txnPrefix: 'cinny-033',
    });
    const sourceRoomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `CINNY-033 Source ${stamp}`,
      topic: 'Room containing Matrix permalinks to the target room.',
    });

    const permalink = getMatrixToRoomEvent(targetFixture.roomId, targetFixture.rootId);
    await sendRoomMessage(
      homeserver,
      session.accessToken,
      sourceRoomId,
      {
        msgtype: 'm.text',
        body: `Open this target thread: ${permalink}`,
        format: 'org.matrix.custom.html',
        formatted_body: `Open this target thread: <a href="${permalink}">${permalink}</a>`,
      },
      'cinny-033'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: targetFixture.roomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    await seedRoomOverviewState({
      page,
      roomId: sourceRoomId,
      userId: session.userId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });

    await page.goto(`/home/${encodeURIComponent(sourceRoomId)}`);
    await expect(page.getByText(`Open this target thread: ${permalink}`)).toBeVisible({
      timeout: 30_000,
    });

    const permalinkAnchor = page.locator(`a[href="${permalink}"]`).first();
    await expect(permalinkAnchor).toBeVisible({ timeout: 30_000 });
    await permalinkAnchor.click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('threadId'), {
        timeout: 10_000,
        message: 'Permalink click should resolve to the target thread view',
      })
      .toBe(targetFixture.rootId);

    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(targetFixture.rootBody).last()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(targetFixture.replyBody).last()).toBeVisible({ timeout: 10_000 });

    await expectNoUnexpectedBrowserDiagnostics(
      diagnostics,
      'cinny-033-message-permalink-open-target'
    );
  });
});
