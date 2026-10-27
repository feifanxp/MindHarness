import { expect, type Locator, type Page } from '@playwright/test';
import { expectScrollbarBounds } from './insetScrollbar';

export const expectClearStrip = async (strip: Locator) => {
  await expect(strip).toHaveText('');
  await expect
    .poll(() =>
      strip.evaluate((element) =>
        [element, ...element.querySelectorAll('*')].flatMap((node) => {
          const css = getComputedStyle(node);
          const borders = [
            css.borderTopWidth,
            css.borderRightWidth,
            css.borderBottomWidth,
            css.borderLeftWidth,
          ];
          const clear =
            css.backgroundColor === 'rgba(0, 0, 0, 0)' &&
            css.backgroundImage === 'none' &&
            css.backdropFilter === 'none' &&
            css.boxShadow === 'none' &&
            borders.every((width) => width === '0px');
          return clear
            ? []
            : [
                {
                  tag: node.tagName,
                  className: node.className,
                  background: css.backgroundColor,
                  image: css.backgroundImage,
                  blur: css.backdropFilter,
                  shadow: css.boxShadow,
                  borders,
                },
              ];
        })
      )
    )
    .toEqual([]);
};

export type Rgba = [number, number, number, number];

const composite = (foreground: Rgba, background: Rgba): Rgba => {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ];
};

const luminance = ([red, green, blue]: Rgba) => {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

export const contrastRatio = (foreground: Rgba, background: Rgba) => {
  const foregroundLuminance = luminance(composite(foreground, background));
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

export const pixelDifference = (first: Rgba, second: Rgba) =>
  first.slice(0, 3).reduce((total, channel, index) => total + Math.abs(channel - second[index]), 0);

export const sampleScreenshot = async (
  page: Page,
  points: Array<{ x: number; y: number }>
): Promise<Rgba[]> => {
  const screenshot = await page.screenshot({ fullPage: true, scale: 'css' });
  return page.evaluate(
    async ({ source, samplePoints }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas context unavailable');
      context.drawImage(image, 0, 0);
      return samplePoints.map(({ x, y }) => {
        const pixel = context.getImageData(
          Math.min(canvas.width - 1, Math.max(0, Math.floor(x))),
          Math.min(canvas.height - 1, Math.max(0, Math.floor(y))),
          1,
          1
        ).data;
        return [pixel[0], pixel[1], pixel[2], pixel[3] / 255] as Rgba;
      });
    },
    {
      source: `data:image/png;base64,${screenshot.toString('base64')}`,
      samplePoints: points,
    }
  );
};

// Observe the rendered rim: top/bottom catch the light and both sides recede.
// A diagonal highlight, missing rim, or uniform outline must fail this check.
export const expectVerticalGlassRim = async (page: Page, surface: Locator) => {
  const box = (await surface.boundingBox())!;
  // boundingBox is viewport-relative; full-page screenshots use document coordinates.
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  box.x += scroll.x;
  box.y += scroll.y;
  const points = [
    // Sum adjacent pixels to account for fractional one-pixel rim coverage.
    { x: box.x + box.width / 2, y: Math.floor(box.y) },
    { x: box.x + box.width / 2, y: Math.floor(box.y) + 1 },
    { x: box.x + box.width / 2, y: Math.ceil(box.y + box.height) - 2 },
    { x: box.x + box.width / 2, y: Math.ceil(box.y + box.height) - 1 },
    { x: Math.floor(box.x), y: box.y + box.height / 2 },
    { x: Math.floor(box.x) + 1, y: box.y + box.height / 2 },
    { x: Math.ceil(box.x + box.width) - 2, y: box.y + box.height / 2 },
    { x: Math.ceil(box.x + box.width) - 1, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + box.height - 6 },
  ];
  const painted = await sampleScreenshot(page, points);
  await surface.evaluate((element) => element.setAttribute('data-glass-rim-probe', ''));
  const hideRim = await page.addStyleTag({
    content: '[data-glass-rim-probe]::before { display: none !important; }',
  });
  let plain: Rgba[];
  try {
    plain = await sampleScreenshot(page, points);
  } finally {
    await hideRim.evaluate((element) => (element as HTMLStyleElement).remove());
    await surface.evaluate((element) => element.removeAttribute('data-glass-rim-probe'));
  }
  const brightness = (pixel: Rgba) => (pixel[0] + pixel[1] + pixel[2]) / 3;
  // Compare only the rim's added light, independent of underlying fills.
  const contribution = (a: number, b: number) =>
    brightness(painted[a]) - brightness(plain[a]) + brightness(painted[b]) - brightness(plain[b]);
  // WebKit can clip away part of a fractional outer edge; use the more
  // completely painted side as the reference, in either light or dark themes.
  const left = contribution(4, 5);
  const right = contribution(6, 7);
  const side = Math.abs(left) >= Math.abs(right) ? left : right;
  expect.soft(contribution(0, 1) - side, `${surface}: top catches the light`).toBeGreaterThan(6);
  expect
    .soft(contribution(2, 3) - side, `${surface}: bottom reflects the light`)
    .toBeGreaterThan(2);
  expect.soft(painted[8], `${surface}: rim leaves the interior clear`).toEqual(plain[8]);
};

// Catch a header outside its scrolling viewport, a strip of the list showing beside
// it, an opaque material, or raised edges reappearing between navigation sections.
export async function expectFloatingNavHeader(
  header: Locator,
  { inheritsPanelTint = false }: { inheritsPanelTint?: boolean } = {}
) {
  await expect(header).toBeVisible();
  const scroll = header.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
  await expect(scroll).toHaveCount(1);
  const geometry = () =>
    header.evaluate((element) => {
      const viewport = element.closest('[data-y-scrollbar-width]')!;
      const css = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      return {
        offset: rect.top - viewportRect.top,
        edges: [rect.left - viewportRect.left, viewportRect.right - rect.right],
        border: [
          css.borderTopWidth,
          css.borderRightWidth,
          css.borderBottomWidth,
          css.borderLeftWidth,
        ],
        shadow: css.boxShadow,
        highlight: css.backgroundImage,
        filter: css.backdropFilter,
        alpha: Number(css.backgroundColor.split('/')[1]?.replace(')', '').trim()),
      };
    });
  await expect.poll(async () => (await geometry()).offset).toBeCloseTo(0, 0);
  const material = await geometry();
  material.edges.forEach((edge) => expect(Math.abs(edge)).toBeLessThan(0.5));
  expect(material.border).toEqual(['0px', '0px', '0px', '0px']);
  expect(material.shadow).toBe('none');
  expect(material.highlight).toBe('none');
  expect(material.filter).toContain('blur(');
  expect(material.filter).not.toContain('url(');
  if (inheritsPanelTint) expect(material.alpha).toBe(0);
  else expect(material.alpha).toBeGreaterThan(0);
  expect(material.alpha).toBeLessThan(1);
  const scrollbar = scroll.getByRole('scrollbar', { includeHidden: true });
  await expect(scrollbar).toHaveCount(1);
  expect(await scroll.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('none');
  if (await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)) {
    await expectScrollbarBounds(scroll, header);
  } else {
    await expect(scrollbar).toBeHidden();
  }
  return scroll;
}
