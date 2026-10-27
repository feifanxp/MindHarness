import { expect, test } from '@playwright/test';
import { getDeactivationCredentials, getHomeserver, getPrimaryCredentials } from './env';
import {
  deactivateActiveAccount,
  expectActiveStoredUsername,
  readSessionStore,
} from './helpers/accounts';
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

test('deactivating the active account removes only that account and leaves the other signed in', async ({
  page,
}) => {
  const deactivationCredentials = getDeactivationCredentials();
  test.slow();
  test.skip(
    !deactivationCredentials,
    'Set E2E_DEACTIVATE_USERNAME and E2E_DEACTIVATE_PASSWORD to run the deactivation e2e flow.'
  );

  const diagnostics = attachBrowserDiagnostics(page);
  const homeserver = getHomeserver();
  const primaryCredentials = getPrimaryCredentials();

  await Promise.all([
    setFullInterfaceModeForCredentials(homeserver, primaryCredentials),
    setFullInterfaceModeForCredentials(homeserver, deactivationCredentials),
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
    username: deactivationCredentials.username,
    password: deactivationCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, deactivationCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(3);

  await deactivateActiveAccount(page, deactivationCredentials.password);

  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, primaryCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(2);

  await expect
    .poll(async () => {
      const sessionStore = await readSessionStore(page);
      return sessionStore.sessions.map((session) => session.userId).sort();
    })
    .toEqual([expect.stringMatching(new RegExp(`^@${primaryCredentials.username}:`))]);

  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  await page.locator('input[name="usernameInput"]').fill(deactivationCredentials.username);
  await page.locator('input[name="passwordInput"]').fill(deactivationCredentials.password);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByText('This account has been deactivated.')).toBeVisible();

  await expectNoUnexpectedBrowserDiagnostics(
    diagnostics,
    'active account deactivation with fallback account'
  );
});
