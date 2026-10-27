import { expect, test } from '@playwright/test';
import {
  getHomeserver,
  getPrimaryCredentials,
  getSecondaryCredentials,
  getThirdCredentials,
} from './env';
import { expectActiveStoredUsername, switchToStoredUsername } from './helpers/accounts';
import {
  accountRailButtonSelector,
  expectLoggedInShellStable,
  loginWithPassword,
  setFullInterfaceModeForCredentials,
} from './helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from './helpers/browserDiagnostics';

test('supports three stored accounts with route restore across switches', async ({ page }) => {
  const secondaryCredentials = getSecondaryCredentials();
  const thirdCredentials = getThirdCredentials();
  test.slow();
  test.skip(
    !secondaryCredentials || !thirdCredentials,
    'Set second and third credentials to run the three-account e2e flow.'
  );

  const diagnostics = attachBrowserDiagnostics(page);
  const homeserver = getHomeserver();
  const primaryCredentials = getPrimaryCredentials();

  await Promise.all([
    setFullInterfaceModeForCredentials(homeserver, primaryCredentials),
    setFullInterfaceModeForCredentials(homeserver, secondaryCredentials),
    setFullInterfaceModeForCredentials(homeserver, thirdCredentials),
  ]);

  await loginWithPassword(page, {
    homeserver,
    username: primaryCredentials.username,
    password: primaryCredentials.password,
  });
  await expectLoggedInShellStable(page);
  await expectActiveStoredUsername(page, primaryCredentials.username);

  await page.goto('/home/create/');
  await expect(page).toHaveURL(/\/home\/create\/?$/);

  await page.getByRole('button', { name: 'Add account' }).click();
  await loginWithPassword(page, {
    homeserver,
    username: secondaryCredentials.username,
    password: secondaryCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, secondaryCredentials.username);

  await page.goto('/home/join/');
  await expect(page).toHaveURL(/\/home\/join\/?$/);

  await page.getByRole('button', { name: 'Add account' }).click();
  await loginWithPassword(page, {
    homeserver,
    username: thirdCredentials.username,
    password: thirdCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, thirdCredentials.username);

  await page.goto('/home/search/');
  await expect(page).toHaveURL(/\/home\/search\/?$/);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(4);

  await switchToStoredUsername(page, primaryCredentials.username);
  await expect(page).toHaveURL(/\/home\/create\/?$/);

  await switchToStoredUsername(page, secondaryCredentials.username);
  await expect(page).toHaveURL(/\/home\/join\/?$/);

  await switchToStoredUsername(page, thirdCredentials.username);
  await expect(page).toHaveURL(/\/home\/search\/?$/);

  await page.reload();
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, thirdCredentials.username);
  await expect(page).toHaveURL(/\/home\/search\/?$/);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(4);

  await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'three-account add/switch/reload');
});
