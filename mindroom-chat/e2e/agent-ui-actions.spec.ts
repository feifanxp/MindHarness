import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { alignUiActionSync } from './helpers/uiActionSync';
import { createThreadFixture, joinRoom, matrixFetch, sendRoomMessage } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
const computerApi = 'http://127.0.0.1:28179';
test.use({ video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

test('agent requests open the active conversation and leave passive history buttons', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  const origin = new URL(homeserver!);
  expect(origin.protocol).toBe('http:');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(origin.hostname);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `ui_viewer_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_ui_${suffix}`);
  const otherAgent = await register(`mindroom_other_${suffix}`);
  let autoOpenFromHomeservers = [viewer.user_id.slice(viewer.user_id.indexOf(':') + 1)];
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Agent UI requests',
    topic: 'Local UI action regression',
    rootBody: 'Show the browser while working',
    replyBody: 'The active conversation',
    invite: [agent.user_id, otherAgent.user_id],
  });
  await joinRoom(homeserver!, agent.access_token, fixture.roomId);
  await joinRoom(homeserver!, otherAgent.access_token, fixture.roomId);
  const otherRoot = await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Another conversation',
  });
  await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Another conversation reply',
    'm.relates_to': { rel_type: 'm.thread', event_id: otherRoot },
  });
  const sendAction = (
    threadId: string | null,
    action: Record<string, string>,
    body: string,
    sender = agent
  ) =>
    sendRoomMessage(homeserver!, sender.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body,
      ...(threadId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } } : {}),
      'io.mindroom.ui_action': {
        version: 1,
        requester_id: viewer.user_id,
        agent_user_id: sender.user_id,
        room_id: fixture.roomId,
        thread_id: threadId,
        ...action,
      },
    });
  const sessions: Record<string, unknown>[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route(`${computerApi}/**`, (route) => {
    if (route.request().method() === 'POST') sessions.push(route.request().postDataJSON());
    // Exercise real authenticated viewer creation without depending on a running worker/VNC.
    // A nonretryable error settles immediately instead of exercising the startup retry window.
    return route.fulfill({ status: 400, json: { detail: 'Local fixture computer unavailable' } });
  });
  await alignUiActionSync(context, page, homeserver!);
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [homeserver],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
        mindroom: {
          ...config.mindroom,
          computers: { apiUrl: computerApi },
          uiActions: { autoOpenFromHomeservers },
        },
      },
    });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  const threadPath = (id: string) =>
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(id)}`;
  const waitForLiveSync = () =>
    page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/sync') && url.searchParams.get('timeout') === '30000';
    });
  const clearCachedClientConfig = () =>
    page.evaluate(() => localStorage.removeItem('io.cinny.client-config:/config.json'));
  const initialLiveSync = waitForLiveSync();
  await page.goto(threadPath(fixture.rootId));
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
  // Cached content can render before the listener is eligible for live delivery.
  await initialLiveSync;
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  const panel = page.getByRole('complementary', { name: 'Computer panel' });
  await sendAction(fixture.rootId, { action: 'show_computer' }, 'Watch my computer');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Local fixture computer unavailable')).toBeVisible();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ agent_user_id: agent.user_id, room_id: fixture.roomId });
  expect(sessions[0].openid_token).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('desktop-agent-computer.png') });
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  await expect(panel).toHaveCount(0);

  // A request in a different thread cannot steal this conversation's UI.
  await sendAction(otherRoot, { action: 'show_computer' }, 'Watch the other conversation');
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Sync reached the passive request',
    'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
  });
  await expect(page.getByText('Sync reached the passive request', { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page.goto(threadPath(otherRoot));
  const viewComputer = page.getByRole('button', { name: 'View computer', exact: true });
  await expect(viewComputer).toBeVisible();
  await expect(panel).toHaveCount(0);
  await viewComputer.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Local fixture computer unavailable')).toBeVisible();
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  const liveSync = waitForLiveSync();
  await page.reload();
  // Cached buttons render before initial sync ends; wait for steady-state live delivery.
  await liveSync;
  await expect(viewComputer).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(sessions).toHaveLength(2);
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);

  await sendAction(otherRoot, { action: 'open_settings', section: 'about' }, 'Open About settings');
  const about = page.getByRole('banner').getByText('About', { exact: true });
  await expect(about).toBeVisible();
  const account = page.getByRole('banner').getByText('Account', { exact: true });
  await sendAction(
    otherRoot,
    { action: 'open_settings', section: 'account' },
    'Open Account settings'
  );
  await expect(account).toBeVisible();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(about).toBeVisible();
  await sendAction(
    otherRoot,
    { action: 'open_settings', section: 'account' },
    'Open Account settings again'
  );
  await expect(account).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(account).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await sendAction(otherRoot, { action: 'open_panel', panel: 'members' }, 'Show Members');
  const members = page.getByRole('dialog', { name: 'Members', exact: true });
  await expect(members).toBeVisible();
  await members.getByRole('button', { name: 'Close', exact: true }).click();
  await sendAction(otherRoot, { action: 'show_computer' }, 'Watch on mobile', otherAgent);
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Local fixture computer unavailable')).toBeVisible();
  expect(sessions).toHaveLength(3);
  expect(sessions[2]).toMatchObject({ agent_user_id: otherAgent.user_id });
  const bounds = await panel.boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('mobile-agent-computer.png') });

  // Removing deployment trust keeps a fresh request passive, with its button still usable.
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  autoOpenFromHomeservers = [];
  // The loader keeps cached config for a full launch; reload against this policy explicitly.
  await clearCachedClientConfig();
  const untrustedSync = waitForLiveSync();
  await page.reload();
  await untrustedSync;
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await sendAction(otherRoot, { action: 'show_computer' }, 'Unlisted server request');
  await expect(page.getByText('Unlisted server request', { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(sessions).toHaveLength(3);
  await page.getByRole('button', { name: 'View computer', exact: true }).last().click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Local fixture computer unavailable')).toBeVisible();
  expect(sessions).toHaveLength(4);

  // Room-level requests stay passive in a thread, then work from their room overview.
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  autoOpenFromHomeservers = [viewer.user_id.slice(viewer.user_id.indexOf(':') + 1)];
  await clearCachedClientConfig();
  const restoredSync = waitForLiveSync();
  await page.reload();
  await restoredSync;
  await sendAction(null, { action: 'show_computer' }, 'Historical room computer');
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Sync reached the room request',
    'm.relates_to': { rel_type: 'm.thread', event_id: otherRoot },
  });
  await expect(page.getByText('Sync reached the room request', { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
  const overviewUrl = new URL(`/home/${encodeURIComponent(fixture.roomId)}`, page.url()).href;
  const overviewSync = waitForLiveSync();
  await page.goto(overviewUrl);
  await overviewSync;
  await expect(page.getByRole('toolbar', { name: 'Thread filters' })).toBeVisible();
  await expect(page).toHaveURL(overviewUrl);
  await expect(panel).toHaveCount(0);
  expect(sessions).toHaveLength(4);
  await sendAction(null, { action: 'show_computer' }, 'Live room computer');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Local fixture computer unavailable')).toBeVisible();
  expect(sessions).toHaveLength(5);
  expect(sessions[4]).toMatchObject({ agent_user_id: agent.user_id, room_id: fixture.roomId });
  await expect(page).toHaveURL(overviewUrl);
  expect(pageErrors).toEqual([]);
});
