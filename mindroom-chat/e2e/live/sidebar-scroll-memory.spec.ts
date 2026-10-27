import { expect, type Page, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  loginToMatrix,
  sendRoomMessage,
} from '../helpers/matrix';

const FILLER_ROOM_COUNT = 25;

type ThreadSeed = { roomId: string; rootId: string; body: string };

const navScrollTop = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector('[data-testid="room-nav-category"]');
    let node = list?.parentElement ?? null;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    return node?.scrollTop ?? -1;
  });

// Scrolling a row into view lets the virtualizer measure rows and correct the
// offset over the next frames, so compare against the settled position.
const settledNavScrollTop = (page: Page) =>
  page.evaluate(async () => {
    const list = document.querySelector('[data-testid="room-nav-category"]');
    let node = list?.parentElement ?? null;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    if (!node) return -1;
    let previous = node.scrollTop;
    for (let stableFrames = 0, frames = 0; stableFrames < 5 && frames < 120; frames += 1) {
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
      stableFrames = node.scrollTop === previous ? stableFrames + 1 : 0;
      previous = node.scrollTop;
    }
    return previous;
  });

const expectNavScrollRestored = async (page: Page, before: number) => {
  const isRestored = async () => Math.abs((await navScrollTop(page)) - before) <= 1;
  await expect.poll(isRestored).toBe(true);
  // A late reset after the first restored frame is the reported failure.
  await page.waitForTimeout(500);
  expect(await isRestored()).toBe(true);
};

test('the navigation panel keeps its scroll position across thread and room opens', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  const homeserver = getHomeserver();
  test.skip(
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
    'Local fixture only'
  );
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const runTag = Date.now().toString(36);
  // Home sorts rooms A to Z; other live specs leave rooms in a shared account,
  // so these sort last to stay among the rendered rows near the thread list.
  const roomName = (index: number) =>
    `Zz nav scroll ${runTag} room ${String(index).padStart(2, '0')}`;
  const roomIds: string[] = [];
  for (let index = 0; index < FILLER_ROOM_COUNT; index += 1) {
    roomIds.push(
      await createPrivateRoom(homeserver, session.accessToken, { name: roomName(index) })
    );
  }
  const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
    name: `Zz nav scroll ${runTag} space`,
  });
  const spaceRoomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Zz nav scroll ${runTag} space room`,
  });
  await addRoomToSpace(homeserver, session.accessToken, spaceId, spaceRoomId);
  const threads: ThreadSeed[] = [];
  for (const [index, roomId] of [roomIds[0], roomIds[1]].entries()) {
    const body = `Zz nav scroll ${runTag} thread ${index}`;
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Reply to ${body}`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    threads.push({ roomId, rootId, body });
  }

  await loginWithPassword(page, { homeserver, ...credentials });
  const panel = page.getByTestId('resizable-page-nav');
  const threadButton = (thread: ThreadSeed) =>
    panel
      .getByTestId('thread-nav-list')
      .getByRole('button', { name: new RegExp(`^Open thread: ${thread.body}\\.`) });
  const roomLink = (index: number) =>
    panel.getByRole('link', { name: roomName(index), exact: true });
  const openThreadFromNav = async (thread: ThreadSeed) => {
    await expect(threadButton(thread)).toBeAttached();
    // The sync bar changes the available scroll range when it disappears.
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 45_000 });
    await threadButton(thread).scrollIntoViewIfNeeded();
    const before = await settledNavScrollTop(page);
    expect(before).toBeGreaterThan(100);
    await threadButton(thread).click();
    await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(thread.rootId)}`));
    await expect(page.getByText(`Reply to ${thread.body}`, { exact: true })).toBeVisible();
    return before;
  };

  await test.step('desktop thread opens keep the shared navigation panel in place', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/home/${encodeURIComponent(roomIds[0])}`);
    for (const thread of threads) {
      const before = await openThreadFromNav(thread);
      await expectNavScrollRestored(page, before);
    }
  });

  await test.step('desktop space switches return Home to its previous position', async () => {
    const before = await settledNavScrollTop(page);
    await page.locator(`button[data-id="${spaceId}"]`).click();
    await expect(
      panel.getByRole('link', { name: `Zz nav scroll ${runTag} space room`, exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(threadButton(threads[0])).toBeAttached();
    await expectNavScrollRestored(page, before);
  });

  await test.step('mobile thread opens return to the same navigation position', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/home/');
    for (const thread of threads) {
      const before = await openThreadFromNav(thread);
      await page.goBack();
      await expect(threadButton(thread)).toBeAttached();
      await expectNavScrollRestored(page, before);
    }
  });

  await test.step('mobile room opens return to the same navigation position', async () => {
    const link = roomLink(FILLER_ROOM_COUNT - 5);
    await link.scrollIntoViewIfNeeded();
    const before = await settledNavScrollTop(page);
    expect(before).toBeGreaterThan(100);
    await link.click();
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(roomIds[FILLER_ROOM_COUNT - 5])));
    await page.goBack();
    await expect(link).toBeAttached();
    await expectNavScrollRestored(page, before);
  });
});

