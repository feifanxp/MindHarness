import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from './env';
import { loginWithPassword } from './helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from './helpers/matrix';

test('Up-arrow edits the latest own thread reply and preserves normal room editing', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials(), 'Requires disposable Matrix credentials.');
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const fixture = await createThreadFixture(homeserver, session.accessToken, {
    name: 'Thread keyboard editing',
    topic: 'Up-arrow regression',
    rootBody: 'Thread root for keyboard editing',
    replyBody: 'Reply to edit with Up-arrow',
  });
  const roomBody = 'Newer message outside the thread';
  await sendRoomMessage(homeserver, session.accessToken, fixture.roomId, {
    msgtype: 'm.text',
    body: roomBody,
  });
  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({
    page,
    roomId: fixture.roomId,
    userId: session.userId,
    viewMode: 'threaded',
  });
  const roomPath = `/home/${encodeURIComponent(fixture.roomId)}`;
  await page.goto(`${roomPath}?threadId=${encodeURIComponent(fixture.rootId)}`);
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
  const composer = page.locator('[data-editable-name="RoomInput"]');
  const editBox = page.locator('[contenteditable="true"]').filter({ hasText: fixture.replyBody });

  await composer.fill('Unsent draft');
  await composer.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(composer).toHaveText('Unsent draft');

  // fill('') selects the draft by script and presses Delete at once. While the client
  // catches up after a cached start, Chromium can deliver the key before the
  // selectionchange event, so the editor deletes at its old caret; clear until empty.
  await expect(async () => {
    await composer.fill('');
    await expect(composer.locator('[data-slate-string]')).toHaveCount(0, { timeout: 1_000 });
  }).toPass();
  await composer.press('ArrowUp');
  await expect(editBox).toBeFocused();
  await editBox.fill('Updated thread reply');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Updated thread reply/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  await page.goto(roomPath);
  await expect(page.getByText(roomBody, { exact: true })).toBeVisible();
  await composer.press('ArrowUp');
  const roomEditBox = page.locator('[contenteditable="true"]').filter({ hasText: roomBody });
  await expect(roomEditBox).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(roomBody, { exact: true })).toBeVisible();
});
