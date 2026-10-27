import { expect, test } from '@playwright/test';

test('mounting code blocks does not synchronously measure scrollbar geometry', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { reads: 0 };
    Object.assign(window, { codeBlockGeometry: state });
    for (const [prototype, properties] of [
      [HTMLElement.prototype, ['offsetHeight', 'offsetWidth']],
      [Element.prototype, ['clientHeight', 'clientWidth']],
    ] as const) {
      for (const property of properties) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, property)!;
        Object.defineProperty(prototype, property, {
          ...descriptor,
          get(this: HTMLElement) {
            // Glass headers measure their own refraction; count the code scroller.
            if (this.closest('pre') && !this.closest('header')) state.reads += 1;
            return descriptor.get!.call(this);
          },
        });
      }
    }
  });
  await page.goto('/e2e/fixtures/message-rendering.html');
  await expect(page.getByRole('button', { name: 'Copy code', exact: true })).toHaveCount(12);
  const reads = await page.evaluate(
    () => (window as Window & { codeBlockGeometry: { reads: number } }).codeBlockGeometry.reads
  );
  expect(reads).toBe(0);
});

test('long code still scrolls and expands without widening the mobile page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/fixtures/message-rendering.html');
  const block = page.locator('pre').first();
  const scroller = block.locator('#code-block-content').locator('..');
  await expect(block.getByRole('button', { name: 'Expand', exact: true })).toBeVisible();
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // Lines wrap by default; turning wrapping off restores horizontal scrolling.
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await block.getByRole('button', { name: 'Wrap lines', exact: true }).click();
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await scroller.evaluate((el) => {
    el.scrollLeft = 100;
    el.scrollTop = 100;
  });
  expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await block.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(block.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
  expect(await scroller.evaluate((el) => el.clientHeight)).toBeGreaterThan(300);
  await block.getByRole('button', { name: 'Collapse', exact: true }).click();
  expect(await scroller.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(300);
});

test('streaming responses update disclosure controls as content grows and shrinks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/fixtures/message-rendering.html');
  const responses = page.getByRole('region', { name: 'Live responses' });
  await expect(responses.getByRole('button', { name: 'Show less', exact: true })).toHaveCount(0);
  await responses.getByRole('button', { name: 'Long response', exact: true }).click();
  await expect(responses.getByRole('button', { name: 'Show less', exact: true })).toHaveCount(6);
  await responses.getByRole('button', { name: 'Short response', exact: true }).click();
  await expect(responses.getByRole('button', { name: 'Show less', exact: true })).toHaveCount(0);
  await responses.getByRole('button', { name: 'Long response', exact: true }).click();
  await responses.getByRole('button', { name: 'Show less', exact: true }).first().click();
  const expand = responses.getByRole('button', { name: 'Show full message', exact: true });
  await expect(expand).toHaveCount(1);
  await expand.click();
  await expect(responses.getByRole('button', { name: 'Show less', exact: true })).toHaveCount(6);
});
