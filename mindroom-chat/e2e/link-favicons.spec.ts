import { expect, test } from '@playwright/test';

test('inline icons preserve text, resize with messages, and recover after edits', async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route('https://icons.duckduckgo.com/ip3/*', async (route) => {
    requested.push(route.request().url());
    expect(route.request().headers().referer).toBeUndefined();
    if (route.request().url().includes('broken-site')) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#39a"/></svg>',
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['', '?dark']) {
    await page.goto(`/e2e/fixtures/link-favicons.html${theme}`);
    const room = page.getByRole('region', { name: 'Room messages' });
    const thread = page.getByRole('region', { name: 'Thread messages' });
    const plainLink = room.getByRole('link', { name: 'https://github.com/example/chat/' });
    await expect(plainLink.locator('img')).toHaveCSS('width', '16px');
    await expect(plainLink.locator('img')).toHaveCSS('height', '16px');
    await expect
      .poll(() =>
        plainLink.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth)
      )
      .toBeGreaterThan(0);
    await expect(plainLink).toHaveAttribute('target', '_blank');
    await expect(room.getByRole('link', { name: 'the docs' }).locator('strong')).toHaveText(
      'the docs'
    );
    await expect(thread.locator('img')).toHaveCSS('width', '14px');
    await expect(thread.locator('img')).toHaveCSS('margin-left', '3.5px');
    for (const spoiler of await room.locator('[data-mx-spoiler]').all()) {
      await expect(spoiler.locator('img')).toHaveCount(0);
      // Keyboard disclosure also handles a spoiler nested inside a navigable link.
      await spoiler.press('Space');
      await expect(spoiler).toHaveAttribute('aria-pressed', 'false');
      await expect(spoiler.locator('img')).toHaveCount(0);
    }
    await expect(room.getByRole('link', { name: 'Nested secret' }).locator('img')).toHaveCount(0);
    await expect(room.getByRole('link', { name: 'Updated link' }).locator('img')).toHaveCount(0);
    expect(await room.innerText()).toContain('https://example.com/code');
    expect(await page.getByRole('img').count()).toBe(0);
    await page.getByRole('button', { name: 'Edit link' }).click();
    await expect(room.getByRole('link', { name: 'Updated link' }).locator('img')).toHaveCount(1);
    await page.getByRole('button', { name: 'Toggle previews' }).click();
    await expect(page.locator('img')).toHaveCount(0);
    await expect(plainLink).toHaveText('https://github.com/example/chat/');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  }
  expect(new Set(requested)).toEqual(
    new Set([
      'https://icons.duckduckgo.com/ip3/github.com.ico',
      'https://icons.duckduckgo.com/ip3/broken-site.com.ico',
    ])
  );
});
