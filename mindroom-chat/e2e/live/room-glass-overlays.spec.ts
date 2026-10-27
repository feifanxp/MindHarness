import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { expectClearStrip } from '../helpers/glassVisual';
import { expectInsetScrollbar } from '../helpers/insetScrollbar';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

for (const width of [390, 1280]) {
  for (const simpleMode of [false, true]) {
    test(`room controls overlay cards at ${width}px in ${
      simpleMode ? 'simple' : 'full'
    } mode`, async ({ page }, testInfo) => {
      test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
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
      const homeserver = getHomeserver();
      test.skip(
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
        'Local fixture only'
      );
      const credentials = getPrimaryCredentials();
      const { accessToken, userId } = await loginToMatrix(
        homeserver,
        credentials.username,
        credentials.password
      );
      const settings = await matrixFetch<Record<string, unknown>>(
        homeserver,
        `/user/${encodeURIComponent(userId)}/account_data/io.mindroom.settings`,
        { accessToken }
      ).catch((error: Error) => {
        if (error.message.startsWith('Matrix API 404')) return {};
        throw error;
      });
      const roomId = await createPrivateRoom(homeserver, accessToken, {
        name: 'Project notes',
        topic: 'Planning the next release',
      });
      const agentId = '@mindroom_glass_fixture:' + userId.slice(userId.indexOf(':') + 1);
      try {
        await matrixFetch(
          homeserver,
          `/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(agentId)}`,
          {
            method: 'PUT',
            accessToken,
            body: JSON.stringify({ membership: 'invite', displayname: 'Design assistant' }),
          }
        );
        await setAccountData(homeserver, accessToken, userId, 'io.mindroom.settings', {
          ...settings,
          simpleMode,
        });
        for (let index = 1; index <= 14; index += 1) {
          // eslint-disable-next-line no-await-in-loop
          const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
            msgtype: 'm.text',
            body: `Release topic ${index}: Review the design and collect feedback`,
          });
          if (index % 2 === 0) {
            // eslint-disable-next-line no-await-in-loop
            await matrixFetch(
              homeserver,
              `/rooms/${encodeURIComponent(
                roomId
              )}/state/com.mindroom.thread.tags/${encodeURIComponent(
                JSON.stringify([rootId, 'resolved'])
              )}`,
              {
                method: 'PUT',
                accessToken,
                body: JSON.stringify({ set_by: userId, set_at: new Date().toISOString() }),
              }
            );
          }
          // eslint-disable-next-line no-await-in-loop
          await sendRoomMessage(homeserver, accessToken, roomId, {
            msgtype: 'm.text',
            body: 'Keep the conversation readable while reviewing the next steps.',
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: rootId,
              is_falling_back: true,
              'm.in_reply_to': { event_id: rootId },
            },
          });
        }
        await loginWithPassword(page, { homeserver, ...credentials });
        await seedRoomOverviewState({
          page,
          roomId,
          userId,
          viewMode: 'compact',
          filterState: createDefaultThreadFilterState(),
        });
        await page.goto(`/home/${encodeURIComponent(roomId)}`);
        const scroll = page.locator('[data-compact-room-view="true"]');
        const header = page.locator('header').filter({ hasText: 'Project notes' });
        const filters = page.locator('[data-room-thread-overview="true"]');
        const footer = page.locator('[data-room-footer="true"]');
        const following = page.locator('[data-room-following="true"]');
        const cards = scroll.locator('button[data-thread-root-id]');
        await expect(cards).toHaveCount(14);
        await expectClearStrip(following);
        expect(
          await header.evaluate((element) => {
            const css = getComputedStyle(element);
            return [css.borderTopWidth, css.borderBottomWidth, css.boxShadow, css.backgroundImage];
          })
        ).toEqual(['0px', '0px', 'none', 'none']);
        await expect(header).toHaveCSS('backdrop-filter', /^blur\(3px\)/);
        await expect(filters.locator('[data-view-mode="compact"]')).toHaveAttribute(
          'aria-pressed',
          'true'
        );
        const headerBox = (await header.boundingBox())!;
        const filtersBox = (await filters.boundingBox())!;
        const footerBox = (await footer.boundingBox())!;
        const scrollBox = (await scroll.boundingBox())!;
        expect(scrollBox.y).toBeLessThanOrEqual(headerBox.y);
        expect(scrollBox.y + scrollBox.height).toBeGreaterThanOrEqual(
          footerBox.y + footerBox.height - 1
        );
        expect((await cards.first().boundingBox())!.y).toBeGreaterThanOrEqual(
          filtersBox.y + filtersBox.height
        );
        await expectInsetScrollbar(page, scroll, filters, footer);
        // Scroll beyond the first cards: content must exist behind every surface.
        await scroll.evaluate((element) => {
          element.scrollTop = 400;
        });
        for (const surface of [header, filters, footer, following]) {
          const box = (await surface.boundingBox())!;
          expect(
            await cards.evaluateAll(
              (elements, area) =>
                elements.some((element) => {
                  const rect = element.getBoundingClientRect();
                  return rect.top < area.y + area.height && rect.bottom > area.y;
                }),
              box
            )
          ).toBe(true);
        }
        expect((await header.boundingBox())!.y).toBeCloseTo(headerBox.y, 0);
        expect((await filters.boundingBox())!.y).toBeCloseTo(filtersBox.y, 0);
        expect((await footer.boundingBox())!.y).toBeCloseTo(footerBox.y, 0);
        await page.mouse.move(0, 0);
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await scroll.getByRole('scrollbar').hover();
        await page.screenshot({ path: testInfo.outputPath('room-overlays.png') });

        // Opening a thread and going back preserves the overview's reading position.
        const savedTop = await scroll.evaluate((element) => element.scrollTop);
        const visibleIndex = await cards.evaluateAll(
          (elements, area) =>
            elements.findIndex((element) => {
              const rect = element.getBoundingClientRect();
              return rect.top >= area.top && rect.bottom <= area.bottom;
            }),
          { top: filtersBox.y + filtersBox.height, bottom: footerBox.y }
        );
        expect(visibleIndex).toBeGreaterThanOrEqual(0);
        await cards.nth(visibleIndex).click();
        const banner = page.locator('[data-thread-context-banner]');
        await expect(banner).toBeVisible();
        await banner.getByRole('button').first().click();
        await expect(scroll).toBeVisible();
        await expect
          .poll(() => scroll.evaluate((element) => element.scrollTop))
          .toBeCloseTo(savedTop, 0);

        // Returning from a thread reconnects the measured footer on the next frame.
        await expect
          .poll(() =>
            scroll.evaluate((element) =>
              Number.parseFloat(getComputedStyle(element).scrollPaddingBottom)
            )
          )
          .toBeCloseTo((await footer.boundingBox())!.height, 0);
        await scroll.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const lastCard = (await cards.last().boundingBox())!;
        expect(lastCard.y + lastCard.height).toBeLessThanOrEqual((await footer.boundingBox())!.y);
        // Native focus scrolling must also respect the controls' measured insets.
        await cards.first().evaluate((element) => element.scrollIntoView({ block: 'start' }));
        expect((await cards.first().boundingBox())!.y).toBeGreaterThanOrEqual(
          (await filters.boundingBox())!.y + filtersBox.height
        );
        if (simpleMode) {
          const unresolved = filters.locator('[data-simple-unresolved-toggle]');
          await unresolved.click();
          await expect(cards).toHaveCount(7);
          await unresolved.click();
          await expect(cards).toHaveCount(14);
        } else {
          await filters.locator('[data-preset-button]').click();
          const presets = filters.locator('[data-preset-dropdown]');
          await expect(presets).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(presets).not.toBeVisible();
        }
        const sort = filters.locator('[data-sort-by]');
        const previousSort = await sort.getAttribute('data-sort-direction');
        await sort.click();
        await expect(sort).not.toHaveAttribute('data-sort-direction', previousSort!);

        for (const mode of simpleMode ? ['threaded'] : ['threaded', 'classic']) {
          // eslint-disable-next-line no-await-in-loop
          await filters.locator(`[data-view-mode="${mode}"]`).click();
          const messages = page.getByTestId('room-virtual-inner');
          const messageScroll = messages.locator('xpath=../..');
          // eslint-disable-next-line no-await-in-loop
          await expect(messages).toBeVisible();
          // eslint-disable-next-line no-await-in-loop
          await expectInsetScrollbar(
            page,
            messageScroll,
            mode === 'classic' ? header : filters,
            footer
          );
          // eslint-disable-next-line no-await-in-loop
          expect((await messageScroll.boundingBox())!.y).toBeLessThanOrEqual(headerBox.y);
          if (mode === 'classic') {
            // eslint-disable-next-line no-await-in-loop
            await expect(filters).toHaveCount(0);
          }
          // eslint-disable-next-line no-await-in-loop
          await messageScroll.evaluate((element) => {
            element.scrollTop = 350;
          });
          // eslint-disable-next-line no-await-in-loop
          await page.mouse.move(0, 0);
          // eslint-disable-next-line no-await-in-loop
          await expect(page.getByRole('tooltip')).toHaveCount(0);
          // eslint-disable-next-line no-await-in-loop
          await messageScroll.getByRole('scrollbar').hover();
          // eslint-disable-next-line no-await-in-loop
          await page.screenshot({ path: testInfo.outputPath(`${mode}-overlays.png`) });
          // eslint-disable-next-line no-await-in-loop
          await page.mouse.move(width / 2, 400);
          // A real scroll gesture releases the initial room-history pin.
          // eslint-disable-next-line no-await-in-loop
          await page.mouse.wheel(0, -10000);
          // eslint-disable-next-line no-await-in-loop
          await expect
            .poll(() => messageScroll.evaluate((element) => element.scrollTop))
            .toBeLessThan(2);
          // eslint-disable-next-line no-await-in-loop
          await expect
            .poll(async () => {
              const top = mode === 'classic' ? header : filters;
              const topBox = (await top.boundingBox())!;
              const rowBox = await messages.locator('[data-message-item]').first().boundingBox();
              return rowBox ? rowBox.y - topBox.y - topBox.height : -1;
            })
            .toBeGreaterThanOrEqual(0);
          // eslint-disable-next-line no-await-in-loop
          await page.getByRole('button', { name: 'Jump to Latest', exact: true }).click();
          // eslint-disable-next-line no-await-in-loop
          await expect
            .poll(() =>
              messageScroll.evaluate(
                (element) => element.scrollHeight - element.scrollTop - element.clientHeight
              )
            )
            .toBeLessThan(2);
        }
      } finally {
        await setAccountData(homeserver, accessToken, userId, 'io.mindroom.settings', settings);
        await matrixFetch(
          homeserver,
          `/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(agentId)}`,
          { method: 'PUT', accessToken, body: JSON.stringify({ membership: 'leave' }) }
        );
        for (const action of ['leave', 'forget']) {
          // eslint-disable-next-line no-await-in-loop
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/${action}`, {
            method: 'POST',
            accessToken,
            body: '{}',
          });
        }
      }
    });
  }
}
