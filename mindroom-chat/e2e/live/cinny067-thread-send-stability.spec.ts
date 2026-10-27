import { devices, expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import { createThreadFixture, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = 8;
const iPhone13 = devices['iPhone 13'];

const getThreadScrollState = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-message-item]');
    let scrollElement: HTMLElement | null = row?.parentElement ?? null;
    while (scrollElement) {
      const { overflowY } = window.getComputedStyle(scrollElement);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        scrollElement.scrollHeight > scrollElement.clientHeight
      ) {
        break;
      }
      scrollElement = scrollElement.parentElement;
    }

    if (!scrollElement) {
      throw new Error('Thread scroll container not found');
    }

    return {
      clientHeight: scrollElement.clientHeight,
      scrollHeight: scrollElement.scrollHeight,
      scrollTop: scrollElement.scrollTop,
    };
  });

const scrollThreadUp = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-message-item]');
    let scrollElement: HTMLElement | null = row?.parentElement ?? null;
    while (scrollElement) {
      const { overflowY } = window.getComputedStyle(scrollElement);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        scrollElement.scrollHeight > scrollElement.clientHeight
      ) {
        break;
      }
      scrollElement = scrollElement.parentElement;
    }
    if (!scrollElement) return false;

    scrollElement.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -300 }));
    scrollElement.scrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight - 300
    );
    scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
  });

const runThreadSendStabilityAssertions = async (page: Page) => {
  const diagnostics = attachBrowserDiagnostics(page);
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const stamp = Date.now();
  const fixture = await createThreadFixture(homeserver, session.accessToken, {
    name: `CINNY-067 ${stamp}`,
    topic: 'Regression fixture for in-thread send route stability',
    rootBody: `CINNY-067 root ${stamp}`,
    replyBody: `CINNY-067 existing reply ${stamp}`,
    txnPrefix: 'cinny-067',
  });
  const uiReplyBody = `CINNY-067 ui reply ${stamp}`;
  const scrolledUpReplyBody = `CINNY-067 scrolled-up reply ${stamp}`;
  let lastSeededReplyBody = fixture.replyBody;

  await loginWithPassword(page, { homeserver, username, password });

  for (let index = 2; index <= REPLY_COUNT; index += 1) {
    lastSeededReplyBody = [
      `CINNY-067 existing reply ${index} ${stamp}`,
      ...Array.from({ length: 8 }, (_, line) => `scroll fixture line ${line + 1}`),
    ].join('\n');
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(
      homeserver,
      session.accessToken,
      fixture.roomId,
      {
        msgtype: 'm.text',
        body: lastSeededReplyBody,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: fixture.rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: fixture.rootId },
        },
      },
      `cinny-067-reply-${index}`
    );
  }

  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );

  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
  // The root can be outside the virtualized window while viewing the latest reply.
  await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBe(fixture.rootId);
  await expect(page.getByText(lastSeededReplyBody)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => {
      const state = await getThreadScrollState(page);
      return state.scrollHeight - state.scrollTop - state.clientHeight;
    })
    .toBeLessThanOrEqual(48);

  await page.evaluate(() => {
    const samples: Array<string | null> = [
      new URL(window.location.href).searchParams.get('threadId'),
    ];
    const timer = window.setInterval(() => {
      samples.push(new URL(window.location.href).searchParams.get('threadId'));
    }, 20);

    (
      window as typeof window & {
        __cinny067ThreadRouteProbe?: { samples: Array<string | null>; timer: number };
      }
    ).__cinny067ThreadRouteProbe = { samples, timer };
  });

  const composer = page.getByRole('textbox').first();
  const sendButton = page.getByRole('button', { name: 'Send message' });
  await composer.click();
  await composer.fill(uiReplyBody);
  await sendButton.click();

  await expect(page.getByText(uiReplyBody)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(uiReplyBody)).toBeInViewport({ timeout: 30_000 });
  await expect
    .poll(async () => {
      const state = await getThreadScrollState(page);
      return state.scrollHeight - state.scrollTop - state.clientHeight;
    })
    .toBeLessThanOrEqual(48);
  await expect(page.getByText('Failed to load this thread')).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('threadId'), {
      timeout: 30_000,
      message: 'Thread route should stay anchored to the root event after sending a reply',
    })
    .toBe(fixture.rootId);

  expect(await scrollThreadUp(page)).toBe(true);
  await expect
    .poll(async () => {
      const state = await getThreadScrollState(page);
      return state.scrollHeight - state.scrollTop - state.clientHeight;
    })
    .toBeGreaterThan(200);
  const scrolledUpState = await getThreadScrollState(page);

  await composer.click();
  await composer.fill(scrolledUpReplyBody);
  await sendButton.click();

  await expect(page.getByText(scrolledUpReplyBody)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await getThreadScrollState(page)).scrollHeight, {
      timeout: 30_000,
      message: 'The second local echo should render and increase the thread height',
    })
    .toBeGreaterThan(scrolledUpState.scrollHeight);

  const afterScrolledUpSend = await getThreadScrollState(page);
  expect(
    afterScrolledUpSend.scrollHeight -
      afterScrolledUpSend.scrollTop -
      afterScrolledUpSend.clientHeight
  ).toBeGreaterThan(200);
  expect(Math.abs(afterScrolledUpSend.scrollTop - scrolledUpState.scrollTop)).toBeLessThan(100);

  const routeSamples = await page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __cinny067ThreadRouteProbe?: { samples: Array<string | null>; timer: number };
      }
    ).__cinny067ThreadRouteProbe;

    if (!probe) return [];

    window.clearInterval(probe.timer);
    return probe.samples;
  });

  expect(routeSamples.length).toBeGreaterThan(0);
  expect(routeSamples.every((threadId) => threadId === fixture.rootId)).toBe(true);

  await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-send-stability');
};

test.describe('thread send stability', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(300_000);

  test('desktop follows only from the bottom and keeps the thread route', async ({ page }) => {
    await runThreadSendStabilityAssertions(page);
  });

  test.describe('iPhone 13', () => {
    test.use({
      viewport: iPhone13.viewport,
      userAgent: iPhone13.userAgent,
      deviceScaleFactor: iPhone13.deviceScaleFactor,
      isMobile: iPhone13.isMobile,
      hasTouch: iPhone13.hasTouch,
    });

    test('follows only from the bottom and keeps the thread route', async ({ page }) => {
      await runThreadSendStabilityAssertions(page);
    });
  });
});
