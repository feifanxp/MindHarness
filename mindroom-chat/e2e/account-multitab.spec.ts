import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from './env';
import {
  expectActiveStoredUsername,
  logoutActiveAccount,
  switchToStoredUsername,
} from './helpers/accounts';
import {
  expectLoggedInShellStable,
  loginWithPassword,
  setFullInterfaceModeForCredentials,
} from './helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from './helpers/browserDiagnostics';

test('propagates active-account switches across tabs without crashing', async ({
  page,
  context,
}) => {
  const secondaryCredentials = getSecondaryCredentials();
  test.slow();
  test.skip(
    !secondaryCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run multi-tab switching coverage.'
  );

  const pageOneDiagnostics = attachBrowserDiagnostics(page);
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
  await page.getByRole('button', { name: 'Add account' }).click();

  await loginWithPassword(page, {
    homeserver,
    username: secondaryCredentials.username,
    password: secondaryCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, secondaryCredentials.username);

  const pageTwo = await context.newPage();
  const pageTwoDiagnostics = attachBrowserDiagnostics(pageTwo);
  await pageTwo.goto('/home/');
  await expectLoggedInShellStable(pageTwo, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(pageTwo, secondaryCredentials.username);

  await switchToStoredUsername(page, primaryCredentials.username);
  await expect(page).toHaveURL(/\/home\/?$/);
  await expectLoggedInShellStable(pageTwo, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(pageTwo, primaryCredentials.username);

  await switchToStoredUsername(pageTwo, secondaryCredentials.username);
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, secondaryCredentials.username);

  await expectNoUnexpectedBrowserDiagnostics(pageOneDiagnostics, 'multi-tab switch page one');
  await expectNoUnexpectedBrowserDiagnostics(pageTwoDiagnostics, 'multi-tab switch page two');
});

test('propagates logout fallback across tabs without crashing', async ({ page, context }) => {
  const secondaryCredentials = getSecondaryCredentials();
  test.slow();
  test.skip(
    !secondaryCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run multi-tab logout coverage.'
  );

  const pageOneDiagnostics = attachBrowserDiagnostics(page);
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
  await page.getByRole('button', { name: 'Add account' }).click();

  await loginWithPassword(page, {
    homeserver,
    username: secondaryCredentials.username,
    password: secondaryCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, secondaryCredentials.username);

  const pageTwo = await context.newPage();
  const pageTwoDiagnostics = attachBrowserDiagnostics(pageTwo);
  await pageTwo.goto('/home/');
  await expectLoggedInShellStable(pageTwo, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(pageTwo, secondaryCredentials.username);

  await logoutActiveAccount(page);
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, primaryCredentials.username);

  await expectLoggedInShellStable(pageTwo, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(pageTwo, primaryCredentials.username);

  await expectNoUnexpectedBrowserDiagnostics(pageOneDiagnostics, 'multi-tab logout page one');
  await expectNoUnexpectedBrowserDiagnostics(pageTwoDiagnostics, 'multi-tab logout page two');
});
