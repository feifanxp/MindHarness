import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

/**
 * Opening a thread at its latest reply keeps paging older history in above
 * the reader. Once the opening pin lets go (a Load Older activation or a real
 * scroll gesture), each page that lands, and the Load Older chip that goes
 * with the last one, must leave the reader's rows in place. Continuation
 * pages are held until the interaction has settled, then land one by one.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = 250;
const PAGE_SPACING_MS = 400;

// Tall replies keep the opening window's first rows far above the reader. A
// gesture may also start scroll-driven back-pagination; its page is held with
// the opening chain's and must keep the reader in place too.
const replyHtml = (index: number): string =>
  `<p>Open chain reply <strong>${index}</strong></p>` +
  `<pre><code>function step${index}() {\n  return ${index};\n}</code></pre>` +
  `<ul><li>first point ${index}</li><li>second point ${index}</li></ul>`;

type Viewport = { bottomGap: number; scrollTop: number; threadCount: number };

const readViewport = (page: Page): Promise<Viewport> =>
  page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]');
    let scroller = inner?.parentElement ?? null;
    while (scroller && !/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    return {
      bottomGap: scroller
        ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
        : Number.NaN,
      scrollTop: scroller?.scrollTop ?? Number.NaN,
      threadCount: Number(inner?.dataset.threadCount ?? -1),
    };
  });

const openThreadWithHeldHistory = async (page: Page) => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Open chain anchor ${Date.now()}`,
  });
  const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Open chain anchor root',
  });
  const replyIds: string[] = [];
  for (let index = 1; index <= REPLY_COUNT; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const replyId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Open chain reply ${index}`,
      format: 'org.matrix.custom.html',
      formatted_body: replyHtml(index),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    replyIds.push(replyId);
  }

  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname.includes('/relations/') && url.searchParams.has('from'),
    async (route) => {
      await released;
      await new Promise((resolve) => {
        setTimeout(resolve, PAGE_SPACING_MS);
      });
      await route.continue().catch(() => undefined);
    }
  );
  await loginWithPassword(page, { homeserver, username, password });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  const latestReply = page.locator(`[data-message-id="${replyIds.at(-1)}"]`);
  await expect(latestReply).toBeInViewport({ ratio: 1, timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Load Older Messages', exact: true })).toBeAttached(
    { timeout: 30_000 }
  );
  expect((await readViewport(page)).threadCount).toBeLessThan(REPLY_COUNT + 1);
  return { latestReply, release, rootId };
};

const waitForWholeThread = async (page: Page) => {
  await expect
    .poll(async () => (await readViewport(page)).threadCount, { timeout: 60_000 })
    .toBe(REPLY_COUNT + 1);
  await expect(page.getByRole('button', { name: 'Load Older Messages', exact: true })).toHaveCount(
    0
  );
  // Let the ledger settle at rest.
  await page.waitForTimeout(1_000);
};

test.describe('thread open chain keeps an unpinned reader in place', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(240_000);

  test('a Load Older activation at the latest reply keeps the latest reply in view', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const { latestReply, release } = await openThreadWithHeldHistory(page);

    // DOM activation, as in loadAllOlderThreadMessages: no scroll, no pointer.
    await page
      .getByRole('button', { name: 'Load Older Messages', exact: true })
      .evaluate((button) => (button as HTMLElement).click());
    const latestTop = await latestReply.evaluate((row) => row.getBoundingClientRect().top);
    release();
    await waitForWholeThread(page);

    await expect(latestReply).toBeInViewport({ ratio: 1 });
    const top = await latestReply.evaluate((row) => row.getBoundingClientRect().top);
    expect(Math.abs(top - latestTop)).toBeLessThanOrEqual(1);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-open-chain-load-older');
  });

  test('a reader who scrolled up keeps their rows while history lands above', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const { latestReply, release, rootId } = await openThreadWithHeldHistory(page);

    await latestReply.hover();
    await page.mouse.wheel(0, -400);
    let lastScrollTop = Number.NaN;
    await expect
      .poll(async () => {
        const { bottomGap, scrollTop } = await readViewport(page);
        const settled = bottomGap > 100 && scrollTop === lastScrollTop;
        lastScrollTop = scrollTop;
        return settled;
      })
      .toBe(true);
    const anchor = await page.evaluate((threadRootId) => {
      const inner = document.querySelector<HTMLElement>('[data-thread-count]');
      let scroller = inner?.parentElement ?? null;
      while (scroller && !/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      if (!scroller) return undefined;
      const viewport = scroller.getBoundingClientRect();
      const row = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).find(
        (item) => {
          const rect = item.getBoundingClientRect();
          return (
            item.dataset.messageId !== threadRootId &&
            rect.top >= viewport.top &&
            rect.bottom <= viewport.bottom
          );
        }
      );
      const eventId = row?.dataset.messageId;
      return row && eventId ? { eventId, top: row.getBoundingClientRect().top } : undefined;
    }, rootId);
    if (!anchor) throw new Error('No fully visible reply after scrolling up');

    release();
    await waitForWholeThread(page);

    const anchorRow = page.locator(`[data-message-id="${anchor.eventId}"]`);
    await expect(anchorRow).toBeInViewport();
    const top = await anchorRow.evaluate((row) => row.getBoundingClientRect().top);
    expect(Math.abs(top - anchor.top)).toBeLessThanOrEqual(1);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-open-chain-wheel');
  });

  test('a reader at the root keeps it in place while history lands below it', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const { latestReply, release, rootId } = await openThreadWithHeldHistory(page);

    // Real gestures let the opening pin go and reach the root. Once scrolling
    // rests, the top of the reader's view (below the sticky headers, the
    // scroller's scroll-padding-top) goes 20px into the root: the root is the
    // reader's row while replies land after it and Load Older goes.
    await latestReply.hover();
    const root = page.locator(`[data-message-id="${rootId}"]`);
    await expect
      .poll(
        async () => {
          if ((await root.count()) > 0) return true;
          await page.mouse.wheel(0, -3000);
          return false;
        },
        { timeout: 60_000 }
      )
      .toBe(true);
    const intoRoot = () =>
      root.evaluate((row) => {
        let scroller = row.parentElement;
        while (scroller && !/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
          scroller = scroller.parentElement;
        }
        return scroller
          ? scroller.getBoundingClientRect().top +
              (Number.parseFloat(window.getComputedStyle(scroller).scrollPaddingTop) || 0) -
              row.getBoundingClientRect().top
          : Number.NaN;
      });
    let lastInto = Number.NaN;
    const rested = async () => {
      const into = await intoRoot();
      const still = into === lastInto;
      lastInto = into;
      return still;
    };
    await expect.poll(rested).toBe(true);
    await root.evaluate((row, into) => {
      let scroller = row.parentElement;
      while (scroller && !/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      if (scroller) scroller.scrollTop += 20 - into;
    }, lastInto);
    await expect.poll(rested).toBe(true);
    expect(Math.abs(lastInto - 20)).toBeLessThanOrEqual(1);
    const rootTop = await root.evaluate((row) => row.getBoundingClientRect().top);

    release();
    await waitForWholeThread(page);

    const top = await root.evaluate((row) => row.getBoundingClientRect().top);
    expect(Math.abs(top - rootTop)).toBeLessThanOrEqual(1);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-open-chain-root');
  });
});
