import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from './env';
import {
  expectActiveStoredUsername,
  getStoredSessionByUsername,
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

test('re-logging the same account through Add account does not create duplicates', async ({
  page,
}) => {
  test.slow();
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');

  const diagnostics = attachBrowserDiagnostics(page);
  const homeserver = getHomeserver();
  const primaryCredentials = getPrimaryCredentials();

  await setFullInterfaceModeForCredentials(homeserver, primaryCredentials);

  await loginWithPassword(page, {
    homeserver,
    username: primaryCredentials.username,
    password: primaryCredentials.password,
  });
  await expectLoggedInShellStable(page);
  await expectActiveStoredUsername(page, primaryCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(2);

  const initialSession = await getStoredSessionByUsername(page, primaryCredentials.username);

  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/addAccount=1/);

  await loginWithPassword(page, {
    homeserver,
    username: primaryCredentials.username,
    password: primaryCredentials.password,
    addAccount: true,
  });
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, primaryCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(2);

  const sessionStore = await readSessionStore(page);
  expect(sessionStore.sessions).toHaveLength(1);

  const updatedSession = await getStoredSessionByUsername(page, primaryCredentials.username);
  expect(updatedSession.sessionId).toBe(initialSession.sessionId);

  await page.reload();
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, primaryCredentials.username);
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(2);

  await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'same-account add-account relogin');
});
