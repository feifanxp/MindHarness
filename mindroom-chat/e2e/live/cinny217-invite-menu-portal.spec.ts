import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectFloatingNavHeader } from '../helpers/glassVisual';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  loginToMatrix,
  matrixFetch,
} from '../helpers/matrix';

/**
 * CINNY-217 live verification: the invite autocomplete menu portals past host
 * clipping on every InviteUserPrompt host surface, and CINNY-216 ranking
 * surfaces the intended agent for its short name.
 *
 * The test creates its own users and room hierarchy and scopes the user
 * directory to those users, so it can run against a fresh disposable
 * homeserver account on a shared homeserver.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const SHOT_DIR = 'ui-audit/cinny217';
const AGENT_SHORT_NAMES = [
  'mind',
  'sarro',
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'iota',
  'kappa',
] as const;

type TestAccount = {
  accessToken: string;
  userId: string;
};

type PortalFixture = {
  roomName: string;
  spaceName: string;
  spaceId: string;
  childName: string;
  runId: string;
  mindUserId: string;
};

const createTestAccount = async (
  homeserver: string,
  username: string,
  displayName: string
): Promise<TestAccount> => {
  const password = randomUUID();
  const account = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        auth: { type: 'm.login.dummy' },
      }),
    }
  );

  await matrixFetch<unknown>(
    homeserver,
    `/profile/${encodeURIComponent(account.user_id)}/displayname`,
    {
      method: 'PUT',
      accessToken: account.access_token,
      body: JSON.stringify({ displayname: displayName }),
    }
  );

  return { accessToken: account.access_token, userId: account.user_id };
};

const seedPortalFixture = async (
  homeserver: string,
  viewer: TestAccount
): Promise<PortalFixture> => {
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const agents = await Promise.all(
    AGENT_SHORT_NAMES.map(async (shortName) => ({
      shortName,
      account: await createTestAccount(
        homeserver,
        `mindroom_${shortName}_${runId}`,
        shortName === 'mind'
          ? 'Mind'
          : `${shortName[0].toUpperCase() + shortName.slice(1)} ${runId}`
      ),
    }))
  );
  const agentHubId = await createPrivateRoom(homeserver, viewer.accessToken, {
    name: `Portal agent directory ${runId}`,
    topic: 'Directory fixture for invite autocomplete coverage.',
    invite: agents.map((agent) => agent.account.userId),
  });
  await Promise.all(
    agents.map((agent) => joinRoom(homeserver, agent.account.accessToken, agentHubId))
  );

  const roomName = `Portal Test Room ${runId}`;
  const spaceName = `Portal Test Space ${runId}`;
  const childName = `Space Child Room ${runId}`;
  await createPrivateRoom(homeserver, viewer.accessToken, {
    name: roomName,
    topic: 'Invite autocomplete portal fixture.',
  });
  const spaceId = await createPrivateSpace(homeserver, viewer.accessToken, {
    name: spaceName,
    topic: 'Invite autocomplete portal hierarchy fixture.',
  });
  const childId = await createPrivateRoom(homeserver, viewer.accessToken, {
    name: childName,
    topic: 'Child room for invite autocomplete portal coverage.',
  });
  await addRoomToSpace(homeserver, viewer.accessToken, spaceId, childId);

  const mindUserId = agents.find((agent) => agent.shortName === 'mind')!.account.userId;
  return { roomName, spaceName, spaceId, childName, runId, mindUserId };
};

const inviteInput = (page: Page) => page.locator('[name="userIdInput"]');
// The listbox id carries a per-instance useId() suffix; match on the prefix.
const inviteMenu = (page: Page) => page.locator('[id^="invite-autocomplete-listbox"]');
const inviteForm = (page: Page) => page.locator('form:has([name="userIdInput"])');

async function verifyPortaledInviteMenu(page: Page, surface: string, mindUserId: string) {
  const field = inviteInput(page);
  await expect(field).toBeVisible({ timeout: 15_000 });

  await field.fill('mind');
  const menu = inviteMenu(page);
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.locator('[role="option"]').count()).toBeGreaterThan(1);

  // CINNY-216: an exact display-name identity ranks before the generated
  // shared-prefix fleet.
  const firstOption = page.locator('[role="option"]').first();
  await expect(firstOption).toHaveAttribute('aria-label', `Mind, ${mindUserId}`);

  // CINNY-217: the menu extends below the dialog content (the old clipping
  // boundary) while staying inside the viewport.
  const menuBox = await menu.boundingBox();
  const formBox = await inviteForm(page).boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox, 'menu bounding box').not.toBeNull();
  expect(formBox, 'form bounding box').not.toBeNull();
  expect(menuBox!.y + menuBox!.height).toBeGreaterThan(formBox!.y + formBox!.height);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport!.height + 1);

  await expectFloatingNavHeader(menu.locator('header'), { inheritsPanelTint: true });
  await expect(menu.getByRole('scrollbar', { includeHidden: true })).toHaveAttribute(
    'tabindex',
    '-1'
  );
  await page.screenshot({ path: `${SHOT_DIR}/${surface}.png` });

  // Clicking a portaled option commits it without closing the dialog.
  await firstOption.click();
  await expect(field).toHaveValue(mindUserId);
  await expect(inviteForm(page)).toBeVisible();
  await expect(menu).toBeHidden();

  // Escape closes only the menu; the dialog survives. (Escape never closes
  // the dialog while focus is in the input - pre-existing stopPropagation
  // behavior for editable elements.)
  await field.fill('sarro');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(inviteForm(page)).toBeVisible();

  // A backdrop click dismisses the dialog itself.
  await page.mouse.click(viewport!.width - 8, viewport!.height - 8);
  await expect(inviteForm(page)).toBeHidden();
}

test.describe('CINNY-217 invite menu portal', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  let restoreSettings: (() => Promise<void>) | undefined;

  test.afterEach(async () => {
    const restore = restoreSettings;
    restoreSettings = undefined;
    await restore?.();
  });

  test('menu escapes host clipping on each invite surface', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const viewer = await loginToMatrix(homeserver, username, password);
    const fixture = await seedPortalFixture(homeserver, viewer);

    // Full navigation is required here, but the shared account's preferences survive the run.
    restoreSettings = await setFullInterfaceModeForSession(homeserver, viewer);

    // Tuwunel returns the first `limit` directory matches to finish, not the
    // best, so other runs' users can crowd out this run's Mind. Searching for
    // runId (in every fixture MXID) returns only this run's users.
    await page.route('**/user_directory/search', (route) =>
      route.continue({
        postData: JSON.stringify({ ...route.request().postDataJSON(), search_term: fixture.runId }),
      })
    );

    await loginWithPassword(page, { homeserver, username, password });

    const roomLink = page.locator(`a[href^="/home/"]:has-text("${fixture.roomName}")`).first();
    await expect(roomLink).toBeVisible({ timeout: 30_000 });

    await test.step('room-nav-item context menu', async () => {
      await roomLink.click({ button: 'right' });
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'room-nav-item', fixture.mindUserId);
      await page.keyboard.press('Escape');
    });

    await test.step('members drawer invite entry', async () => {
      await roomLink.click();
      const drawerInvite = page.locator('[aria-label="Invite people"]');
      await expect(drawerInvite).toBeVisible({ timeout: 30_000 });
      await drawerInvite.click();
      await verifyPortaledInviteMenu(page, 'members-drawer', fixture.mindUserId);
    });

    await test.step('mindroom room header menu', async () => {
      // The vertical-dots "More Options" trigger is the last room-header button.
      const roomHeader = page.locator(`header:has-text("${fixture.roomName}")`).first();
      await roomHeader.locator('button').last().click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'mindroom-room-header', fixture.mindUserId);
      await page.keyboard.press('Escape');
    });

    await test.step('space tabs context menu', async () => {
      const spaceTab = page.locator(`button[data-id="${fixture.spaceId}"]`).first();
      await expect(spaceTab).toBeVisible({ timeout: 30_000 });
      await spaceTab.click({ button: 'right' });
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'space-tabs', fixture.mindUserId);
      await page.keyboard.press('Escape');
    });

    await test.step('space page panel menu', async () => {
      const spaceTab = page.locator(`button[data-id="${fixture.spaceId}"]`).first();
      await spaceTab.click();
      const panelHeader = page.locator(`header:has-text("${fixture.spaceName}")`).last();
      await expect(panelHeader).toBeVisible({ timeout: 30_000 });
      await panelHeader.locator('button').last().click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'space-page-menu', fixture.mindUserId);
      await page.keyboard.press('Escape');
    });

    await test.step('lobby header menu', async () => {
      await page.getByRole('link', { name: 'Lobby', exact: true }).click();
      const lobbyMembers = page.getByRole('button', { name: /Members/ });
      await expect(lobbyMembers).toBeVisible();
      const lobbyHeader = lobbyMembers.locator('xpath=ancestor::header[1]');
      await lobbyHeader.locator('button').last().click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'lobby-header', fixture.mindUserId);
      await page.keyboard.press('Escape');
    });

    await test.step('hierarchy item menu', async () => {
      const childRow = page.getByText(fixture.childName).first();
      await expect(childRow).toBeVisible({ timeout: 30_000 });
      await childRow.hover();
      const rowOptions = childRow
        .locator('xpath=ancestor::*[.//button[@aria-pressed]][1]//button[@aria-pressed]')
        .last();
      await rowOptions.click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'hierarchy-item', fixture.mindUserId);
      await page.keyboard.press('Escape');
    });
  });
});
