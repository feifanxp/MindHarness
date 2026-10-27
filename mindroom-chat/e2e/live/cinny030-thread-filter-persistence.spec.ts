import { expect, test, type Page } from '@playwright/test';
import {
  getHomeserver,
  getPrimaryCredentials,
  getRequiredEnv,
  hasPrimaryCredentials,
} from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  seedRoomOverviewState,
  setAccountData,
} from '../helpers/matrix';
import { getThreadOverviewSortButton } from '../helpers/threadOverview';

type ThreadFixture = {
  roomId: string;
  roomName: string;
  rootId: string;
  rootBody: string;
};

type ThreadFilterKey = 'resolved' | 'scheduled';
type ThreadFilterState = 'any' | 'include' | 'exclude';

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

  return {
    accessToken: body.access_token as string,
    userId: body.user_id as string,
  };
};

const sendRoomMessage = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  content: Record<string, unknown>
) => {
  const txnId = `cinny-030-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

const seedThreadRoom = async (
  homeserver: string,
  accessToken: string,
  roomLabel: string,
  agentUserId: string
): Promise<ThreadFixture> => {
  const roomName = `CINNY-030 ${roomLabel} ${Date.now()}`;
  const rootBody = `${roomLabel} thread root`;
  const roomBody = await matrixFetch(homeserver, '/createRoom', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({
      name: roomName,
      topic: `Live fixture for CINNY-030 ${roomLabel}.`,
      preset: 'private_chat',
      invite: [agentUserId],
    }),
  });
  const roomId = roomBody.room_id as string;

  await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: `${roomLabel} filler message`,
  });

  const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: rootBody,
  });

  await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: `${roomLabel} thread reply`,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

  return { roomId, roomName, rootId, rootBody };
};

const waitForThreadOverview = async (page: Page) => {
  await expect(page.locator('[data-room-thread-overview="true"]')).toBeVisible({
    timeout: 30_000,
  });
};

const navigateToRoom = async (page: Page, roomName: string) => {
  const roomLink = page.getByRole('link', { name: roomName }).first();

  await expect(roomLink).toBeVisible({ timeout: 30_000 });
  await roomLink.click();
  await waitForThreadOverview(page);
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
};

const getFilterButton = (page: Page, key: ThreadFilterKey) =>
  page.locator(`[data-room-thread-overview="true"] [data-filter-key="${key}"]`);

const expectFilterState = async (page: Page, key: ThreadFilterKey, state: ThreadFilterState) => {
  await expect(getFilterButton(page, key)).toHaveAttribute('data-filter-state', state);
};

const expectSortDirection = async (page: Page, direction: 'asc' | 'desc') => {
  await expect(getThreadOverviewSortButton(page)).toHaveAccessibleName('Last Reply');
  await expect(getThreadOverviewSortButton(page)).toHaveAttribute('data-sort-by', 'lastReply');
  await expect(getThreadOverviewSortButton(page)).toHaveAttribute('data-sort-direction', direction);
};

const openThreadAndReturn = async (page: Page, rootId: string, rootBody: string) => {
  const threadButton = page.locator(`button[aria-label*="${rootBody}"]`).first();

  await expect(threadButton).toBeVisible({ timeout: 30_000 });
  await threadButton.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBe(rootId);

  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBeNull();
  await waitForThreadOverview(page);
};

const switchAwayAndBack = async (page: Page) => {
  const focusStealer = await page.context().newPage();
  const resolvedFilterButton = getFilterButton(page, 'resolved');

  await resolvedFilterButton.focus();
  await focusStealer.goto('data:text/html,<input aria-label="focus-stealer" autofocus />');
  await focusStealer.bringToFront();
  await focusStealer.getByLabel('focus-stealer').focus();
  await page.waitForTimeout(250);

  await page.bringToFront();
  await resolvedFilterButton.focus();
  await page.waitForTimeout(250);

  await focusStealer.close();
};

test.describe('live cinny-030 thread filter persistence', () => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');

  test('thread overview toolbar state persists per room across navigation', async ({ page }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const agentUserId = getRequiredEnv('E2E_AGENT_USER_ID');
    await setAccountData(homeserver, accessToken, userId, 'io.mindroom.settings', {
      simpleMode: false,
    });
    const roomA = await seedThreadRoom(homeserver, accessToken, 'Room A', agentUserId);
    const roomB = await seedThreadRoom(homeserver, accessToken, 'Room B', agentUserId);

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: roomA.roomId,
      userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    await seedRoomOverviewState({
      page,
      roomId: roomB.roomId,
      userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    await navigateToRoom(page, roomA.roomName);
    await expectFilterState(page, 'resolved', 'any');
    await expectFilterState(page, 'scheduled', 'any');
    await expectSortDirection(page, 'desc');
    await getFilterButton(page, 'resolved').click();
    await getFilterButton(page, 'resolved').click();
    await expectFilterState(page, 'resolved', 'exclude');
    await expectFilterState(page, 'scheduled', 'any');

    await openThreadAndReturn(page, roomA.rootId, roomA.rootBody);
    await expectFilterState(page, 'resolved', 'exclude');
    await expectFilterState(page, 'scheduled', 'any');

    await switchAwayAndBack(page);
    await expectFilterState(page, 'resolved', 'exclude');
    await expectFilterState(page, 'scheduled', 'any');

    await getThreadOverviewSortButton(page).click();
    await expectSortDirection(page, 'asc');

    await navigateToRoom(page, roomB.roomName);
    await expectFilterState(page, 'resolved', 'any');
    await expectFilterState(page, 'scheduled', 'any');
    await expectSortDirection(page, 'desc');

    await getFilterButton(page, 'scheduled').click();
    await expectFilterState(page, 'resolved', 'any');
    await expectFilterState(page, 'scheduled', 'include');

    await navigateToRoom(page, roomA.roomName);
    await expectFilterState(page, 'resolved', 'exclude');
    await expectFilterState(page, 'scheduled', 'any');
    await expectSortDirection(page, 'asc');

    await navigateToRoom(page, roomB.roomName);
    await expectFilterState(page, 'resolved', 'any');
    await expectFilterState(page, 'scheduled', 'include');
    await expectSortDirection(page, 'desc');

    await page.screenshot({
      path: 'test-results/cinny030-thread-filter-persistence.png',
      fullPage: true,
    });
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-030-thread-filter-persistence');
  });
});
