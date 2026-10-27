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
  serviceWorkers: 'block',
});

for (const serverInfoCached of [true, false]) {
  test(`restores cached threads before Matrix responses with server information ${
    serverInfoCached ? 'cached' : 'missing'
  }, then syncs`, async ({ page }) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const roomName = `Cached room population ${Date.now()}`;
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Cached room history with only the newest root in the saved SDK sync.',
    });
    await loginWithPassword(page, { homeserver, ...credentials });
    await seedRoomOverviewState({ page, roomId, userId: session.userId, viewMode: 'compact' });
    const roomPath = `/home/${encodeURIComponent(roomId)}`;
    // Avoid depending on which rooms the shared account's sidebar has mounted.
    await page.goto(roomPath);
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
    const rootIds: string[] = [];
    const replyIds: string[] = [];
    for (const label of ['First cached thread', 'Second cached thread', 'Newest cached thread']) {
      rootIds.push(
        await sendRoomMessage(
          homeserver,
          session.accessToken,
          roomId,
          {
            msgtype: 'm.text',
            body: label,
          },
          'cached-room-population'
        )
      );
      if (rootIds.length === 1) {
        for (const body of ['First cached reply', 'Second cached reply']) {
          replyIds.push(
            await sendRoomMessage(
              homeserver,
              session.accessToken,
              roomId,
              {
                msgtype: 'm.text',
                body,
                'm.relates_to': {
                  rel_type: 'm.thread',
                  event_id: rootIds[0],
                  is_falling_back: true,
                  'm.in_reply_to': { event_id: rootIds[0] },
                },
              },
              'cached-room-population'
            )
          );
        }
      }
    }

    await expect(page.locator('[data-thread-root-id]')).toHaveCount(3);
    const { activeSessionId } = await readSessionStore(page);
    expect(activeSessionId).toBeTruthy();
    const cacheDbName = `mindroom-cache::${activeSessionId}`;
    await expect
      .poll(() =>
        page.evaluate(
          async ({ dbName, keys }) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(dbName);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              const transaction = db.transaction('events', 'readonly');
              const events = transaction.objectStore('events');
              const found = await Promise.all(
                keys.map(
                  (key) =>
                    new Promise<boolean>((resolve, reject) => {
                      const request = events.get(key);
                      request.onsuccess = () => resolve(!!request.result);
                      request.onerror = () => reject(request.error);
                    })
                )
              );
              return found.filter(Boolean).length;
            } finally {
              db.close();
            }
          },
          {
            dbName: cacheDbName,
            keys: [
              ...rootIds.map((root) => `${roomId}||${root}`),
              ...replyIds.map((reply) => `${roomId}|${rootIds[0]}|${reply}`),
            ],
          }
        )
      )
      .toBe(5);

    // End the client before replacing its saved sync with a realistic narrow tail.
    await page.goto('/config.json');
    const filter = encodeURIComponent(
      JSON.stringify({ room: { rooms: [roomId], timeline: { limit: 1 } } })
    );
    const sync = await matrixFetch<{
      next_batch: string;
      rooms: { join: Record<string, { timeline: { events: Array<{ event_id: string }> } }> };
    }>(homeserver, `/sync?timeout=0&filter=${filter}`, { accessToken: session.accessToken });
    expect(sync.rooms.join[roomId].timeline.events.map((event) => event.event_id)).toEqual([
      rootIds[2],
    ]);
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
        localStorage.setItem('mindroom.debug.timeline', '1');
      },
      { dbName: `matrix-js-sdk:web-sync-store::${activeSessionId}`, savedSync: sync }
    );

    if (!serverInfoCached) {
      await page.evaluate(() => {
        Object.keys(localStorage)
          .filter((key) => key.startsWith('cinny_spec_versions::'))
          .forEach((key) => localStorage.removeItem(key));
      });
    }

    const hydrationMessages: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('room-cache-hydrate')) hydrationMessages.push(message.text());
    });
    let releaseRequests!: () => void;
    const requestsHeld = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    let matrixRequestsHeld = 0;
    await page.route(/\/_matrix\//, async (route) => {
      matrixRequestsHeld += 1;
      await requestsHeld;
      await route.continue();
    });
    try {
      await page.goto(roomPath);
      await expect.poll(() => matrixRequestsHeld).toBeGreaterThan(0);
      await expect(page.locator('[data-thread-root-id]')).toHaveCount(3, { timeout: 5_000 });
      await expect
        .poll(() => hydrationMessages.some((line) => line.includes('room-cache-hydrate-complete')))
        .toBe(true);
      expect(hydrationMessages.some((line) => line.includes('skip-latest-already-loaded'))).toBe(
        false
      );
      await page.locator(`[data-thread-root-id="${rootIds[0]}"]`).click();
      for (const replyId of replyIds) {
        await expect(page.locator(`[data-message-id="${replyId}"]`)).toBeVisible({
          timeout: 5_000,
        });
      }
      await page.goBack();
      await expect(page.locator('[data-thread-root-id]')).toHaveCount(3);
      const liveRootId = await sendRoomMessage(
        homeserver,
        session.accessToken,
        roomId,
        { msgtype: 'm.text', body: 'Arrived while startup networking was held' },
        'cached-room-population-live'
      );
      await expect(page.locator('[data-thread-root-id]')).toHaveCount(3);
      releaseRequests();
      await expect(page.locator(`[data-thread-root-id="${liveRootId}"]`)).toBeVisible();
      await expect(page.locator('[data-thread-root-id]')).toHaveCount(4);
    } finally {
      releaseRequests();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
