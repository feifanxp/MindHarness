import { expect, test, type Locator } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  sendMessageEdit,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

async function expectRightAligned(control: Locator) {
  const rightGap = await control.evaluate((button) => {
    const row = button.closest('[data-message-id]');
    if (!row) throw new Error('Message row missing.');
    const rowRight =
      row.getBoundingClientRect().right - parseFloat(getComputedStyle(row).paddingRight);
    return Math.abs(rowRight - button.getBoundingClientRect().right);
  });
  expect(rightGap).toBeLessThan(2);
}

const body = [
  'See this:',
  ...Array.from(
    { length: 16 },
    (_, index) => `🔧 read_file_chunk [${index + 1}]\nMessage detail ${index + 1}.`
  ),
].join('\n\n');

for (const surface of ['room', 'thread'] as const) {
  for (const { theme, messageLayout, layoutName } of [
    { theme: 'dark', messageLayout: 0, layoutName: 'Modern' },
    { theme: 'light', messageLayout: 0, layoutName: 'Modern' },
    { theme: 'dark', messageLayout: 1, layoutName: 'Compact' },
    { theme: 'dark', messageLayout: 2, layoutName: 'Bubble' },
  ] as const) {
    test(`message disclosure: ${surface}, ${theme}, ${layoutName}`, async ({ page }, testInfo) => {
      test.skip(!hasPrimaryCredentials(), 'Matrix test credentials required.');
      const homeserver = getHomeserver();
      const credentials = getPrimaryCredentials();
      const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        {
          simpleMode: false,
        }
      );
      const fixture = await createThreadFixture(homeserver, session.accessToken, {
        name: `Message disclosure ${surface} ${theme} ${Date.now()}`,
        rootBody: surface === 'room' ? body : 'Message disclosure thread',
        replyBody: surface === 'thread' ? body : 'Short reply.',
      });
      const messageId = surface === 'room' ? fixture.rootId : fixture.replyId;
      await page.addInitScript(
        ({ themeId, messageLayout }) => {
          localStorage.setItem(
            'settings',
            JSON.stringify({
              useSystemTheme: false,
              themeId,
              messageLayout,
            })
          );
        },
        { themeId: `${theme}-theme`, messageLayout }
      );
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.setViewportSize(
        theme === 'dark' ? { width: 1280, height: 900 } : { width: 390, height: 844 }
      );
      await seedRoomOverviewState({
        page,
        roomId: fixture.roomId,
        userId: session.userId,
        viewMode: surface === 'room' ? 'classic' : 'threaded',
      });
      const roomPath = `/home/${encodeURIComponent(fixture.roomId)}`;
      await page.goto(
        surface === 'room' ? roomPath : `${roomPath}?threadId=${encodeURIComponent(fixture.rootId)}`
      );

      const timeline = surface === 'thread' ? page.locator('div[data-thread-count]') : page;
      const row = timeline.locator(`[data-message-id="${messageId}"]`);
      const expand = row.getByRole('button', { name: 'Show full message', exact: true });
      await expect(expand).toBeVisible();
      if (surface === 'thread') {
        await expect(page.locator('div[data-thread-count]')).toBeVisible();
      } else {
        await expect(page.locator('div[data-thread-count]')).toHaveCount(0);
      }

      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      await expand.scrollIntoViewIfNeeded();
      await expect(page.locator('body')).toHaveClass(new RegExp(`prism-${theme}`));
      const contentId = await expand.getAttribute('aria-controls');
      expect(contentId).toBeTruthy();
      const content = page.locator(`[id="${contentId}"]`);
      await expect(content).not.toHaveCSS('mask-image', 'none');
      const layout = await expand.evaluate((button) => {
        const content = document.getElementById(button.getAttribute('aria-controls')!);
        if (!content) throw new Error('Controlled content missing.');
        const contentRect = content.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return {
          clipped: content.scrollHeight > content.clientHeight,
          previewHeight: contentRect.height,
          contentWidth: contentRect.width,
          rowWidth: button.closest('[data-message-id]')!.getBoundingClientRect().width,
          withinPreview:
            buttonRect.top >= contentRect.top && buttonRect.bottom <= contentRect.bottom,
          bottomGap: Math.abs(contentRect.bottom - buttonRect.bottom),
          extraHeight: content.parentElement!.getBoundingClientRect().height - contentRect.height,
          rightGap: Math.abs(contentRect.right - buttonRect.right),
          inViewport: buttonRect.left >= 0 && buttonRect.right <= window.innerWidth,
        };
      });
      expect(layout.clipped).toBe(true);
      expect(layout.previewHeight).toBeGreaterThan(140);
      expect(layout.withinPreview).toBe(true);
      expect(layout.bottomGap).toBeLessThan(2);
      expect(layout.extraHeight).toBeLessThan(2);
      expect(layout.rightGap).toBeLessThan(2);
      expect(layout.inViewport).toBe(true);
      if (layoutName === 'Bubble') {
        expect(layout.contentWidth).toBeLessThan(layout.rowWidth / 2);
      } else {
        await expectRightAligned(expand);
      }
      await page.screenshot({ path: testInfo.outputPath('collapsed.png') });

      await expand.focus();
      await page.keyboard.press('Enter');
      const collapse = row.getByRole('button', { name: 'Show less', exact: true });
      await expect(collapse).toBeFocused();
      await expect(collapse).toHaveAttribute('aria-expanded', 'true');
      if (layoutName !== 'Bubble') await expectRightAligned(collapse);
      await expect(content).toHaveCSS('mask-image', 'none');
      await expect
        .poll(() => content.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
        .toBe(true);
      await page.keyboard.press('Space');
      await expect(expand).toBeFocused();
      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      await expect(content).not.toHaveCSS('mask-image', 'none');
      expect(await content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true
      );

      await expand.click();
      await expect(collapse).toBeVisible();
      await collapse.click();
      await expect(expand).toBeFocused();

      await sendMessageEdit(
        homeserver,
        session.accessToken,
        fixture.roomId,
        messageId,
        'Edited short message.'
      );
      await expect(row).toContainText('Edited short message.');
      await expect(row.getByRole('button', { name: /Show (full message|less)/ })).toHaveCount(0);
      if (theme === 'dark') {
        const widthFraction = await content.evaluate((element) => {
          const row = element.closest('[data-message-id]')!;
          return element.getBoundingClientRect().width / row.getBoundingClientRect().width;
        });
        expect(widthFraction).toBeLessThan(0.5);
      }

      const wideCode = Array.from({ length: 16 }, () => 'x'.repeat(200)).join('\n');
      await sendRoomMessage(homeserver, session.accessToken, fixture.roomId, {
        msgtype: 'm.text',
        body: wideCode,
        'm.new_content': {
          msgtype: 'm.text',
          body: wideCode,
          format: 'org.matrix.custom.html',
          formatted_body: `<pre><code>${wideCode}</code></pre>`,
        },
        'm.relates_to': { rel_type: 'm.replace', event_id: messageId },
      });
      await expect(content.locator('pre')).toBeVisible();
      await expect(row.getByRole('button', { name: /^Show (full message|less)$/ })).toBeVisible();
      if (await expand.isVisible()) await expand.click();
      await expect(collapse).toBeVisible();
      const codeWidth = await content.evaluate((element) => ({
        content: element.getBoundingClientRect().width,
        row: element.closest('[data-message-id]')!.getBoundingClientRect().width,
      }));
      expect(codeWidth.content).toBeLessThanOrEqual(codeWidth.row);
      if (layoutName !== 'Bubble') await expectRightAligned(collapse);
      await collapse.click();
      await expect(expand).toBeVisible();
    });
  }
}
