import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getMessageComposer = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox').first();

const getZeroReplyThreadButton = (page: import('@playwright/test').Page, rootBody: string) =>
  page.getByRole('button', {
    name: new RegExp(`${escapeRegex(rootBody)}[\\s\\S]*0 replies`, 'i'),
  });

const getExpandedZeroReplyThreadButton = (
  page: import('@playwright/test').Page,
  rootBody: string
) =>
  page
    .locator('[data-message-item]', { hasText: rootBody })
    .getByRole('button', { name: /Thread 0 replies/i })
    .first();

const clickThreadExitButton = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => {
    const exitButton = document.querySelector('[data-thread-context-banner] button');
    if (!(exitButton instanceof HTMLButtonElement)) {
      throw new Error('Thread exit button not found');
    }
    exitButton.click();
  });
};

type DelayedUiSend = {
  waitForIntercept: () => Promise<void>;
  isReleased: () => boolean;
  dispose: () => Promise<void>;
};

const delayNextUiMessageSend = async (
  page: import('@playwright/test').Page,
  homeserver: string,
  roomId: string,
  delayMs = 4_000
): Promise<DelayedUiSend> => {
  const pattern = `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
    roomId
  )}/send/m.room.message/**`;
  let released = false;
  let handled = false;
  let interceptedResolver: (() => void) | undefined;
  const intercepted = new Promise<void>((resolve) => {
    interceptedResolver = resolve;
  });

  const handler = async (route: import('@playwright/test').Route) => {
    if (handled) {
      await route.continue();
      return;
    }

    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }

    handled = true;
    interceptedResolver?.();
    await page.waitForTimeout(delayMs);
    await route.continue();
    released = true;
  };

  await page.route(pattern, handler);

  return {
    waitForIntercept: () => intercepted,
    isReleased: () => released,
    dispose: async () => {
      await page.unroute(pattern, handler).catch(() => undefined);
    },
  };
};

const expectPendingThenConfirmedThreadRoute = async (page: import('@playwright/test').Page) => {
  await expect
    .poll(() => new URL(page.url()).searchParams.get('threadId'), {
      timeout: 30_000,
      message: 'Thread route should open on a provisional local-echo id first',
    })
    .toMatch(/^~/);

  await expect
    .poll(() => new URL(page.url()).searchParams.get('threadId'), {
      timeout: 30_000,
      message: 'Thread route should canonicalize to the confirmed root id',
    })
    .toMatch(/^\$/);
};

const prepareFreshRoom = async (viewMode: 'compact' | 'threaded') => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const stamp = Date.now();
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `CINNY-068 ${viewMode} ${stamp}`,
    topic: `Regression fixture for fresh zero-reply roots in ${viewMode} view`,
  });
  const rootBody = `CINNY-068 ${viewMode} fresh zero-reply root ${stamp}`;

  return {
    homeserver,
    username,
    password,
    userId: session.userId,
    roomId,
    rootBody,
  };
};

test.describe('live cinny-068 fresh zero-reply open', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('compact view automatically opens a fresh zero-reply root while the send request is still pending', async ({
    page,
  }, testInfo) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const { homeserver, username, password, userId, roomId, rootBody } = await prepareFreshRoom(
      'compact'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await waitForLoggedInShell(page);

    const delayedSend = await delayNextUiMessageSend(page, homeserver, roomId);
    try {
      const composer = getMessageComposer(page);
      await composer.click();
      await composer.fill(rootBody);
      await composer.press('Enter');

      await delayedSend.waitForIntercept();

      await expect
        .poll(() => new URL(page.url()).searchParams.get('threadId'), {
          timeout: 30_000,
          message: 'Compact root send should open its provisional local-echo route',
        })
        .toMatch(/^~/);
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByText('Replies are available after this message is confirmed.')
      ).toBeVisible();
      await expect(page.locator('[data-editable-name="RoomInput"]')).toHaveCount(0);
      await testInfo.attach('pending-root-replies-disabled', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      expect(delayedSend.isReleased()).toBe(false);

      await expect(page.getByText('Failed to load this thread')).toHaveCount(0);
      await expect
        .poll(() => new URL(page.url()).searchParams.get('threadId'), {
          timeout: 30_000,
          message: 'Thread route should canonicalize to the confirmed root id',
        })
        .toMatch(/^\$/);
      await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible();

      await clickThreadExitButton(page);
      await expect
        .poll(() => new URL(page.url()).searchParams.get('threadId'), {
          timeout: 10_000,
          message: 'Confirmed route should retain the original room exit target',
        })
        .toBeNull();
      await expect(getZeroReplyThreadButton(page, rootBody)).toBeVisible({ timeout: 30_000 });
      await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-068-compact');
    } finally {
      await delayedSend.dispose();
    }
  });

  test('expanded view opens a fresh zero-reply root while the send request is still pending', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const { homeserver, username, password, userId, roomId, rootBody } = await prepareFreshRoom(
      'threaded'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });

    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await waitForLoggedInShell(page);

    const delayedSend = await delayNextUiMessageSend(page, homeserver, roomId);
    try {
      const composer = getMessageComposer(page);
      await composer.click();
      await composer.fill(rootBody);
      await composer.press('Enter');

      await delayedSend.waitForIntercept();

      const threadButton = getExpandedZeroReplyThreadButton(page, rootBody);
      await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });
      await expect(threadButton).toBeVisible({ timeout: 30_000 });
      expect(delayedSend.isReleased()).toBe(false);

      await threadButton.click();
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Failed to load this thread')).toHaveCount(0);
      expect(delayedSend.isReleased()).toBe(false);

      await expectPendingThenConfirmedThreadRoute(page);
      await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-068-expanded');
    } finally {
      await delayedSend.dispose();
    }
  });
});
