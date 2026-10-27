import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { loginToMatrix, setAccountData } from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live shell i18n', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('sidebar, thread navigation, and command palette follow the app language', async ({
    page,
  }) => {
    test.slow();

    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    await setAccountData(homeserver, session.accessToken, session.userId, 'io.mindroom.settings', {
      simpleMode: false,
    });
    await loginWithPassword(page, { homeserver, username, password });

    // English defaults
    await expect(page.getByText('Threads').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open command palette' })).toBeVisible();

    // German
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'de'));
    await page.reload();
    await expect(page.getByText('Threads').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Startseite').first()).toBeVisible();
    await expect(page.getByText('Nachrichtensuche')).toBeVisible();
    const dePaletteButton = page.getByRole('button', { name: 'Befehlspalette öffnen' }).first();
    await expect(dePaletteButton).toBeVisible();
    await dePaletteButton.click();
    await expect(page.getByRole('combobox', { name: 'Befehlspalette', exact: true })).toBeVisible();
    await expect(page.getByText('Aktionen').first()).toBeVisible();
    await expect(page.getByText('Einstellungen öffnen').first()).toBeVisible();
    // Settle time so fonts/paint finish before the documentation screenshot.
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'ui-audit/i18n-shell-de-palette.png' });
    await page.keyboard.press('Escape');

    // Dutch
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'nl'));
    await page.reload();
    await expect(page.getByText('Threads').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Berichten zoeken')).toBeVisible();
    const nlPaletteButton = page.getByRole('button', { name: 'Commandopalet openen' }).first();
    await expect(nlPaletteButton).toBeVisible();
    await nlPaletteButton.click();
    await expect(page.getByRole('combobox', { name: 'Commandopalet', exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'ui-audit/i18n-shell-nl-palette.png' });
  });
});
