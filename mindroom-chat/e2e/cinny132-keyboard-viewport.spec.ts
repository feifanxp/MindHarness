import { expect, test } from '@playwright/test';

const LAYOUT_HEIGHT = 793;
const LAYOUT_WIDTH = 390;
const KEYBOARD_HEIGHT = 457;
const KEYBOARD_OFFSET = 170;
const VISIBLE_BOTTOM = KEYBOARD_OFFSET + KEYBOARD_HEIGHT;

declare global {
  interface Window {
    __setVisualViewport?: (height: number, offsetTop: number, eventName: string) => void;
  }
}

test.use({
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { width: LAYOUT_WIDTH, height: LAYOUT_HEIGHT },
  video: 'off',
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let height: number | undefined;
    let offsetTop = 0;
    const events = new EventTarget();

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        get width() {
          return window.innerWidth;
        },
        get height() {
          return height ?? window.innerHeight;
        },
        get offsetLeft() {
          return 0;
        },
        get offsetTop() {
          return offsetTop;
        },
        get pageLeft() {
          return 0;
        },
        get pageTop() {
          return offsetTop;
        },
        get scale() {
          return 1;
        },
      },
    });

    window.__setVisualViewport = (nextHeight: number, nextOffsetTop: number, eventName: string) => {
      height = nextHeight;
      offsetTop = nextOffsetTop;
      events.dispatchEvent(new Event(eventName));
    };
  });
});

const readRootBox = (page: import('@playwright/test').Page) =>
  page.$eval('#root', (root) => {
    const rect = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    return {
      position: style.position,
      marginTop: Number.parseFloat(style.marginTop) || 0,
      top: rect.top,
      height: rect.height,
      bottom: rect.bottom,
    };
  });

test('fills a keyboard-panned visual viewport while keeping root in normal flow', async ({
  page,
}) => {
  await page.goto('/');
  expect(await page.evaluate(() => window.matchMedia('(display-mode: standalone)').matches)).toBe(
    false
  );

  await page.evaluate(
    ([height, offsetTop]) => {
      const editor = document.createElement('textarea');
      document.body.append(editor);
      editor.focus();
      window.__setVisualViewport?.(height, offsetTop, 'scroll');
    },
    [KEYBOARD_HEIGHT, KEYBOARD_OFFSET]
  );

  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))
    )
    .toBe(`${KEYBOARD_HEIGHT}px`);

  expect(await page.evaluate(() => window.innerHeight)).toBe(LAYOUT_HEIGHT);
  expect(await readRootBox(page)).toEqual({
    position: 'static',
    marginTop: KEYBOARD_OFFSET,
    top: KEYBOARD_OFFSET,
    height: KEYBOARD_HEIGHT,
    bottom: VISIBLE_BOTTOM,
  });
});

test('does nothing when the browser resizes both viewports', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(
    ([height, offsetTop]) => {
      const editor = document.createElement('textarea');
      document.body.append(editor);
      editor.focus();
      window.__setVisualViewport?.(height, offsetTop, 'scroll');
    },
    [KEYBOARD_HEIGHT, KEYBOARD_OFFSET]
  );

  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))
    )
    .toBe(`${KEYBOARD_HEIGHT}px`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--app-viewport-offset-top')
      )
    )
    .toBe(`${KEYBOARD_OFFSET}px`);

  await page.setViewportSize({ width: LAYOUT_WIDTH, height: KEYBOARD_HEIGHT });
  await page.evaluate((height) => {
    window.__setVisualViewport?.(height, 0, 'resize');
  }, KEYBOARD_HEIGHT);

  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))
    )
    .toBe('');
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--app-viewport-offset-top')
      )
    )
    .toBe('');

  expect(await readRootBox(page)).toEqual({
    position: 'static',
    marginTop: 0,
    top: 0,
    height: KEYBOARD_HEIGHT,
    bottom: KEYBOARD_HEIGHT,
  });
});
