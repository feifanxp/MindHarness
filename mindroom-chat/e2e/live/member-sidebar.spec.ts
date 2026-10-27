import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, createPrivateSpace, loginToMatrix } from '../helpers/matrix';

test.skip(!hasPrimaryCredentials(), 'Requires a local Matrix test account.');

test.beforeEach(async ({ page }) => {
  // The local Matrix fixture has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
});

const openRoom = async (page: Page) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Member sidebar ${Date.now()}`,
  });
  await loginWithPassword(page, { homeserver, ...credentials });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  return { roomId, userId: session.userId };
};

const widthOf = async (panel: Locator) => Math.round((await panel.boundingBox())?.width ?? 0);

const startDrag = async (page: Page, handle: Locator) => {
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('Missing member resize handle');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + Math.min(240, bounds.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
};

const dragOnPhone = async (page: Page, handle: Locator, delta: number) => {
  if (page.context().browser()?.browserType().name() !== 'chromium') {
    const start = await startDrag(page, handle);
    await page.mouse.move(start.x + delta, start.y, { steps: 8 });
    await page.mouse.up();
    return;
  }
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('Missing member resize handle');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + 240;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (delta * step) / 8, y }],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
};

test('members remain available below desktop width and resize, collapse, and reopen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 850 });
  const { userId } = await openRoom(page);
  const roomUrl = page.url();
  const panel = page.getByTestId('resizable-members-panel');
  const handle = page.getByRole('separator', { name: 'Resize member panel' });
  await expect(page.getByRole('button', { name: 'Hide Members', exact: true })).toBeVisible();
  await expect(panel).toBeVisible();
  await expect.poll(() => widthOf(panel)).toBe(266);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const start = await startDrag(page, handle);
  await page.mouse.move(start.x - 60, start.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => widthOf(panel)).toBe(326);
  await expect
    .poll(() => page.evaluate((id) => localStorage.getItem(`mindroom.members.width:${id}`), userId))
    .toBe('326');

  for (const width of [751, 800, 1124, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(handle).toBeVisible();
    expect(await widthOf(panel)).toBeGreaterThanOrEqual(200);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    await expect(page).toHaveURL(roomUrl);
  }

  await expect.poll(() => widthOf(panel)).toBe(326);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => widthOf(panel)).toBe(346);

  const collapse = await startDrag(page, handle);
  await page.mouse.move(collapse.x + 196, collapse.y, { steps: 8 });
  await expect(panel).toHaveAttribute('data-collapse-preview', 'true');
  await page.mouse.move(collapse.x, collapse.y, { steps: 8 });
  await expect.poll(() => widthOf(panel)).toBe(346);
  await page.mouse.move(collapse.x + 196, collapse.y, { steps: 8 });
  await page.mouse.up();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(roomUrl);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show Members', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show Members', exact: true }).click();
  await expect.poll(() => widthOf(panel)).toBe(346);

  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const rtl = await startDrag(page, handle);
  await page.mouse.move(rtl.x + 40, rtl.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => widthOf(panel)).toBe(386);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 1280);
  await page.screenshot({ path: test.info().outputPath('members-tablet-rtl.png') });
  expect(errors).toEqual([]);
});

test.describe('phone member overlay', () => {
  const { defaultBrowserType: _browserType, ...phone } = devices['iPhone 13'];
  test.use(phone);

  test('opens over the conversation, resizes, and closes without changing the room', async ({
    page,
    browserName,
  }) => {
    await openRoom(page);
    const roomUrl = page.url();
    const panel = page.getByTestId('resizable-members-panel');
    const dialog = page.getByRole('dialog', { name: 'Members', exact: true });
    const show = page.getByRole('button', { name: 'Show Members', exact: true });
    await expect(show).toBeVisible();
    await expect(dialog).toHaveCount(0);
    const editor = page.locator('[data-slate-editor="true"]').first();
    const editorWidth = await widthOf(editor);

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await show.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    await expect.poll(() => widthOf(editor)).toBe(editorWidth);
    const handle = dialog.getByRole('separator', { name: 'Resize member panel' });
    await dragOnPhone(page, handle, -50);
    await expect.poll(() => widthOf(panel)).toBe(316);
    await page.screenshot({ path: test.info().outputPath('members-phone-overlay.png') });

    await dragOnPhone(page, handle, 166);
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(roomUrl);
    await expect(show).toBeFocused();
    // CDP touch injection can swallow the next tap even on plain HTML; reopen with the keyboard.
    await page.keyboard.press('Enter');
    await expect.poll(() => widthOf(panel)).toBe(316);
    await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    await expect(show).toBeFocused();

    await show.tap();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await show.tap();
    await page.touchscreen.tap(20, 350);
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => widthOf(editor)).toBe(editorWidth);
    await expect(page).toHaveURL(roomUrl);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
    if (browserName === 'chromium') {
      const session = await page.context().newCDPSession(page);
      try {
        await session.send('Emulation.setSafeAreaInsetsOverride', {
          insets: { left: 44, right: 32 },
        });
        for (const direction of ['ltr', 'rtl']) {
          await page.evaluate(
            (dir) => document.documentElement.setAttribute('dir', dir),
            direction
          );
          await show.focus();
          await page.keyboard.press('Enter');
          await expect(dialog).toHaveCSS('padding-left', '44px');
          await expect(dialog).toHaveCSS('padding-right', '32px');
          await handle.focus();
          await page.keyboard.press('End');
          await expect(handle).toHaveAttribute('aria-valuemax', '314');
          await expect.poll(() => widthOf(panel)).toBe(314);
          expect(Math.round((await panel.boundingBox())!.x)).toBe(44);
          await page.keyboard.press('Home');
          await expect.poll(() => widthOf(panel)).toBe(200);
          expect(Math.round((await panel.boundingBox())!.x)).toBe(direction === 'ltr' ? 158 : 44);
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
        }
      } finally {
        await session.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
        await session.detach();
      }
    }
    expect(errors).toEqual([]);
  });
});

for (const width of [390, 1000]) {
  test(`space members resize and reopen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
      name: `Member sidebar space ${Date.now()}`,
    });
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(`/${encodeURIComponent(spaceId)}/lobby/`);
    const lobbyUrl = page.url();
    const panel = page.getByTestId('resizable-members-panel');
    const members = page.getByRole('button', { name: 'Members', exact: true });
    await expect(members).toBeVisible();
    if (width < 751) {
      await expect(panel).toHaveCount(0);
      await members.click();
      await expect(page.getByRole('dialog', { name: 'Members', exact: true })).toBeVisible();
    }
    await expect(panel).toBeVisible();
    const handle = panel.getByRole('separator', { name: 'Resize member panel' });
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => widthOf(panel)).toBe(286);
    const collapse = await startDrag(page, handle);
    await page.mouse.move(collapse.x + 140, collapse.y, { steps: 8 });
    await page.mouse.up();
    await expect(panel).toHaveCount(0);
    await members.click();
    await expect.poll(() => widthOf(panel)).toBe(286);
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(lobbyUrl);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
  });
}
