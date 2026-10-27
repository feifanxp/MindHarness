import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  loginToMatrix,
  matrixFetch,
  setAccountData,
  setDirectAccountData,
} from '../helpers/matrix';

const setArchived = (
  homeserver: string,
  accessToken: string,
  userId: string,
  roomId: string,
  archived: boolean
) =>
  matrixFetch(
    homeserver,
    `/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(
      roomId
    )}/account_data/io.mindroom.archived`,
    {
      method: 'PUT',
      accessToken,
      body: JSON.stringify({ archived }),
    }
  );

test.skip(!hasPrimaryCredentials(), 'Requires a local Matrix test account.');

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile archive' : 'desktop archive', () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
    test('archives, opens without restoring, persists, and restores a room', async ({ page }) => {
      const homeserver = getHomeserver();
      const credentials = getPrimaryCredentials();
      const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
      const name = `Archive room ${Date.now()}`;
      const roomId = await createPrivateRoom(homeserver, session.accessToken, {
        name,
        topic: 'Archive test',
      });
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        { simpleMode: true }
      );
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.goto('/home/');
      await waitForLoggedInShell(page);
      const roomHeader = page
        .locator('header')
        .filter({ has: page.getByText(name, { exact: true }) });
      if (mobile) {
        await page.getByRole('link', { name, exact: true }).click();
        await roomHeader.getByRole('button').last().click();
      } else {
        await page.getByRole('link', { name, exact: true }).click({ button: 'right' });
      }
      await expect(page.getByRole('button', { name: 'Leave Room', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Archive Room', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Archive Room', exact: true })).toHaveCount(0);
      await page.goto('/home/');
      await waitForLoggedInShell(page);
      await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
      const openArchives = async () => {
        await page.getByRole('button', { name: /Open settings for / }).click();
        await page.getByRole('button', { name: 'Archived Rooms', exact: true }).click();
      };
      await openArchives();
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('archived-rooms.png') });
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(encodeURIComponent(roomId)));
      await expect(page.getByRole('button', { name: 'Close archived rooms' })).toHaveCount(0);
      await expect(roomHeader).toBeVisible();
      const content = await matrixFetch<{ archived: boolean }>(
        homeserver,
        `/user/${encodeURIComponent(session.userId)}/rooms/${encodeURIComponent(
          roomId
        )}/account_data/io.mindroom.archived`,
        { accessToken: session.accessToken }
      );
      expect(content.archived).toBe(true);
      const membership = await matrixFetch<{ membership: string }>(
        homeserver,
        `/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(
          session.userId
        )}`,
        { accessToken: session.accessToken }
      );
      expect(membership.membership).toBe('join');
      await page.goto('/home/');
      await waitForLoggedInShell(page);
      await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
      await openArchives();
      await page.getByRole('button', { name: `Restore ${name}`, exact: true }).click();
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
      await page.goto('/home/');
      await waitForLoggedInShell(page);
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    });
  });
}

test('hides archived direct and space rooms and follows remote restore', async ({ page }) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const suffix = Date.now();
  const name = `Archive space room ${suffix}`;
  const directName = `Archive DM ${suffix}`;
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name,
    topic: 'Archive test',
  });
  const directId = await createPrivateRoom(homeserver, session.accessToken, {
    name: directName,
    topic: 'Archive test',
    isDirect: true,
  });
  const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
    name: `Archive space ${suffix}`,
    topic: 'Archive test',
  });
  await addRoomToSpace(homeserver, session.accessToken, spaceId, roomId);
  await setDirectAccountData(
    homeserver,
    session.accessToken,
    session.userId,
    '@archive-peer:example.org',
    directId
  );
  await setAccountData(homeserver, session.accessToken, session.userId, 'io.mindroom.settings', {
    simpleMode: false,
  });
  await setArchived(homeserver, session.accessToken, session.userId, roomId, true);
  await setArchived(homeserver, session.accessToken, session.userId, directId, true);
  await loginWithPassword(page, { homeserver, ...credentials });
  await page.goto('/direct/');
  await waitForLoggedInShell(page);
  await expect(page.getByRole('link', { name: directName })).toHaveCount(0);
  await page.goto(`/${encodeURIComponent(spaceId)}/`);
  await waitForLoggedInShell(page);
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  await setArchived(homeserver, session.accessToken, session.userId, roomId, false);
  await setArchived(homeserver, session.accessToken, session.userId, directId, false);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.goto('/direct/');
  await expect(page.getByRole('link', { name: directName })).toBeVisible();
});
