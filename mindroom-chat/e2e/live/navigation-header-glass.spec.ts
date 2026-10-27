import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { expectFloatingNavHeader } from '../helpers/glassVisual';
import { expectInsetScrollbar } from '../helpers/insetScrollbar';
import { createPrivateRoom, loginToMatrix, matrixFetch, setAccountData } from '../helpers/matrix';

for (const [themeId, width] of [
  ['dark-theme', 390],
  ['silver-theme', 1100],
] as const) {
  test('all navigation headers share floating glass in ' + themeId, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const homeserver = getHomeserver();
    test.skip(
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
      'Local fixture only'
    );
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const readAccountData = (type: string) =>
      matrixFetch<Record<string, unknown>>(
        homeserver,
        '/user/' + encodeURIComponent(session.userId) + '/account_data/' + type,
        { accessToken: session.accessToken }
      ).catch((error: Error) => {
        if (error.message.startsWith('Matrix API 404')) return {};
        throw error;
      });
    const [savedSettings, savedDirects] = await Promise.all([
      readAccountData('io.mindroom.settings'),
      readAccountData('m.direct'),
    ]);
    const rooms: string[] = [];
    try {
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        { ...savedSettings, simpleMode: false }
      );
      for (let index = 1; index <= 32; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        rooms.push(
          await createPrivateRoom(homeserver, session.accessToken, {
            name: String(index).padStart(2, '0') + ' · Design studio',
            topic: 'Local navigation glass fixture',
          })
        );
      }
      await setAccountData(homeserver, session.accessToken, session.userId, 'm.direct', {
        ...savedDirects,
        '@avery:example.org': rooms.slice(16),
      });
      await page.setViewportSize({ width, height: 640 });
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem(
          'settings',
          JSON.stringify({ useSystemTheme: false, themeId: selectedTheme, isPeopleDrawer: false })
        );
      }, themeId);
      await loginWithPassword(page, { homeserver, ...credentials });
      const panel = page.getByTestId('resizable-page-nav');
      const navigate = (path: string) =>
        page.evaluate((url) => {
          window.history.pushState(null, '', url);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, path);
      for (const [path, title] of [
        ['/home/', 'Home'],
        ['/direct/', 'Direct Messages'],
        [width < 750 ? '/inbox/' : '/inbox/invites/', 'Inbox'],
        ...(width < 750 ? [] : [['/inbox/notifications/', 'Inbox']]),
        ['/explore/', 'Explore Community'],
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await navigate(path);
        const header = panel.locator('header').filter({ hasText: title });
        // eslint-disable-next-line no-await-in-loop
        const scroll = await expectFloatingNavHeader(header);
        if (path === '/home/' || path === '/direct/') {
          // eslint-disable-next-line no-await-in-loop
          await expectInsetScrollbar(page, scroll, header);
          if (path === '/home/' && width >= 750) {
            const splitter = panel.getByRole('separator', { name: 'Resize navigation panel' });
            // eslint-disable-next-line no-await-in-loop
            const handle = (await splitter.boundingBox())!;
            // eslint-disable-next-line no-await-in-loop
            const track = (await scroll.getByRole('scrollbar').boundingBox())!;
            expect(track.x + track.width).toBeLessThanOrEqual(handle.x);
            // eslint-disable-next-line no-await-in-loop
            const before = (await panel.boundingBox())!.width;
            const x = handle.x + handle.width / 2;
            const y = handle.y + handle.height / 2;
            // eslint-disable-next-line no-await-in-loop
            await page.mouse.move(x, y);
            // eslint-disable-next-line no-await-in-loop
            await page.mouse.down();
            // eslint-disable-next-line no-await-in-loop
            await page.mouse.move(x + 30, y, { steps: 5 });
            // eslint-disable-next-line no-await-in-loop
            await page.mouse.up();
            // eslint-disable-next-line no-await-in-loop
            await expect
              .poll(async () => (await panel.boundingBox())!.width)
              .toBeCloseTo(before + 30, 0);
          }
          // eslint-disable-next-line no-await-in-loop
          await scroll.evaluate((el) => {
            el.scrollTop = 180;
          });
          // eslint-disable-next-line no-await-in-loop
          await expect
            .poll(() =>
              header.evaluate((el) => {
                const viewport = el.closest('[data-y-scrollbar-width]')!;
                const top = el.getBoundingClientRect();
                return Array.from(viewport.querySelectorAll('a')).some((link) => {
                  const bounds = link.getBoundingClientRect();
                  return bounds.top < top.bottom && bounds.bottom > top.top;
                });
              })
            )
            .toBe(true);
          // eslint-disable-next-line no-await-in-loop
          await expectFloatingNavHeader(header);
          // eslint-disable-next-line no-await-in-loop
          await scroll.getByRole('scrollbar').hover();
          // eslint-disable-next-line no-await-in-loop
          await page.screenshot({
            path: testInfo.outputPath(path.split('/')[1] + '-header-scrolled.png'),
            scale: 'css',
          });
          // eslint-disable-next-line no-await-in-loop
          await header.getByRole('button').click();
          // eslint-disable-next-line no-await-in-loop
          await expect(page.getByRole('button', { name: /Mark.*read/i })).toBeVisible();
          // eslint-disable-next-line no-await-in-loop
          await page.keyboard.press('Escape');
          const row = panel
            .getByRole('link')
            .filter({ hasText: path === '/home/' ? '02 · Design studio' : '18 · Design studio' })
            .locator('..');
          // eslint-disable-next-line no-await-in-loop
          await row.hover();
          // eslint-disable-next-line no-await-in-loop
          await row.getByRole('button', { name: 'More Options', exact: true }).click();
          // eslint-disable-next-line no-await-in-loop
          await expect(
            page.getByRole('button', { name: 'Room Settings', exact: true })
          ).toBeVisible();
          // eslint-disable-next-line no-await-in-loop
          await page.keyboard.press('Escape');
        }
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({
          path: testInfo.outputPath(path.split('/')[1] + '-header.png'),
          scale: 'css',
        });
      }
      // Empty lists must keep the title and centered actions in the same viewport.
      await setAccountData(homeserver, session.accessToken, session.userId, 'm.direct', {});
      await navigate('/direct/');
      await expect(panel.getByText('No Direct Messages', { exact: true })).toBeVisible();
      const emptyDirect = await expectFloatingNavHeader(
        panel.locator('header').filter({ hasText: 'Direct Messages' })
      );
      expect(
        await emptyDirect.evaluate((el) => el.scrollHeight - el.clientHeight)
      ).toBeLessThanOrEqual(1);
      await expect(
        panel.getByRole('button', { name: 'Direct Message', exact: true })
      ).toBeInViewport();
      const joined = await matrixFetch<{ joined_rooms: string[] }>(homeserver, '/joined_rooms', {
        accessToken: session.accessToken,
      });
      await setAccountData(homeserver, session.accessToken, session.userId, 'm.direct', {
        '@avery:example.org': joined.joined_rooms,
      });
      await navigate('/home/');
      await expect(panel.getByText('No Rooms', { exact: true })).toBeVisible();
      const emptyHome = await expectFloatingNavHeader(
        panel.locator('header').filter({ hasText: 'Home' })
      );
      expect(
        await emptyHome.evaluate((el) => el.scrollHeight - el.clientHeight)
      ).toBeLessThanOrEqual(1);
      await expect(
        panel.getByRole('button', { name: 'Create Room', exact: true })
      ).toBeInViewport();
      await setAccountData(homeserver, session.accessToken, session.userId, 'm.direct', {
        ...savedDirects,
        '@avery:example.org': rooms.slice(16),
      });
      await expect(
        panel.getByRole('link', { name: '01 · Design studio', exact: true })
      ).toBeVisible();
      await page.getByRole('button', { name: /Open settings for / }).click();
      await expect(page.getByRole('button', { name: 'General', exact: true })).toBeVisible();
      const settingsHeader = page
        .getByRole('button', { name: 'General', exact: true })
        .locator('xpath=ancestor::*[@data-y-scrollbar-width][1]')
        .locator('header');
      await expectFloatingNavHeader(settingsHeader, { inheritsPanelTint: true });
      await page.setViewportSize({ width, height: 360 });
      const settingsScroll = await expectFloatingNavHeader(settingsHeader, {
        inheritsPanelTint: true,
      });
      await expectInsetScrollbar(page, settingsScroll, settingsHeader);
      const logout = (await page
        .getByRole('button', { name: 'Logout', exact: true })
        .boundingBox())!;
      const settingsTrack = (await settingsScroll.getByRole('scrollbar').boundingBox())!;
      expect(settingsTrack.y + settingsTrack.height).toBeLessThanOrEqual(logout.y);
      await settingsScroll.getByRole('scrollbar').hover();
      await page.screenshot({ path: testInfo.outputPath('settings-header.png'), scale: 'css' });
      await page.setViewportSize({ width, height: 640 });
      await page.keyboard.press('Escape');
      // Room settings uses the same navigation primitive inside the glass modal.
      await navigate('/home/' + encodeURIComponent(rooms[0]));
      const roomHeader = page.locator('header').filter({ hasText: '01 · Design studio' });
      await roomHeader.getByRole('button').last().click();
      await page.getByRole('button', { name: 'Room Settings', exact: true }).click();
      await expect(page.getByRole('button', { name: 'General', exact: true })).toBeVisible();
      const roomSettingsHeader = page
        .getByRole('button', { name: 'General', exact: true })
        .locator('xpath=ancestor::*[@data-y-scrollbar-width][1]')
        .locator('header');
      await expectFloatingNavHeader(roomSettingsHeader, { inheritsPanelTint: true });
      await page.setViewportSize({ width, height: 240 });
      const roomSettingsScroll = await expectFloatingNavHeader(roomSettingsHeader, {
        inheritsPanelTint: true,
      });
      await expectInsetScrollbar(page, roomSettingsScroll, roomSettingsHeader);
      await roomSettingsScroll.getByRole('scrollbar').hover();
      await page.screenshot({
        path: testInfo.outputPath('room-settings-header.png'),
        scale: 'css',
      });
      await page.keyboard.press('Escape');
      expect(errors).toEqual([]);
    } finally {
      const cleanup = await Promise.allSettled([
        setAccountData(
          homeserver,
          session.accessToken,
          session.userId,
          'io.mindroom.settings',
          savedSettings
        ),
        setAccountData(homeserver, session.accessToken, session.userId, 'm.direct', savedDirects),
        ...rooms.map(async (roomId) => {
          await matrixFetch(homeserver, '/rooms/' + encodeURIComponent(roomId) + '/leave', {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
          await matrixFetch(homeserver, '/rooms/' + encodeURIComponent(roomId) + '/forget', {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
        }),
      ]);
      const failures = cleanup.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : []
      );
      // Record cleanup failures without replacing a browser assertion already in flight.
      expect.soft(failures, 'Could not clean up navigation fixture').toEqual([]);
    }
  });
}
