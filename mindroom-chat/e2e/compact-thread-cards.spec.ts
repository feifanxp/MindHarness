import { expect, test, type Page } from '@playwright/test';

const cardGeometry = (page: Page) =>
  page.locator('[data-thread-root-id]').evaluateAll((cards) =>
    cards.map((card) => {
      const rect = (element: Element | null) => element!.getBoundingClientRect();
      const style = getComputedStyle(card);
      const contentLeft =
        rect(card).left +
        Number.parseFloat(style.borderLeftWidth) +
        Number.parseFloat(style.paddingLeft);
      const contentRight =
        rect(card).right -
        Number.parseFloat(style.borderRightWidth) -
        Number.parseFloat(style.paddingRight);
      const [titleRow, previewRow] = Array.from(card.children);
      const title = titleRow.firstElementChild!;
      const preview = previewRow.firstElementChild!;
      const metadata = card.querySelector('[data-compact-card-metadata="true"]');
      const menu = card.parentElement!.querySelector('[aria-label="More options"]');
      return {
        contentLeft,
        contentRight,
        titleLeft: rect(title).left,
        previewLeft: rect(preview).left,
        previewRight: rect(preview).right,
        previewHasCount: previewRow.querySelector('[data-compact-card-reply-count]') !== null,
        metadataCenter: (rect(metadata).top + rect(metadata).bottom) / 2,
        menuCenter: (rect(menu).top + rect(menu).bottom) / 2,
      };
    })
  );

test('compact cards give the title and preview the full width on a phone', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/e2e/fixtures/compact-thread-cards.html');
  await page.locator('body[data-fixture-ready="true"]').waitFor();

  const cards = await cardGeometry(page);
  expect(cards).toHaveLength(6);
  cards.forEach((card) => {
    // No reserved unread gutter: title and preview start at the content edge.
    expect(Math.abs(card.titleLeft - card.contentLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(card.previewLeft - card.contentLeft)).toBeLessThanOrEqual(1);
    // Neither the reply count nor the touch menu button narrows the preview.
    expect(card.previewHasCount).toBe(false);
    expect(Math.abs(card.previewRight - card.contentRight)).toBeLessThanOrEqual(1);
    // The menu button sits on the last row.
    expect(Math.abs(card.menuCenter - card.metadataCenter)).toBeLessThanOrEqual(1);
  });

  // Unread threads are marked by an accent edge, not a dot.
  const unread = page.locator('[data-thread-unread="true"]');
  await expect(unread).toHaveCount(2);
  await expect(unread.first()).not.toHaveCSS('box-shadow', 'none');
  await expect(page.locator('[data-thread-root-id]:not([data-thread-unread])').first()).toHaveCSS(
    'box-shadow',
    'none'
  );
  await page.screenshot({ path: testInfo.outputPath('compact-thread-cards-phone.png') });

  // A resolver name wider than the row ends in an ellipsis inside the card.
  const byline = await page
    .locator('[data-compact-card-resolution-byline="true"] span')
    .last()
    .evaluate((label) => {
      label.textContent = `Resolved by ${'A very long display name '.repeat(6)}`;
      const card = label.closest<HTMLElement>('[data-thread-root-id]')!;
      const style = getComputedStyle(card);
      return {
        clipped: label.scrollWidth > label.clientWidth,
        textOverflow: getComputedStyle(label).textOverflow,
        labelRight: label.getBoundingClientRect().right,
        contentRight:
          card.getBoundingClientRect().right -
          Number.parseFloat(style.borderRightWidth) -
          Number.parseFloat(style.paddingRight),
      };
    });
  expect(byline.clipped).toBe(true);
  expect(byline.textOverflow).toBe('ellipsis');
  expect(byline.labelRight).toBeLessThanOrEqual(byline.contentRight);
});

test.describe('compact card swipe', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 500 } });

  test('a touch swipe toward the start resolves a card and leaves taps and scrolling alone', async ({
    page,
  }, testInfo) => {
    await page.goto('/e2e/fixtures/compact-thread-cards.html');
    await page.locator('body[data-fixture-ready="true"]').waitFor();
    const touch = await page.context().newCDPSession(page);
    const card = page.locator('[data-thread-root-id="$thread-2"]');
    const bounds = await card.boundingBox();
    if (!bounds) throw new Error('Card has no bounds');
    const y = bounds.y + bounds.height / 2;
    const drag = async (points: { x: number; y: number }[], { release = true } = {}) => {
      const [first, ...rest] = points;
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...first, id: 1 }],
      });
      for (const point of rest) {
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ ...point, id: 1 }],
        });
      }
      if (release)
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const across = (fromX: number, toX: number, atY = y) =>
      Array.from({ length: 9 }, (_, step) => ({ x: fromX + ((toX - fromX) * step) / 8, y: atY }));
    const notResolved = async () => {
      await expect(card).not.toHaveAttribute('data-attention-state', 'resolved');
      await expect(page.locator('[data-compact-card-swipe="action"]')).toHaveCount(0);
    };

    // A short swipe springs back.
    await drag(across(bounds.x + bounds.width - 30, bounds.x + bounds.width - 90));
    await notResolved();

    // A touch that starts at the screen edge belongs to the edge swipe.
    await drag(across(385, 150));
    await notResolved();

    // Past the threshold the strip arms; letting go resolves the card.
    await drag(across(bounds.x + bounds.width - 30, bounds.x + 60), { release: false });
    await expect(page.locator('[data-compact-card-swipe="action"]')).toHaveAttribute(
      'data-armed',
      'true'
    );
    await page.screenshot({ path: testInfo.outputPath('compact-card-swipe-armed.png') });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(card).toHaveAttribute('data-attention-state', 'resolved');
    await expect(page.locator('[data-compact-card-swipe="action"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-opened-thread');

    // The same swipe on a resolved card reopens it.
    await drag(across(bounds.x + bounds.width - 30, bounds.x + 60));
    await expect(card).not.toHaveAttribute('data-attention-state', 'resolved');

    // A vertical drag still scrolls the list and resolves nothing.
    const view = page.locator('[data-compact-room-view="true"]');
    await view.evaluate((element) => {
      element.style.height = '300px';
    });
    const box = await view.boundingBox();
    if (!box) throw new Error('View has no bounds');
    await drag(
      Array.from({ length: 13 }, (_, step) => ({
        x: box.x + box.width / 2,
        y: box.y + box.height * 0.75 - step * 15,
      }))
    );
    await expect.poll(() => view.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await notResolved();

    // A tap still opens the thread.
    await card.tap();
    await expect(page.locator('body')).toHaveAttribute('data-opened-thread', '$thread-2');
    await touch.detach();
  });
});
