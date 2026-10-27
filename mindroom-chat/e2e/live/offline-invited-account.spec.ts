import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

test.use({ viewport: devices['iPhone 13'].viewport, serviceWorkers: 'block' });

test('reopens an accepted invitation offline and catches up after reconnect', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  const inviterCredentials = getSecondaryCredentials();
  test.skip(!inviterCredentials, 'Two local Matrix accounts required');
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const member = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const inviter = await loginToMatrix(
    homeserver,
    inviterCredentials!.username,
    inviterCredentials!.password
  );
  const roomName = `Offline invitation ${Date.now()}`;
  const roomId = await createPrivateRoom(homeserver, inviter.accessToken, {
    name: roomName,
    topic: 'An accepted invitation must not make cached startup depend on key discovery.',
    invite: [member.userId],
  });
  await loginWithPassword(page, { homeserver, ...credentials });
  await page.goto('/inbox/invites');
  await page.getByRole('button', { name: /^(Primary|Public) 1$/ }).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
  await seedRoomOverviewState({ page, roomId, userId: member.userId, viewMode: 'compact' });
  const roomPath = `/home/${encodeURIComponent(roomId)}`;
  await page.goto(roomPath);
  await expect(page.getByText(roomName, { exact: true })).toBeVisible();
  const rootId = await sendRoomMessage(homeserver, inviter.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Saved before going offline',
  });
  await expect(page.locator(`[data-thread-root-id="${rootId}"]`)).toBeVisible();
  // The SDK saves its first sync after startup, then at most every five minutes. That
  // save precedes the root's sync, so only now move past the throttle; the inviter's
  // read receipt then delivers another real sync.
  await page.clock.setFixedTime(new Date(Date.now() + 6 * 60_000));
  await matrixFetch(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(rootId)}`,
    { method: 'POST', accessToken: inviter.accessToken, body: '{}' }
  );
  const { activeSessionId } = await readSessionStore(page);
  // Wait for the application's own saved sync; do not manufacture a cache snapshot.
  await expect
    .poll(() =>
      page.evaluate(async (name) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<string>((resolve, reject) => {
            const request = db.transaction('sync').objectStore('sync').getAll();
            request.onsuccess = () => resolve(JSON.stringify(request.result));
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      }, `matrix-js-sdk:web-sync-store::${activeSessionId}`)
    )
    .toContain(rootId);

  await page.close();
  // Chromium treats the intercepted app document as public address space.
  if (browserName === 'chromium') {
    await context.grantPermissions(['local-network-access'], { origin: baseURL });
  }
  // Capacitor serves its bundled app even in airplane mode. Serve only those local
  // assets here; all remote fetches fail and navigator.onLine is false.
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) {
      await route.fulfill({ response: await route.fetch() });
    } else {
      await route.abort('internetdisconnected');
    }
  });
  // Desktop WebKit blocks navigation before routes can serve bundled assets.
  if (browserName === 'webkit') {
    await context.addInitScript(() =>
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    );
  } else {
    await context.setOffline(true);
  }
  const reopened = await context.newPage();
  await reopened.goto(roomPath);
  expect(await reopened.evaluate(() => navigator.onLine)).toBe(false);
  await expect(reopened.locator(`[data-thread-root-id="${rootId}"]`)).toBeVisible({
    timeout: 5_000,
  });
  await reopened.locator(`[data-thread-root-id="${rootId}"]`).click();
  await expect(reopened.locator(`[data-message-id="${rootId}"]`)).toBeVisible();

  const replyId = await sendRoomMessage(homeserver, inviter.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Arrived while the app was offline',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  await context.unrouteAll({ behavior: 'wait' });
  await context.setOffline(false);
  if (browserName === 'webkit') {
    await reopened.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
  }
  await expect(reopened.locator(`[data-message-id="${replyId}"]`)).toBeVisible();
  await expect(reopened.getByText(/Failed to start account/)).toHaveCount(0);
});
