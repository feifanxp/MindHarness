import { devices, expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

test.use({ viewport: devices['iPhone 13'].viewport, serviceWorkers: 'block' });

const THREADS = 120;

type MatrixRequest = { path: string };

const recordMatrixRequests = (page: Page, homeserver: string) => {
  const origin = new URL(homeserver).origin;
  const requests: MatrixRequest[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || !url.pathname.startsWith('/_matrix/client/')) return;
    requests.push({ path: decodeURIComponent(url.pathname) });
  });
  return requests;
};
/** Thread cards at least partly inside the viewport. */
const countShownCards = (page: Page) =>
  page.evaluate(
    () =>
      new Set(
        Array.from(document.querySelectorAll('[data-thread-root-id]'))
          .filter((element) => {
            const { top, bottom } = element.getBoundingClientRect();
            return bottom > 0 && top < window.innerHeight;
          })
          .map((element) => element.getAttribute('data-thread-root-id'))
      ).size
  );
const countThreadRequests = (requests: MatrixRequest[]) => ({
  roots: requests.filter(({ path }) => /\/rooms\/[^/]+\/event\//.test(path)).length,
  relations: requests.filter(({ path }) => path.includes('/relations/')).length,
});

test('lists and reopens a large thread overview without a request per thread', async ({ page }) => {
  test.setTimeout(240_000);
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  await setAccountData(homeserver, session.accessToken, session.userId, 'io.mindroom.settings', {
    simpleMode: false,
  });
  const roomName = `Thread bootstrap requests ${Date.now()}`;
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: roomName,
    topic: 'Listed threads load their history only when opened.',
  });
  const send = (body: string, root?: string) =>
    sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body,
      ...(root
        ? {
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: root,
              is_falling_back: true,
              'm.in_reply_to': { event_id: root },
            },
          }
        : {}),
    });
  const roots: string[] = [];
  for (let batch = 0; batch < THREADS / 20; batch += 1) {
    roots.push(
      ...(await Promise.all(
        Array.from({ length: 20 }, async (_, offset) => {
          const index = batch * 20 + offset;
          const root = await send(`Bootstrap thread ${index}`);
          await send(`First reply ${index}`, root);
          return root;
        })
      ))
    );
  }
  // Keep thread events out of the saved sync window, so every thread starts as a listed root.
  for (let index = 0; index < 25; index += 1) {
    await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.notice',
      body: `Room activity ${index}`,
    });
  }

  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({ page, roomId, userId: session.userId, viewMode: 'compact' });
  const roomPath = `/home/${encodeURIComponent(roomId)}`;
  // Other rooms of the account may hold threads of their own.
  const countRoomThreadRequests = (requests: MatrixRequest[]) =>
    countThreadRequests(requests.filter(({ path }) => path.includes(`/rooms/${roomId}/`)));
  const firstOpen = recordMatrixRequests(page, homeserver);
  await page.goto(roomPath);
  await expect(page.getByText(`Showing ${THREADS} threads`, { exact: true })).toHaveCount(1);
  await expect(page.locator(`[data-thread-root-id="${roots[5]}"]`)).toContainText('First reply 5');
  await page.waitForTimeout(5_000);
  // Each listed thread used to fetch its root (twice) and a first page; now only shown cards load.
  const shownAtFirstOpen = await countShownCards(page);
  expect(shownAtFirstOpen).toBeLessThan(THREADS / 4);
  expect(countRoomThreadRequests(firstOpen).roots).toBeLessThanOrEqual(shownAtFirstOpen);
  expect(countRoomThreadRequests(firstOpen).relations).toBeLessThanOrEqual(shownAtFirstOpen);

  // While the app is closed, one thread changes inside a gap that the next /sync omits.
  await page.goto('about:blank');
  await send('Reply inside the sync gap', roots[3]);
  for (let index = 0; index < 25; index += 1) await send(`Later reply ${index}`, roots[4]);
  const reopen = recordMatrixRequests(page, homeserver);
  await page.goto(roomPath);
  await expect(page.getByText(`Showing ${THREADS} threads`, { exact: true })).toHaveCount(1);
  // Only the thread list carries this reply, so the cached card upgrades from its summary.
  await expect(page.locator(`[data-thread-root-id="${roots[3]}"]`)).toContainText(
    'Reply inside the sync gap'
  );
  await expect(page.locator(`[data-thread-root-id="${roots[4]}"]`)).toContainText('Later reply 24');
  await page.waitForTimeout(5_000);
  // Shown cards load again after a page load; one root outside the synced window is fetched too.
  const shownAtReopen = await countShownCards(page);
  expect(countRoomThreadRequests(reopen).relations).toBeLessThanOrEqual(shownAtReopen);
  expect(countRoomThreadRequests(reopen).roots).toBeLessThanOrEqual(shownAtReopen + 1);

  // A shown card keeps an exact count as live replies arrive.
  const liveCard = page.locator(`[data-thread-root-id="${roots[4]}"]`);
  await expect(liveCard).toHaveAccessibleName(/\b26 msgs\b/);
  await send('Live reply on a shown card', roots[4]);
  await expect(liveCard).toContainText('Live reply on a shown card');
  await expect(liveCard).toHaveAccessibleName(/\b27 msgs\b/);

  const coldStart = recordMatrixRequests(page, homeserver);
  await page.reload();
  await expect(page.getByText(`Showing ${THREADS} threads`, { exact: true })).toHaveCount(1);
  await expect.poll(() => coldStart.some(({ path }) => path.endsWith('/sync'))).toBe(true);
  const beforeSync = coldStart.slice(
    0,
    coldStart.findIndex(({ path }) => path.endsWith('/sync'))
  );
  expect(countRoomThreadRequests(beforeSync).relations).toBe(0);
  expect(countRoomThreadRequests(beforeSync).roots).toBeLessThanOrEqual(1);

  // Let the cards shown after the reload load first; opening a thread then loads that thread alone.
  await page.waitForTimeout(3_000);
  const opening = recordMatrixRequests(page, homeserver);
  await page.locator(`[data-thread-root-id="${roots[7]}"]`).click();
  await expect(page.getByText('First reply 7', { exact: true })).toBeVisible();
  await page.waitForTimeout(2_000);
  const forOpenedThread = opening.filter(({ path }) => path.includes(roots[7]));
  expect(countThreadRequests(forOpenedThread).relations).toBeGreaterThan(0);
  expect(countRoomThreadRequests(opening)).toEqual(countThreadRequests(forOpenedThread));
});
