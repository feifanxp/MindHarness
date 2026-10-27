import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { logoutActiveAccount } from './helpers/accounts';
import {
  createThreadFixture,
  joinRoom,
  matrixFetch,
  redactEvent,
  sendRoomMessage,
} from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });

test('the Canvases page lists canvases, keeps pins in account data, and opens one expanded', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `canvas_list_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_lister_${suffix}`);
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Canvas list',
    topic: 'Canvases page regression',
    rootBody: 'Plan my trip',
    replyBody: 'The trip conversation',
    invite: [agent.user_id],
  });
  await joinRoom(homeserver!, agent.access_token, fixture.roomId);
  const action = (title: string, threadId: string | null) => ({
    version: 1,
    action: 'show_canvas',
    requester_id: viewer.user_id,
    agent_user_id: agent.user_id,
    room_id: fixture.roomId,
    thread_id: threadId,
    canvas: {
      title,
      html: `<h1>${title}</h1><label>Packed <input type="checkbox" id="packed"></label>`,
    },
  });
  const showCanvas = (title: string, threadId: string | null) =>
    sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body: `Interactive panel: ${title}.`,
      ...(threadId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } } : {}),
      'io.mindroom.ui_action': action(title, threadId),
    });

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
        mindroom: { ...config.mindroom, canvas: { enabled: true } },
      },
    });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });

  // The sidebar has no Canvases button until there is a canvas.
  const canvasesButton = page.getByRole('button', { name: 'Canvases', exact: true });
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
  await expect(canvasesButton).toHaveCount(0);

  // Canvases are listed as they arrive, without their room being open.
  const tripId = await showCanvas('Trip checklist', fixture.rootId);
  const briefingId = await showCanvas('Morning briefing', null);
  await page.getByRole('button', { name: 'Canvases', exact: true }).click();
  await expect(page).toHaveURL(/\/canvases\/$/);
  const list = page.getByTestId('canvases-view');
  const titles = list.locator('tbody tr td:nth-child(2) button');
  await expect(titles).toHaveText(['Morning briefing', 'Trip checklist']);
  await expect(list.locator('tbody tr').first()).toContainText('Canvas list');

  // An update renames its row and moves it up, while the page is open.
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.notice',
    body: '* Interactive panel updated.',
    'm.new_content': {
      msgtype: 'm.notice',
      body: 'Interactive panel updated.',
      'io.mindroom.ui_action': action('Trip checklist for Lisbon', fixture.rootId),
    },
    'm.relates_to': { rel_type: 'm.replace', event_id: tripId },
  });
  await expect(titles).toHaveText(['Trip checklist for Lisbon', 'Morning briefing']);

  // A pin moves the briefing to the top and is kept in account data as IDs only.
  await list.getByRole('button', { name: 'Pin Morning briefing' }).click();
  await expect(titles).toHaveText(['Morning briefing', 'Trip checklist for Lisbon']);
  await expect
    .poll(() =>
      matrixFetch<unknown>(
        homeserver!,
        `/user/${encodeURIComponent(viewer.user_id)}/account_data/io.mindroom.pinned_canvases`,
        { accessToken: viewer.access_token }
      ).catch(() => undefined)
    )
    .toEqual({ canvases: [{ room_id: fixture.roomId, event_id: briefingId }] });
  await page.screenshot({ path: testInfo.outputPath('canvases-page.png') });

  // The list and the pin survive a reload.
  await page.reload();
  await expect(titles).toHaveText(['Morning briefing', 'Trip checklist for Lisbon']);
  await expect(list.getByRole('button', { name: 'Unpin Morning briefing' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  // A title opens the canvas in its thread, filling the room, at its latest version.
  await titles.filter({ hasText: 'Trip checklist for Lisbon' }).click();
  await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(fixture.rootId)}`));
  const panel = page.getByRole('complementary', { name: 'Canvas panel' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Expand canvas' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(panel).toContainText('Trip checklist for Lisbon');
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('canvas-opened.png') });

  // The thread column names the thread (its summary, here its first message) and opens it.
  await page.getByRole('button', { name: 'Canvases', exact: true }).click();
  const tripRow = list.locator('tbody tr', { hasText: 'Trip checklist for Lisbon' });
  await tripRow.getByRole('button', { name: fixture.rootBody, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(fixture.rootId)}`));
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
  await expect(panel).toBeHidden();
  // A canvas shown in the room itself has no thread to name.
  await page.getByRole('button', { name: 'Canvases', exact: true }).click();
  await expect(
    list.locator('tbody tr', { hasText: 'Morning briefing' }).locator('td').nth(2)
  ).toHaveText('');

  // The room name opens the conversation without a canvas.
  await list
    .locator('tbody tr', { hasText: 'Morning briefing' })
    .getByRole('button', { name: 'Canvas list' })
    .click();
  await expect(page.getByText(fixture.rootBody, { exact: true }).first()).toBeVisible();
  await expect(panel).toBeHidden();

  // A deleted canvas leaves the list.
  await page.getByRole('button', { name: 'Canvases', exact: true }).click();
  await redactEvent(homeserver!, agent.access_token, fixture.roomId, tripId);
  await expect(titles).toHaveText(['Morning briefing']);

  // Logging out deletes this session's list (the page reloads meanwhile, so the check retries).
  const listDatabases = () =>
    page
      .evaluate(
        async () =>
          (await indexedDB.databases()).filter((database) =>
            database.name?.startsWith('mindroom-canvas-index::')
          ).length
      )
      .catch(() => -1);
  expect(await listDatabases()).toBe(1);
  await logoutActiveAccount(page);
  await expect.poll(listDatabases).toBe(0);
});
