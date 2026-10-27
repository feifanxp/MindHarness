import { expect, test, type Page, type Route } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from './env';
import { loginWithPassword } from './helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from './helpers/matrix';

test.use({ serviceWorkers: 'block' });

const openSyncedRoom = async (page: Page) => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Connection status ${Date.now()}`,
  });

  await loginWithPassword(page, { homeserver, username, password });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.getByRole('textbox').first();
  await expect(composer).toBeVisible();
  // The cached start below needs the room in the sync store. On a fresh boot,
  // "Catching up..." clears after the second /sync, which starts once the first
  // was saved; a live message ends that long poll early.
  await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Sent while connected',
  });
  const status = page.getByTestId('client-sync-status');
  await expect(status).toHaveCount(0, { timeout: 45_000 });
  return { homeserver, composer, status };
};

test('shows the lost connection while /sync has not noticed it and clears it once the homeserver answers', async ({
  page,
  context,
}) => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');
  const { homeserver, composer, status } = await openSyncedRoom(page);

  // As in the iPhone incident: the requests the /sync loop waits for get no
  // answer, so its state never changes, while other requests fail outright.
  const heldRequests: Route[] = [];
  const outage = async (route: Route) => {
    if (route.request().method() === 'GET') {
      heldRequests.push(route);
      return;
    }
    await route.abort('internetdisconnected');
  };
  await context.route(`${homeserver}/**`, outage);
  await page.reload();
  await expect(composer).toBeVisible();
  await composer.fill('Sent while the homeserver is unreachable');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(status).toHaveText('Connection Lost!');

  await context.unroute(`${homeserver}/**`, outage);
  await Promise.all(heldRequests.map((route) => route.continue().catch(() => undefined)));
  await expect(page.getByText('Connection Lost!')).toHaveCount(0);
});

test('does not show a lost connection when one request fails while the homeserver answers', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');
  const { composer } = await openSyncedRoom(page);
  await page.evaluate(() => {
    const seen = { lost: false };
    Object.assign(window, { connectionLostSeen: seen });
    new MutationObserver(() => {
      const status = document.querySelector('[data-testid="client-sync-status"]');
      if (status?.textContent?.includes('Connection Lost!')) seen.lost = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  const send = '**/_matrix/client/v3/rooms/*/send/**';
  await page.route(send, (route) => route.abort('internetdisconnected'));
  const sendFailed = page.waitForEvent('requestfailed', (request) =>
    request.url().includes('/send/')
  );
  // The failed send starts a check of the homeserver; once it is answered,
  // nothing can show the banner for this failure.
  const checkAnswered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/_matrix/client/versions'
  );
  await composer.fill('Sent while only sends fail');
  await page.getByRole('button', { name: 'Send message' }).click();
  await sendFailed;
  const checkResponse = await checkAnswered;
  expect(checkResponse.ok()).toBe(true);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      })
  );

  expect(
    await page.evaluate(
      () => (window as unknown as { connectionLostSeen: { lost: boolean } }).connectionLostSeen.lost
    )
  ).toBe(false);
  await page.unroute(send);
});
