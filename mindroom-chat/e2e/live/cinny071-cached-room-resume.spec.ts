import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  loginToMatrix,
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

const delayFirstSync = async (
  page: import('@playwright/test').Page,
  delayMs = 8_000
): Promise<() => Promise<void>> => {
  const syncPattern = /\/_matrix\/client\/(?:v3|r0)\/sync(?:\?|$)/;
  let handled = false;

  const handler = async (route: import('@playwright/test').Route) => {
    if (handled) {
      await route.continue();
      return;
    }

    handled = true;
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
    await route.continue();
  };

  await page.route(syncPattern, handler);

  return async () => {
    await page.unroute(syncPattern, handler).catch(() => undefined);
  };
};

const installStartupFlashRecorder = async (
  page: import('@playwright/test').Page
): Promise<() => Promise<string[]>> => {
  await page.addInitScript(() => {
    const textMatches = /join(?:ing)?\b|heating up|connecting server/i;
    const store = window as Window & { __cinnyStartupFlashTexts?: string[] };
    store.__cinnyStartupFlashTexts = [];

    const record = () => {
      const text = document.body?.innerText?.trim();
      if (!text || !textMatches.test(text)) return;
      store.__cinnyStartupFlashTexts?.push(text);
    };

    record();
    const observer = new MutationObserver(() => record());
    window.addEventListener(
      'load',
      () => {
        record();
        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }
      },
      { once: true }
    );
  });

  return async () =>
    page.evaluate(() => {
      const store = window as Window & { __cinnyStartupFlashTexts?: string[] };
      return store.__cinnyStartupFlashTexts ?? [];
    });
};

const findTargetedJoinFlashes = (flashes: string[], targets: string[]): string[] =>
  flashes.filter((text) => {
    const textWithoutHomeJoinAction = text.replace(/\bjoin with address\b/gi, '');
    return (
      /\bjoin(?:ing)?\b/i.test(textWithoutHomeJoinAction) &&
      targets.some((target) => target.length > 0 && text.includes(target))
    );
  });

