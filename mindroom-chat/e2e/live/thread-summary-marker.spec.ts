import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';

const FIRST_SUMMARY = 'Investigation of iOS push notifications stopping after a few hours';
const LATEST_SUMMARY = 'Fixing iOS push token refresh while the app is suspended';

// A finger or pointer presses where the control is; Playwright's click would
// first scroll it, which moves a thread row under the sticky banner.
const press = async (page: Page, touch: boolean, target: Locator) => {
  const box = (await target.boundingBox())!;
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

// MindRoom posts a summary after an agent's first reply and then every ten
// messages. In the open thread each one is a quiet marker under the reply; a
// summary that repeats the previous one leaves no row, and the full title
// shows on hover or tap.
for (const viewport of [
  { name: 'desktop', width: 1280, height: 800, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
]) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.touch, isMobile: viewport.touch });

    test('shows summaries in a thread as small markers', async ({ page }, testInfo) => {
      test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // The local Matrix fixture has no provisioning service.
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await page.addInitScript(() => {
        if (localStorage.getItem('settings')) return;
        localStorage.setItem(
          'settings',
          JSON.stringify({ useSystemTheme: false, themeId: 'light-theme', isPeopleDrawer: false })
        );
      });
      const homeserver = getHomeserver();
      const credentials = getPrimaryCredentials();
      const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
      const agent = await registerAgentAccount(homeserver, 'code');
      await matrixFetch(homeserver, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
        method: 'PUT',
        accessToken: agent.accessToken,
        body: JSON.stringify({ displayname: 'Code' }),
      });
      const restoreSettings = await setFullInterfaceModeForSession(homeserver, session);
      try {
        const roomId = await createPrivateRoom(homeserver, session.accessToken, {
          name: 'iOS app',
          invite: [agent.userId],
        });
        await joinRoom(homeserver, agent.accessToken, roomId);
        const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
          msgtype: 'm.text',
          body: 'Push notifications stop arriving on my iPhone after a few hours. Can you dig into why?',
        });
        const inThread = {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        };
        const say = (accessToken: string, body: string) =>
          sendRoomMessage(homeserver, accessToken, roomId, {
            msgtype: 'm.text',
            body,
            'm.relates_to': inThread,
          });
        const summarize = (summary: string, messageCount: number) =>
          sendRoomMessage(homeserver, agent.accessToken, roomId, {
            msgtype: 'm.notice',
            body: summary,
            'io.mindroom.thread_summary': {
              version: 1,
              summary,
              message_count: messageCount,
              generated_at: new Date().toISOString(),
              model: 'test',
            },
            'm.relates_to': inThread,
          });
        await say(agent.accessToken, 'Checking the APNs delivery logs and background refresh.');
        await summarize(FIRST_SUMMARY, 2);
        await say(session.accessToken, 'It happens on iOS 18 too, not only 17.');
        await say(agent.accessToken, 'APNs accepts every push, so the device token goes stale.');
        await say(session.accessToken, 'Okay, so it is the token refresh. Can you fix it?');
        await say(agent.accessToken, 'Yes. Moving the refresh into a BGAppRefreshTask.');
        await summarize(FIRST_SUMMARY, 6);
        await say(agent.accessToken, 'Done. PR #212 is up; push still arrives after 6 h.');
        await summarize(LATEST_SUMMARY, 7);
        await say(session.accessToken, 'Nice, merging after lunch.');

        await loginWithPassword(page, { homeserver, ...credentials });
        await openRoute(
          page,
          `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`
        );
        const banner = page.locator('[data-thread-context-banner]');
        await expect(banner.locator('[data-thread-context-summary]')).toHaveText(LATEST_SUMMARY);
        await expect(page.getByText('Nice, merging after lunch.')).toBeVisible();

        const titled = page.getByRole('button', { name: 'AI titled this thread' });
        const updated = page.getByRole('button', { name: 'AI title updated' });
        await expect(titled).toHaveCount(1);
        // The repeated summary leaves no row.
        await expect(updated).toHaveCount(1);
        await expect(page.getByText(/AI summary of last/).filter({ visible: true })).toHaveCount(0);
        await expect(page.getByText(FIRST_SUMMARY).filter({ visible: true })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('thread.png') });

        const details = page.locator('[data-thread-summary-details]');
        const away = page.getByText('Nice, merging after lunch.');
        if (viewport.touch) await press(page, true, updated);
        else await updated.hover();
        await expect(details).toBeVisible();
        await expect(details).toContainText('AI summary of last 7 messages');
        await expect(details).toContainText(LATEST_SUMMARY);
        await expect(details).toContainText(`Was: ${FIRST_SUMMARY}`);
        await expect(updated).toHaveAttribute('aria-expanded', 'true');
        await page.screenshot({ path: testInfo.outputPath('details.png') });
        // Open details take no input: the marker, and the timeline around it,
        // still get the pointer, the wheel and shortcuts.
        const box = (await updated.boundingBox())!;
        const hit = await page.evaluate(
          ([x, y]) => ({
            marker: !!document.elementFromPoint(x, y)?.closest('button[aria-expanded]'),
            blocking: Array.from(document.getElementById('portalContainer')?.children ?? []).some(
              (child) => child.getAttribute('role') !== 'tooltip'
            ),
          }),
          [box.x + box.width / 2, box.y + box.height / 2]
        );
        expect(hit).toEqual({ marker: true, blocking: false });

        if (!viewport.touch) {
          // The open details must not cover the marker: moving within it keeps
          // them open, a click pins them, and they stay after the mouse leaves.
          for (const dx of [2, 4, 6, 8]) {
            // eslint-disable-next-line no-await-in-loop
            await page.mouse.move(box.x + dx, box.y + box.height / 2);
          }
          await expect(details).toBeVisible();
          await press(page, false, updated);
          await page.mouse.move(viewport.width / 2, viewport.height - 20);
          await expect(details).toBeVisible();
        }
        // A press elsewhere closes them.
        await press(page, viewport.touch, away);
        await expect(details).toHaveCount(0);
      } finally {
        await restoreSettings();
      }
    });
  });
}
