import { expect, test } from '@playwright/test';
import { pixelDifference, sampleScreenshot } from './helpers/glassVisual';

test('bends the backdrop at the curved rim while keeping the center steady', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 400 });
  await page.goto('/e2e/fixtures/liquid-glass.html?optics');
  const lens = page.getByTestId('optical-lens');
  await expect(lens).toHaveAttribute('data-liquid-glass', 'active');
  const edge = Array.from({ length: 15 }, (_, index) => ({ x: 102 + index, y: 180 }));
  const center = Array.from({ length: 48 }, (_, index) => ({ x: 230 + index, y: 180 }));
  const bent = await sampleScreenshot(page, [...edge, ...center]);
  await lens.evaluate((element) => {
    element.style.backdropFilter = 'blur(3px)';
  });
  const flat = await sampleScreenshot(page, [...edge, ...center]);
  const deltas = bent.map((pixel, index) => pixelDifference(pixel, flat[index]));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  expect(mean(deltas.slice(0, edge.length)), 'visible lens bending at the rim').toBeGreaterThan(60);
  expect(mean(deltas.slice(edge.length)), 'neutral glass center').toBeLessThan(30);
});

test('tracks light without rebuilding the filter and releases it for accessibility', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/liquid-glass.html');
  const menu = page.getByTestId('showcase-menu');
  await expect(menu).toHaveAttribute('data-liquid-glass', 'active');
  // Font loading can resize the menu and legitimately replace its filter.
  // Let that layout and its ResizeObserver update settle before testing pointer motion.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  const filter = await menu.evaluate((element) =>
    element.style.getPropertyValue('--liquid-glass-filter')
  );
  await menu.hover({ position: { x: 40, y: 30 } });
  await expect
    .poll(() =>
      menu.evaluate((element) => element.style.getPropertyValue('--liquid-glass-light-x'))
    )
    .not.toBe('');
  const first = await menu.evaluate((element) =>
    element.style.getPropertyValue('--liquid-glass-light-x')
  );
  await menu.hover({ position: { x: 220, y: 130 } });
  await expect
    .poll(() =>
      menu.evaluate((element) => element.style.getPropertyValue('--liquid-glass-light-x'))
    )
    .not.toBe(first);
  expect(
    await menu.evaluate((element) => element.style.getPropertyValue('--liquid-glass-filter'))
  ).toBe(filter);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      menu.evaluate((element) => element.style.getPropertyValue('--liquid-glass-light-x'))
    )
    .toBe('');
  await page.emulateMedia({ contrast: 'more' });
  await expect(menu).not.toHaveAttribute('data-liquid-glass', 'active');
  await expect(menu).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[data-liquid-glass-defs]')).toHaveCount(0);
  await page.emulateMedia({ contrast: 'no-preference' });
  await expect(menu).toHaveAttribute('data-liquid-glass', 'active');
});