test.describe('live cinny-071 cached room resume', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('cold-starting from root restores the last room and shows cached room content before sync completes', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomName = `CINNY-071 Resume ${stamp}`;
    const rootBody = `CINNY-071 cached room body ${stamp}`;
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Regression fixture for rendering cached room state before first sync.',
    });

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: rootBody,
      },
      'cinny-071'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });

    const disposeDelayedSync = await delayFirstSync(page);
    const getStartupFlashes = await installStartupFlashRecorder(page);
    try {
      await page.goto('/');

      await expect
        .poll(() => new URL(page.url()).pathname, {
          timeout: 30_000,
          message: 'Root launch should restore the previously open room path',
        })
        .toContain(`/home/${encodeURIComponent(roomId)}`);

      await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText('Heating up')).toHaveCount(0);
    } finally {
      await disposeDelayedSync();
    }

    const startupFlashes = await getStartupFlashes();
    expect(findTargetedJoinFlashes(startupFlashes, [roomName, roomId])).toEqual([]);

    await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-071-cached-room-resume');
  });

  test('startup from bare home remains on Home despite a saved room thread route', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomName = `CINNY-071 Thread Restore ${stamp}`;
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Regression fixture for remaining on Home despite a saved room thread route.',
    });
    const rootBody = `CINNY-071 thread root ${stamp}`;
    const replyBody = `CINNY-071 thread reply ${stamp}`;

    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: rootBody,
      },
      'cinny-071-thread-root'
    );

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: replyBody,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      },
      'cinny-071-thread-reply'
    );

    const expectedRoute = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(
      rootId
    )}`;

    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(expectedRoute);
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(replyBody).first()).toBeVisible({ timeout: 30_000 });

    const getStartupFlashes = await installStartupFlashRecorder(page);
    await expect
      .poll(async () => {
        const store = await readSessionStore(page);
        return store.sessions.find((item) => item.sessionId === store.activeSessionId)
          ?.lastKnownPath;
      })
      .toBe(expectedRoute);

    await page.goto('/home/');

    await expectLoggedInShellStable(page);
    await expect(page).toHaveURL((url) => url.pathname === '/home/' && url.search === '');
    await expect(page.locator('[data-home-room-action="create"]')).toBeVisible();
    await expect(page.locator('[data-thread-context-banner]')).toHaveCount(0);
    const startupFlashes = await getStartupFlashes();
    expect(findTargetedJoinFlashes(startupFlashes, [roomName, roomId])).toEqual([]);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-071-room-thread-bare-home');
  });

  test('cold-starting a space thread route does not flash join-space or join-room fallbacks', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const spaceName = `CINNY-071 Space ${stamp}`;
    const roomName = `CINNY-071 Space Room ${stamp}`;
    const rootBody = `CINNY-071 space thread root ${stamp}`;
    const replyBody = `CINNY-071 space thread reply ${stamp}`;
    const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
      name: spaceName,
      topic: 'Regression fixture for space-scoped thread restore.',
    });
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Child room fixture for space-scoped thread restore.',
    });
    await addRoomToSpace(homeserver, session.accessToken, spaceId, roomId);

    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: rootBody,
      },
      'cinny-071-space-thread-root'
    );

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: replyBody,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      },
      'cinny-071-space-thread-reply'
    );

    const expectedPathname = `/${encodeURIComponent(spaceId)}/${encodeURIComponent(roomId)}`;
    const expectedSearch = `threadId=${encodeURIComponent(rootId)}`;

    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(`${expectedPathname}?${expectedSearch}`);
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(replyBody).first()).toBeVisible({ timeout: 30_000 });

    const disposeDelayedSync = await delayFirstSync(page);
    const getStartupFlashes = await installStartupFlashRecorder(page);
    try {
      await page.goto('/');

      await expect
        .poll(() => new URL(page.url()).pathname, {
          timeout: 30_000,
          message: 'Root launch should restore the previously open space room path',
        })
        .toBe(expectedPathname);

      await expect
        .poll(() => new URL(page.url()).search, {
          timeout: 30_000,
          message: 'Root launch should preserve the space thread id',
        })
        .toContain(expectedSearch);

      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(replyBody).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await disposeDelayedSync();
    }

    const startupFlashes = await getStartupFlashes();
    expect(findTargetedJoinFlashes(startupFlashes, [spaceName, spaceId, roomName, roomId])).toEqual(
      []
    );
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-071-space-thread-root-restore');
  });

  test('startup from bare home remains on Home despite a saved space thread route', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const spaceName = `CINNY-071 Bare Home Space ${stamp}`;
    const roomName = `CINNY-071 Bare Home Room ${stamp}`;
    const rootBody = `CINNY-071 bare home space root ${stamp}`;
    const replyBody = `CINNY-071 bare home space reply ${stamp}`;
    const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
      name: spaceName,
      topic: 'Regression fixture for remaining on Home despite a saved space thread route.',
    });
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Child room fixture for remaining on Home despite a saved space thread route.',
    });
    await addRoomToSpace(homeserver, session.accessToken, spaceId, roomId);

    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: rootBody,
      },
      'cinny-071-space-home-root'
    );

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: replyBody,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      },
      'cinny-071-space-home-reply'
    );

    const expectedRoute = `/${encodeURIComponent(spaceId)}/${encodeURIComponent(
      roomId
    )}?threadId=${encodeURIComponent(rootId)}`;

    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(expectedRoute);
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(rootBody).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(replyBody).first()).toBeVisible({ timeout: 30_000 });

    const getStartupFlashes = await installStartupFlashRecorder(page);
    await expect
      .poll(async () => {
        const store = await readSessionStore(page);
        return store.sessions.find((item) => item.sessionId === store.activeSessionId)
          ?.lastKnownPath;
      })
      .toBe(expectedRoute);

    await page.goto('/home/');

    await expectLoggedInShellStable(page);
    await expect(page).toHaveURL((url) => url.pathname === '/home/' && url.search === '');
    await expect(page.locator('[data-home-room-action="create"]')).toBeVisible();
    await expect(page.locator('[data-thread-context-banner]')).toHaveCount(0);
    const startupFlashes = await getStartupFlashes();
    expect(findTargetedJoinFlashes(startupFlashes, [spaceName, spaceId, roomName, roomId])).toEqual(
      []
    );
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-071-space-thread-bare-home');
  });
});
