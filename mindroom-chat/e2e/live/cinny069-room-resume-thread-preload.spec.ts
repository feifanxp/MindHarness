import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const iPhone13 = devices['iPhone 13'];

test.use({
  viewport: iPhone13.viewport,
  userAgent: iPhone13.userAgent,
  deviceScaleFactor: iPhone13.deviceScaleFactor,
  isMobile: iPhone13.isMobile,
  hasTouch: iPhone13.hasTouch,
});

const buildThreadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

const dispatchResumeSignals = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
  });
};

test.describe('room resume thread preload', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('refreshes all visible compact thread cards on resume without requiring a thread click', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomName = `CINNY-069 Resume ${stamp}`;
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Regression fixture for stale visible thread cards after page resume.',
    });

    const threads = await Promise.all(
      Array.from({ length: 3 }, async (_value, index) => {
        const rootBody = `CINNY-069 root ${index} ${stamp}`;
        const replyBody = `CINNY-069 reply ${index} ${stamp}`;
        const rootId = await sendRoomMessage(
          homeserver,
          session.accessToken,
          roomId,
          {
            msgtype: 'm.text',
            body: rootBody,
          },
          'cinny-069'
        );

        await sendRoomMessage(
          homeserver,
          session.accessToken,
          roomId,
          {
            msgtype: 'm.text',
            body: replyBody,
            'm.relates_to': buildThreadRelation(rootId),
          },
          'cinny-069'
        );

        return {
          rootBody,
          rootId,
          replyBody,
          latestReplyBody: `CINNY-069 reply latest ${index} ${stamp}`,
        };
      })
    );

    const threadLoadPattern = /\/_matrix\/client\/v1\/rooms\/.*\/(threads|relations)\b/;
    const blockedThreadLoadUrls: string[] = [];
    await page.route(threadLoadPattern, async (route) => {
      blockedThreadLoadUrls.push(decodeURIComponent(route.request().url()));
      await route.abort();
    });

    // While suspended, the page gets no new room data, as when its network stalls:
    // /sync responses are held (the long poll only looks slow) and room history
    // responses are dropped. Resuming re-enables thread loads alone, so only the
    // resume refresh can bring the cards up to date.
    let suspension: Promise<void> | undefined;
    let endSuspension = () => {};
    let heldSyncResponseCount = 0;
    await page.route(/\/_matrix\/client\/v3\/sync(\?|$)/, async (route) => {
      const response = await route.fetch({ timeout: 0 }).catch(() => undefined);
      if (!response) {
        await route.abort().catch(() => undefined);
        return;
      }
      if (suspension) {
        heldSyncResponseCount += 1;
        await suspension;
      }
      await route.fulfill({ response }).catch(() => undefined);
    });
    await page.route(
      /\/_matrix\/client\/v3\/rooms\/[^/]+\/(messages|event|context)\b/,
      async (route) => {
        const response = await route.fetch().catch(() => undefined);
        if (!response || suspension) {
          await route.abort().catch(() => undefined);
          return;
        }
        await route.fulfill({ response }).catch(() => undefined);
      }
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    blockedThreadLoadUrls.length = 0;
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 30_000 });

    const cards = threads.map(({ rootId }) => page.locator(`[data-thread-root-id="${rootId}"]`));
    await Promise.all(cards.map((card) => card.waitFor({ timeout: 30_000 })));
    // Each root's synced latest-reply bundle fills its card without loading the thread.
    await Promise.all(
      cards.map((card, index) =>
        expect(card).toContainText(threads[index].replyBody, { timeout: 30_000 })
      )
    );
    // Shown cards load their threads once the client is live; let those loads fail first.
    await expect
      .poll(
        () =>
          threads.every(({ rootId }) =>
            blockedThreadLoadUrls.some((url) => url.includes(`/relations/${rootId}`))
          ),
        { timeout: 60_000 }
      )
      .toBe(true);

    suspension = new Promise((resolve) => {
      endSuspension = resolve;
    });
    await Promise.all(
      threads.map(({ rootId, latestReplyBody }) =>
        sendRoomMessage(
          homeserver,
          session.accessToken,
          roomId,
          {
            msgtype: 'm.text',
            body: latestReplyBody,
            'm.relates_to': buildThreadRelation(rootId),
          },
          'cinny-069'
        )
      )
    );
    // /sync has answered since the replies were sent, but the page has not seen it.
    await expect.poll(() => heldSyncResponseCount, { timeout: 40_000 }).toBeGreaterThan(0);
    const staleCardTexts = await Promise.all(cards.map((card) => card.innerText()));
    staleCardTexts.forEach((cardText, index) => {
      expect(cardText).toContain(threads[index].rootBody);
      expect(cardText).toContain(threads[index].replyBody);
      expect(cardText).not.toContain(threads[index].latestReplyBody);
    });

    await page.unroute(threadLoadPattern);
    await dispatchResumeSignals(page);

    await Promise.all(
      cards.map((card, index) =>
        expect(card).toContainText(threads[index].latestReplyBody, { timeout: 30_000 })
      )
    );
    endSuspension();
    suspension = undefined;

    await cards[0].click();
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(threads[0].latestReplyBody)).toBeVisible({ timeout: 30_000 });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-069-room-resume-thread-preload');
  });
});
