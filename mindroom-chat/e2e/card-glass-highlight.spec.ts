import { expect, test, type Locator } from '@playwright/test';
import { pixelDifference, sampleScreenshot } from './helpers/glassVisual';

const highlight = (surface: Locator) =>
  surface.evaluate((element) => ({
    x: (element as HTMLElement).style.getPropertyValue('--liquid-glass-light-x'),
    background: getComputedStyle(element).backgroundImage,
  }));

for (const theme of ['light', 'dark']) {
  test(`tool and approval activity rows use a hover tint without pointer light in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 1100 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?messages&theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    for (const id of ['tool', 'history']) {
      const surface = page.getByTestId(id).locator('[data-message-disclosure] > button').first();
      await page.mouse.move(0, 0);
      const restingColor = await surface.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      );
      const bounds = (await surface.boundingBox())!;
      const points = [{ x: bounds.x + 250, y: bounds.y + 18 }];
      const [resting] = await sampleScreenshot(page, points);
      await surface.hover({ position: { x: 250, y: 18 } });
      await expect(surface).not.toHaveCSS('background-color', restingColor);
      await expect(surface).toHaveCSS('background-image', 'none');
      await expect(surface).toHaveCSS('backdrop-filter', 'none');
      expect((await highlight(surface)).x).toBe('');
      const [near] = await sampleScreenshot(page, points);
      expect(pixelDifference(resting, near)).toBeGreaterThan(0);
      const hoverColor = await surface.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      );
      await surface.hover({ position: { x: 450, y: 18 } });
      await expect(surface).toHaveCSS('background-color', hoverColor);
      expect((await highlight(surface)).x).toBe('');
    }
  });

  for (const fixture of ['messages', 'controls']) {
    test(`${fixture} cards follow the pointer and respect motion preferences in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 800, height: 1800 });
      await page.goto(`/e2e/fixtures/glass-surfaces.html?${fixture}&theme=${theme}`);
      await page.evaluate(() => document.fonts.ready);
      const ids =
        fixture === 'messages'
          ? ['summary', 'approval', 'receipt', 'approval-group']
          : ['attachment', 'paste', 'link'];
      for (const id of ids) {
        const host = page.getByTestId(id);
        const surface = id === 'link' ? host : host.locator(':scope > *').first();
        await surface.hover({ position: { x: 12, y: 12 } });
        await expect.poll(async () => (await highlight(surface)).x).not.toBe('');
        const first = await highlight(surface);
        await surface.hover({ position: { x: 120, y: 18 } });
        await expect
          .poll(async () => (await highlight(surface)).background)
          .not.toBe(first.background);
        await expect(surface).not.toHaveAttribute('data-liquid-glass', 'active');
        await page.mouse.move(0, 0);
        await expect.poll(async () => (await highlight(surface)).x).toBe('');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await surface.hover({ position: { x: 120, y: 18 } });
        await expect.poll(async () => (await highlight(surface)).x).toBe('');
        await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'more' });
        await surface.hover({ position: { x: 12, y: 12 } });
        await expect(surface).toHaveCSS('background-image', 'none');
        await page.emulateMedia({ contrast: 'no-preference' });
      }
      if (fixture === 'messages') {
        const history = page.getByTestId('history').locator('[data-message-disclosure]').first();
        await history.locator(':scope > button').click();
        const nested = history.locator('details[aria-label="Resolved tool approval request"]');
        await nested.hover({ position: { x: 120, y: 18 } });
        expect((await highlight(history)).x).toBe('');
        expect((await highlight(nested)).x).toBe('');
        await expect(nested).toHaveCSS('background-image', 'none');
        await expect(nested).toHaveCSS('backdrop-filter', 'none');
      }
    });
  }
}
