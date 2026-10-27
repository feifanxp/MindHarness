import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createHiddenOverviewFilterState,
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
  setDirectAccountData,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live cinny-034 direct room timeline', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('a direct message between people shows the classic timeline over a stored compact mode', async ({
    page,
  }) => {
    test.slow();

    const secondaryCredentials = getSecondaryCredentials();
    test.skip(
      !secondaryCredentials,
      'E2E_SECOND_USERNAME / E2E_SECOND_PASSWORD not set for direct-message live tests'
    );

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const primarySession = await loginToMatrix(homeserver, username, password);
    const secondarySession = await loginToMatrix(
      homeserver,
      secondaryCredentials!.username,
      secondaryCredentials!.password
    );
    const stamp = Date.now();
    const directRoomId = await createPrivateRoom(homeserver, primarySession.accessToken, {
      name: `CINNY-034 Direct ${stamp}`,
      topic: 'Live fixture for direct-room timeline behavior.',
      preset: 'trusted_private_chat',
      invite: [secondarySession.userId],
      isDirect: true,
    });
    const dmBody = `CINNY-034 direct message ${stamp}`;

    await joinRoom(homeserver, secondarySession.accessToken, directRoomId);
    await setDirectAccountData(
      homeserver,
      primarySession.accessToken,
      primarySession.userId,
      secondarySession.userId,
      directRoomId
    );
    await setDirectAccountData(
      homeserver,
      secondarySession.accessToken,
      secondarySession.userId,
      primarySession.userId,
      directRoomId
    );
    const dmEventId = await sendRoomMessage(
      homeserver,
      primarySession.accessToken,
      directRoomId,
      {
        msgtype: 'm.text',
        body: dmBody,
      },
      'cinny-034'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: directRoomId,
      userId: primarySession.userId,
      viewMode: 'compact',
      filterState: createHiddenOverviewFilterState(),
    });

    await page.goto(`/direct/${encodeURIComponent(directRoomId)}`);

    await expect(page.locator(`[data-message-id="${dmEventId}"]`)).toContainText(dmBody, {
      timeout: 30_000,
    });
    await expect(page.locator('[data-compact-room-view="true"]')).toHaveCount(0);
    await expect(page.locator('[data-room-thread-overview="true"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Open thread: CINNY-034 direct/ })).toHaveCount(
      0
    );

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-034-direct-room-classic');
  });
});
