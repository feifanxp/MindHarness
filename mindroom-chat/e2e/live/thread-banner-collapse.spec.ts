import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';

const ROOM_NAME = 'Protocol design';
const SUMMARY =
  'Error model and protocol design for state preparation under correlated drive errors';

// Playwright's click scrolls the target into view first, and for a button in
// the sticky banner that scrolls the thread toward the banner's place in the
// flow. Press where the button is instead, as a finger or pointer would.
const press = async (page: Page, touch: boolean, button: Locator) => {
  const box = (await button.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

const openRoute = (page: Page, url: string) =>
  page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

// The thread banner stays above the messages while they scroll. More collapses
// it to a pill with back and Show details on every screen, and the choice
// persists.
// A tablet keeps the room list open, which leaves the title as little room as a phone.
for (const viewport of [
  { name: 'desktop', width: 1280, height: 800, touch: false, bylineBelow: false },
  { name: 'tablet', width: 820, height: 1180, touch: true, bylineBelow: true },
  { name: 'phone', width: 390, height: 844, touch: true, bylineBelow: true },
]) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.touch, isMobile: viewport.touch });

    test('collapses the thread banner to a pill and keeps it collapsed', async ({
      page,
    }, testInfo) => {
      test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // The local Matrix fixture has no provisioning service.
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await page.addInitScript(() => {
        // Seed once, so a reload keeps what the page itself saved.
        if (localStorage.getItem('settings')) return;
        localStorage.setItem(
          'settings',
          JSON.stringify({ useSystemTheme: false, themeId: 'light-theme', isPeopleDrawer: false })
        );
      });
      const homeserver = getHomeserver();
      const credentials = getPrimaryCredentials();
      const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
      const restoreSettings = await setFullInterfaceModeForSession(homeserver, session);
      const roomId = await createPrivateRoom(homeserver, session.accessToken, {
        name: ROOM_NAME,
      }).catch(async (error) => {
        await restoreSettings();
        throw error;
      });
      try {
        const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
          msgtype: 'm.text',
          body: 'Can the current method handle correlated drive errors?',
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
        const tagged = { set_by: session.userId, set_at: new Date().toISOString() };
        await sendStateEvent(
          homeserver,
          session.accessToken,
          roomId,
          'com.mindroom.thread.tags',
          rootId,
          { tags: { protocol: tagged, research: tagged } }
        );
        for (let index = 1; index <= 14; index += 1) {
          // eslint-disable-next-line no-await-in-loop
          await sendRoomMessage(homeserver, session.accessToken, roomId, {
            msgtype: 'm.text',
            body: `Step ${index}: Treat the correlated errors as one shared rotation per round.\nMeasuring at the end with post-selection gives the same answer when only the accepted runs matter.`,
            'm.relates_to': inThread,
          });
        }

        await loginWithPassword(page, { homeserver, ...credentials });
        const threadPath = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(
          rootId
        )}`;
        await openRoute(page, threadPath);
        const banner = page.locator('[data-thread-context-banner]');
        await expect(banner.locator('[data-thread-context-summary]')).toHaveText(SUMMARY);
        const scroll = page.locator('[data-thread-count]').locator('xpath=../..');
        const bottomGap = () =>
          scroll.evaluate(
            (element) => element.scrollHeight - element.scrollTop - element.clientHeight
          );
        await expect.poll(bottomGap).toBeLessThan(2);
        const tag = banner.getByText('protocol', { exact: true }).filter({ visible: true });
        await expect(tag).toHaveCount(1);
        const resolve = banner.getByRole('button', { name: 'Resolve', includeHidden: true });
        await expect(resolve).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('expanded.png') });
        // The two tags share a row.
        const research = banner.getByText('research', { exact: true }).filter({ visible: true });
        const tagTop = async (pill: Locator) => (await pill.boundingBox())!.y;
        expect(Math.abs((await tagTop(tag)) - (await tagTop(research)))).toBeLessThan(2);
        // A titled thread drops the "Thread View" eyebrow.
        await expect(banner.getByText('Thread View', { exact: true })).toHaveCount(0);
        const more = banner.getByRole('button', { name: 'Thread options' });
        // Collapsing lives in More, not in the bar.
        await expect(banner.getByRole('button', { name: 'Hide thread details' })).toHaveCount(0);
        const expandedHeight = (await banner.boundingBox())!.height;

        await press(page, viewport.touch, more);
        const menu = page.getByRole('menu', { name: 'Thread options' });
        await menu.locator('[data-thread-action="hideDetails"]').click();
        await expect(menu).toBeHidden();
        const show = banner.getByRole('button', { name: 'Show thread details' });
        await expect(show).toBeFocused();
        await expect(banner.getByRole('button')).toHaveCount(2);
        await expect(banner.getByRole('button', { name: 'Back to room' })).toBeVisible();
        await expect(banner.locator('[data-thread-context-summary]')).toHaveCount(0);
        await expect(resolve).toHaveCount(0);
        await expect(tag).toHaveCount(0);
        await expect.poll(async () => (await banner.boundingBox())!.height).toBeLessThanOrEqual(44);
        // A pill at the start of the row, not a bar across the timeline.
        const collapsed = (await banner.boundingBox())!;
        expect(collapsed.width).toBeLessThanOrEqual(80);
        // The reader stays at the latest message while the banner shrinks.
        await expect.poll(bottomGap).toBeLessThan(2);
        await expect(page.getByText('Step 14:', { exact: false })).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath('collapsed.png') });
        await testInfo.attach('sizes', {
          body: JSON.stringify(
            { expandedHeight, collapsedHeight: collapsed.height, collapsedWidth: collapsed.width },
            null,
            2
          ),
          contentType: 'application/json',
        });

        // The choice holds for the next thread view, also after a reload.
        await page.reload();
        await expect(show).toBeVisible();
        await expect(banner.locator('[data-thread-context-summary]')).toHaveCount(0);
        // The pill shows before the thread loads; wait for it, as a reader would.
        await expect(page.getByText('Step 14:', { exact: false })).toBeInViewport();

        await press(page, viewport.touch, show);
        await expect(banner.locator('[data-thread-context-summary]')).toHaveText(SUMMARY);
        await expect(resolve).toBeVisible();
        await expect(tag).toHaveCount(1);
        // Show details unmounted with the pill; More, which can hide it again, has focus.
        await expect(more).toBeFocused();

        // Who resolved the thread follows its title (below it where the title
        // has no room beside it), and the chip lines up with More.
        await press(page, viewport.touch, resolve);
        const resolved = banner.getByRole('button', { name: 'Resolved' });
        const byline = banner.locator('[data-thread-resolution-byline]');
        await expect(byline).toBeVisible();
        const box = async (locator: Locator) => (await locator.boundingBox())!;
        const centerY = ({ y, height }: { y: number; height: number }) => y + height / 2;
        const title = await box(banner.locator('[data-thread-context-summary]'));
        const by = await box(byline);
        if (viewport.bylineBelow) {
          expect(by.y).toBeGreaterThanOrEqual(title.y + title.height);
          expect(title.width).toBeGreaterThan(100);
        } else {
          expect(Math.abs(centerY(by) - centerY(title))).toBeLessThan(2);
          // Right after the title, not at the far end of the row.
          expect(by.x - (title.x + title.width)).toBeLessThan(16);
        }
        expect(Math.abs(centerY(await box(resolved)) - centerY(await box(more)))).toBeLessThan(2);
        // Resolve is an icon the size of More, named by a tooltip.
        const resolvedBox = await box(resolved);
        const moreBox = await box(more);
        expect(Math.abs(resolvedBox.width - moreBox.width)).toBeLessThan(1);
        expect(Math.abs(resolvedBox.height - moreBox.height)).toBeLessThan(1);
        // Resolved fills green; More keeps its own surface.
        const background = (locator: Locator) =>
          locator.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(await background(resolved)).not.toBe(await background(more));
        await expect(resolved).toHaveAccessibleDescription(/^Resolved by /);
        if (!viewport.touch) {
          // The click that resolved it closed the tooltip; point at it afresh.
          await page.mouse.move(0, 0);
          await page.mouse.move(resolvedBox.x + resolvedBox.width / 2, centerY(resolvedBox));
          await expect(page.getByRole('tooltip')).toContainText('Resolved by');
          await expect(page.getByRole('tooltip')).toContainText('Reopen thread');
        }
        await page.screenshot({ path: testInfo.outputPath('resolved.png') });
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
