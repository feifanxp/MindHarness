import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

const openCommandPalette = async (page: Page) => {
  const mac = await page.evaluate(() => /Mac|iPod|iPhone|iPad/.test(navigator.platform));
  await page.keyboard.press(mac ? 'Meta+k' : 'Control+k');
};

test.describe('command palette', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');

  test('filters without losing text, follows pointer selection, and opens the chosen room', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const { accessToken } = await loginToMatrix(
      homeserver,
      credentials.username,
      credentials.password
    );
    const roomName = `Palette navigation ${Date.now()}`;
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: roomName,
      topic: 'A room for command palette navigation checks',
    });
    await loginWithPassword(page, { homeserver, ...credentials });
    await openCommandPalette(page);
    const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true });
    const input = dialog.getByRole('combobox');
    await expect(input).toBeFocused();

    await input.fill(roomName);
    await dialog.getByRole('button', { name: 'Rooms', exact: true }).click();
    await expect(input).toHaveValue(`# ${roomName}`);
    await expect(input).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Rooms', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(dialog.getByRole('option').filter({ hasText: roomName })).toBeVisible();
    await expect(dialog.locator('[role="option"]:not([data-kind="room"])')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'All', exact: true }).click();
    await expect(input).toHaveValue(roomName);
    await input.fill('');
    const firstSelectedId = await input.getAttribute('aria-activedescendant');
    await dialog.getByRole('listbox').evaluate((list) => {
      const scroll = list.parentElement!;
      scroll.scrollTop = scroll.scrollHeight;
    });
    await input.fill(' ');
    await expect(input).toHaveAttribute('aria-activedescendant', firstSelectedId!);
    await expect(dialog.getByRole('option', { selected: true })).toBeInViewport();
    await input.press('ArrowUp');
    const selected = dialog.getByRole('option', { selected: true });
    await expect(selected).toBeInViewport();
    await expect(input).toHaveAttribute(
      'aria-activedescendant',
      (await selected.getAttribute('id'))!
    );
    await expect(input).toBeFocused();

    await input.fill(roomName);
    const target = dialog.getByRole('option').filter({ hasText: roomName }).first();
    await target.hover();
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(roomId)));
  });

  test('leads with rooms, sinks the open room, keeps one trigger, and moves room search to the menu', async ({
    page,
  }, testInfo) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const restoreInterfaceMode = await setFullInterfaceModeForSession(homeserver, session);
    try {
      const stamp = Date.now();
      const earlierName = `Palette earlier ${stamp}`;
      const currentName = `Palette current ${stamp}`;
      const earlierId = await createPrivateRoom(homeserver, session.accessToken, {
        name: earlierName,
      });
      const currentId = await createPrivateRoom(homeserver, session.accessToken, {
        name: currentName,
      });
      await sendRoomMessage(homeserver, session.accessToken, earlierId, {
        msgtype: 'm.text',
        body: 'older activity',
      });
      await sendRoomMessage(homeserver, session.accessToken, currentId, {
        msgtype: 'm.text',
        body: 'newest activity',
      });
      await loginWithPassword(page, { homeserver, ...credentials });

      const trigger = page.getByRole('button', { name: 'Open command palette', exact: true });
      await expect(trigger).toHaveCount(1);
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true });
      const input = dialog.getByRole('combobox');
      await expect(input).toBeFocused();
      await expect(dialog.getByRole('listbox').getByRole('group').first()).toHaveAccessibleName(
        /^Rooms/
      );
      await input.fill(currentName);
      await expect(dialog.getByRole('option').first()).toContainText(currentName);
      await input.press('Enter');
      await expect(page).toHaveURL(new RegExp(encodeURIComponent(currentId)));

      // The room header no longer duplicates the sidebar trigger; room message search moved
      // from its top bar into the room menu.
      await expect(trigger).toHaveCount(1);
      const header = page.getByRole('banner').filter({ hasText: currentName });
      await header.getByRole('button', { name: 'More Options' }).click();
      await page.getByRole('button', { name: 'Message Search' }).click();
      await expect(page).toHaveURL(
        new RegExp(`/search/\\?${new URLSearchParams({ rooms: currentId })}$`)
      );
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(encodeURIComponent(currentId)));
      await trigger.hover();
      await expect(page.getByRole('tooltip')).toContainText(/(Ctrl \+ K|⌘ K)/);

      // The shortcut works while its tooltip is showing.
      await openCommandPalette(page);
      await expect(input).toBeFocused();
      const first = dialog.getByRole('option').first();
      await expect(first).toHaveAttribute('data-kind', 'room');
      await expect(first).toContainText(earlierName);
      await expect(first).toHaveAttribute('aria-selected', 'true');
      await page.screenshot({ path: testInfo.outputPath('rooms-first-palette.png') });
      await input.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(encodeURIComponent(earlierId)));
    } finally {
      await restoreInterfaceMode();
    }
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    test(`keeps mobile search and dismissal visible at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await loginWithPassword(page, { homeserver: getHomeserver(), ...getPrimaryCredentials() });
      await openCommandPalette(page);
      const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true });
      const input = dialog.getByRole('combobox');
      await expect(input).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Close command palette' })).toBeInViewport();
      await expect(dialog.getByRole('status')).toBeInViewport();
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      const shellCornerRadii = await dialog.evaluate((element) => {
        const shell = element.parentElement;
        if (!shell) throw new Error('Command palette shell is missing');
        const style = getComputedStyle(shell);
        return {
          topLeft: Number.parseFloat(style.borderTopLeftRadius),
          topRight: Number.parseFloat(style.borderTopRightRadius),
          bottomLeft: Number.parseFloat(style.borderBottomLeftRadius),
          bottomRight: Number.parseFloat(style.borderBottomRightRadius),
        };
      });
      expect(shellCornerRadii.bottomLeft).toBeGreaterThan(0);
      expect(shellCornerRadii.bottomRight).toBeGreaterThan(0);
      expect(shellCornerRadii.bottomLeft).toBe(shellCornerRadii.topLeft);
      expect(shellCornerRadii.bottomRight).toBe(shellCornerRadii.topRight);
      await page.screenshot({ path: testInfo.outputPath('rounded-command-palette.png') });

      await dialog.getByRole('button', { name: 'Spaces', exact: true }).click();
      await expect(input).toHaveValue('* ');
      await expect(input).toBeFocused();
      await input.fill('> zxqnotfound');
      await expect(dialog.getByRole('option')).toHaveCount(0);
      await expect(input).not.toHaveAttribute('aria-activedescendant');
      await dialog.getByRole('button', { name: 'Clear search' }).click();
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await dialog.getByRole('button', { name: 'Close command palette' }).click();
      await expect(dialog).toHaveCount(0);
    });
  }
});
