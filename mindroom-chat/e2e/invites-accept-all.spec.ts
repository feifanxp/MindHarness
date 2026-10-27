import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createPrivateRoom, joinRoom, matrixFetch } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });

test('Accept All joins every primary invite and records the DMs', async ({ page }, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `invites_viewer_${suffix}`;
  const viewer = await register(username);
  const router = await register(`invites_router_${suffix}`);

  // A shared room makes the inviter known, so its invites land under Primary.
  const sharedRoomId = await createPrivateRoom(homeserver!, router.access_token, {
    name: 'Lobby',
    topic: 'Shared room',
    invite: [viewer.user_id],
  });
  await joinRoom(homeserver!, viewer.access_token, sharedRoomId);
  const invited = [
    await createPrivateRoom(homeserver!, router.access_token, {
      name: 'Leadership',
      topic: 'Leadership & Strategy',
      invite: [viewer.user_id],
    }),
    await createPrivateRoom(homeserver!, router.access_token, {
      name: 'Finance',
      topic: 'Finance Hub',
      invite: [viewer.user_id],
    }),
  ];
  // Two DMs: the second m.direct write must not drop the first.
  const createDm = (name: string) =>
    createPrivateRoom(homeserver!, router.access_token, {
      name,
      topic: 'Direct chat',
      preset: 'trusted_private_chat',
      invite: [viewer.user_id],
      isDirect: true,
    });
  const dmRoomIds = [await createDm('Router DM'), await createDm('Second DM')];

  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  await page.goto('/inbox/invites/');
  const accept = page.getByRole('button', { name: 'Accept', exact: true });
  await expect(accept).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('before.png') });

  await page.getByRole('button', { name: 'Accept All' }).click();
  await expect(accept).toHaveCount(0);
  await expect(page.getByText('No Invites')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('after.png') });

  const { joined_rooms: joinedRooms } = await matrixFetch<{ joined_rooms: string[] }>(
    homeserver!,
    '/joined_rooms',
    { accessToken: viewer.access_token }
  );
  expect(joinedRooms).toEqual(expect.arrayContaining([...invited, ...dmRoomIds]));
  const direct = await matrixFetch<Record<string, string[]>>(
    homeserver!,
    `/user/${encodeURIComponent(viewer.user_id)}/account_data/m.direct`,
    { accessToken: viewer.access_token }
  );
  expect(direct).toEqual({ [router.user_id]: expect.arrayContaining(dmRoomIds) });
  expect(direct[router.user_id]).toHaveLength(2);
});
