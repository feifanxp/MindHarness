import { expect, test } from '@playwright/test';
import {
  getHomeserver,
  getPrimaryCredentials,
  getSecondaryCredentials,
  hasPrimaryCredentials,
} from '../env';
import { loginWithPassword } from '../helpers/auth';
import { expectClearStrip } from '../helpers/glassVisual';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

test('following glass appears only while another reader follows the latest message', async ({
  page,
}, testInfo) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  const secondary = getSecondaryCredentials();
  test.skip(!secondary, 'A second local Matrix account is required');
  if (!secondary) return;

  const homeserver = getHomeserver();
  test.skip(
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
    'Local fixture only'
  );
  const primary = getPrimaryCredentials();
  const [author, reader] = await Promise.all([
    loginToMatrix(homeserver, primary.username, primary.password),
    loginToMatrix(homeserver, secondary.username, secondary.password),
  ]);
  expect(reader.userId).not.toBe(author.userId);
  const accountSettings = await matrixFetch<Record<string, unknown>>(
    homeserver,
    `/user/${encodeURIComponent(author.userId)}/account_data/io.mindroom.settings`,
    { accessToken: author.accessToken }
  ).catch((error: Error) => {
    if (error.message.startsWith('Matrix API 404')) return {};
    throw error;
  });
  const roomId = await createPrivateRoom(homeserver, author.accessToken, {
    name: 'Shared notes',
    topic: 'Planning the next design review',
    invite: [reader.userId],
  });
  let readerJoined = false;

  try {
    await setAccountData(homeserver, author.accessToken, author.userId, 'io.mindroom.settings', {
      ...accountSettings,
      simpleMode: false,
    });
    await joinRoom(homeserver, reader.accessToken, roomId);
    readerJoined = true;
    // Keep the sample name local to this room instead of changing the account profile.
    await matrixFetch(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(
        reader.userId
      )}`,
      {
        method: 'PUT',
        accessToken: reader.accessToken,
        body: JSON.stringify({ membership: 'join', displayname: 'Avery' }),
      }
    );
    for (let index = 1; index <= 8; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, author.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Design note ${index}: Keep the conversation easy to follow.\nReview the details together before choosing the next step.\nLeave room for questions and a second pair of eyes.`,
      });
    }
    const firstBody = 'The draft is ready for another pair of eyes.';
    const firstEvent = await sendRoomMessage(homeserver, author.accessToken, roomId, {
      msgtype: 'm.text',
      body: firstBody,
    });
    const markRead = (accessToken: string, eventId: string) =>
      matrixFetch(
        homeserver,
        `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
        { method: 'POST', accessToken, body: '{}' }
      );
    await markRead(author.accessToken, firstEvent);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/v1/local-mindroom/connections', (route) =>
      route.fulfill({ json: { connections: [] } })
    );
    await page.addInitScript(() => {
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
      localStorage.setItem(
        'settings',
        JSON.stringify({
          ...settings,
          useSystemTheme: false,
          themeId: 'dark-theme',
          isPeopleDrawer: false,
          hideActivity: settings.hideActivity ?? false,
        })
      );
    });
    await loginWithPassword(page, { homeserver, ...primary });
    const roomPath = `/home/${encodeURIComponent(roomId)}`;
    await seedRoomOverviewState({ page, roomId, userId: author.userId, viewMode: 'classic' });
    await page.goto(roomPath);
    await expect.poll(() => new URL(page.url()).pathname).toBe(roomPath);
    await expect(page.getByTestId('room-virtual-inner')).toBeVisible();
    await expect(page.locator('[data-room-thread-overview="true"]')).toHaveCount(0);
    await expect(page.getByText(firstBody, { exact: true })).toBeVisible();
    // Initial catchup may need another 30-second Matrix long-poll cycle.
    await expect(page.getByText('Catching up...', { exact: true })).toHaveCount(0, {
      timeout: 60_000,
    });

    const following = page.locator('[data-room-following="true"]');
    await expectClearStrip(following);
    const emptyHeight = (await following.boundingBox())!.height;
    expect(emptyHeight).toBeGreaterThanOrEqual(28);
    const scroll = page.getByTestId('room-virtual-inner').locator('xpath=../..');
    await expect
      .poll(() =>
        scroll.evaluate(
          (element) => element.scrollHeight - element.scrollTop - element.clientHeight
        )
      )
      .toBeLessThan(2);
    await page.mouse.move(195, 400);
    await page.mouse.wheel(0, -180);
    await expect
      .poll(() =>
        scroll.evaluate(
          (element) => element.scrollHeight - element.scrollTop - element.clientHeight
        )
      )
      .toBeGreaterThan(100);
    const expectMessagesBehindStrip = async () => {
      await expect
        .poll(async () => {
          const strip = (await following.boundingBox())!;
          return scroll.locator('[data-message-item]').evaluateAll(
            (messages, area) =>
              messages.some((message) => {
                const box = message.getBoundingClientRect();
                return box.top < area.y + area.height && box.bottom > area.y;
              }),
            strip
          );
        })
        .toBe(true);
    };
    await expectMessagesBehindStrip();
    const historyTop = await scroll.evaluate((element) => element.scrollTop);
    const jumpToLatest = page.getByRole('button', { name: 'Jump to Latest', exact: true });
    await expect(jumpToLatest).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.getByText('Catching up...', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('following-empty.png') });

    await markRead(reader.accessToken, firstEvent);
    const readerButton = following.getByRole('button', { name: /Avery.*following/ });
    await expect(readerButton).toBeVisible();
    await expect
      .poll(() =>
        following.evaluate((element) => {
          const styles = [element, ...element.querySelectorAll('*')].map((node) =>
            getComputedStyle(node)
          );
          return (
            styles.some(
              (css) => css.backgroundColor !== 'rgba(0, 0, 0, 0)' && css.backdropFilter !== 'none'
            ) &&
            styles.every(
              (css) =>
                css.backgroundImage === 'none' &&
                css.boxShadow === 'none' &&
                css.borderTopWidth === '0px' &&
                css.borderRightWidth === '0px' &&
                css.borderBottomWidth === '0px' &&
                css.borderLeftWidth === '0px'
            )
          );
        })
      )
      .toBe(true);
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop))
      .toBeCloseTo(historyTop, 0);
    await expectMessagesBehindStrip();
    await expect(page.getByText('Catching up...', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('following-reader.png') });
    await readerButton.click();
    const readers = page
      .getByText('Seen by', { exact: true })
      .locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
    await expect(readers).toBeVisible();
    await expect(readers.getByText('Avery', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Seen by', { exact: true })).not.toBeVisible();

    const nextBody = 'A new note is waiting to be read.';
    const nextEvent = await sendRoomMessage(homeserver, author.accessToken, roomId, {
      msgtype: 'm.text',
      body: nextBody,
    });
    await expectClearStrip(following);
    await jumpToLatest.click();
    await expect(page.getByText(nextBody, { exact: true })).toBeVisible();
    await markRead(reader.accessToken, nextEvent);
    await expect(readerButton).toBeVisible();

    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
      localStorage.setItem('settings', JSON.stringify({ ...settings, hideActivity: true }));
    });
    await page.reload();
    await expect(page.getByText(nextBody, { exact: true })).toBeVisible();
    await expectClearStrip(following);
    expect((await following.boundingBox())!.height).toBeCloseTo(emptyHeight, 0);
  } finally {
    const sessions = readerJoined ? [reader, author] : [author];
    const results = await Promise.allSettled([
      setAccountData(
        homeserver,
        author.accessToken,
        author.userId,
        'io.mindroom.settings',
        accountSettings
      ),
      ...sessions.map(async ({ accessToken }) => {
        await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
          method: 'POST',
          accessToken,
          body: '{}',
        });
        await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/forget`, {
          method: 'POST',
          accessToken,
          body: '{}',
        });
      }),
    ]);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
  }
});
