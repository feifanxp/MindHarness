import { test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from './env';
import { loginWithPassword } from './helpers/auth';

test('logs in with password against an explicit homeserver', async ({ page }) => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');

  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();

  await loginWithPassword(page, {
    homeserver,
    username: credentials.username,
    password: credentials.password,
  });
});
