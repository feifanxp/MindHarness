import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  loginToMatrix,
  setDirectAccountData,
} from '../helpers/matrix';

const { defaultBrowserType: _browserType, ...phone } = devices['iPhone 13'];

test.skip(!hasPrimaryCredentials(), 'Requires a local Matrix test account.');

for (const mobile of [false, true]) {
  test.describe(mobile ? 'phone navigation panel' : 'desktop navigation panel', () => {
    test.use(mobile ? phone : { viewport: { width: 1280, height: 900 } });

    test('sizes navigation and handles Home, DM, and Space repeat clicks', async ({ page }) => {
      const homeserver = getHomeserver();
      const credentials = getPrimaryCredentials();
      const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
      const suffix = Date.now();
      const roomId = await createPrivateRoom(homeserver, session.accessToken, {
        name: `Sidebar room ${suffix}`,
      });
      const directId = await createPrivateRoom(homeserver, session.accessToken, {
        name: `Sidebar DM ${suffix}`,
        isDirect: true,
      });
      await setDirectAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        '@sidebar-peer:example.org',
        directId
      );
      const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
        name: `Sidebar space ${suffix}`,
      });
      await addRoomToSpace(homeserver, session.accessToken, spaceId, roomId);
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.goto('/home/');
      await waitForLoggedInShell(page);

      const panel = page.getByTestId('resizable-page-nav');
      const handle = page.getByRole('separator', { name: 'Resize navigation panel' });
      await expect(panel).toBeVisible();
      const expectFullWidth = async () => {
        await expect(panel).toBeVisible();
        await expect(handle).toHaveCount(0);
        await expect
          .poll(async () => {
            const bounds = await panel.boundingBox();
            return bounds ? { x: Math.round(bounds.x), width: Math.round(bounds.width) } : null;
          })
          // The persistent icon rail occupies the first 66 px of the phone viewport.
          .toEqual({ x: 66, width: page.viewportSize()!.width - 66 });
        await expect(page.locator('body')).toHaveJSProperty(
          'scrollWidth',
          page.viewportSize()!.width
        );
      };
      const initial = await panel.boundingBox();
      expect(initial).not.toBeNull();
      let resizedWidth = 0;
      if (mobile) {
        await expectFullWidth();
        // A width saved by an earlier app version must not narrow the phone list.
        await page.evaluate((userId) => {
          localStorage.setItem(`mindroom.pageNav.width:${userId}`, '220');
        }, session.userId);
        await page.reload();
        await waitForLoggedInShell(page);
        await expectFullWidth();
        await page.setViewportSize({ width: 750, height: 390 });
        await expectFullWidth();
        await page.setViewportSize({ width: 844, height: 390 });
        await expect(handle).toBeVisible();
        await expect
          .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
          .toBe(220);
        await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 844);
        await page.setViewportSize({ width: 390, height: 844 });
        await expectFullWidth();
      } else {
        const edge = await handle.boundingBox();
        if (!edge || !initial) throw new Error('Missing resize geometry');
        const start = { x: edge.x + edge.width / 2, y: edge.y + 250 };
        const delta = 100;
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + delta, start.y, { steps: 8 });
        await page.mouse.up();
        resizedWidth = Math.round(initial.width + delta);
        await expect
          .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
          .toBe(resizedWidth);
        await expect(handle).toHaveCSS('touch-action', 'none');
        await page.reload();
        await waitForLoggedInShell(page);
        await expect
          .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
          .toBe(resizedWidth);
        const roomPath = `/home/${encodeURIComponent(roomId)}/`;
        await page.goto(roomPath);
        await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
        const resizeEdge = await handle.boundingBox();
        if (!resizeEdge) throw new Error('Missing collapse drag target');
        const dragX = resizeEdge.x + resizeEdge.width / 2;
        const dragY = resizeEdge.y + 250;
        await page.mouse.move(dragX, dragY);
        await page.mouse.down();
        await page.mouse.move(dragX - resizedWidth + 150, dragY, { steps: 8 });
        await expect.poll(async () => (await panel.boundingBox())?.width).toBe(0);
        await expect(panel).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Expand navigation panel' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
        await page.screenshot({ path: test.info().outputPath('collapse-preview.png') });
        // Dragging back reverses the preview without losing the current room.
        await page.mouse.move(dragX, dragY, { steps: 8 });
        await expect
          .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
          .toBe(resizedWidth);
        await page.mouse.move(dragX - resizedWidth + 150, dragY, { steps: 8 });
        await page.mouse.up();
        await expect(panel).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(encodeURIComponent(roomId)));
        await page.reload();
        await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
        await expect(panel).toHaveCount(0);
        await page.getByRole('button', { name: 'Expand navigation panel' }).click();
        await expect
          .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
          .toBe(resizedWidth);
      }
      await page.screenshot({ path: test.info().outputPath('navigation-panel.png') });

      for (const section of [
        {
          root: '/home/',
          room: roomId,
          button: page.getByRole('button', { name: 'Home', exact: true }),
        },
        {
          root: '/direct/',
          room: directId,
          button: page.getByRole('button', { name: 'Direct Messages', exact: true }),
        },
        {
          root: `/${encodeURIComponent(spaceId)}/`,
          room: roomId,
          button: page.locator(`button[data-id="${spaceId}"]`),
        },
      ]) {
        const roomPath = `${section.root}${encodeURIComponent(section.room)}/`;
        await page.goto(roomPath);
        await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
        // Wait for the real room route to record its active path before opening the list.
        await expect
          .poll(() =>
            page.evaluate(
              ({ userId, room }) => {
                const paths = JSON.parse(localStorage.getItem(`navToActivePath${userId}`) ?? '{}');
                return Object.values(paths).some((path) =>
                  (path as { pathname: string }).pathname.includes(encodeURIComponent(room))
                );
              },
              { userId: session.userId, room: section.room }
            )
          )
          .toBe(true);
        if (mobile) {
          await expect(panel).toHaveCount(0);
          await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
          await page.goto(section.root);
          await waitForLoggedInShell(page);
          await expectFullWidth();
          await section.button.tap();
          await expect(panel).toHaveCount(0);
          await expect(page).toHaveURL(new RegExp(encodeURIComponent(section.room)));
        } else {
          const currentUrl = page.url();
          await expect(panel).toBeVisible();
          await section.button.click();
          await expect(panel).toHaveCount(0);
          await expect(page).toHaveURL(currentUrl);
          await section.button.click();
          await expect(panel).toBeVisible();
          await expect(page).toHaveURL(currentUrl);
          await expect
            .poll(async () => Math.round((await panel.boundingBox())?.width ?? 0))
            .toBe(resizedWidth);
          await section.button.click();
          const other =
            section.root === '/direct/'
              ? page.getByRole('button', { name: 'Home', exact: true })
              : page.getByRole('button', { name: 'Direct Messages', exact: true });
          await other.click();
          await expect(panel).toBeVisible();
        }
      }
    });
  });
}
