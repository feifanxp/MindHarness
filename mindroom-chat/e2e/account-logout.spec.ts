import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from './env';
import { expectActiveStoredUsername, logoutActiveAccount } from './helpers/accounts';
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

test('falls back to the remaining account on logout, then returns to auth after final logout', async ({
  page,
}) => {
  const secondaryCredentials = getSecondaryCredentials();
  test.slow();
  test.skip(
    !secondaryCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run the multi-account e2e flow.'
  );

  const diagnostics = attachBrowserDiagnostics(page);
  const homeserver = getHomeserver();
  const primaryCredentials = getPrimaryCredentials();

  await Promise.all([
    setFullInterfaceModeForCredentials(homeserver, primaryCredentials),
    setFullInterfaceModeForCredentials(homeserver, secondaryCredentials),
  ]);

  await loginWithPassword(page, {
    homeserver,
    username: primaryCredentials.username,
    password: primaryCredentials.password,
  });
  await expectLoggedInShellStable(page);
  await expectActiveStoredUsername(page, primaryCredentials.username);

  await page.getByRole('button', { name: 'Add account' }).click();

  await loginWithPassword(page, {
    homeserver,
    username: secondaryCredentials.username,
    password: secondaryCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, secondaryCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(3);

  await logoutActiveAccount(page);
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, primaryCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(2);

  await logoutActiveAccount(page);
  await expect(page.locator('input[name="serverInput"]')).toBeVisible();
  await expect(page.getByText('Login')).toBeVisible();
  await expect(page).toHaveURL(/\/login\/.+/);

  await expectNoUnexpectedBrowserDiagnostics(
    diagnostics,
    'active logout fallback and final logout'
  );
});
