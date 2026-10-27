import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createPrivateRoom,
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

// PR #98 deliberately removed last-thread auto-restore on room entry:
// re-entering a room lands on the room view. (Startup root-path restore is a
// different behavior, covered by cinny001b.) This spec now pins the removal.
test.describe('live CINNY-001 room re-entry does not auto-restore the last thread', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('re-entering a room stays on the room view instead of the last open thread', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomWithThread = await createThreadFixture(homeserver, session.accessToken, {
      name: `CINNY-001 Thread ${stamp}`,
      topic: 'Live fixture for restoring the last open thread on room entry.',
      rootBody: `CINNY-001 root ${stamp}`,
      replyBody: `CINNY-001 reply ${stamp}`,
      txnPrefix: 'cinny-001',
    });
    const fallbackRoomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `CINNY-001 Fallback ${stamp}`,
      topic: 'Secondary room used while leaving and re-entering the thread room.',
    });
    const fallbackRoomBody = `CINNY-001 fallback ${stamp}`;
    const fallbackRoomTopic = 'Secondary room used while leaving and re-entering the thread room.';

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      fallbackRoomId,
      {
        msgtype: 'm.text',
        body: fallbackRoomBody,
      },
      'cinny-001'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: roomWithThread.roomId,
      userId: session.userId,
      viewMode: 'threaded',
    });
    await seedRoomOverviewState({
      page,
      roomId: fallbackRoomId,
      userId: session.userId,
      viewMode: 'threaded',
    });

    await page.goto(
      `/home/${encodeURIComponent(roomWithThread.roomId)}?threadId=${encodeURIComponent(
        roomWithThread.rootId
      )}`
    );

    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(roomWithThread.replyBody)).toBeVisible({ timeout: 30_000 });

    await page.goto(`/home/${encodeURIComponent(fallbackRoomId)}`);
    await expect(page.getByRole('button', { name: fallbackRoomTopic })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto(`/home/${encodeURIComponent(roomWithThread.roomId)}`);

    // Give a delayed restore every chance to misbehave, then assert the room
    // view held: no threadId crept back into the URL and no Thread View pane.
    await expect(page.getByText(roomWithThread.rootBody).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    expect(new URL(page.url()).searchParams.get('threadId')).toBeNull();
    await expect(page.locator('[data-thread-context-banner]')).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-001-last-open-thread');
  });
});
