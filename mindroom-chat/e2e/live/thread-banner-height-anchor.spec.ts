import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createPrivateRoom,
  loginToMatrix,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';

/**
 * The thread banner is sticky but sits in the scroll content above the rows,
 * so a change of its height (a summary arriving, the thread being resolved or
 * reopened) moves every row by that amount. A reader in the rows must keep
 * them in place, without a ResizeObserver loop error.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = 40;

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

type Fixture = { homeserver: string; session: MatrixSession; roomId: string; rootId: string };

const openThread = async (page: Page, { tagged = false } = {}): Promise<Fixture> => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Banner anchor ${Date.now()}`,
  });
  const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Banner anchor root',
  });
  for (let index = 1; index <= REPLY_COUNT; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Banner anchor reply ${index}\nA second line keeps every reply two lines tall.`,
      'm.relates_to': threadRelation(rootId),
    });
  }
  if (tagged) {
    await sendStateEvent(
      homeserver,
      session.accessToken,
      roomId,
      'com.mindroom.thread.tags',
      rootId,
      {
        tags: { anchor: { set_by: session.userId, set_at: new Date().toISOString() } },
      }
    );
  }
  await page.addInitScript(() => {
    window.addEventListener('error', (event) => {
      if (!/ResizeObserver loop/.test(event.message)) return;
      const probe = window as unknown as { resizeObserverLoops?: number };
      probe.resizeObserverLoops = (probe.resizeObserverLoops ?? 0) + 1;
    });
  });
  await loginWithPassword(page, { homeserver, username, password });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  // The "Catching up" bar above the room goes with the next sync, which the
  // banner change itself brings, and would move the scroller mid-check.
  await page.addStyleTag({
    content: '[data-testid="client-sync-status"] { display: none !important; }',
  });
  await expect(page.getByText(`Banner anchor reply ${REPLY_COUNT}`, { exact: false })).toBeVisible({
    timeout: 60_000,
  });
  // The whole thread, so no page or Load Older fold lands during a check.
  await expect(page.locator('[data-thread-count]')).toHaveAttribute(
    'data-thread-count',
    String(REPLY_COUNT + 1),
    { timeout: 60_000 }
  );
  await expect(page.getByRole('button', { name: 'Load Older Messages', exact: true })).toHaveCount(
    0
  );
  return { homeserver, session, roomId, rootId };
};

const scroller = (page: Page) => page.locator('[data-thread-count]').locator('xpath=../..');
const bannerHeight = async (page: Page) =>
  (await page.locator('[data-thread-context-banner="true"]').boundingBox())!.height;
const bottomGap = (page: Page) =>
  scroller(page).evaluate(
    (element) => element.scrollHeight - element.clientHeight - element.scrollTop
  );

const waitForRest = async (page: Page) => {
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const scrollTop = await scroller(page).evaluate((element) => element.scrollTop);
      const still = scrollTop === last;
      last = scrollTop;
      return still;
    })
    .toBe(true);
};

const scrollMidThread = async (page: Page) => {
  const box = (await scroller(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, -300);
      await waitForRest(page);
      return bottomGap(page);
    })
    .toBeGreaterThan(400);
};

/** Rows' tops relative to the scroller, which can itself move on the page. */
const rowTops = (page: Page) =>
  scroller(page).evaluate((element) => {
    const viewport = element.getBoundingClientRect();
    return Object.fromEntries(
      Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).map((row) => [
        row.dataset.messageId!,
        row.getBoundingClientRect().top - viewport.top,
      ])
    );
  });

/** The reply nearest the middle of the viewport stays where it was. */
const expectReaderHeld = async (page: Page, change: () => Promise<void>) => {
  const before = await rowTops(page);
  const clientHeight = await scroller(page).evaluate((element) => element.clientHeight);
  const [readerId, readerTop] = Object.entries(before)
    .filter(([, top]) => top > 0 && top < clientHeight - 100)
    .sort(([, a], [, b]) => Math.abs(a - clientHeight / 2) - Math.abs(b - clientHeight / 2))[0];
  const height = await bannerHeight(page);
  await change();
  await expect.poll(() => bannerHeight(page)).not.toBe(height);
  // Let the timeline settle.
  await page.waitForTimeout(1_000);
  expect(Math.abs((await rowTops(page))[readerId] - readerTop)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { resizeObserverLoops?: number }).resizeObserverLoops ?? 0
    )
  ).toBe(0);
};

const resolve = ({ homeserver, session, roomId, rootId }: Fixture, resolved: boolean) =>
  sendStateEvent(
    homeserver,
    session.accessToken,
    roomId,
    'com.mindroom.thread.tags',
    JSON.stringify([rootId, 'resolved']),
    resolved ? { set_by: session.userId, set_at: new Date().toISOString() } : {}
  );

test.describe('thread banner height changes keep the reader in place', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(180_000);

  test('a thread summary arriving keeps a mid-thread reader in place', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    // A title replaces the "Thread View" eyebrow in the same row; with a tag,
    // the eyebrow row stays for the tags and the title adds a row below it.
    const fixture = await openThread(page, { tagged: true });
    await scrollMidThread(page);
    await expectReaderHeld(page, async () => {
      await sendRoomMessage(fixture.homeserver, fixture.session.accessToken, fixture.roomId, {
        msgtype: 'm.notice',
        body: 'Banner anchor summary',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Banner anchor summary',
          generated_at: Date.now(),
          message_count: REPLY_COUNT,
        },
        'm.relates_to': threadRelation(fixture.rootId),
      });
    });
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-banner-summary');
  });

  // Banner state of its own: no timeline commit carries these changes.
  test('resolving and reopening the thread keeps a mid-thread reader in place', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const fixture = await openThread(page);
    await scrollMidThread(page);
    await expectReaderHeld(page, () => resolve(fixture, true));
    await expectReaderHeld(page, () => resolve(fixture, false));
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-banner-resolve');
  });

  // A shrink that reached layout before its fold would clamp the scroll here.
  test('a reader at the latest reply stays there as the banner grows and shrinks', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const fixture = await openThread(page);
    // The opening can rest a few pixels short of the bottom.
    await scroller(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await waitForRest(page);
    expect(await bottomGap(page)).toBeLessThan(1);
    await expectReaderHeld(page, () => resolve(fixture, true));
    expect(await bottomGap(page)).toBeLessThan(1);
    await expectReaderHeld(page, () => resolve(fixture, false));
    expect(await bottomGap(page)).toBeLessThan(1);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-banner-latest');
  });
});
