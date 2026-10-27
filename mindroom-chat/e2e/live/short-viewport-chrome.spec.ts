import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';

const ROOM_NAME = 'Study notes';
const ROOM_TOPIC = 'Private room for questions and study notes';
const SUMMARY = 'Explaining eigenvalue problems across modal analysis and numerical methods';

const openRoute = (page: Page, url: string) =>
  page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

// Thread chrome stacks the room header, the thread banner, the composer and
// the receipt row. On a landscape phone that left about a third of the
// viewport for messages; short touch screens now keep a single bar at the top.
for (const viewport of [
  { name: 'landscape phone', width: 667, height: 375, touch: true, compact: true },
  { name: 'large landscape phone', width: 844, height: 390, touch: true, compact: true },
  { name: 'portrait phone', width: 390, height: 844, touch: true, compact: false },
  { name: 'short desktop window', width: 1280, height: 400, touch: false, compact: false },
]) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.touch, isMobile: viewport.touch });

    test(`${viewport.width}x${viewport.height} ${
      viewport.compact ? 'compacts' : 'keeps'
    } the room chrome`, async ({ page }, testInfo) => {
      test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // The local Matrix fixture has no provisioning service.
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await page.addInitScript(() => {
        localStorage.setItem(
          'settings',
          JSON.stringify({ useSystemTheme: false, themeId: 'dark-theme', isPeopleDrawer: false })
        );
      });
      const homeserver = getHomeserver();
      const credentials = getPrimaryCredentials();
      const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
      const restoreSettings = await setFullInterfaceModeForSession(homeserver, session);
      const roomId = await createPrivateRoom(homeserver, session.accessToken, {
        name: ROOM_NAME,
        topic: ROOM_TOPIC,
      }).catch(async (error) => {
        await restoreSettings();
        throw error;
      });
      try {
        const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
          msgtype: 'm.text',
          body: 'Can you explain eigenvalue problems in structural analysis?',
        });
        const inThread = {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        };
        await sendRoomMessage(homeserver, session.accessToken, roomId, {
          msgtype: 'm.notice',
          body: SUMMARY,
          'io.mindroom.thread_summary': {
            version: 1,
            summary: SUMMARY,
            generated_at: Date.now(),
            message_count: 4,
          },
          'm.relates_to': inThread,
        });
        await sendStateEvent(
          homeserver,
          session.accessToken,
          roomId,
          'com.mindroom.thread.tags',
          rootId,
          { tags: { fea: { set_by: session.userId, set_at: new Date().toISOString() } } }
        );
        for (let index = 1; index <= 8; index += 1) {
          // eslint-disable-next-line no-await-in-loop
          await sendRoomMessage(homeserver, session.accessToken, roomId, {
            msgtype: 'm.text',
            body: `Step ${index}: An eigenvalue problem asks which vectors keep their direction under a linear map.\nIn modal analysis each eigenvector is a mode shape and each eigenvalue a squared natural frequency.`,
            'm.relates_to': inThread,
          });
        }

        await loginWithPassword(page, { homeserver, ...credentials });
        await openRoute(page, `/home/${encodeURIComponent(roomId)}`);
        const roomHeader = page.locator('header').filter({ hasText: ROOM_NAME });
        await expect(roomHeader).toBeVisible();
        const topic = roomHeader.getByRole('button', { name: ROOM_TOPIC, includeHidden: true });
        await expect(topic).toBeAttached();
        await page.screenshot({ path: testInfo.outputPath('room.png') });
        if (viewport.compact) {
          await expect(topic, 'short viewports drop the topic line').toBeHidden();
          expect((await roomHeader.boundingBox())!.height).toBeLessThanOrEqual(44);
        } else {
          await expect(topic).toBeVisible();
        }

        await openRoute(
          page,
          `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`
        );
        const banner = page.locator('[data-thread-context-banner]');
        await expect(banner.locator('[data-thread-context-summary]')).toHaveText(SUMMARY);
        await expect(page.getByText('Step 8:', { exact: false })).toBeInViewport();
        const more = banner.getByRole('button', { name: 'Thread options' });
        await expect(more).toBeVisible();
        const scroll = page.locator('[data-thread-count]').locator('xpath=../..');
        await expect
          .poll(() =>
            scroll.evaluate(
              (element) => element.scrollHeight - element.scrollTop - element.clientHeight
            )
          )
          .toBeLessThan(2);
        await page.screenshot({ path: testInfo.outputPath('thread.png') });

        const bannerBox = (await banner.boundingBox())!;
        const composerBox = (await page.locator('[data-room-footer]').boundingBox())!;
        const visibleMessages = composerBox.y - (bannerBox.y + bannerBox.height);
        await testInfo.attach('geometry', {
          body: JSON.stringify({ bannerBox, composerBox, visibleMessages }, null, 2),
          contentType: 'application/json',
        });

        if (viewport.compact) {
          await expect(roomHeader).toBeAttached();
          await expect(roomHeader, 'the thread banner replaces the room header').toBeHidden();
          expect(bannerBox.y).toBeLessThan(12);
          expect(bannerBox.height, 'the thread banner is a single row').toBeLessThanOrEqual(48);
          // A titled thread has no eyebrow on any screen.
          await expect(banner.getByText('Thread View', { exact: true })).toHaveCount(0);
          const resolve = banner.getByRole('button', { name: 'Resolve', includeHidden: true });
          await expect(resolve).toBeAttached();
          await expect(resolve).toBeHidden();
          await expect(
            banner.getByText('fea', { exact: true }).filter({ visible: true })
          ).toHaveCount(0);
          await expect(page.locator('[data-room-following]')).toBeAttached();
          await expect(page.locator('[data-room-following]')).toBeHidden();
          expect(visibleMessages / viewport.height).toBeGreaterThan(0.55);

          // Tags, pinning and resolving stay reachable from the actions menu.
          await more.click();
          const menu = page.getByRole('menu', { name: 'Thread options' });
          await expect(menu.locator('[data-thread-action="tags"]')).toBeVisible();
          await expect(menu.locator('[data-thread-action="resolve"]')).toBeVisible();
          await expect(menu.locator('[data-thread-action="pin"]')).toBeVisible();
          await menu.locator('[data-thread-action="resolve"]').click();
          // A resolved thread keeps its status in the single row.
          const resolved = banner.getByRole('button', { name: 'Resolved' });
          await expect(resolved).toBeVisible();
          // The row hides the byline, but the button still says who resolved it.
          const byline = banner.locator('[data-thread-resolution-byline]');
          await expect(byline).toBeAttached();
          await expect(byline).toBeHidden();
          await expect(resolved).toHaveAccessibleDescription(/^Resolved by /);
          // The menu ignores Escape while the change is saving.
          await expect(menu.locator('[data-thread-action="resolve"]')).toBeEnabled();
          await page.keyboard.press('Escape');
          await expect(menu).toBeHidden();
          expect((await banner.boundingBox())!.height).toBeLessThanOrEqual(48);

          // Rotating re-measures the header inset the sticky banner sits under.
          await page.setViewportSize({ width: viewport.height, height: viewport.width });
          await expect(roomHeader).toBeVisible();
          await expect
            .poll(async () => {
              const header = (await roomHeader.boundingBox())!;
              return (await banner.boundingBox())!.y - (header.y + header.height);
            })
            .toBeGreaterThanOrEqual(0);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await expect(roomHeader).toBeHidden();
          await expect.poll(async () => (await banner.boundingBox())!.y).toBeLessThan(12);

          // Leaving the thread brings the room header back.
          await banner.locator('button').first().click();
          await expect(roomHeader).toBeVisible();
        } else {
          await expect(roomHeader).toBeVisible();
          await expect(banner.getByText('Thread View', { exact: true })).toHaveCount(0);
          await expect(banner.getByRole('button', { name: 'Resolve' })).toBeVisible();
          await expect(
            banner.getByText('fea', { exact: true }).filter({ visible: true })
          ).toHaveCount(1);
          await expect(page.locator('[data-room-following]')).toBeVisible();
        }
      } finally {
        await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
          method: 'POST',
          accessToken: session.accessToken,
          body: '{}',
        }).catch(() => undefined);
        await restoreSettings();
      }
    });
  });
}
