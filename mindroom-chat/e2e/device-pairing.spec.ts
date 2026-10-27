import { expect, test, type Page, type Request } from '@playwright/test';

const SESSION_STORE_KEY = 'mindroom_multi_account_store';

// The e2e dev server points provisioning at its own origin instead of the
// hosted service (scripts/e2e-client-config.mjs), so accounts seeded on that
// origin play the hosted accounts. The page contacts their homeserver only to
// exchange an access token for an OpenID token; that request and the
// provisioning requests are fulfilled below.
const provisioningOrigin = () =>
  new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:4173').origin;

type SeedSession = { userId: string; accessToken: string; baseUrl?: string };

const seedSessions = async (page: Page, sessions: SeedSession[], activeUserId?: string) => {
  const stored = sessions.map((session, index) => ({
    sessionId: `${encodeURIComponent(
      session.baseUrl ?? provisioningOrigin()
    )}::${encodeURIComponent(session.userId)}`,
    baseUrl: session.baseUrl ?? provisioningOrigin(),
    userId: session.userId,
    deviceId: `DEVICE${index}`,
    accessToken: session.accessToken,
    lastUsedAt: index + 1,
  }));
  const store = {
    version: 1,
    activeSessionId: stored.find((session) => session.userId === activeUserId)?.sessionId,
    sessions: stored,
  };
  await page.addInitScript(
    ([key, value]) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
    },
    [SESSION_STORE_KEY, JSON.stringify(store)] as const
  );
};

const mockOpenIdTokens = async (page: Page) => {
  const requests: Request[] = [];
  await page.route('**/_matrix/client/v3/user/*/openid/request_token', async (route) => {
    requests.push(route.request());
    const accessToken = route
      .request()
      .headers()
      .authorization?.replace(/^Bearer /, '');
    await route.fulfill({
      json: {
        access_token: `openid-for-${accessToken}`,
        token_type: 'Bearer',
        matrix_server_name: 'mindroom.chat',
        expires_in: 3600,
      },
    });
  });
  return requests;
};

const mockPairDevice = async (page: Page) => {
  const requests: Request[] = [];
  await page.route('**/v1/local-mindroom/pair/device/*', async (route) => {
    requests.push(route.request());
    const action = new URL(route.request().url()).pathname.split('/').pop();
    await route.fulfill({
      json: {
        client_name: 'studio-mac',
        created_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: new Date(Date.now() + 9 * 60_000).toISOString(),
        status: action === 'approve' ? 'approved' : 'pending',
      },
    });
  });
  return requests;
};

const readActiveSessionId = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? '{}').activeSessionId as string,
    SESSION_STORE_KEY
  );

test('approves a pairing code with a chosen non-active account', async ({ page }) => {
  await seedSessions(
    page,
    [
      { userId: '@alice:mindroom.chat', accessToken: 'alice-token' },
      { userId: '@bob:mindroom.chat', accessToken: 'bob-token' },
      {
        userId: '@carol:matrix.org',
        accessToken: 'carol-token',
        baseUrl: 'https://matrix-client.matrix.org',
      },
    ],
    '@carol:matrix.org'
  );
  const openIdRequests = await mockOpenIdTokens(page);
  const requests = await mockPairDevice(page);

  await page.goto('/connect?code=abcd-efgh');
  await expect(page.getByText('Connect studio-mac?')).toBeVisible();
  await expect(page.getByText('@carol:matrix.org')).toHaveCount(0);
  const activeBefore = await readActiveSessionId(page);

  await page.getByRole('button', { name: '@bob:mindroom.chat', exact: true }).click();
  await page.getByRole('button', { name: 'Approve as @bob:mindroom.chat' }).click();

  await expect(page.getByText('Connected. You can return to your terminal.')).toBeVisible();
  const approve = requests.find((request) => request.url().endsWith('/pair/device/approve'));
  expect(approve?.url()).toBe(`${provisioningOrigin()}/v1/local-mindroom/pair/device/approve`);
  expect(approve?.headers()['x-matrix-openid-token']).toBe('openid-for-bob-token');
  expect(approve?.postDataJSON()).toEqual({ pair_code: 'ABCD-EFGH' });
  for (const request of requests) {
    expect(request.headers()).not.toHaveProperty('x-matrix-access-token');
    expect(request.headers()).not.toHaveProperty('authorization');
  }
  expect(openIdRequests.at(-1)?.url()).toBe(
    `${provisioningOrigin()}/_matrix/client/v3/user/%40bob%3Amindroom.chat/openid/request_token`
  );
  expect(openIdRequests.at(-1)?.headers().authorization).toBe('Bearer bob-token');
  expect(await readActiveSessionId(page)).toBe(activeBefore);
});

test('sends signed-out visitors to login and back to the code afterwards', async ({ page }) => {
  await page.goto('/connect?code=ABCD-EFGH');

  await page.getByRole('button', { name: 'Sign in to approve' }).click();

  await expect(page).toHaveURL(/\/login\//);
  const saved = await page.evaluate(() => window.localStorage.getItem('after_login_redirect_url'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ path: '/connect?code=ABCD-EFGH' });
});
