import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from './env';
import { expectActiveStoredUsername } from './helpers/accounts';
import {
  activeAccountButtonNamePattern,
  expectLoggedInShellStable,
  loginWithPassword,
} from './helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from './helpers/browserDiagnostics';

test('survives a homeserver outage without crashing and recovers after reconnect', async ({
  page,
  context,
}) => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');

  const diagnostics = attachBrowserDiagnostics(page);
  const homeserver = getHomeserver();
  const primaryCredentials = getPrimaryCredentials();

  await loginWithPassword(page, {
    homeserver,
    username: primaryCredentials.username,
    password: primaryCredentials.password,
  });
  await expectLoggedInShellStable(page);
  await expectActiveStoredUsername(page, primaryCredentials.username);

  const abortHomeserverTraffic = (route: { abort: (errorCode?: string) => Promise<void> }) =>
    route.abort('internetdisconnected');

  await context.route(`${homeserver}/**`, abortHomeserverTraffic);
  await page.reload();

  const offlineStateHandle = await page.waitForFunction(
    () => {
      const bodyText = document.body?.innerText ?? '';
      if (bodyText.includes('Unexpected Application Error!')) return 'crash';
      if (document.querySelector('input[name="serverInput"]')) return 'auth';
      if (bodyText.includes('Unable to connect to the homeserver')) {
        return 'connectivity-dialog';
      }
      if (
        Array.from(document.querySelectorAll('button')).some((button) =>
          /Open (account switcher|settings) for /.test(button.getAttribute('aria-label') ?? '')
        )
      ) {
        return 'shell';
      }
      return null;
    },
    undefined,
    { timeout: 20_000 }
  );

  const offlineState = await offlineStateHandle.jsonValue();
  expect(offlineState).toMatch(/^(auth|shell|connectivity-dialog)$/);
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toHaveCount(
    offlineState === 'shell' ? 1 : 0
  );
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);

  await context.unroute(`${homeserver}/**`, abortHomeserverTraffic);
  await page.reload();
  await expectLoggedInShellStable(page, { durationMs: 6_000, sampleIntervalMs: 300 });
  await expectActiveStoredUsername(page, primaryCredentials.username);

  await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'homeserver outage and reconnect');
});
