import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForCredentials } from '../helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
} from '../helpers/matrix';

for (const surface of ['room', 'thread'] as const) {
  for (const width of [390, 1280]) {
    test(`message disclosure clears the composer in ${surface} at ${width}px`, async ({
      page,
    }, testInfo) => {
      test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
      const homeserver = getHomeserver();
      test.skip(
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
        'Local fixture only'
      );
      const credentials = getPrimaryCredentials();
      if (surface === 'room') {
        await setFullInterfaceModeForCredentials(homeserver, credentials);
      }
      const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
      const body = Array.from(
        { length: 40 },
        (_, i) =>
          `Detail ${
            i + 1
          }: Keep the message controls above the composer while reading a long response.`
      ).join('\n\n');
      const fixture = await createThreadFixture(homeserver, session.accessToken, {
        name: 'Message controls',
        topic: 'Local message disclosure fixture',
        rootBody: surface === 'room' ? body : 'Review the long response',
        replyBody: surface === 'thread' ? body : 'Short reply',
      });
      try {
        await page.setViewportSize({ width, height: 844 });
        await page.route('**/v1/local-mindroom/connections', (route) =>
          route.fulfill({ json: { connections: [] } })
        );
        await page.addInitScript(() => {
          localStorage.setItem(
            'settings',
            JSON.stringify({ useSystemTheme: false, themeId: 'dark-theme', isPeopleDrawer: false })
          );
        });
        await loginWithPassword(page, { homeserver, ...credentials });
        await seedRoomOverviewState({
          page,
          roomId: fixture.roomId,
          userId: session.userId,
          viewMode: surface === 'room' ? 'classic' : 'threaded',
        });
        const roomPath = `/home/${encodeURIComponent(fixture.roomId)}`;
        await page.goto(
          surface === 'room'
            ? roomPath
            : `${roomPath}?threadId=${encodeURIComponent(fixture.rootId)}`
        );
        const messageId = surface === 'room' ? fixture.rootId : fixture.replyId;
        const row = page.locator(`[data-message-id="${messageId}"]`);
        await expect(row).toBeVisible();
        const expand = row.getByRole('button', { name: 'Show full message', exact: true });
        if (await expand.isVisible()) await expand.click();
        const collapse = row.getByRole('button', { name: 'Show less', exact: true });
        await expect(collapse).toBeVisible();
        const scroll = row.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
        const footer = page.locator('[data-room-footer]');
        const scrollBox = (await scroll.boundingBox())!;
        await page.mouse.move(
          scrollBox.x + scrollBox.width / 2,
          (await footer.boundingBox())!.y - 100
        );
        // Real wheel input releases the timeline's follow-latest state in both engines.
        // Reaching the top can prepend earlier room events and restore an anchor.
        // Continue real input until that pagination has also reached the top.
        await expect
          .poll(async () => {
            await page.mouse.wheel(0, -(await scroll.evaluate((el) => el.scrollHeight)));
            return scroll.evaluate((el) => el.scrollTop);
          })
          .toBeLessThan(2);
        const contentId = (await collapse.getAttribute('aria-controls'))!;
        const content = page.locator(`[id="${contentId}"]`);
        // Pagination may still prepend rows after the top check, so scroll relative to
        // the message rather than the timeline start. Its body must still reach above
        // the composer at the short height, or its sticky control stays inside it.
        const contentOffset = async () =>
          (await content.boundingBox())!.y - (await scroll.boundingBox())!.y;
        await page.mouse.wheel(0, (await contentOffset()) - 150);
        await expect.poll(contentOffset).toBeLessThan(200);
        const contentBox = (await content.boundingBox())!;
        expect(contentBox.y + contentBox.height).toBeGreaterThan(
          (await footer.boundingBox())!.y + 200
        );
        const expectClearControl = async () => {
          await expect
            .poll(async () => {
              const button = (await collapse.boundingBox())!;
              return (await footer.boundingBox())!.y - button.y - button.height;
            })
            .toBeGreaterThanOrEqual(7);
          expect(
            await collapse.evaluate((el) => {
              const box = el.getBoundingClientRect();
              return el.contains(
                document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              );
            })
          ).toBe(true);
        };
        await expectClearControl();
        await page.screenshot({
          path: testInfo.outputPath('disclosure-above-composer.png'),
          scale: 'css',
        });
        const height = (await footer.boundingBox())!.height;
        await page
          .locator('[data-slate-editor="true"]')
          .fill('Draft line one\nDraft line two\nDraft line three\nDraft line four');
        await expect.poll(async () => (await footer.boundingBox())!.height).toBeGreaterThan(height);
        await expectClearControl();
        await page.setViewportSize({ width, height: 568 });
        expect((await content.boundingBox())!.y).toBeLessThan(
          (await footer.boundingBox())!.y - 100
        );
        await expectClearControl();
        await collapse.click();
        await expect(expand).toBeVisible();
      } finally {
        try {
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(fixture.roomId)}/leave`, {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(fixture.roomId)}/forget`, {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
        } catch (error) {
          expect.soft(error, 'Local fixture cleanup').toBeUndefined();
        }
      }
    });
  }
}
