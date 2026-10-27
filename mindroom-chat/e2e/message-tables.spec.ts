import { expect, test } from '@playwright/test';

for (const separator of ['', '&whitespace']) {
  test(`table after grouped tools keeps phone scrolling and grid${separator}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/e2e/fixtures/message-tables.html?tools${separator}`);
    const table = page.getByRole('table');
    const scrollArea = page.getByRole('region', { name: 'Scrollable table' });
    await expect(scrollArea).toBeVisible();
    await expect(page.getByText('Scroll horizontally')).toBeVisible();
    expect(await scrollArea.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(
      await table
        .locator('td')
        .first()
        .evaluate((cell) => cell.clientWidth)
    ).toBeGreaterThan(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await expect(table.locator('td').first()).toHaveCSS('border-right-width', '1px');
    await expect(table.locator('td').first()).toHaveCSS('border-right-style', 'solid');
    await expect(table.locator('td').first()).toHaveCSS('border-bottom-width', '1px');
    await expect(table.locator('td').first()).toHaveCSS('border-bottom-style', 'solid');
    expect(
      await table
        .locator('td')
        .first()
        .evaluate((cell) => getComputedStyle(cell).borderColor)
    ).not.toBe('rgba(0, 0, 0, 0)');
    await scrollArea.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scrollArea.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await scrollArea.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(table.locator('td').last()).toBeInViewport();
    const tools = page.getByRole('button', { name: /^Ran 2 tool calls/ });
    const group = tools.locator('..');
    await tools.click();
    await expect(tools).toHaveAttribute('aria-expanded', 'true');
    await expect(group.locator('[data-tool-index]')).toHaveCount(2);
    for (const [index, name] of [
      [1, 'first_tool'],
      [2, 'second_tool'],
    ] as const) {
      const row = group.locator(`[data-tool-index="${index}"]`);
      await expect(row).toHaveCount(1);
      await expect(row.getByText(name, { exact: true })).toBeVisible();
    }
  });
}

for (const format of ['markdown', 'html']) {
  test(`${format} tables scroll without squeezing columns or widening the page`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/e2e/fixtures/message-tables.html?format=${format}`);
    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // A complete word must fit even when the message inherits break-word.
    expect(
      await table
        .locator('td')
        .first()
        .evaluate((cell) => cell.clientWidth)
    ).toBeGreaterThan(120);
    const scrollArea = page.getByRole('region', { name: 'Scrollable table' });
    await expect(scrollArea).toBeVisible();
    await expect(page.getByText('Scroll horizontally')).toBeVisible();
    expect(await scrollArea.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    await scrollArea.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scrollArea.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await scrollArea.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(table.locator('td').last()).toBeInViewport();

    // Both container resizing and streaming replacements update the hint.
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(page.getByText('Scroll horizontally')).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(scrollArea).toBeVisible();
    await page.getByRole('button', { name: 'Toggle table width' }).click();
    await expect(page.getByText('Scroll horizontally')).toBeHidden();
    await expect(page.getByRole('region', { name: 'Scrollable table' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Toggle table width' }).click();
    await expect(scrollArea).toBeVisible();
  });
}

test('table grid has faint inner dividers and no outer border in both themes', async ({ page }) => {
  for (const theme of ['', '&dark']) {
    await page.goto(`/e2e/fixtures/message-tables.html?format=html${theme}`);
    const table = page.getByRole('table');
    await expect(table.getByText('Project overview')).toBeVisible();
    await expect(table).toHaveCSS('border-collapse', 'collapse');
    await expect(table).toHaveCSS('border-top-style', 'hidden');
    await expect(table).toHaveCSS('border-right-style', 'hidden');
    await expect(table).toHaveCSS('border-bottom-style', 'hidden');
    await expect(table).toHaveCSS('border-left-style', 'hidden');
    await expect(table.locator('td').first()).toHaveCSS('border-right-width', '1px');
    await expect(table.locator('td').first()).toHaveCSS('border-bottom-width', '1px');
    const color = await table
      .locator('td')
      .first()
      .evaluate((cell) => getComputedStyle(cell).borderColor);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    expect(color).not.toBe(await table.evaluate((el) => getComputedStyle(el).color));
  }
});
