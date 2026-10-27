import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

const composerPlaceholder = (page: Page) =>
  page.locator('[data-editable-name="RoomInput"] [data-slate-placeholder="true"]');

const openRoomComposer = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({
    timeout: 30_000,
  });
};

test.describe('live composer i18n', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('composer placeholder and voice aria-label follow the app language', async ({ page }) => {
    test.slow();

    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Composer i18n ${Date.now()}`,
      topic: 'Live fixture for composer translation checks.',
    });
    await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'composer i18n fixture',
    });

    await loginWithPassword(page, { homeserver, username, password });

    await openRoomComposer(page, roomId);
    await expect(composerPlaceholder(page)).toHaveText('Send a message...');
    await expect(page.getByRole('button', { name: 'Record voice message' })).toBeVisible();
    // Settle time so fonts/paint finish before the documentation screenshot.
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'ui-audit/i18n-composer-en.png' });

    const cases = [
      ['de', 'Nachricht senden...', 'Sprachnachricht aufnehmen'],
      ['nl', 'Stuur een bericht...', 'Spraakbericht opnemen'],
    ] as const;

    for (const [lng, expectedPlaceholder, voiceLabel] of cases) {
      await page.evaluate((language) => localStorage.setItem('i18nextLng', language), lng);
      await page.reload();
      await openRoomComposer(page, roomId);
      await expect(composerPlaceholder(page)).toHaveText(expectedPlaceholder);
      await expect(page.getByRole('button', { name: voiceLabel })).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `ui-audit/i18n-composer-${lng}.png` });
    }
  });
});
