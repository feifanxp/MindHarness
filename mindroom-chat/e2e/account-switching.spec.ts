import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from './env';
import {
  expectActiveStoredUsername,
  removeInactiveStoredUsername,
  switchToStoredUsername,
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

test('restores per-account routes, survives reload, and removes an inactive account', async ({
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

  await page.goto('/home/create/');
  await expect(page).toHaveURL(/\/home\/create\/?$/);

  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/addAccount=1/);

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

  await switchToStoredUsername(page, primaryCredentials.username);
  await expect(page).toHaveURL(/\/home\/create\/?$/);

  await switchToStoredUsername(page, secondaryCredentials.username);
  await expect(page).toHaveURL(/\/home\/join\/?$/);

  await page.reload();
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, secondaryCredentials.username);
  await expect(page).toHaveURL(/\/home\/join\/?$/);

  await removeInactiveStoredUsername(page, primaryCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(2);
  await expectActiveStoredUsername(page, secondaryCredentials.username);

  await expectNoUnexpectedBrowserDiagnostics(
    diagnostics,
    'account switching / reload / inactive removal'
  );
});
