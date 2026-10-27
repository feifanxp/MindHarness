import { expect, test, type Locator } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { expectFloatingNavHeader } from '../helpers/glassVisual';
import { expectInsetScrollbar } from '../helpers/insetScrollbar';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  loginToMatrix,
  matrixFetch,
  setAccountData,
} from '../helpers/matrix';

// Directory results are local fixtures; the service worker must not bypass routing.
test.use({ serviceWorkers: 'block' });

for (const [themeId, width] of [
  ['dark-theme', 1280],
  ['silver-theme', 390],
] as const) {
  test(`Lobby and Explore headers overlay content in ${themeId}`, async ({ page }, testInfo) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    test.skip(
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
      'Local fixture only'
    );
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const savedSettings = await matrixFetch<Record<string, unknown>>(
      homeserver,
      `/user/${encodeURIComponent(session.userId)}/account_data/io.mindroom.settings`,
      { accessToken: session.accessToken }
    ).catch((error: Error) => {
      if (error.message.startsWith('Matrix API 404')) return {};
      throw error;
    });
    const createdRooms: string[] = [];
    try {
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        { ...savedSettings, simpleMode: false }
      );
      const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
        name: 'MindRoom',
        topic: 'Rooms for creative work and shared ideas',
      });
      createdRooms.push(spaceId);
      for (let index = 1; index <= 24; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        const roomId = await createPrivateRoom(homeserver, session.accessToken, {
          name: `${String(index).padStart(2, '0')} · ${
            ['Garden plans', 'Design studio', 'Reading room', 'New ideas'][index % 4]
          }`,
          topic: 'A place to share ideas, explore projects, and build together.',
        });
        createdRooms.push(roomId);
        // eslint-disable-next-line no-await-in-loop
        await addRoomToSpace(homeserver, session.accessToken, spaceId, roomId);
      }
      await page.setViewportSize({ width, height: 844 });
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await page.route('**/config.json', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          json: {
            ...(await response.json()),
            featuredCommunities: {
              rooms: createdRooms.slice(1),
              spaces: [],
              servers: ['example.org'],
            },
          },
        });
      });
      await page.route('**/_matrix/client/*/publicRooms**', (route) =>
        route.fulfill({
          json: {
            chunk: createdRooms.slice(1).map((roomId, index) => ({
              room_id: roomId,
              name: `${String(index + 1).padStart(2, '0')} · ${
                ['Design studio', 'Reading room', 'New ideas', 'Garden plans'][index % 4]
              }`,
              topic: 'A place to share ideas, explore projects, and build together.',
              num_joined_members: 12 + index,
              world_readable: false,
              guest_can_join: false,
              join_rule: 'public',
            })),
            total_room_count_estimate: 24,
          },
        })
      );
      await page.addInitScript((selectedTheme) => {
        const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
        localStorage.setItem(
          'settings',
          JSON.stringify({
            ...settings,
            useSystemTheme: false,
            themeId: selectedTheme,
            isPeopleDrawer: false,
          })
        );
      }, themeId);
      await loginWithPassword(page, { homeserver, ...credentials });

      const navigate = (path: string) =>
        page.evaluate((url) => {
          window.history.pushState(null, '', url);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, path);

      const verifyHeader = async (header: Locator, content: Locator, name: string) => {
        await expect(page.getByText('Catching up...', { exact: true })).toHaveCount(0, {
          timeout: 60000,
        });
        const scroller = content.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
        await scroller.evaluate((element) => {
          element.scrollTop = 390;
        });
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(300);
        await page.screenshot({ path: testInfo.outputPath(`${name}-scrolled.png`) });
        await expectFloatingNavHeader(header);
        await header.hover({ position: { x: 10, y: 10 } });
        await expectFloatingNavHeader(header);
        expect(
          await header.evaluate((element) => getComputedStyle(element, '::before').display)
        ).toBe('none');
        // A room overlaps the header geometrically; the header owns pointer hits.
        expect(
          await header.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(bounds.x + 10, bounds.y + 10));
          })
        ).toBe(true);
        await expectInsetScrollbar(page, scroller, header);
        await scroller.evaluate((element) => {
          element.scrollTop = 390;
        });
        const interior = scroller.locator('button[data-room-id], button:has-text("View")').first();
        await expect(interior).toHaveCount(1);
        await interior.evaluate((element) => element.scrollIntoView({ block: 'start' }));
        const top = (await header.boundingBox())!;
        expect((await interior.boundingBox())!.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
        // Put real room text behind the material, not just somewhere above the viewport.
        const text = (await content.boundingBox())!;
        await scroller.evaluate((element, delta) => {
          element.scrollTop += delta;
        }, text.y - top.y - top.height / 2);
        const behind = (await content.boundingBox())!;
        expect(behind.y).toBeLessThan(top.y + top.height);
        expect(behind.y + behind.height).toBeGreaterThan(top.y);
        await scroller.evaluate((element) => {
          element.scrollTop = 390;
        });
        await scroller.getByRole('scrollbar').hover();
        await page.screenshot({ path: testInfo.outputPath(`${name}-scrolled.png`) });
      };

      await page.getByRole('button', { name: 'Mi', exact: true }).click({ timeout: 15000 });
      await page.getByRole('link', { name: 'Lobby', exact: true }).click({ timeout: 15000 });
      const lobbyHeader = page
        .locator('header')
        .filter({ has: page.getByRole('button', { name: 'Members', exact: true }) });
      const lobbyRoom = page.getByText('01 · Design studio', { exact: true }).last();
      await expect(lobbyRoom).toBeVisible();
      const lobbyContent = lobbyRoom.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
      const hero = page.locator('h2').filter({ hasText: 'MindRoom' }).locator('..').locator('..');
      const boundary =
        (await hero.boundingBox())!.y +
        (await hero.boundingBox())!.height -
        (await lobbyHeader.boundingBox())!.y -
        (await lobbyHeader.boundingBox())!.height;
      await lobbyContent.evaluate((element, offset) => {
        element.scrollTop = offset - 2;
      }, boundary);
      await expect(lobbyHeader.getByText('MindRoom', { exact: true })).toHaveCount(0);
      await lobbyContent.evaluate((element, offset) => {
        element.scrollTop = offset + 2;
      }, boundary);
      await expect(lobbyHeader.getByText('MindRoom', { exact: true })).toBeVisible();
      // Pass an inner node so the same helper finds the actual viewport.
      await verifyHeader(lobbyHeader, lobbyRoom, 'lobby');
      await lobbyContent.getByRole('scrollbar').press('End');
      await expect(page.getByText('24 · Garden plans', { exact: true }).last()).toBeVisible();
      const toTop = page.getByRole('button', { name: 'Scroll to Top', exact: true });
      await expect(toTop).toBeVisible();
      expect((await toTop.boundingBox())!.y).toBeGreaterThanOrEqual(
        (await lobbyHeader.boundingBox())!.y + (await lobbyHeader.boundingBox())!.height
      );
      await toTop.click();
      await expect
        .poll(() => lobbyContent.evaluate((element) => element.scrollTop))
        .toBeLessThan(1);
      await lobbyHeader.getByRole('button', { name: 'Members', exact: true }).click();
      const membersHeader = page
        .locator('header')
        .filter({ has: page.getByRole('button', { name: 'Invite people', exact: true }) });
      await expect(membersHeader.getByText('1 Member', { exact: true })).toBeVisible();
      await membersHeader.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(
        lobbyHeader.getByRole('button', { name: 'Members', exact: true })
      ).toHaveAttribute('aria-pressed', 'false');

      await navigate('/explore/example.org/');
      const serverHeader = page.locator('header').filter({ hasText: 'example.org' });
      const roomCard = page.getByText('01 · Design studio', { exact: true }).last();
      await expect(roomCard).toBeVisible();
      await verifyHeader(serverHeader, roomCard, 'explore');

      await navigate('/explore/featured/');
      const featuredRoom = page.getByText('01 · Design studio', { exact: true }).last();
      await expect(featuredRoom).toBeVisible();
      if (width === 390) {
        await verifyHeader(page.locator('header').last(), featuredRoom, 'featured');
      } else {
        const scroll = featuredRoom.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
        await expect(scroll.locator('header')).toHaveCount(0);
        await expect(scroll).toHaveCSS('scroll-padding-block-start', '0px');
      }
    } finally {
      const results = await Promise.allSettled([
        setAccountData(
          homeserver,
          session.accessToken,
          session.userId,
          'io.mindroom.settings',
          savedSettings
        ),
        ...createdRooms.map(async (roomId) => {
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/forget`, {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
        }),
      ]);
      expect
        .soft(
          results.filter((result) => result.status === 'rejected'),
          'Fixture cleanup'
        )
        .toEqual([]);
    }
  });
}
