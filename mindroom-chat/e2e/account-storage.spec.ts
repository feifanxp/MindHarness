import { expect, test } from '@playwright/test';
import {
  buildLoginPath,
  getHomeserver,
  getPrimaryCredentials,
  getSecondaryCredentials,
} from './env';
import {
  getStoredSessionByUsername,
  logoutActiveAccount,
  readSessionStore,
  removeInactiveStoredUsername,
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
import {
  createIndexedDbNames,
  getExpectedSessionDbNames,
  readIndexedDbNames,
  readLegacySessionStorage,
  seedLegacySessionStorage,
} from './helpers/storage';

test('cleans up session-scoped browser storage after account removal and final logout', async ({
  page,
}) => {
  const secondaryCredentials = getSecondaryCredentials();
  test.slow();
  test.skip(
    !secondaryCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run storage cleanup coverage.'
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

  const primarySession = await getStoredSessionByUsername(page, primaryCredentials.username);
  const primaryDbNames = getExpectedSessionDbNames(primarySession);
  const primaryIndexedDbNames = await readIndexedDbNames(page);
  primaryDbNames.forEach((name) => expect(primaryIndexedDbNames).toContain(name));

  await page.getByRole('button', { name: 'Add account' }).click();
  await loginWithPassword(page, {
    homeserver,
    username: secondaryCredentials.username,
    password: secondaryCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });

  const secondarySession = await getStoredSessionByUsername(page, secondaryCredentials.username);
  const secondaryDbNames = getExpectedSessionDbNames(secondarySession);
  const foreignDbNames = [
    'matrix-js-sdk:web-sync-store::foreign-app',
    'crypto-store::foreign-app',
    'matrix-js-sdk::foreign-app::DEVICE::matrix-sdk-crypto',
  ];
  await seedLegacySessionStorage(page);
  await createIndexedDbNames(page, foreignDbNames);
  const bothIndexedDbNames = await readIndexedDbNames(page);
  [...primaryDbNames, ...secondaryDbNames].forEach((name) =>
    expect(bothIndexedDbNames).toContain(name)
  );
  foreignDbNames.forEach((name) => expect(bothIndexedDbNames).toContain(name));

  await removeInactiveStoredUsername(page, primaryCredentials.username);
  const afterRemovalIndexedDbNames = await readIndexedDbNames(page);
  primaryDbNames.forEach((name) => expect(afterRemovalIndexedDbNames).not.toContain(name));
  secondaryDbNames.forEach((name) => expect(afterRemovalIndexedDbNames).toContain(name));
  foreignDbNames.forEach((name) => expect(afterRemovalIndexedDbNames).toContain(name));

  // The final logout shows sign-in, clears local data, then reloads the app;
  // navigating before that reload races it.
  const reloaded = page.waitForEvent('load');
  await logoutActiveAccount(page);
  await reloaded;
  await expect(page.locator('input[name="serverInput"]')).toBeVisible();
  await page.goto(buildLoginPath(homeserver));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();

  const finalSessionStore = await readSessionStore(page);
  expect(finalSessionStore.sessions).toHaveLength(0);

  const finalIndexedDbNames = await readIndexedDbNames(page);
  secondaryDbNames.forEach((name) => expect(finalIndexedDbNames).not.toContain(name));
  foreignDbNames.forEach((name) => expect(finalIndexedDbNames).toContain(name));

  const legacyStorage = await readLegacySessionStorage(page);
  Object.values(legacyStorage).forEach((value) => expect(value).toBeNull());

  await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'session storage cleanup');
});
