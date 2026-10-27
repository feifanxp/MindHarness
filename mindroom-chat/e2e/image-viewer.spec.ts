import { expect, test, type Locator } from '@playwright/test';

async function transform(image: Locator) {
  return image.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
}

test.describe('image viewer touch gestures', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('pinch, continue dragging with one finger, and start another drag', async ({ page }) => {
    await page.goto('/e2e/fixtures/image-viewer.html');
    const image = page.getByRole('img', { name: 'Test image' });
    await expect(image).toBeVisible();
    const session = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', points: number[][]) => {
      await session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([id, x, y]) => ({ id, x, y })),
      });
    };

    await touch('touchStart', [[1, 150, 400]]);
    await touch('touchStart', [
      [1, 150, 400],
      [2, 250, 400],
    ]);
    await touch('touchMove', [
      [1, 100, 400],
      [2, 300, 400],
    ]);
    await expect.poll(async () => (await transform(image)).scale).toBeCloseTo(2);
    // CDP touchEnd lists the fingers being lifted, not the remaining touches.
    await touch('touchEnd', [[2, 300, 400]]);
    const before = await transform(image);
    await touch('touchMove', [[1, 150, 440]]);
    await expect.poll(async () => (await transform(image)).x).toBeCloseTo(before.x + 50);
    await expect.poll(async () => (await transform(image)).y).toBeCloseTo(before.y + 40);
    await expect(image).toHaveCSS('transition-duration', '0s');
    await touch('touchEnd', []);

    await touch('touchStart', [[3, 200, 450]]);
    await touch('touchMove', [[3, 170, 420]]);
    await touch('touchEnd', []);
    await expect.poll(async () => (await transform(image)).x).toBeCloseTo(before.x + 20);
    await expect.poll(async () => (await transform(image)).y).toBeCloseTo(before.y + 10);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);

    await page.getByText('200%', { exact: true }).click();
    await expect.poll(() => transform(image)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

test('mouse dragging follows the cursor at double zoom and releases outside the image', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/image-viewer.html');
  const image = page.getByRole('img', { name: 'Test image' });
  await page.getByText('100%', { exact: true }).click();
  await expect.poll(async () => (await transform(image)).scale).toBe(2);
  await page.mouse.move(400, 350);
  await page.mouse.down();
  await page.mouse.move(440, 380);
  await expect.poll(async () => (await transform(image)).x).toBe(40);
  await expect.poll(async () => (await transform(image)).y).toBe(30);
  await expect(image).toHaveCSS('transition-duration', '0s');
  await page.mouse.move(440, 5);
  await page.mouse.up();
  const released = await transform(image);
  await page.mouse.move(500, 300);
  await expect.poll(() => transform(image)).toEqual(released);
});
