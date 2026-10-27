import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

/**
 * Older history that lands above a reader is folded into the offset ledger,
 * and the fold is settled with a scrollTop write once scrolling rests. A
 * wheel that arrives just before that write must still move the view: WebKit
 * cancels a wheel scroll that a scrollTop write lands on before its first
 * step. On dev, a run without any harness hit this with the wheel dispatched
 * 154 ms after the fold, the settle 1 ms later, and the view not moving at
 * all. Chromium keeps the wheel: it applies the wheel from the new offset.
 *
 * The harness pins that timing. While a fold is pending it restarts the
 * settle wait's quiet window with a scrollend, as when the reader's last
 * scroll has just ended, and keeps the timers that window arms. When the
 * wheel arrives it ends that window right after the wheel's dispatch, before
 * the wheel's first frame, unless the wait has replaced its timer by then.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = 250;
const WHEEL_PX = 300;

const replyHtml = (index: number): string =>
  `<p>Wheel settle reply <strong>${index}</strong></p>` +
  `<pre><code>function step${index}() {\n  return ${index};\n}</code></pre>` +
  `<ul><li>first point ${index}</li><li>second point ${index}</li></ul>`;

type Harness = { foldPending: boolean; margin: string; wheelWithSettleDue: boolean };

const readHarness = (page: Page): Promise<Harness> =>
  page.evaluate(() => (window as unknown as { __wheelSettle: () => Harness }).__wheelSettle());

const installHarness = (page: Page) =>
  page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]')!;
    let scroller = inner.parentElement!;
    while (!/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement!;
    }
    // Timers armed while the harness dispatches a scrollend are the settle
    // wait's quiet window; one the wait clears has been replaced.
    const realSetTimeout = window.setTimeout;
    const realClearTimeout = window.clearTimeout;
    const cleared = new Set<number | undefined>();
    let quietTimers: Array<{ id: number; run: () => void }> = [];
    let capturing = false;
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = realSetTimeout(handler, delay, ...args);
      if (capturing && typeof handler === 'function') {
        quietTimers.push({ id, run: () => (handler as (...a: unknown[]) => void)(...args) });
      }
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      cleared.add(id);
      realClearTimeout(id);
    }) as typeof window.clearTimeout;
    const restartQuietWindow = () => {
      quietTimers = [];
      capturing = true;
      scroller.dispatchEvent(new Event('scrollend'));
      capturing = false;
    };

    let armed = false;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let wheelWithSettleDue = false;
    new MutationObserver(() => {
      if (!armed || inner.style.marginTop === '') return;
      armed = false;
      restartQuietWindow();
      keepalive = setInterval(restartQuietWindow, 100);
    }).observe(inner, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener(
      'wheel',
      () => {
        if (keepalive === undefined) return;
        clearInterval(keepalive);
        keepalive = undefined;
        const due = quietTimers;
        if (due.length === 0) return;
        wheelWithSettleDue = true;
        // A message runs after this dispatch and before the next frame.
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          due
            .filter(({ id }) => !cleared.has(id))
            .forEach(({ id, run }) => {
              realClearTimeout(id);
              run();
            });
        };
        channel.port2.postMessage(null);
      },
      { capture: true, passive: true }
    );
    const harness = window as unknown as {
      __wheelSettleArm: () => void;
      __wheelSettle: () => Harness;
    };
    harness.__wheelSettleArm = () => {
      armed = true;
      wheelWithSettleDue = false;
    };
    harness.__wheelSettle = () => ({
      foldPending: keepalive !== undefined,
      margin: inner.style.marginTop,
      wheelWithSettleDue,
    });
  });

// page.route cannot see the requests WebKit's service worker makes.
test.use({ serviceWorkers: 'block' });

test.describe('a wheel right as a ledger settle runs', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(240_000);

  test('moves the view while older history lands above the reader', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Wheel settle ${Date.now()}`,
      topic: 'Ledger settle wheel fixture',
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Wheel settle root',
    });
    let latestReplyId = '';
    for (let index = 1; index <= REPLY_COUNT; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      latestReplyId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Wheel settle reply ${index}`,
        format: 'org.matrix.custom.html',
        formatted_body: replyHtml(index),
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    }

    // Older pages wait here and land one at a time.
    const held: Array<() => void> = [];
    await page.route(
      (url) => url.pathname.includes('/relations/') && url.searchParams.has('from'),
      async (route) => {
        await new Promise<void>((resolve) => {
          held.push(resolve);
        });
        await route.continue().catch(() => undefined);
      }
    );
    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    const latestReply = page.locator(`[data-message-id="${latestReplyId}"]`);
    await expect(latestReply).toBeInViewport({ ratio: 1, timeout: 60_000 });
    await expect(
      page.getByRole('button', { name: 'Load Older Messages', exact: true })
    ).toBeAttached({ timeout: 30_000 });

    // A real gesture lets the opening pin go, so landed pages fold.
    await latestReply.hover();
    await page.mouse.wheel(0, -400);
    let lastScrollTop = Number.NaN;
    await expect
      .poll(async () => {
        const { scrollTop } = await readViewportTop(page);
        const still = scrollTop === lastScrollTop;
        lastScrollTop = scrollTop;
        return still;
      })
      .toBe(true);
    await installHarness(page);

    for (let landing = 1; landing <= 2; landing += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() =>
        (window as unknown as { __wheelSettleArm: () => void }).__wheelSettleArm()
      );
      // Not every page adds rows above the reader; release pages until one does.
      // eslint-disable-next-line no-await-in-loop
      await expect
        .poll(
          async () => {
            if ((await readHarness(page)).foldPending) return true;
            held.shift()?.();
            return false;
          },
          { timeout: 60_000, intervals: [1_500] }
        )
        .toBe(true);
      // eslint-disable-next-line no-await-in-loop
      const before = await readViewportTop(page);
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -WHEEL_PX);
      // Rest: the fold has settled and the offset stopped moving.
      let lastTop = Number.NaN;
      // eslint-disable-next-line no-await-in-loop
      await expect
        .poll(async () => {
          const harness = await readHarness(page);
          const { rowTop } = await readViewportTop(page, before.eventId);
          const still = harness.margin === '' && rowTop === lastTop;
          lastTop = rowTop;
          return still;
        })
        .toBe(true);
      // eslint-disable-next-line no-await-in-loop
      expect(
        (await readHarness(page)).wheelWithSettleDue,
        'the wheel arrived with the settle due'
      ).toBe(true);
      // eslint-disable-next-line no-await-in-loop
      const after = await readViewportTop(page, before.eventId);
      expect(
        after.rowTop - before.rowTop,
        `landing ${landing}: the wheel moved the view`
      ).toBeGreaterThan(WHEEL_PX / 2);
    }
    while (held.length) held.shift()!();
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-wheel-at-settle');
  });
});

// The reply nearest the middle of the view, or the given reply, and its top.
const readViewportTop = (
  page: Page,
  eventId?: string
): Promise<{ eventId: string; rowTop: number; scrollTop: number }> =>
  page.evaluate((id) => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]')!;
    let scroller = inner.parentElement!;
    while (!/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement!;
    }
    const box = scroller.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]'));
    const row = id
      ? rows.find((item) => item.dataset.messageId === id)
      : rows.find((item) => {
          const rect = item.getBoundingClientRect();
          return rect.top <= middle && rect.bottom >= middle;
        });
    return {
      eventId: row?.dataset.messageId ?? '',
      rowTop: row?.getBoundingClientRect().top ?? Number.NaN,
      scrollTop: scroller.scrollTop,
    };
  }, eventId);
