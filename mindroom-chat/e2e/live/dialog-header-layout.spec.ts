/* eslint-disable no-await-in-loop -- Dialogs share a session and open sequentially. */
import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import { expectFloatingNavHeader } from '../helpers/glassVisual';
import { expectInsetScrollbar, expectScrollbarBounds } from '../helpers/insetScrollbar';
import { createPrivateRoom, loginToMatrix, matrixFetch, sendStateEvent } from '../helpers/matrix';

for (const themeId of ['dark-theme', 'silver-theme']) {
  test(`dialog headers fit short views and virtual lists in ${themeId}`, async ({
    page,
  }, testInfo) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    test.skip(
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
      'Local fixture only'
    );
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    let roomId: string | undefined;
    let restoreSettings: (() => Promise<unknown>) | undefined;
    try {
      restoreSettings = await setFullInterfaceModeForSession(homeserver, session);
      roomId = await createPrivateRoom(homeserver, session.accessToken, {
        name: 'Design studio',
        topic: 'Shared projects',
      });
      // Invite-only local identities exercise the real virtual list without registering accounts.
      await Promise.all(
        Array.from({ length: 32 }, (_, index) =>
          sendStateEvent(
            homeserver,
            session.accessToken,
            roomId!,
            'm.room.member',
            `@glass_guest_${index}:${session.userId.split(':').slice(1).join(':')}`,
            {
              membership: 'invite',
              displayname: `Studio guest ${String(index + 1).padStart(2, '0')}`,
            }
          )
        )
      );
      await page.setViewportSize({ width: 390, height: 620 });
      await page.addInitScript(
        (theme) =>
          localStorage.setItem(
            'settings',
            JSON.stringify({
              ...JSON.parse(localStorage.getItem('settings') ?? '{}'),
              useSystemTheme: false,
              themeId: theme,
              isPeopleDrawer: false,
            })
          ),
        themeId
      );
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.evaluate((id) => {
        window.history.pushState(null, '', `/home/${encodeURIComponent(id)}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, roomId);
      const roomHeader = page.locator('header').filter({ hasText: 'Design studio' }).first();
      for (const [length, topic] of [
        ['short', 'Shared projects'],
        [
          'long',
          Array.from(
            { length: 40 },
            (_, index) => `Project ${index + 1}: share ideas and review designs together.`
          ).join('\n\n'),
        ],
      ]) {
        await sendStateEvent(homeserver, session.accessToken, roomId, 'm.room.topic', '', {
          topic,
        });
        await roomHeader.getByRole('button', { name: topic, exact: true }).click();
        const header = page
          .locator('header')
          .filter({ has: page.getByText('Design studio', { exact: true }) })
          .last();
        const scroll = header.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
        await expect(scroll).toBeVisible();
        await scroll.evaluate((element) => {
          element.scrollTop = 230;
        });
        await expectFloatingNavHeader(header, { inheritsPanelTint: true });
        const bounds = (await scroll.boundingBox())!;
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(621);
        if (length === 'short') expect(bounds.height).toBeLessThan(200);
        else {
          expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
          await expectInsetScrollbar(page, scroll, header);
        }
        await page.mouse.move(2, 2);
        await page.screenshot({ path: testInfo.outputPath(`topic-${length}.png`), scale: 'css' });
        await header.getByRole('button').last().click();
      }
      await roomHeader.getByRole('button').last().click();
      await page.getByRole('button', { name: 'Room Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Members', exact: true }).click();
      const header = page
        .locator('header')
        .filter({ has: page.getByText('1 Member', { exact: true }) });
      const scroll = header.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
      await scroll.getByRole('button', { name: 'Joined', exact: true }).click();
      await page.getByRole('button', { name: 'Invited', exact: true }).click();
      await expect(scroll.getByRole('button', { name: /Studio guest 01/ })).toBeVisible();
      await scroll.evaluate((element) => {
        element.scrollTop = 500;
      });
      await expectFloatingNavHeader(header, { inheritsPanelTint: true });
      await expectScrollbarBounds(scroll, header);
      // Scroll through estimated virtual rows so their real heights are measured.
      await expect(async () => {
        await scroll.evaluate((element) => {
          element.scrollTop += 250;
        });
        await expect(scroll.getByRole('button', { name: /Studio guest 32/ })).toBeInViewport({
          ratio: 1,
          timeout: 500,
        });
      }).toPass({ timeout: 10000, intervals: [100] });
      await scroll.getByRole('scrollbar').press('End');
      await expect(scroll.getByRole('button', { name: /Studio guest 32/ })).toBeInViewport({
        ratio: 1,
      });
      const search = scroll.getByRole('textbox');
      await search.fill('Studio guest 32');
      await expect(scroll.getByRole('button', { name: /Studio guest 32/ })).toBeVisible();
      await search.fill('');
      await scroll.getByRole('scrollbar').press('Home');
      await expect(scroll.getByRole('button', { name: /Studio guest 01/ })).toBeVisible();
      await scroll.evaluate((element) => {
        element.scrollTop = 180;
      });
      await page.mouse.move(2, 2);
      await page.screenshot({ path: testInfo.outputPath('settings-members.png'), scale: 'css' });
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        window.history.pushState(null, '', '/home');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('button', { name: /Open settings for / }).click();
      await page.getByRole('button', { name: 'Emojis & Stickers', exact: true }).click();
      await page.getByRole('button', { name: 'Select', exact: true }).click();
      const packsHeader = page
        .locator('header')
        .filter({ has: page.getByText('Room Packs', { exact: true }) });
      await expectFloatingNavHeader(packsHeader, { inheritsPanelTint: true });
      await page.screenshot({ path: testInfo.outputPath('room-packs.png'), scale: 'css' });
    } finally {
      const cleanup = await Promise.allSettled([
        restoreSettings?.(),
        (async () => {
          if (!roomId) return;
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
        })(),
      ]);
      expect
        .soft(
          cleanup.filter((result) => result.status === 'rejected'),
          'Fixture cleanup'
        )
        .toEqual([]);
    }
  });
}
