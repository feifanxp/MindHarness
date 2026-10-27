import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { getHomeserver, getPrimaryCredentials } from '../env';

// Manual verification capture for the timeline minimap (CINNY-219).
// Requires the fixture room created by e2e/live/fixtures/minimap-fixture.sh
// (Minimap Long Room with a thread that overflows a short viewport).

test('timeline minimap: stripes render, hover previews, click jumps', async ({ page }) => {
  // Short viewport so the thread overflows and jumps actually scroll.
  await page.setViewportSize({ width: 1200, height: 520 });
  const credentials = getPrimaryCredentials();
  await loginWithPassword(page, {
    homeserver: getHomeserver(),
    username: credentials.username,
    password: credentials.password,
  });

  await page.getByText('Minimap Long Room').first().click();
  await page
    .getByText('Root question: how does the whole local stack fit together?')
    .first()
    .click();

  // One stripe per loaded human (non-agent) message; agent replies get none.
  const minimap = page.getByTestId('timeline-minimap');
  await expect(minimap).toBeVisible();
  const strips = minimap.locator('[data-minimap-strip]');
  await expect.poll(() => strips.count()).toBeGreaterThanOrEqual(4);
  await page.screenshot({ path: 'ui-audit/minimap-rest.png' });

  // Hover the second stripe: preview card pairs the question with its answer.
  const secondStrip = await strips.nth(1).boundingBox();
  if (!secondStrip) throw new Error('second stripe has no bounding box');
  await page.mouse.move(secondStrip.x + 4, secondStrip.y + secondStrip.height / 2);
  await expect(minimap.getByText(/Question number \d about the setup\?/)).toBeVisible();
  await expect(minimap.getByText(/Answer number \d\./)).toBeVisible();
  await page.screenshot({ path: 'ui-audit/minimap-hover.png' });

  // Click the last stripe: timeline jumps to the newest human message and the
  // thread root leaves the viewport.
  const lastStrip = await strips.last().boundingBox();
  if (!lastStrip) throw new Error('last stripe has no bounding box');
  await page.mouse.move(lastStrip.x + 4, lastStrip.y + lastStrip.height / 2);
  await page.mouse.click(lastStrip.x + 4, lastStrip.y + lastStrip.height / 2);
  await expect
    .poll(async () => strips.first().getAttribute('data-in-view'), { timeout: 10_000 })
    .toBe('false');
  await expect
    .poll(async () => strips.last().getAttribute('data-in-view'), { timeout: 10_000 })
    .toBe('true');

  // Click the first stripe: timeline jumps back to the thread root.
  const firstStrip = await strips.first().boundingBox();
  if (!firstStrip) throw new Error('first stripe has no bounding box');
  await page.mouse.move(firstStrip.x + 4, firstStrip.y + firstStrip.height / 2);
  await page.mouse.click(firstStrip.x + 4, firstStrip.y + firstStrip.height / 2);
  await expect(
    page
      .locator('[data-message-id]')
      .filter({ hasText: 'Root question: how does the whole local stack fit together?' })
      .first()
  ).toBeInViewport({ timeout: 10_000 });
  await expect
    .poll(async () => strips.first().getAttribute('data-in-view'), { timeout: 10_000 })
    .toBe('true');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-audit/minimap-clicked.png' });
});
