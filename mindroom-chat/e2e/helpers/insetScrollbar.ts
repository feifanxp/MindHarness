import { expect, type Locator, type Page } from '@playwright/test';

export async function expectScrollbarBounds(
  scroll: Locator,
  topControl: Locator,
  footer?: Locator
) {
  const bar = scroll.getByRole('scrollbar');
  await expect(bar).toBeVisible();
  const track = (await bar.boundingBox())!;
  const top = (await topControl.boundingBox())!;
  const viewport = (await scroll.boundingBox())!;
  const bottom = footer ? (await footer.boundingBox())!.y : viewport.y + viewport.height;
  expect(track.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
  expect(track.y + track.height).toBeLessThanOrEqual(bottom + 1);
  expect(track.height).toBeGreaterThan(20);
  await expect(bar).toHaveAttribute('aria-controls', (await scroll.getAttribute('id'))!);
  expect(await scroll.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('none');
}

export async function expectInsetScrollbar(
  page: Page,
  scroll: Locator,
  topControl: Locator,
  footer?: Locator
) {
  await expectScrollbarBounds(scroll, topControl, footer);
  const bar = scroll.getByRole('scrollbar');
  const track = (await bar.boundingBox())!;

  const thumb = bar.locator('[data-scrollbar-thumb]');
  await bar.press('Home');
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeLessThan(1);
  await expect.poll(async () => (await thumb.boundingBox())!.y).toBeCloseTo(track.y, 0);
  await bar.press('End');
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(1);
  await expect
    .poll(async () => {
      const box = (await thumb.boundingBox())!;
      return box.y + box.height;
    })
    .toBeCloseTo(track.y + track.height, 0);

  const before = await scroll.evaluate((el) => el.scrollTop);
  const handle = (await thumb.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, track.y + track.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeLessThan(before - 10);
  await expect(bar).toBeFocused();
  await bar.evaluate((element) => (element as HTMLElement).blur());
}
