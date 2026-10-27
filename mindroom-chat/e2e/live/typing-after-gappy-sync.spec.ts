import { expect, test } from '@playwright/test';
import {
  getHomeserver,
  getPrimaryCredentials,
  getSecondaryCredentials,
  hasPrimaryCredentials,
} from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

// A gappy (limited) sync resets the room's live timeline; the client must keep
// hearing the members already in the room (matrix-js-sdk patch, PR #402).
test('typing is still shown after a gappy sync', async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  const secondary = getSecondaryCredentials();
  test.skip(!secondary, 'A second local Matrix account is required');
  if (!secondary) return;

  const homeserver = getHomeserver();
  const primary = getPrimaryCredentials();
  const [author, reader] = await Promise.all([
    loginToMatrix(homeserver, primary.username, primary.password),
    loginToMatrix(homeserver, secondary.username, secondary.password),
  ]);
  const roomId = await createPrivateRoom(homeserver, author.accessToken, {
    name: 'Gappy sync typing',
    topic: 'Typing after a limited sync',
    invite: [reader.userId],
  });
  const roomPath = (path: string) => `/rooms/${encodeURIComponent(roomId)}${path}`;
  let restoreSettings: (() => Promise<unknown>) | undefined;

  try {
    restoreSettings = await setFullInterfaceModeForSession(homeserver, author);
    await joinRoom(homeserver, reader.accessToken, roomId);
    await matrixFetch(
      homeserver,
      roomPath(`/state/m.room.member/${encodeURIComponent(reader.userId)}`),
      {
        method: 'PUT',
        accessToken: reader.accessToken,
        body: JSON.stringify({ membership: 'join', displayname: 'Avery' }),
      }
    );
    const firstBody = 'Before the gap';
    await sendRoomMessage(homeserver, author.accessToken, roomId, {
      msgtype: 'm.text',
      body: firstBody,
    });

    await loginWithPassword(page, { homeserver, ...primary });
    await seedRoomOverviewState({ page, roomId, userId: author.userId, viewMode: 'classic' });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const timeline = page.getByTestId('room-virtual-inner');
    await expect(timeline.getByText(firstBody, { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Catching up...', { exact: true })).toHaveCount(0, {
      timeout: 60_000,
    });

    const typing = page.getByText('Avery is typing...', { exact: true });
    const setTyping = (active: boolean) =>
      matrixFetch(homeserver, roomPath(`/typing/${encodeURIComponent(reader.userId)}`), {
        method: 'PUT',
        accessToken: reader.accessToken,
        body: JSON.stringify({ typing: active, timeout: 60000 }),
      });
    await setTyping(true);
    await expect(typing).toBeVisible({ timeout: 40_000 });
    await setTyping(false);
    await expect(typing).toHaveCount(0, { timeout: 40_000 });

    // Miss more events than the sync timeline limit (20, `STARTUP_SYNC_TIMELINE_LIMIT`), so the next sync is limited.
    await page.context().setOffline(true);
    for (let index = 1; index <= 30; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, author.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Gap message ${index}`,
      });
    }
    const limitedSync = page.waitForResponse(
      async (response) => {
        if (!response.url().includes('/sync?') || response.status() !== 200) return false;
        const data = await response.json();
        return data.rooms?.join?.[roomId]?.timeline?.limited === true;
      },
      { timeout: 120_000 }
    );
    await page.context().setOffline(false);
    await limitedSync;
    await expect(timeline.getByText('Gap message 30', { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    await setTyping(true);
    await expect(typing).toBeVisible({ timeout: 40_000 });
    await setTyping(false);
    await expect(typing).toHaveCount(0, { timeout: 40_000 });
  } finally {
    const results = await Promise.allSettled([
      restoreSettings?.(),
      ...[reader, author].map(async ({ accessToken }) => {
        await matrixFetch(homeserver, roomPath('/leave'), {
          method: 'POST',
          accessToken,
          body: '{}',
        });
        await matrixFetch(homeserver, roomPath('/forget'), {
          method: 'POST',
          accessToken,
          body: '{}',
        });
      }),
    ]);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
  }
});
