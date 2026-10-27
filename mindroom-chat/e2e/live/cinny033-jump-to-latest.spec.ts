import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const ROOM_MESSAGE_COUNT = 140;

const scrollTimelineToTop = async (page: Page, visibleMarkerText: string) => {
  await page.evaluate((markerText) => {
    const candidate = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (element) => element.textContent?.includes(markerText)
    );

    if (!candidate) {
      throw new Error(`Unable to find visible message containing "${markerText}"`);
    }

    let current: HTMLElement | null = candidate;
    while (current) {
      const { overflowY } = getComputedStyle(current);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        current.scrollHeight > current.clientHeight + 20
      ) {
        current.scrollTop = 0;
        current.dispatchEvent(new Event('scroll', { bubbles: true }));
        return;
      }
      current = current.parentElement;
    }

    throw new Error('Unable to find a scrollable room timeline container');
  }, visibleMarkerText);
};

test.describe('live CINNY-033 jump to latest', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('Jump to Latest stays hidden at bottom and appears only after scrolling away', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `CINNY-033 Jump ${stamp}`,
      topic: 'Live fixture for jump-to-latest visibility.',
    });

    let latestBody = '';
    for (let index = 0; index < ROOM_MESSAGE_COUNT; index += 1) {
      latestBody = `CINNY-033 message ${index + 1} ${stamp}`;
      await sendRoomMessage(
        homeserver,
        session.accessToken,
        roomId,
        {
          msgtype: 'm.text',
          body: latestBody,
        },
        'cinny-033'
      );
    }

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await page.evaluate((nextRoomId) => {
      localStorage.setItem(`roomViewMode:${nextRoomId}`, JSON.stringify('threaded'));
    }, roomId);

    await page.goto(`/home/${encodeURIComponent(roomId)}`);

    const latestMessage = page.locator('[data-message-id]').filter({ hasText: latestBody }).first();
    await expect(latestMessage).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Jump to Latest')).toHaveCount(0);

    await scrollTimelineToTop(page, latestBody);
    await expect(page.getByText('Jump to Latest')).toBeVisible({ timeout: 10_000 });

    await page.getByText('Jump to Latest').click();
    await expect(latestMessage).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Jump to Latest')).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-033-jump-to-latest');
  });
});
