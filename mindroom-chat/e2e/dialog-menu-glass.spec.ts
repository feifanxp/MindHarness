/* eslint-disable no-await-in-loop -- Menus share focus and must open sequentially. */
import { expect, test } from '@playwright/test';
import { expectFloatingNavHeader, pixelDifference, sampleScreenshot } from './helpers/glassVisual';

for (const theme of ['silver', 'dark']) {
  test(`pack actions stay below the scrolling title in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 620 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&viewer=pack&theme=${theme}`);
    const title = page.locator('header');
    const scroll = title.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
    await page.getByRole('button', { name: 'Both', exact: true }).click();
    await page.getByRole('button', { name: 'Emoji', exact: true }).click();
    const actions = page
      .getByRole('button', { name: 'Apply Changes', exact: true })
      .locator('xpath=../../..');
    await scroll.evaluate((element) => {
      element.scrollTop = 250;
    });
    const expectBelowTitle = async () => {
      await expect
        .poll(async () => {
          const header = (await title.boundingBox())!;
          return (await actions.boundingBox())!.y - header.y - header.height;
        })
        .toBeGreaterThan(0);
    };
    await expectBelowTitle();
    // Follow the measured height when a responsive title gets taller.
    await title.evaluate((element) => {
      element.style.height = '86px';
    });
    await expectBelowTitle();
  });

  test(`short text viewers fill their scrolling canvas in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 620 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&viewer=text&theme=${theme}`);
    const pre = page.locator('pre');
    await expect(pre).toHaveText('Short file');
    const text = (await pre.boundingBox())!;
    const viewport = (await pre
      .locator('xpath=ancestor::*[@data-y-scrollbar-width][1]')
      .boundingBox())!;
    const [canvas, right, bottom] = await sampleScreenshot(page, [
      { x: text.x + 4, y: text.y + 8 },
      { x: viewport.x + viewport.width - 20, y: text.y + 8 },
      { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height - 24 },
    ]);
    expect(pixelDifference(canvas, right), 'Canvas fills scrollbar gutter').toBeLessThan(3);
    expect(
      pixelDifference(canvas, bottom),
      'Canvas fills empty area below short text'
    ).toBeLessThan(3);
  });

  test(`nested titles keep the surrounding panel color in ${theme}`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&theme=${theme}`);
    await page.getByRole('button', { name: 'Open filters' }).click();
    const title = page.locator('header').filter({ hasText: 'Filters' });
    const scroll = await expectFloatingNavHeader(title, { inheritsPanelTint: true });
    await page.mouse.move(1, 1);
    const bounds = (await title.boundingBox())!;
    // Empty regions above/below the seam must match, not form a separately tinted band.
    const [header, body] = await sampleScreenshot(page, [
      { x: bounds.x + bounds.width - 68, y: bounds.y + bounds.height / 2 },
      { x: bounds.x + bounds.width - 68, y: bounds.y + bounds.height + 22 },
    ]);
    expect(pixelDifference(header, body), 'Header matches its enclosing panel').toBeLessThan(9);
    if (browserName === 'chromium') {
      // A new backdrop root can match the colors by disabling nested blur entirely.
      // Verify painted blur over real scrolling text, not just its computed CSS.
      await scroll.evaluate((element) => {
        element.scrollTop = 145;
      });
      const points = Array.from({ length: 200 }, (_, index) => ({
        x: bounds.x + 24 + (index % 40) * 3,
        y: bounds.y + bounds.height - 18 + Math.floor(index / 40) * 3,
      }));
      const blurred = await sampleScreenshot(page, points);
      await title.evaluate((element) => element.style.setProperty('backdrop-filter', 'none'));
      const unblurred = await sampleScreenshot(page, points);
      await title.evaluate((element) => element.style.removeProperty('backdrop-filter'));
      expect(
        blurred.reduce((sum, pixel, index) => sum + pixelDifference(pixel, unblurred[index]), 0),
        'Scrolling text is visibly blurred beneath the title'
      ).toBeGreaterThan(500);
    }
    await page.emulateMedia({ contrast: 'more' });
    await expect(title).toHaveCSS('backdrop-filter', 'none');
    await expect(title).toHaveCSS('background-color', /^rgb\(/);
  });

  test(`scrolling titles leave the panel rim sharp in ${theme}`, async ({ page }) => {
    test.skip(theme !== 'dark', "Silver's rim is too close to its background to measure");
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&theme=${theme}`);
    await page.getByRole('button', { name: 'Open filters' }).click();
    const title = page.locator('header').filter({ hasText: 'Filters' });
    await title.evaluate((element) =>
      Promise.all(
        element
          .closest('body > *')!
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished)
      )
    );
    await page.mouse.move(1, 1);
    const bounds = (await title.boundingBox())!;
    // Chromium's title blur otherwise smears the panel's 1px rim into a band along the edge.
    // Sample below the title text and clear of the rounded corner.
    const y = bounds.y + bounds.height - 10;
    const [rim, edge, inner] = await sampleScreenshot(page, [
      { x: bounds.x, y },
      { x: bounds.x + 3, y },
      { x: bounds.x + 24, y },
    ]);
    expect(pixelDifference(rim, inner), 'Rim is drawn crisply over the title').toBeGreaterThan(60);
    expect(pixelDifference(edge, inner), 'Title edge matches its interior').toBeLessThan(9);
  });

  test(`custom menus keep flat scrolling titles and keyboard selection in ${theme}`, async ({
    page,
  }, testInfo) => {
    for (const width of [390, 900]) {
      await page.setViewportSize({ width, height: 620 });
      await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&theme=${theme}`);
      await page.getByRole('button', { name: 'Choose model', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Model for this thread' });
      const title = dialog.locator('[data-glass-flat="true"]').first();
      const scroll = await expectFloatingNavHeader(title, { inheritsPanelTint: true });
      const search = dialog.getByRole('searchbox');
      await expect(search).toBeFocused();
      const track = scroll.getByRole('scrollbar');
      const bounds = (await track.boundingBox())!;
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.8);
      expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
      await expect(search).toBeFocused();
      await page.keyboard.press('ArrowDown');
      const activeId = await search.getAttribute('aria-activedescendant');
      const option = page.locator(`[id="${activeId}"]`);
      await expect(option).toBeInViewport({ ratio: 1 });
      expect((await option.boundingBox())!.y).toBeGreaterThanOrEqual(
        (await title.boundingBox())!.y + (await title.boundingBox())!.height - 1
      );
      await scroll.evaluate((element) => {
        element.scrollTop = 160;
      });
      await expectFloatingNavHeader(title, { inheritsPanelTint: true });
      await page.mouse.move(1, 1);
      await page.screenshot({ path: testInfo.outputPath(`models-${width}.png`), scale: 'css' });
      await search.fill('Studio model 24');
      const match = dialog.getByRole('option', { name: /^Studio model 24 / });
      await expect(match).toBeVisible();
      await expect(search).toHaveAttribute(
        'aria-activedescendant',
        (await match.getAttribute('id'))!
      );
      await page.keyboard.press('Enter');
      await expect(page.locator('output')).toHaveText('model-24');
      await dialog.getByRole('button', { name: 'Close model picker' }).click();
      await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toBeFocused();
    }

    await page.setViewportSize({ width: 390, height: 480 });
    const openFilters = page.getByRole('button', { name: 'Open filters' });
    // macOS WebKit does not focus a clicked button, so Escape could not return focus to it.
    await openFilters.focus();
    await openFilters.press('Enter');
    const title = page.locator('header').filter({ hasText: 'Filters' });
    const scroll = await expectFloatingNavHeader(title, { inheritsPanelTint: true });
    await scroll.evaluate((element) => {
      element.scrollTop = 200;
    });
    await expectFloatingNavHeader(title, { inheritsPanelTint: true });
    await page.screenshot({ path: testInfo.outputPath('thread-filters.png'), scale: 'css' });
    await scroll.getByRole('scrollbar').press('End');
    await page.getByRole('button', { name: 'Filter option 20' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open filters' })).toBeFocused();

    const invite = page.getByRole('textbox', { name: 'Invite search' });
    await invite.focus();
    const inviteHeader = page.locator('header').filter({ hasText: 'Invite people' });
    const inviteScroll = await expectFloatingNavHeader(inviteHeader, { inheritsPanelTint: true });
    // The list covers the dialog's own controls, so it is tinted nearly opaque,
    // and the option Enter picks is filled while the other rows stay clear.
    const inviteList = page.getByRole('listbox', { name: 'People' });
    expect(
      await inviteList.evaluate((element) => {
        const alpha = getComputedStyle(element).backgroundColor.match(/[/,]\s*([\d.]+)\)$/);
        return alpha ? Number(alpha[1]) : 1;
      })
    ).toBeGreaterThanOrEqual(0.9);
    const optionFill = (name: string) =>
      inviteList
        .getByRole('option', { name, exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await optionFill('Studio guest 1')).not.toBe('rgba(0, 0, 0, 0)');
    expect(await optionFill('Studio guest 2')).toBe('rgba(0, 0, 0, 0)');
    const inviteTrack = (await inviteScroll.getByRole('scrollbar').boundingBox())!;
    await page.mouse.click(
      inviteTrack.x + inviteTrack.width / 2,
      inviteTrack.y + inviteTrack.height * 0.8
    );
    await expect(invite).toBeFocused();
    expect(await inviteScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    await expectFloatingNavHeader(inviteHeader, { inheritsPanelTint: true });
    await page.screenshot({ path: testInfo.outputPath('invite-autocomplete.png'), scale: 'css' });
    await page.keyboard.press('Escape');
    await expect(inviteHeader).toBeHidden();

    await page.getByRole('button', { name: 'Open autocomplete' }).click();
    const suggestions = page.locator('header').filter({ hasText: 'Suggestions' });
    const suggestionsScroll = await expectFloatingNavHeader(suggestions, {
      inheritsPanelTint: true,
    });
    const first = page.getByRole('button', { name: 'Suggestion 1', exact: true });
    const last = page.getByRole('button', { name: 'Suggestion 20', exact: true });
    await last.focus();
    await page.keyboard.press('ArrowDown');
    await expect(first).toBeFocused();
    const bounds = (await suggestionsScroll.getByRole('scrollbar').boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.8);
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'Suggestion 2', exact: true })).toBeFocused();
    await suggestionsScroll.evaluate((element) => {
      element.scrollTop = 100;
    });
    await expectFloatingNavHeader(suggestions, { inheritsPanelTint: true });
    await page.screenshot({ path: testInfo.outputPath('autocomplete.png'), scale: 'css' });
    await page.keyboard.press('Escape');
    await expect(suggestions).toBeHidden();
  });
}
