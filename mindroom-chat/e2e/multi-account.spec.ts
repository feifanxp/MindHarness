import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from './env';
import {
  accountRailButtonSelector,
  expectLoggedInShellStable,
  loginWithPassword,
  setFullInterfaceModeForCredentials,
} from './helpers/auth';

test('adds a second account without leaving the add-account flow', async ({ page }) => {
  const secondaryCredentials = getSecondaryCredentials();
  test.slow();
  test.skip(
    !secondaryCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run the multi-account e2e flow.'
  );

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

  await expect(page.locator(accountRailButtonSelector)).toHaveCount(2);

  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/addAccount=1/);
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);

  await loginWithPassword(page, {
    homeserver,
    username: secondaryCredentials.username,
    password: secondaryCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });

  await expect(page.locator(accountRailButtonSelector)).toHaveCount(3);
});