const RECENT_THREAD_COUNT = 10;
const RECENT_LIST = '[data-testid="recently-opened-nav-list"]';

// Each fully visible Recently Opened row's top relative to the list's
// viewport, by its title, once the list has stopped moving.
const settledRecentRowOffsets = (page: Page) =>
  page.evaluate(async (selector) => {
    const list = document.querySelector<HTMLElement>(selector);
    if (!list) return {};
    let previous = list.scrollTop;
    for (let stableFrames = 0, frames = 0; stableFrames < 5 && frames < 120; frames += 1) {
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
      stableFrames = list.scrollTop === previous ? stableFrames + 1 : 0;
      previous = list.scrollTop;
    }
    const { top, bottom } = list.getBoundingClientRect();
    const offsets: Record<string, number> = {};
    list.querySelectorAll<HTMLButtonElement>('button[title]').forEach((row) => {
      const rect = row.getBoundingClientRect();
      if (rect.top >= top && rect.bottom <= bottom) offsets[row.title] = rect.top - top;
    });
    return offsets;
  }, RECENT_LIST);

test('Recently Opened keeps its rows in place across thread opens', async ({ page }) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  const homeserver = getHomeserver();
  test.skip(
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
    'Local fixture only'
  );
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const runTag = Date.now().toString(36);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Recent scroll ${runTag}`,
  });
  const threads: ThreadSeed[] = [];
  for (let index = 0; index < RECENT_THREAD_COUNT; index += 1) {
    const body = `Recent scroll ${runTag} thread ${index}`;
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    threads.push({ roomId, rootId, body });
  }

  await loginWithPassword(page, { homeserver, ...credentials });
  await page.evaluate(
    ({ userId, entries }) => {
      localStorage.setItem(`recentThreads:${userId}`, JSON.stringify({ v: 1, entries }));
    },
    {
      userId: session.userId,
      entries: threads.map((thread, index) => ({
        roomId: thread.roomId,
        threadId: thread.rootId,
        openedAt: Date.now() - index * 1000,
        summaryText: thread.body,
      })),
    }
  );
  const categoryButton = page.locator('button[data-category-id="mindroom|recently-opened"]');
  const rows = page.locator(`${RECENT_LIST} button[title]`);
  const showRecentlyOpened = async () => {
    await expect(categoryButton).toBeVisible();
    if ((await page.locator(RECENT_LIST).count()) === 0) await categoryButton.click();
    await expect(rows).toHaveCount(RECENT_THREAD_COUNT);
  };

  // Opens the second row in view, which moves to the top of the list; after
  // `returnToList`, the rows below it must be exactly where they were.
  const openRowAndReturn = async (returnToList: () => Promise<void>) => {
    await page.evaluate((selector) => {
      document.querySelector<HTMLElement>(selector)!.scrollTop = 90;
    }, RECENT_LIST);
    const before = await settledRecentRowOffsets(page);
    const inView = Object.keys(before);
    const below = inView.slice(2);
    expect(below.length).toBeGreaterThan(2);
    const opened = threads.find((thread) => inView[1].endsWith(thread.body))!;
    await rows.filter({ hasText: opened.body }).click();
    await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(opened.rootId)}`));
    await expect(page.getByText(opened.body).last()).toBeVisible();

    await returnToList();
    await expect(rows.first()).toHaveAttribute('title', new RegExp(`${opened.body}$`));
    const after = await settledRecentRowOffsets(page);
    for (const title of below) {
      expect(
        Math.abs(after[title] - before[title]),
        `${title} moved from ${before[title]} to ${after[title]}`
      ).toBeLessThanOrEqual(1);
    }
  };

  await test.step('desktop collapse and expand', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/home/');
    await showRecentlyOpened();
    await openRowAndReturn(async () => {
      await categoryButton.click();
      await expect(page.locator(RECENT_LIST)).toHaveCount(0);
      await categoryButton.click();
    });
  });

  await test.step('mobile thread open and back', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/home/');
    await showRecentlyOpened();
    await openRowAndReturn(() => page.goBack());
  });
});
