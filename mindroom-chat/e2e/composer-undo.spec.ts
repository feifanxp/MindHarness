import { expect, test, type Locator } from '@playwright/test';

// The composer's text, without the placeholder an empty composer shows.
const composerText = (composer: Locator) =>
  composer.evaluate((element) =>
    Array.from(element.querySelectorAll('[data-slate-string]'), (node) => node.textContent).join('')
  );

// Undo after typing a sentence removes the last word, not the whole sentence.
test('composer undo removes one typed word at a time', async ({ page }) => {
  await page.goto('/e2e/fixtures/composer-undo.html');
  const composer = page.getByRole('textbox');
  await composer.click();
  await page.keyboard.type('hello world again', { delay: 30 });
  await expect.poll(() => composerText(composer)).toBe('hello world again');

  for (const expected of ['hello world ', 'hello ', '']) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('ControlOrMeta+z');
    // eslint-disable-next-line no-await-in-loop
    await expect.poll(() => composerText(composer)).toBe(expected);
  }
});
