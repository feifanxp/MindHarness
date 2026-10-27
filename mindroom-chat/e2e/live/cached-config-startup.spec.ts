import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const phone = devices['iPhone 13'];
test.use({
  viewport: phone.viewport,
  isMobile: true,
  hasTouch: true,
  // Network stalls must reach Playwright instead of an installed PWA worker.
  serviceWorkers: 'block',
});

test('opens cached chats before configuration and Matrix responses, preserving navigation on refresh', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const roomName = `Cached startup ${Date.now()}`;
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: roomName,
    topic: 'Cached app startup while runtime configuration is pending.',
  });
  const rootId = await sendRoomMessage(
    homeserver,
    session.accessToken,
    roomId,
    {
      msgtype: 'm.text',
      body: 'Ready from the saved room',
    },
    'cached-config-startup'
  );

  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({ page, roomId, userId: session.userId, viewMode: 'compact' });
  // The shared account's virtualized sidebar need not have this room mounted.
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.locator(`[data-thread-root-id="${rootId}"]`)).toBeVisible();
  const { activeSessionId } = await readSessionStore(page);
  expect(activeSessionId).toBeTruthy();

  // Stop the client, then persist a real server snapshot for a deterministic reopen.
  await page.goto('/config.json');
  const filter = encodeURIComponent(
    JSON.stringify({ room: { rooms: [roomId], timeline: { limit: 20 } } })
  );
  const sync = await matrixFetch<{ next_batch: string; rooms: unknown }>(
    homeserver,
    `/sync?timeout=0&filter=${filter}`,
    { accessToken: session.accessToken }
  );
  const configKey = 'io.cinny.client-config:/config.json';
  const savedConfig = await page.evaluate(
    async ({ dbName, savedSync, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('sync', 'readwrite');
          transaction.objectStore('sync').put({
            clobber: '-',
            nextBatch: savedSync.next_batch,
            roomsData: savedSync.rooms,
          });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        db.close();
      }
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    },
    { dbName: `matrix-js-sdk:web-sync-store::${activeSessionId}`, savedSync: sync, key: configKey }
  );
  expect(savedConfig).toBeTruthy();

  let releaseMatrix!: () => void;
  let releaseConfig!: () => void;
  const matrixHeld = new Promise<void>((resolve) => {
    releaseMatrix = resolve;
  });
  const configHeld = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  let configRequested = false;
  let matrixRequestsHeld = 0;
  await page.route(/\/_matrix\//, async (route) => {
    matrixRequestsHeld += 1;
    await matrixHeld;
    await route.abort();
  });
  await page.route('**/config.json', async (route) => {
    configRequested = true;
    await configHeld;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...savedConfig,
        splash: { ...savedConfig.splash, loadingMessages: ['Refreshed for next launch'] },
      }),
    });
  });
  try {
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect.poll(() => configRequested).toBe(true);
    await expect.poll(() => matrixRequestsHeld).toBeGreaterThan(0);
    const card = page.locator(`[data-thread-root-id="${rootId}"]`);
    await expect(card).toBeVisible({ timeout: 5_000 });
    await card.click();
    await expect(page.locator(`[data-message-id="${rootId}"]`)).toBeVisible({ timeout: 5_000 });
    const threadUrl = page.url();
    const composer = page.getByRole('textbox').first();
    await composer.fill('Keep my draft through background refresh');
    const mountedComposer = await composer.elementHandle();

    releaseConfig();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? '{}').splash?.loadingMessages?.[0],
          configKey
        )
      )
      .toBe('Refreshed for next launch');
    await expect(page).toHaveURL(threadUrl);
    await expect(composer).toContainText('Keep my draft through background refresh');
    expect(await mountedComposer?.evaluate((element) => element.isConnected)).toBe(true);
  } finally {
    releaseConfig();
    releaseMatrix();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
