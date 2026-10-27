import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { readRoomEventCacheEventIds, readThreadEventCacheRecords } from '../helpers/storage';

test.use({ serviceWorkers: 'block' });

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

test('shows a summary cached while its room was closed on the overview and thread banner', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  test.setTimeout(180_000);
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const stamp = Date.now();
  const otherRoomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Summary elsewhere ${stamp}`,
    topic: 'Stays open while the summary arrives in another room.',
  });
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Summary in background ${stamp}`,
    topic: 'Receives a thread summary while its view is closed.',
  });
  await sendRoomMessage(homeserver, session.accessToken, otherRoomId, {
    msgtype: 'm.text',
    body: `Elsewhere ${stamp}`,
  });

  await loginWithPassword(page, { homeserver, ...credentials });
  await expectLoggedInShellStable(page);
  await seedRoomOverviewState({ page, roomId, userId: session.userId, viewMode: 'compact' });
  // Keep another room open, so no view of the summary's room is mounted.
  await page.goto(`/home/${encodeURIComponent(otherRoomId)}`);
  await expect(page.getByText(`Elsewhere ${stamp}`, { exact: true }).first()).toBeVisible();

  const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Original prompt',
  });
  const summaryText = `Summary from background history ${stamp}`;
  const summaryId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.notice',
    body: summaryText,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: summaryText,
      generated_at: new Date().toISOString(),
    },
    'm.relates_to': threadRelation(rootId),
  });
  const cachedThreadIds = async () =>
    (await readThreadEventCacheRecords(page, roomId, rootId)).map((record) => record.eventId);
  // Let the summary arrive in its own sync: a burst can come as a gappy sync without it.
  await expect
    .poll(
      async () =>
        (await cachedThreadIds()).includes(summaryId) &&
        (await readRoomEventCacheEventIds(page, roomId)).includes(rootId)
    )
    .toBe(true);
  // More replies than the overview reads from a thread's cached tail (32)
  // and than the SDK keeps of a room's timeline across reloads (50).
  let lastReplyId = '';
  for (let index = 0; index < 60; index += 1) {
    lastReplyId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Reply ${index}`,
      'm.relates_to': threadRelation(rootId),
    });
  }
  await expect
    .poll(async () => {
      const ids = await cachedThreadIds();
      return ids.includes(lastReplyId) && ids.length > 40;
    })
    .toBe(true);

  // Stop the client and save an SDK snapshot that, like one after a long
  // conversation, no longer holds the summary notice.
  const { activeSessionId } = await readSessionStore(page);
  await page.goto('/config.json');
  const filter = encodeURIComponent(
    JSON.stringify({ room: { rooms: [roomId], timeline: { limit: 1 } } })
  );
  const sync = await matrixFetch<{ next_batch: string; rooms: unknown }>(
    homeserver,
    `/sync?timeout=0&filter=${filter}`,
    { accessToken: session.accessToken }
  );
  await page.evaluate(
    async ({ dbName, savedSync }) => {
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
    },
    { dbName: `matrix-js-sdk:web-sync-store::${activeSessionId}`, savedSync: sync }
  );
  await page.close();

  // Offline, only the cache can supply the title.
  if (browserName === 'chromium')
    await context.grantPermissions(['local-network-access'], { origin: baseURL });
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) {
      await route.fulfill({ response: await route.fetch() });
    } else {
      await route.abort('internetdisconnected');
    }
  });
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto(`/home/${encodeURIComponent(roomId)}`);
  const card = reopened.locator(`[data-compact-room-view] [data-thread-root-id="${rootId}"]`);
  await expect(card).toContainText(summaryText);
  await card.click();
  await expect(reopened.locator('[data-thread-context-summary="true"]').first()).toContainText(
    summaryText
  );
});
