import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { expectInsetScrollbar, expectScrollbarBounds } from '../helpers/insetScrollbar';
import { createPrivateRoom, loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`thread messages scroll behind the pinned summary at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    await page.setViewportSize(viewport);
    // The local Matrix fixture has no provisioning service.
    await page.route('**/v1/local-mindroom/connections', (route) =>
      route.fulfill({ json: { connections: [] } })
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        'settings',
        JSON.stringify({ useSystemTheme: false, themeId: 'dark-theme', isPeopleDrawer: false })
      );
    });
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: 'Design review',
      topic: 'Local glass layout fixture',
    });
    try {
      const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: 'Review the floating thread summary',
      });
      await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.notice',
        body: 'Keep the conversation visible beneath the thread controls',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Keep the conversation visible beneath the thread controls',
          generated_at: Date.now(),
          message_count: 1,
        },
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
      for (let index = 1; index <= 16; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await sendRoomMessage(homeserver, session.accessToken, roomId, {
          msgtype: 'm.text',
          body: `Design note ${index}: Messages should flow underneath the translucent summary.\nKeep the controls clear and easy to reach while reading the conversation.`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: rootId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: rootId },
          },
        });
      }
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.evaluate((url) => {
        window.history.pushState(null, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
      const banner = page.locator('[data-thread-context-summary]').locator('xpath=../../../..');
      const scroll = page.locator('[data-thread-count]').locator('xpath=../..');
      await expect(banner).toBeVisible();
      await expect(page.getByText('Design note 16:', { exact: false })).toBeInViewport();
      await expect
        .poll(() =>
          scroll.evaluate(
            (element) => element.scrollHeight - element.scrollTop - element.clientHeight
          )
        )
        .toBeLessThan(2);
      const initialBanner = await banner.boundingBox();
      const viewportBox = await scroll.boundingBox();
      const roomHeader = page.locator('header').filter({ hasText: 'Design review' });
      await expect(roomHeader).toHaveCSS('box-shadow', 'none');
      await expect(roomHeader).toHaveCSS('backdrop-filter', /^blur\(3px\)/);
      const roomHeaderBox = (await roomHeader.boundingBox())!;
      const composer = page.locator('[data-slate-editor="true"]');
      const composerBox = (await composer.boundingBox())!;
      expect(initialBanner).not.toBeNull();
      expect(viewportBox).not.toBeNull();
      expect(viewportBox!.y, 'messages extend behind the room header').toBeLessThanOrEqual(
        roomHeaderBox.y
      );
      expect(
        viewportBox!.y + viewportBox!.height,
        'messages extend behind the composer and receipt footer'
      ).toBeGreaterThan(composerBox.y + composerBox.height);
      expect(viewportBox!.y, 'the message viewport extends behind the summary').toBeLessThan(
        initialBanner!.y
      );
      await expect
        .poll(() =>
          scroll.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).scrollPaddingTop)
          )
        )
        .toBeGreaterThan(initialBanner!.height);

      await expectInsetScrollbar(page, scroll, banner, page.locator('[data-room-footer]'));

      await page.mouse.move(
        viewportBox!.x + viewportBox!.width / 2,
        initialBanner!.y + initialBanner!.height + 60
      );
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(2);
      const firstMessage = page.locator('[data-message-item="0"]');
      await expect(firstMessage).toBeVisible();
      const firstBox = await firstMessage.boundingBox();
      expect(firstBox!.y, 'the first message can be read below the summary').toBeGreaterThanOrEqual(
        initialBanner!.y + initialBanner!.height
      );
      await scroll.getByRole('scrollbar').hover();
      await page.screenshot({ path: testInfo.outputPath('scrollbar-top.png') });
      await page.mouse.move(
        viewportBox!.x + viewportBox!.width / 2,
        initialBanner!.y + initialBanner!.height + 60
      );

      const historyTarget = await scroll.evaluate((element) =>
        Math.min(380, (element.scrollHeight - element.clientHeight) / 2)
      );
      await page.mouse.wheel(0, historyTarget);
      await expect
        .poll(() => scroll.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(historyTarget - 2);
      await expect
        .poll(() =>
          scroll.evaluate(
            (element) => element.scrollHeight - element.scrollTop - element.clientHeight
          )
        )
        .toBeGreaterThan(100);
      await expect
        .poll(async () => (await banner.boundingBox())!.y)
        .toBeCloseTo(initialBanner!.y, 0);
      const rowsBehindBanner = await page.locator('[data-message-item]').evaluateAll(
        (rows, box) =>
          rows.filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.top < box.y + box.height && rect.bottom > box.y;
          }).length,
        initialBanner!
      );
      expect(rowsBehindBanner, 'rendered messages continue behind the glass').toBeGreaterThan(0);
      // Rows also pass under [+all], so it needs its own glass to keep their text out of its label.
      const expansionButton = page.getByRole('button', { name: /^\[[+-]all\]$/ });
      const expansionBox = (await expansionButton.boundingBox())!;
      const rowsBehindExpansion = await page.locator('[data-message-item]').evaluateAll(
        (rows, box) =>
          rows.filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.top < box.y + box.height && rect.bottom > box.y;
          }).length,
        expansionBox
      );
      expect(rowsBehindExpansion, 'messages scroll beneath [+all]').toBeGreaterThan(0);
      await expect(expansionButton).toHaveCSS('backdrop-filter', /^blur\(3px\)/);
      await expect(expansionButton).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const footer = page.locator('[data-room-footer]');
      const emptyFooterHeight = (await footer.boundingBox())!.height;
      const clearComposer = async () => {
        // Let selectionchange reach Slate before deleting the selected text.
        await composer.press('ControlOrMeta+A', { delay: 80 });
        await composer.press('Backspace');
        await expect
          .poll(async () => (await footer.boundingBox())!.height)
          .toBeCloseTo(emptyFooterHeight, 0);
      };
      const growComposer = async () => {
        const previousHeight = (await footer.boundingBox())!.height;
        await composer.fill('Draft line one\nDraft line two\nDraft line three\nDraft line four');
        await expect
          .poll(async () => (await footer.boundingBox())!.height)
          .toBeGreaterThan(previousHeight);
        await expect
          .poll(async () => {
            const padding = await scroll.evaluate((element) =>
              Number.parseFloat(getComputedStyle(element).scrollPaddingBottom)
            );
            return padding - (await footer.boundingBox())!.height;
          })
          .toBeCloseTo(0, 0);
      };
      const historyTop = await scroll.evaluate((element) => element.scrollTop);
      await growComposer();
      await expectScrollbarBounds(scroll, banner, footer);
      await expect
        .poll(() => scroll.evaluate((element) => element.scrollTop))
        .toBeCloseTo(historyTop, 0);
      await clearComposer();
      await expectScrollbarBounds(scroll, banner, footer);
      await page.mouse.move(viewport.width - 2, viewport.height - 2);
      await scroll.getByRole('scrollbar').hover();
      await page.screenshot({ path: testInfo.outputPath('thread-overlay.png') });

      await page.getByRole('button', { name: 'Jump to Latest', exact: true }).click();
      await expect
        .poll(() =>
          scroll.evaluate(
            (element) => element.scrollHeight - element.scrollTop - element.clientHeight
          )
        )
        .toBeLessThan(2);
      await growComposer();
      await expect
        .poll(() =>
          scroll.evaluate(
            (element) => element.scrollHeight - element.scrollTop - element.clientHeight
          )
        )
        .toBeLessThan(2);
      const lastMessage = page.getByText('Design note 16:', { exact: false });
      const lastBox = (await lastMessage.boundingBox())!;
      expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(
        (await page.locator('[data-room-footer]').boundingBox())!.y
      );
      await clearComposer();

      await scroll.getByRole('scrollbar').hover();
      await page.screenshot({ path: testInfo.outputPath('scrollbar-bottom.png') });
      const expansionLabel = await expansionButton.textContent();
      await expansionButton.click();
      await expect(expansionButton).not.toHaveText(expansionLabel!);
      await banner.getByRole('button', { name: 'Resolve', exact: true }).click();
      await expect(banner.getByRole('button', { name: 'Resolved', exact: true })).toBeVisible();
      if (viewport.width === 390) {
        await page.setViewportSize({ width: 390, height: 568 });
        await expect(
          banner.getByRole('button', { name: 'Resolved', exact: true })
        ).toBeInViewport();
        await expectScrollbarBounds(scroll, banner, footer);
      }
      await page.mouse.move(viewportBox!.x + viewportBox!.width / 2, 300);
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(2);
      await expect
        .poll(async () => {
          const headerBox = (await banner.boundingBox())!;
          const rootBox = (await firstMessage.boundingBox())!;
          return rootBox.y - headerBox.y - headerBox.height;
        })
        .toBeGreaterThanOrEqual(0);
      const targetMessage = page.locator('[data-message-item="4"]');
      await targetMessage.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await expect
        .poll(async () => {
          const headerBox = (await banner.boundingBox())!;
          const targetBox = (await targetMessage.boundingBox())!;
          return targetBox.y - headerBox.y - headerBox.height;
        })
        .toBeGreaterThanOrEqual(0);
      await banner.getByRole('button').first().click();
      await expect(page.locator('[data-thread-context-summary]')).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
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
    }
  });
}
