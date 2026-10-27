import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

test.use({ viewport: devices['iPhone 13'].viewport, serviceWorkers: 'block' });

test('restores all 400 downloaded threads behind a long room history while offline', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  test.setTimeout(240_000);
  context.setDefaultTimeout(15_000);
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  await setAccountData(homeserver, session.accessToken, session.userId, 'io.mindroom.settings', {
    simpleMode: false,
  });
  const roomName = `Offline thread overview ${Date.now()}`;
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: roomName,
    topic: 'Downloaded threads remain discoverable outside the recent room timeline.',
  });
  const roots: string[] = [];
  for (let batch = 0; batch < 20; batch += 1) {
    roots.push(
      ...(await Promise.all(
        Array.from({ length: 20 }, async (_, offset) => {
          const index = batch * 20 + offset;
          const root = await sendRoomMessage(homeserver, session.accessToken, roomId, {
            msgtype: 'm.text',
            body: `Offline thread ${index}`,
          });
          await sendRoomMessage(homeserver, session.accessToken, roomId, {
            msgtype: 'm.text',
            body: `Cached reply ${index}`,
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: root,
              is_falling_back: true,
              'm.in_reply_to': { event_id: root },
            },
          });
          if (index === 0) {
            await sendRoomMessage(homeserver, session.accessToken, roomId, {
              msgtype: 'm.notice',
              body: 'Saved overview summary',
              'io.mindroom.thread_summary': true,
              'm.relates_to': {
                rel_type: 'm.thread',
                event_id: root,
                is_falling_back: true,
                'm.in_reply_to': { event_id: root },
              },
            });
          }
          return root;
        })
      ))
    );
  }
  // Non-root room activity can put old roots beyond the interactive history budget.
  for (let batch = 0; batch < 100; batch += 1) {
    await Promise.all(
      Array.from({ length: 20 }, (_, offset) =>
        sendRoomMessage(homeserver, session.accessToken, roomId, {
          msgtype: 'm.notice',
          body: `Background activity ${batch * 20 + offset}`,
        })
      )
    );
  }
  await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Most recent reply',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: roots[399],
      is_falling_back: true,
      'm.in_reply_to': { event_id: roots[399] },
    },
  });
  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({ page, roomId, userId: session.userId, viewMode: 'compact' });
  const roomPath = `/home/${encodeURIComponent(roomId)}`;
  await page.goto(roomPath);
  await expect(page.getByText('Showing 400 threads', { exact: true })).toHaveCount(1);
  const header = page.locator('header').filter({ hasText: roomName });
  await header.getByRole('button').last().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Room Settings', exact: true }).click();
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('button', { name: 'Download entire room', exact: true }).click();
  const { activeSessionId } = await readSessionStore(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ name, room }) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(name);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              return await new Promise<{ roots: number; downloaded: boolean }>(
                (resolve, reject) => {
                  const request = db.transaction('meta').objectStore('meta').getAll();
                  request.onsuccess = () =>
                    resolve({
                      roots: request.result.filter((row) => row.roomId === room && row.rootEvent)
                        .length,
                      downloaded: request.result.some(
                        (row) => row.roomId === room && row.offline?.exhausted
                      ),
                    });
                  request.onerror = () => reject(request.error);
                }
              );
            } finally {
              db.close();
            }
          },
          { name: `mindroom-cache::${activeSessionId}`, room: roomId }
        ),
      { timeout: 90_000 }
    )
    .toEqual({ roots: 400, downloaded: true });
  await page.close();
  if (browserName === 'chromium')
    await context.grantPermissions(['local-network-access'], { origin: baseURL });
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) {
      await route.fulfill({ response: await route.fetch() });
    } else {
      await route.abort('internetdisconnected');
    }
  });
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
  await expect(reopened.getByText('Showing 400 threads', { exact: true })).toHaveCount(1, {
    timeout: 5_000,
  });
  await expect(reopened.locator(`[data-thread-root-id="${roots[0]}"]`)).toContainText(
    'Saved overview summary',
    { timeout: 5_000 }
  );
  await expect(reopened.locator(`[data-thread-root-id="${roots[1]}"]`)).toContainText(
    'Cached reply 1',
    { timeout: 5_000 }
  );
  await expect(reopened.locator(`[data-thread-root-id="${roots[0]}"]`)).toContainText(
    'Cached reply 0',
    { timeout: 5_000 }
  );
  await reopened.locator(`[data-thread-root-id="${roots[0]}"]`).click();
  await expect(reopened.getByText('Saved overview summary', { exact: true }).first()).toBeVisible();
  await expect(reopened.getByText('Cached reply 0', { exact: true })).toBeVisible();
  const newReply = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Arrived during offline startup',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: roots[0],
      is_falling_back: true,
      'm.in_reply_to': { event_id: roots[0] },
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
  await expect(reopened.locator(`[data-message-id="${newReply}"]`)).toBeVisible();
  await reopened.goBack();
  await expect(reopened.locator(`[data-thread-root-id="${roots[0]}"]`)).toContainText(
    'Arrived during offline startup'
  );
});
