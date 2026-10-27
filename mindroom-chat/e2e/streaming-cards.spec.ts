import { expect, test, type Locator, type Page } from '@playwright/test';

const runningAnimations = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);

const animationStates = (card: Locator) =>
  card.evaluate((element) => element.getAnimations({ subtree: true }).map((a) => a.playState));

test('only visible streaming dots animate while all 200 cards stay ready for scrolling', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/streaming-cards.html');
  const cards = page.locator('[data-thread-root-id]');
  await expect(cards).toHaveCount(200);
  await expect.poll(() => animationStates(cards.first())).toEqual(['running']);
  await expect.poll(() => animationStates(cards.last())).toEqual(['paused']);
  await expect.poll(() => runningAnimations(page)).toBeLessThan(10);

  // A large jump must reveal already-mounted content and resume its pulse.
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last()).toBeInViewport();
  await expect.poll(() => animationStates(cards.last())).toEqual(['running']);
  await expect.poll(() => animationStates(cards.first())).toEqual(['paused']);
  await expect(cards).toHaveCount(200);

  await cards.first().scrollIntoViewIfNeeded();
  await expect.poll(() => animationStates(cards.first())).toEqual(['running']);
  await expect.poll(() => animationStates(cards.last())).toEqual(['paused']);

  await page.getByRole('button', { name: 'Toggle cards', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle cards', exact: true }).click();
  await expect(cards).toHaveCount(200);
  await expect.poll(() => animationStates(cards.first())).toEqual(['running']);
  await expect.poll(() => runningAnimations(page)).toBeLessThan(10);
});

test('streaming dots remain static with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/e2e/fixtures/streaming-cards.html');
  await expect(page.locator('[data-thread-root-id]')).toHaveCount(200);
  await expect.poll(() => runningAnimations(page)).toBe(0);
});

test('streaming dots still animate when IntersectionObserver is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', { value: undefined });
  });
  await page.goto('/e2e/fixtures/streaming-cards.html');
  const first = page.locator('[data-thread-root-id]').first();
  await expect(first).toBeVisible();
  await expect.poll(() => animationStates(first)).toEqual(['running']);
});
