import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell, expectLoggedInShellStable } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live login', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('password login succeeds', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'login');
  });

  test('shell stable for 4 seconds after login', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page, { durationMs: 4_000 });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'shell-stability');
  });

  test('session persists after reload', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    await page.reload();
    await waitForLoggedInShell(page);

    await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'session-persistence');
  });
});
