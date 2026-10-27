import { expect, test, type Page } from '@playwright/test';
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

const readScroll = (page: Page) =>
  page.getByTestId('room-virtual-inner').evaluate((inner) => {
    let scroller = inner.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
      scroller = scroller.parentElement;
    return { top: scroller!.scrollTop, max: scroller!.scrollHeight - scroller!.clientHeight };
  });

// A short room loads its older rows only when the reader scrolls up; they must
// not send a reader at the top back to the bottom.
test('older rows loaded above a reader at the top keep them there', async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  const secondary = getSecondaryCredentials();
  test.skip(!secondary, 'A second local Matrix account is required');
  if (!secondary) return;

  const homeserver = getHomeserver();
  const primary = getPrimaryCredentials();
  const [author, other] = await Promise.all([
    loginToMatrix(homeserver, primary.username, primary.password),
    loginToMatrix(homeserver, secondary.username, secondary.password),
  ]);
  const roomId = await createPrivateRoom(homeserver, author.accessToken, {
    name: 'Short room',
    topic: 'Older rows above the reader',
    invite: [other.userId],
  });
  const roomPath = (path: string) => `/rooms/${encodeURIComponent(roomId)}${path}`;
  let restoreSettings: (() => Promise<unknown>) | undefined;

  try {
    restoreSettings = await setFullInterfaceModeForSession(homeserver, author);
    await joinRoom(homeserver, other.accessToken, roomId);
    for (let index = 1; index <= 9; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, author.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Note ${index}: a line long enough to wrap in the timeline.\nA second line.`,
      });
    }

    await page.setViewportSize({ width: 1100, height: 844 });
    await loginWithPassword(page, { homeserver, ...primary });
    await seedRoomOverviewState({ page, roomId, userId: author.userId, viewMode: 'classic' });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const timeline = page.getByTestId('room-virtual-inner');
    await expect(timeline.getByText('Note 9:', { exact: false })).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(5_000);

    // Following a new message near the bottom asks for the bottom again.
    const box = (await timeline.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, 400);
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(1_000);
    await sendRoomMessage(homeserver, other.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'A new message',
    });
    await expect(timeline.getByText('A new message', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1_000);
    const followed = await readScroll(page);
    expect(followed.max - followed.top).toBeLessThan(2);

    // Scroll to the top: the room's older rows load above the reader.
    await page.mouse.wheel(0, -3000);
    await expect.poll(async () => (await readScroll(page)).max).toBeGreaterThan(followed.max);
    await page.waitForTimeout(1_500);
    const atTop = await readScroll(page);
    expect(atTop.max - atTop.top).toBeGreaterThan(200);
    await expect(page.getByRole('button', { name: 'Jump to Latest', exact: true })).toBeVisible();
  } finally {
    const results = await Promise.allSettled([
      restoreSettings?.(),
      ...[other, author].map(async ({ accessToken }) => {
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
