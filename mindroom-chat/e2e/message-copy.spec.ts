import { devices, expect, test } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('copy text omits tool markers and the side action includes tool calls', async ({ page }) => {
  await page.goto('/e2e/fixtures/message-copy.html');
  const copyText = page.getByRole('button', { name: 'Copy Text', exact: true });
  const copyWithToolCalls = page.getByRole('button', { name: 'Copy Text with Tool Calls' });
  await expect(copyText).toBeVisible();
  await expect(copyWithToolCalls).toBeVisible();

  // Both actions share one row, with the tool-call action on the side.
  const primaryBox = (await copyText.boundingBox())!;
  const sideBox = (await copyWithToolCalls.boundingBox())!;
  const centerY = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(centerY(primaryBox) - centerY(sideBox))).toBeLessThan(1);
  expect(sideBox.x).toBeGreaterThanOrEqual(primaryBox.x + primaryBox.width);
  expect(await copyText.locator('button').count()).toBe(0);

  await copyText.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('Let me check.\n\nIt is sunny, $T = 21^\\circ C$.');

  await copyWithToolCalls.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(
      [
        'Let me check.',
        '',
        '**🔧 Tool call 1**',
        '',
        '```',
        'search_web(query=weather Amsterdam)',
        '```',
        '',
        'Result:',
        '',
        '```',
        'Sunny, 21°C',
        '```',
        '',
        'It is sunny, $T = 21^\\circ C$.',
      ].join('\n')
    );
});

test('copy text has no tool-call side action without tool markers', async ({ page }) => {
  await page.goto('/e2e/fixtures/message-copy.html?plain');
  await expect(page.getByRole('button', { name: 'Copy Text', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy Text with Tool Calls' })).toHaveCount(0);
});

test.describe('on touch screens', () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7'];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test('the tool-call copy is a labelled row below Copy Text', async ({ page }) => {
    await page.goto('/e2e/fixtures/message-copy.html');
    const copyText = page.getByRole('button', { name: 'Copy Text', exact: true });
    const copyWithToolCalls = page.getByRole('button', { name: 'Copy Text with Tool Calls' });
    await expect(copyWithToolCalls).toHaveText('Copy Text with Tool Calls');

    const primaryBox = (await copyText.boundingBox())!;
    const rowBox = (await copyWithToolCalls.boundingBox())!;
    expect(rowBox.y).toBeGreaterThanOrEqual(primaryBox.y + primaryBox.height);

    await copyWithToolCalls.tap();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('**🔧 Tool call 1**');
  });
});
