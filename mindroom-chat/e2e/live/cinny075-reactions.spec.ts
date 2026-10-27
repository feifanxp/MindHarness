import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendReaction,
  sendRoomMessage,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live message reactions', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('renders Matrix m.reaction annotations on normal room messages', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-075 Reactions ${stamp}`,
      topic: 'Live fixture for message reaction rendering.',
    });
    const messageBody = `Reaction target ${stamp}`;
    const reactionKey = '👍';
    const messageId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: messageBody,
      },
      'cinny-075'
    );
    await sendReaction(homeserver, accessToken, roomId, messageId, reactionKey, 'cinny-075');

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });

    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const messageItem = page.locator(`[data-message-id="${messageId}"]`);
    await expect(messageItem).toBeVisible({ timeout: 30_000 });
    await expect(messageItem.getByText(messageBody)).toBeVisible();
    await expect(messageItem.getByRole('button', { name: `${reactionKey} 1` })).toBeVisible({
      timeout: 30_000,
    });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-075-reactions');
  });

  test('renders Matrix m.reaction annotations inside thread view', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-075 Thread Reactions ${stamp}`,
      topic: 'Live fixture for thread message reaction rendering.',
    });
    const rootBody = `Reaction thread root ${stamp}`;
    const replyBody = `Reaction thread reply ${stamp}`;
    const reactionKey = '✅';
    const rootId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: rootBody,
      },
      'cinny-075'
    );
    const replyId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: replyBody,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      },
      'cinny-075'
    );
    await sendReaction(homeserver, accessToken, roomId, replyId, reactionKey, 'cinny-075');

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });

    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    const replyItem = page.locator(`[data-message-id="${replyId}"]`);
    await expect(replyItem).toBeVisible({ timeout: 30_000 });
    await expect(replyItem.getByText(replyBody)).toBeVisible();
    await expect(replyItem.getByRole('button', { name: `${reactionKey} 1` })).toBeVisible({
      timeout: 30_000,
    });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-075-thread-reactions');
  });
});
