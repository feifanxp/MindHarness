import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';

const REPLY = 'The tooltip names this button.';

const openRoute = (page: Page, url: string) =>
  page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

// Point at a button as a mouse would, without Playwright scrolling it into view.
const pointAt = async (page: Page, button: Locator) => {
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
};

// Icon-only buttons name themselves in a folds tooltip, as the room header's do,
// and screen readers get the same name.
test('icon buttons in the composer and the message toolbar show their names', async ({ page }) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const restoreSettings = await setFullInterfaceModeForSession(homeserver, session);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: 'Tooltips',
  }).catch(async (error) => {
    await restoreSettings();
    throw error;
  });
  try {
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Which buttons explain themselves?',
    });
    await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: REPLY,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });

    await loginWithPassword(page, { homeserver, ...credentials });
    await openRoute(
      page,
      `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`
    );
    const reply = page.getByText(REPLY, { exact: true });
    await expect(reply).toBeVisible();
    const tooltip = page.getByRole('tooltip');

    const footer = page.locator('[data-room-footer]');
    for (const name of ['Attach files', 'Formatting', 'Emoji', 'Send message']) {
      const button = footer.getByRole('button', { name, exact: true });
      // eslint-disable-next-line no-await-in-loop
      await pointAt(page, button);
      // eslint-disable-next-line no-await-in-loop
      await expect(tooltip).toHaveText(name);
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.move(0, 0);
      // eslint-disable-next-line no-await-in-loop
      await expect(tooltip).toHaveCount(0);
    }
    const microphone = footer.getByRole('button', { name: 'Record voice message' });
    await pointAt(page, microphone);
    await expect(tooltip).toHaveText('Record voice message');
    await page.mouse.move(0, 0);

    // The toolbar shows while the pointer rests on the message. The room header
    // has a More Options button too, so look inside the toolbar Reply sits in.
    await reply.hover();
    const toolbar = page.getByRole('button', { name: 'Reply', exact: true }).locator('..');
    for (const name of ['Add Reaction', 'Reply', 'More Options']) {
      const button = toolbar.getByRole('button', { name, exact: true });
      // eslint-disable-next-line no-await-in-loop
      await pointAt(page, button);
      // eslint-disable-next-line no-await-in-loop
      await expect(tooltip).toHaveText(name);
    }
  } finally {
    await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
      method: 'POST',
      accessToken: session.accessToken,
      body: '{}',
    }).catch(() => undefined);
    await restoreSettings();
  }
});
