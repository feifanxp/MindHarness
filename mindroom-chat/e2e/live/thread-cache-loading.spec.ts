import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

test('opens a root-only thread while its IndexedDB history read is blocked', async ({ page }) => {
  test.skip(!hasPrimaryCredentials(), 'Requires disposable Matrix credentials.');
  test.setTimeout(90_000);
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const fixture = await createThreadFixture(homeserver, session.accessToken, {
    name: 'Blocked thread cache',
    topic: 'Server loading must not wait for storage',
    rootBody: 'Root visible before history loads',
    replyBody: 'Reply fetched while storage is blocked',
  });
  const summary = 'Summary fetched while storage is blocked';
  await sendRoomMessage(homeserver, session.accessToken, fixture.roomId, {
    msgtype: 'm.notice',
    body: summary,
    'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
    'io.mindroom.thread_summary': {
      version: 1,
      summary,
      generated_at: new Date().toISOString(),
      message_count: 2,
    },
  });

  // Keep only the root in initial SDK state; allow the opened thread to fetch real history.
  let opening = false;
  await page.route('**/_matrix/client/**/sync?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const timeline = body.rooms?.join?.[fixture.roomId]?.timeline;
    if (!opening && timeline?.events) {
      timeline.events = timeline.events.filter(
        (event: { content?: { 'm.relates_to'?: { event_id?: string } } }) =>
          event.content?.['m.relates_to']?.event_id !== fixture.rootId
      );
    }
    await route.fulfill({ response, json: body });
  });
  await page.route('**/_matrix/client/**/relations/**', async (route) => {
    if (!opening && decodeURIComponent(route.request().url()).includes(fixture.rootId)) {
      await route.fulfill({ json: { chunk: [] } });
    } else await route.continue();
  });
  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({
    page,
    roomId: fixture.roomId,
    userId: session.userId,
    viewMode: 'compact',
  });
  await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
  const card = page.locator(`[data-thread-root-id="${fixture.rootId}"]`);
  await expect(card).toBeVisible();

  await page.evaluate(async () => {
    const name = (await indexedDB.databases()).find((db) =>
      db.name?.startsWith('mindroom-cache::')
    )?.name;
    if (!name) throw new Error('Thread cache database missing');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const state = window as typeof window & {
      releaseThreadCache?: () => void;
      threadCacheReadFinished?: boolean;
    };
    let keepAlive = true;
    const transaction = db.transaction(['events', 'meta'], 'readwrite');
    const store = transaction.objectStore('meta');
    await new Promise<void>((resolve, reject) => {
      let started = false;
      const pump = () => {
        const request = store.get('__thread_loading_probe__');
        request.onsuccess = () => {
          if (!started) {
            started = true;
            resolve();
          }
          if (keepAlive) pump();
        };
        request.onerror = () => reject(request.error);
      };
      pump();
    });
    state.threadCacheReadFinished = false;
    const read = db
      .transaction('events', 'readonly')
      .objectStore('events')
      .get('__thread_loading_probe__');
    read.onsuccess = () => {
      state.threadCacheReadFinished = true;
    };
    state.releaseThreadCache = () => {
      keepAlive = false;
      db.close();
    };
  });
  try {
    opening = true;
    await card.click();
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible();
    await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
    await expect(page.locator('[data-thread-context-summary="true"]').first()).toContainText(
      summary
    );
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { threadCacheReadFinished?: boolean }).threadCacheReadFinished
      )
    ).toBe(false);
    await expect(page.getByText('Failed to load this thread', { exact: true })).toHaveCount(0);
  } finally {
    await page.evaluate(() =>
      (window as typeof window & { releaseThreadCache?: () => void }).releaseThreadCache?.()
    );
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});
