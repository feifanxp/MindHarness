import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';

const FILLER_MESSAGE_COUNT = 320;

type MatrixFixture = {
  roomId: string;
  rootId: string;
};

const matrixFetch = async (
  homeserver: string,
  path: string,
  options: RequestInit & { accessToken?: string } = {}
) => {
  const { accessToken, headers, ...rest } = options;
  const response = await fetch(`${homeserver}/_matrix/client/v3${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });
  const body = await response.json();

  if (!response.ok) {
    const error = [body.errcode, body.error].filter(Boolean).join(' ');
    throw new Error(`Matrix API ${response.status} for ${path}: ${error || 'unknown error'}`);
  }

  return body;
};

const loginToMatrix = async (homeserver: string, username: string, password: string) => {
  const body = await matrixFetch(homeserver, '/login', {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    }),
  });

  return body.access_token as string;
};

const sendRoomMessage = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  content: Record<string, unknown>
) => {
  const txnId = `cinny-015-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = await matrixFetch(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify(content),
    }
  );

  return body.event_id as string;
};

const seedThreadExitFixture = async (
  homeserver: string,
  username: string,
  password: string
): Promise<MatrixFixture> => {
  const accessToken = await loginToMatrix(homeserver, username, password);
  const roomBody = await matrixFetch(homeserver, '/createRoom', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({
      name: `CINNY-015 Thread Exit Scroll ${Date.now()}`,
      topic: 'Live fixture for CINNY-015 room-mode thread exit scroll validation.',
      preset: 'private_chat',
    }),
  });
  const roomId = roomBody.room_id as string;

  for (let index = 0; index < FILLER_MESSAGE_COUNT; index += 1) {
    await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body: `CINNY-015 filler ${index + 1}`,
    });
  }

  const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: 'CINNY-015 thread root',
  });

  await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: 'CINNY-015 thread reply 1',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

  await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: 'CINNY-015 thread reply 2',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

  return { roomId, rootId };
};

const clickThreadExitButton = async (page: Page) => {
  await page.evaluate(() => {
    const exitButton = document.querySelector('[data-thread-context-banner] button');

    if (!(exitButton instanceof HTMLButtonElement)) {
      throw new Error('Thread exit button not found');
    }

    exitButton.click();
  });
};

const installHistoryBackProbe = async (page: Page) => {
  await page.evaluate(() => {
    const historyWithProbe = window.history as History & {
      __cinnyOriginalBack?: History['back'];
      __cinnyBackCount?: number;
    };
    if (!historyWithProbe.__cinnyOriginalBack) {
      historyWithProbe.__cinnyOriginalBack = historyWithProbe.back.bind(historyWithProbe);
      historyWithProbe.__cinnyBackCount = 0;
      historyWithProbe.back = (() => {
        historyWithProbe.__cinnyBackCount = (historyWithProbe.__cinnyBackCount ?? 0) + 1;
        return historyWithProbe.__cinnyOriginalBack?.();
      }) as History['back'];
    } else {
      historyWithProbe.__cinnyBackCount = 0;
    }
  });
};

const readHistoryBackProbe = async (page: Page) =>
  page.evaluate(() => {
    const historyWithProbe = window.history as History & {
      __cinnyBackCount?: number;
    };
    return historyWithProbe.__cinnyBackCount ?? 0;
  });

test.describe('live cinny-015 thread exit scroll', () => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');

  test('exiting a deep-linked thread scrolls the thread root into the room viewport', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { roomId, rootId } = await seedThreadExitFixture(homeserver, username, password);

    await loginWithPassword(page, { homeserver, username, password });
    await page.evaluate((nextRoomId) => {
      localStorage.setItem(`roomViewMode:${nextRoomId}`, JSON.stringify('threaded'));
    }, roomId);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);

    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });

    await clickThreadExitButton(page);

    await expect
      .poll(() => new URL(page.url()).searchParams.get('threadId'), {
        timeout: 10_000,
        message: 'Thread route should close after clicking the thread exit button',
      })
      .toBeNull();

    const rootMessage = page.locator(`[data-message-id="${rootId}"]`);
    await expect(rootMessage).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(
        async () =>
          rootMessage.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.bottom > 0 && rect.top < window.innerHeight;
          }),
        {
          timeout: 10_000,
          message: 'Thread root should be scrolled back into the room viewport after exit',
        }
      )
      .toBe(true);

    await page.screenshot({ path: 'test-results/cinny015-thread-exit-scroll.png', fullPage: true });
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-015-thread-exit-scroll');
  });

  test('exiting an in-room thread uses history back instead of rebuilding the route', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { roomId, rootId } = await seedThreadExitFixture(homeserver, username, password);

    await loginWithPassword(page, { homeserver, username, password });
    await page.evaluate((nextRoomId) => {
      localStorage.setItem(`roomViewMode:${nextRoomId}`, JSON.stringify('threaded'));
    }, roomId);
    await page.goto(`/home/${encodeURIComponent(roomId)}`);

    const openThreadButton = page.getByRole('button', { name: /Thread 2 replies/i }).last();
    await expect(openThreadButton).toBeVisible({ timeout: 10_000 });
    await installHistoryBackProbe(page);
    await openThreadButton.click();

    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 10_000 });
    await clickThreadExitButton(page);

    await expect
      .poll(() => new URL(page.url()).searchParams.get('threadId'), {
        timeout: 10_000,
        message: 'Thread route should close after clicking the thread exit button',
      })
      .toBeNull();

    await expect
      .poll(() => readHistoryBackProbe(page), {
        timeout: 5_000,
        message:
          'Thread exit should use window.history.back() when returning to an in-room thread root',
      })
      .toBe(1);

    await expect
      .poll(() => {
        const url = new URL(page.url());
        return {
          pathname: url.pathname,
          focusEvent: url.searchParams.get('focusEvent'),
          threadId: url.searchParams.get('threadId'),
        };
      })
      .toEqual({
        pathname: `/home/${encodeURIComponent(roomId)}`,
        focusEvent: null,
        threadId: null,
      });

    const rootMessage = page.locator(`[data-message-id="${rootId}"]`);
    await expect(rootMessage).toBeVisible({ timeout: 10_000 });
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-015-thread-exit-history-back');
  });
});
