import { expect, test, type Locator, type Page } from '@playwright/test';
import { pressTab } from './helpers/keyboard';
import {
  contrastRatio,
  expectVerticalGlassRim,
  pixelDifference,
  sampleScreenshot,
  type Rgba,
} from './helpers/glassVisual';

for (const theme of ['light', 'dark']) {
  test(`chat controls and attachment shells have top and bottom rim highlights in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 1800 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?controls&theme=${theme}`);
    await page.evaluate(() => Promise.all([...document.fonts].map((font) => font.load())));
    const surfaces = [
      ...['recording', 'attachment', 'paste', 'upload', 'upload-error'].map((id) =>
        page.getByTestId(id).locator(':scope > *')
      ),
      page.getByTestId('link'),
      page.getByTestId('card-shells').locator('details'),
      page.getByRole('button', { name: 'Show full message', exact: true }),
      page.getByRole('button', { name: 'Jump to Latest', exact: true }),
    ];
    for (const surface of surfaces) {
      await expect(surface).toBeInViewport({ ratio: 1 });
      await expectVerticalGlassRim(page, surface);
      expect
        .soft(await surface.evaluate((element) => getComputedStyle(element).boxShadow))
        .not.toContain('inset');
    }
  });

  test(`chat glass keeps controls usable and respects high contrast in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 1800 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?controls&theme=${theme}`);
    await page.getByRole('button', { name: 'Pause voice recording' }).click();
    await expect(page.getByRole('button', { name: 'Resume voice recording' })).toBeEnabled();
    await page.getByRole('button', { name: 'Resume voice recording' }).click();
    await expect(page.getByRole('button', { name: 'Pause voice recording' })).toBeEnabled();
    const disclosure = page.getByTestId('disclosure').getByRole('button');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    const jump = page.getByRole('button', { name: 'Jump to Latest', exact: true });
    await jump.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText('Jump to Latest');
    const extras = page.getByTestId('card-shells').locator('details');
    await extras.locator('summary').click();
    await expect(extras.locator('pre')).toBeHidden();
    await extras.locator('summary').click();
    await expect(extras.locator('pre')).toBeVisible();
    await expect(extras.locator('pre')).toHaveCSS('filter', 'none');
    await expect(extras.locator('pre')).toHaveCSS('backdrop-filter', 'none');
    await page.emulateMedia({ contrast: 'more' });
    for (const surface of [page.getByTestId('link'), extras, jump, disclosure]) {
      await expect(surface).toHaveCSS('backdrop-filter', 'none');
      expect(
        await surface.evaluate((element) => getComputedStyle(element, '::before').display)
      ).toBe('none');
    }
    const outlined = [
      ...['attachment', 'upload', 'upload-error', 'recording'].map((id) =>
        page.getByTestId(id).locator(':scope > *')
      ),
      page.getByTestId('link'),
      extras,
      jump,
    ];
    for (const surface of outlined) {
      await expect(surface).toHaveCSS('backdrop-filter', 'none');
      await expect(surface).toHaveCSS('box-shadow', /inset/);
    }
    await page.emulateMedia({ forcedColors: 'active' });
    for (const surface of outlined) {
      await expect(surface).toHaveCSS('outline-style', 'solid');
      await expect(surface).toHaveCSS('outline-width', '1px');
    }
    await jump.focus();
    await pressTab(page);
    await pressTab(page, true);
    await expect(jump).toBeFocused();
    expect(
      await jump.evaluate((element) => {
        const css = getComputedStyle(element);
        return [css.outlineWidth, css.outlineOffset];
      })
    ).toEqual(['2px', '2px']);
  });
}

for (const theme of ['light', 'dark']) {
  test(`message cards share top and bottom rim highlights in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1400 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?messages&theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    for (const id of ['summary', 'approval', 'approval-group', 'approval-bar', 'composer']) {
      const host = page.getByTestId(id);
      const surface = id === 'approval-bar' ? host : host.locator(':scope > *').first();
      await expect(surface).toBeInViewport({ ratio: 1 });
      await expectVerticalGlassRim(page, surface);
      expect
        .soft(
          await surface.evaluate((element) => getComputedStyle(element).boxShadow),
          `${id} has no competing outline`
        )
        .not.toContain('inset');
    }
    for (const id of ['tool', 'history']) {
      const row = page.getByTestId(id).locator('[data-message-disclosure] > button').first();
      await expect(row).toBeInViewport({ ratio: 1 });
      await expect(row).toHaveCSS('background-image', 'none');
      await expect(row).toHaveCSS('backdrop-filter', 'none');
      await expect(row).toHaveCSS('box-shadow', 'none');
      expect(await row.evaluate((element) => getComputedStyle(element, '::before').content)).toBe(
        'none'
      );
    }
  });

  test(`message glass preserves disclosure controls and composer focus in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 1400 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?messages&theme=${theme}`);
    const tool = page.getByTestId('tool').getByRole('button', { name: /^Ran 2 tool calls/ });
    await tool.click();
    await expect(tool).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page
        .getByTestId('tool')
        .locator('[data-tool-index="2"]')
        .getByText('read_file', { exact: true })
    ).toBeVisible();
    const history = page.getByTestId('history').locator('[data-message-disclosure]').first();
    await history.locator(':scope > button').click();
    const nested = history.locator('details[aria-label="Resolved tool approval request"]');
    await expect(nested).toHaveCount(1);
    await expect(nested).toHaveCSS('backdrop-filter', 'none');
    expect(
      await nested.evaluate((element) => {
        const rim = getComputedStyle(element, '::before');
        return rim.display === 'none' || rim.content === 'none';
      })
    ).toBe(true);
    await nested.locator(':scope > summary').click();
    await expect(
      nested.getByText('Decision recorded for this call', { exact: true })
    ).toBeVisible();
    const editor = page.getByTestId('composer').getByRole('textbox');
    const composer = page.getByTestId('composer').locator(':scope > *').first();
    await editor.fill('Review the notes');
    await expect(composer).toHaveCSS('box-shadow', /inset/);
    await expect(editor).toHaveText('Review the notes');
    await editor.blur();
    await expect(composer).not.toHaveCSS('box-shadow', /inset/);
    await page.emulateMedia({ contrast: 'more' });
    for (const surface of [page.getByTestId('summary').locator(':scope > *'), composer]) {
      await expect(surface).toHaveCSS('backdrop-filter', 'none');
      expect(
        await surface.evaluate((element) => getComputedStyle(element, '::before').display)
      ).toBe('none');
    }
    await expect(history).toHaveCSS('backdrop-filter', 'none');
    expect(await history.evaluate((element) => getComputedStyle(element, '::before').content)).toBe(
      'none'
    );
  });
}

for (const theme of ['light', 'silver', 'dark', 'midnight', 'butter']) {
  test(`thread and audio rims highlight the top and bottom in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1600 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?theme=${theme}`);
    // The fixture uses the real, plain chat background so colors cannot hide a missing rim.
    for (const surface of [
      page.getByTestId('thread-banner'),
      page.getByTestId('audio-host').locator(':scope > div > div').last(),
    ]) {
      await expect(surface).toBeVisible();
      await expect(surface).toBeInViewport({ ratio: 1 });
      await expectVerticalGlassRim(page, surface);
    }
    if (theme === 'light' || theme === 'silver') {
      const top = await page.getByTestId('thread-banner').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x + box.width / 2 + window.scrollX, y: box.y + window.scrollY };
      });
      // The gap above this banner is plain page background, without overlapping text.
      const [edge, backdrop] = await sampleScreenshot(page, [top, { ...top, y: top.y - 2 }]);
      expect(pixelDifference(edge, backdrop), 'top rim stays visible on white').toBeGreaterThan(24);
    }
  });
}

for (const theme of ['light', 'dark']) {
  test(`flat navigation stays rimless in ${theme}`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/glass-surfaces.html?theme=${theme}`);
    const header = page.getByTestId('standalone-nav-header');
    await expect(header).not.toHaveCSS('backdrop-filter', 'none');
    await expect(header).toHaveCSS('box-shadow', 'none');
    expect(await header.evaluate((element) => getComputedStyle(element, '::before').display)).toBe(
      'none'
    );
  });

  test(`safe area shares the app and modal backdrop in ${theme}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Safe-area emulation requires CDP');
    await page.setViewportSize({ width: 390, height: 844 });
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59 } });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?theme=${theme}`);
    const open = page.getByRole('button', { name: 'Open settings sheet', exact: true });
    await expect(open).toBeVisible();
    await expect(page.locator('#root')).toHaveCSS('padding-top', '59px');
    expect((await open.boundingBox())!.y).toBeGreaterThanOrEqual(59);
    await page.addStyleTag({ content: 'main { background: var(--app-bg-color) !important; }' });
    const points = [
      { x: 5, y: 20 },
      { x: 5, y: 62 },
    ];
    const normal = await sampleScreenshot(page, points);
    expect(normal[0]).toEqual(normal[1]);
    await open.click();
    await expect(page.getByTestId('settings-sheet')).toBeVisible();
    await expect
      .poll(async () => {
        const dimmed = await sampleScreenshot(page, points);
        return pixelDifference(dimmed[0], normal[0]);
      })
      .toBeGreaterThan(10);
    const dimmed = await sampleScreenshot(page, points);
    // Separate compositor layers can round the same alpha blend by one channel value.
    dimmed[0].slice(0, 3).forEach((channel, index) => {
      expect(Math.abs(channel - dimmed[1][index])).toBeLessThanOrEqual(1);
    });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
    expect(await sampleScreenshot(page, points)).toEqual(normal);
    await session.detach();
  });

  test(`settings navigation header frosts the list behind it in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?theme=${theme}`);
    const header = page.getByTestId('settings-nav-header');
    await expect(header).toBeVisible();
    // The navigation list scrolls under this sticky header, so it keeps the
    // flat frosted material of the other navigation headers.
    const material = await header.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        alpha: Number(style.backgroundColor.split('/')[1]?.replace(')', '').trim()),
        image: style.backgroundImage,
        filter: style.backdropFilter,
        shadow: style.boxShadow,
        border: style.borderTopWidth,
      };
    });
    // The enclosing glass modal supplies the tint; its header only adds blur.
    expect(material.alpha).toBe(0);
    expect(material.filter).toContain('blur(');
    expect(material.filter).not.toContain('url(');
    expect(material).toMatchObject({ image: 'none', shadow: 'none', border: '0px' });
  });
}

for (const theme of ['light', 'silver', 'dark', 'midnight', 'butter']) {
  test(`settings sheet reveals its dimmed backdrop and retains contrast in ${theme}`, async ({
    page,
  }) => {
    await page.goto(`/e2e/fixtures/glass-surfaces.html?theme=${theme}`);
    await page.getByRole('button', { name: 'Open settings sheet', exact: true }).click();
    // Sample the settled sheet, not its entrance: WebKit keeps painting the
    // backdrop's first, undimmed fade frame until its next rendering update.
    await page.getByTestId('settings-sheet').evaluate((element) =>
      Promise.all(
        element
          .closest('body > *')!
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished)
      )
    );
    const samples = [
      {
        boundaryTestId: 'settings-sheet',
        name: 'settings sheet',
        text: page.getByTestId('settings-sheet-copy'),
      },
    ];
    const backgrounds: Rgba[] = [];
    // Change every layer behind the real portal, including the fixture's cards.
    const backdrop = await page.addStyleTag({
      content: 'main { background: black !important; } main > * { visibility: hidden; }',
    });
    for (const color of ['black', 'white']) {
      await backdrop.evaluate((element, value) => {
        element.textContent = `main { background: ${value} !important; } main > * { visibility: hidden; }`;
      }, color);
      await expectRenderedContrast(page, theme, color, samples);
      backgrounds.push((await renderedBackgrounds(page, samples))[0]);
    }
    expect(
      pixelDifference(backgrounds[0], backgrounds[1]),
      'visible backdrop response through the settings sheet'
    ).toBeGreaterThan(120);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
  });
}

// Twelve seconds of silent PCM keeps the real audio component self-contained.
const audio = Buffer.alloc(192044);
audio.write('RIFF', 0);
audio.writeUInt32LE(audio.length - 8, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write('data', 36);
audio.writeUInt32LE(audio.length - 44, 40);

type VisualSample = {
  boundaryTestId: string;
  name: string;
  text: Locator;
};

type PreparedSample = VisualSample & {
  color: Rgba;
  point: { x: number; y: number };
  visibility: string;
};

const prepareSamples = async (samples: VisualSample[]): Promise<PreparedSample[]> => {
  const prepared: PreparedSample[] = [];
  for (const sample of samples) {
    await expect(sample.text, `${sample.name} text`).toBeVisible();
    const details = await sample.text.evaluate((element, boundaryTestId) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas context unavailable');
      context.fillStyle = getComputedStyle(element).color;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      let effectiveOpacity = 1;
      let ancestor: Element | null = element;
      while (ancestor) {
        const opacity = Number.parseFloat(getComputedStyle(ancestor).opacity);
        effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
        if ((ancestor as HTMLElement).dataset.testid === boundaryTestId) break;
        ancestor = ancestor.parentElement;
      }
      if (!ancestor) throw new Error(`Missing contrast boundary: ${boundaryTestId}`);
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = Array.from(range.getClientRects()).find(
        (candidate) => candidate.width > 0 && candidate.height > 0
      );
      const bounds = rect ?? element.getBoundingClientRect();
      const visibility = (element as HTMLElement).style.visibility;
      return {
        color: [pixel[0], pixel[1], pixel[2], (pixel[3] / 255) * effectiveOpacity] as Rgba,
        point: {
          x: bounds.left + bounds.width / 2 + window.scrollX,
          y: bounds.top + bounds.height / 2 + window.scrollY,
        },
        visibility,
      };
    }, sample.boundaryTestId);
    prepared.push({ ...sample, ...details });
  }
  await Promise.all(
    prepared.map(({ text }) =>
      text.evaluate((element) => {
        (element as HTMLElement).style.visibility = 'hidden';
      })
    )
  );
  return prepared;
};

const restoreSamples = async (samples: PreparedSample[]) => {
  await Promise.all(
    samples.map(({ text, visibility }) =>
      text.evaluate((element, previousVisibility) => {
        (element as HTMLElement).style.visibility = previousVisibility;
      }, visibility)
    )
  );
};

const renderedContrast = async (page: Page, samples: VisualSample[]) => {
  const prepared = await prepareSamples(samples);
  try {
    const backgrounds = await sampleScreenshot(
      page,
      prepared.map(({ point }) => point)
    );
    return prepared.map(({ name, color }, index) => ({
      name,
      ratio: contrastRatio(color, backgrounds[index]),
    }));
  } finally {
    await restoreSamples(prepared);
  }
};

const renderedBackgrounds = async (page: Page, samples: VisualSample[]) => {
  const prepared = await prepareSamples(samples);
  try {
    return await sampleScreenshot(
      page,
      prepared.map(({ point }) => point)
    );
  } finally {
    await restoreSamples(prepared);
  }
};

const expectRenderedContrast = async (
  page: Page,
  theme: string,
  backdrop: string,
  samples: VisualSample[]
) => {
  for (const { name, ratio } of await renderedContrast(page, samples)) {
    expect(ratio, `${theme} ${backdrop} ${name} rendered contrast`).toBeGreaterThanOrEqual(4.5);
  }
};

test.beforeEach(async ({ page }) => {
  await page.route('**/_matrix/media/**', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: audio })
  );
});

const materialText = (page: Page): VisualSample[] => [
  { boundaryTestId: 'settings-modal', name: 'settings', text: page.getByTestId('settings-copy') },
  {
    boundaryTestId: 'settings-modal',
    name: 'settings heading',
    text: page.getByTestId('settings-heading-copy'),
  },
  { boundaryTestId: 'glass-menu', name: 'menu', text: page.getByTestId('menu-copy') },
  { boundaryTestId: 'glass-modal', name: 'modal', text: page.getByTestId('modal-copy') },
  { boundaryTestId: 'glass-header', name: 'header', text: page.getByTestId('header-copy') },
  {
    boundaryTestId: 'editor-host',
    name: 'editor',
    text: page.locator('[contenteditable="true"][data-editable-name="Message"] p'),
  },
  {
    boundaryTestId: 'audio-host',
    name: 'audio',
    text: page.getByTitle('0:00 / 0:12', { exact: true }),
  },
];

const expectOpaqueFallback = async (page: Page) => {
  const shadowProperty = await page.locator('main').getAttribute('data-glass-shadow-property');
  if (!shadowProperty) throw new Error('Glass shadow property unavailable');
  for (const [name, surface] of [
    ['menu', page.getByTestId('glass-menu')],
    ['modal', page.getByTestId('glass-modal')],
    ['header', page.getByTestId('glass-header')],
    ['settings', page.getByTestId('settings-modal')],
    ['editor', page.getByTestId('editor-host').locator(':scope > div')],
    ['audio', page.getByTestId('audio-host').locator(':scope > div > div').last()],
  ] as const) {
    await expect(surface).toHaveCSS('backdrop-filter', 'none');
    expect(
      await surface.evaluate((element) => {
        const rim = getComputedStyle(element, '::before');
        return rim.display === 'none' || rim.content === 'none';
      }),
      `${name} has no specular rim in opaque mode`
    ).toBe(true);
    expect(await surface.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe(
      'none'
    );
    expect(
      await surface.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas context unavailable');
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3] / 255;
      }),
      `${name} own background alpha`
    ).toBe(1);
    if (name === 'menu' || name === 'header') {
      expect(
        await surface.evaluate(
          (element, property) => getComputedStyle(element).getPropertyValue(property).trim(),
          shadowProperty
        ),
        `${name} glass shadow fallback`
      ).toContain('transparent');
    }
  }
  for (const surface of [page.getByTestId('settings-page'), page.getByTestId('settings-header')]) {
    await expect(surface).toHaveCSS('background-color', /rgba\(\d+, \d+, \d+, 0\)/);
    await expect(surface).toHaveCSS('backdrop-filter', 'none');
  }
};

for (const theme of ['light', 'silver', 'dark', 'midnight', 'butter']) {
  test(`shared materials retain rendered text contrast over every backdrop in ${theme}`, async ({
    page,
  }) => {
    await page.goto(`/e2e/fixtures/glass-surfaces.html?theme=${theme}`);
    const editor = page.locator('[contenteditable="true"][data-editable-name="Message"]');
    await editor.fill('A readable message');
    await expect(page.getByTestId('glass-menu')).not.toHaveCSS('backdrop-filter', 'none');

    const main = page.locator('main');
    const samples = materialText(page);
    for (const [backdrop, background] of [
      ['fixture', undefined],
      ['black', 'rgb(0 0 0)'],
      ['white', 'rgb(255 255 255)'],
    ] as const) {
      if (background) {
        await main.evaluate((element, value) => {
          element.style.background = value;
        }, background);
      }
      await expectRenderedContrast(page, theme, backdrop, samples);
      if (!background) continue;
      for (const sample of samples.filter(({ name }) => ['menu', 'modal'].includes(name))) {
        await sample.text.hover();
        await expect
          .poll(() =>
            page
              .getByTestId(sample.boundaryTestId)
              .evaluate((element) => element.style.getPropertyValue('--liquid-glass-light-x'))
          )
          .not.toBe('');
        await expectRenderedContrast(page, theme, `${backdrop} pointer highlight`, [sample]);
      }
    }
  });
}

test('shared materials reveal changes in the backdrop', async ({ page }) => {
  await page.goto('/e2e/fixtures/glass-surfaces.html?theme=light');
  const editor = page.locator('[contenteditable="true"][data-editable-name="Message"]');
  await editor.fill('A readable message');
  const samples = materialText(page).filter(({ name }) =>
    ['menu', 'modal', 'editor', 'settings', 'settings heading'].includes(name)
  );
  const main = page.locator('main');
  const editorHost = page.getByTestId('editor-host');

  await main.evaluate((element) => {
    element.style.background = 'rgb(20 42 82)';
  });
  await editorHost.evaluate((element) => {
    element.style.background = 'rgb(20 42 82)';
  });
  const darkBackdrop = await renderedBackgrounds(page, samples);
  const repeatedDarkBackdrop = await renderedBackgrounds(page, samples);
  await main.evaluate((element) => {
    element.style.background = 'rgb(236 216 178)';
  });
  await editorHost.evaluate((element) => {
    element.style.background = 'rgb(236 216 178)';
  });
  const lightBackdrop = await renderedBackgrounds(page, samples);

  samples.forEach(({ name }, index) => {
    const screenshotDrift = pixelDifference(darkBackdrop[index], repeatedDarkBackdrop[index]);
    const backdropResponse = pixelDifference(repeatedDarkBackdrop[index], lightBackdrop[index]);
    expect(backdropResponse, `${name} backdrop response`).toBeGreaterThanOrEqual(
      screenshotDrift + 12
    );
  });
});

test('accessibility preferences use opaque materials without blur', async ({
  page,
  browserName,
}) => {
  // Playwright exposes reduced-transparency emulation through Chromium's CDP only.
  if (browserName === 'chromium') {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    });
    await page.goto('/e2e/fixtures/glass-surfaces.html?theme=midnight');
    await expectOpaqueFallback(page);
    await client.send('Emulation.setEmulatedMedia', { features: [] });
  }
  await page.emulateMedia({ contrast: 'more' });
  await page.goto('/e2e/fixtures/glass-surfaces.html?theme=midnight');
  await expectOpaqueFallback(page);

  await page.emulateMedia({ contrast: 'no-preference' });
  await page.emulateMedia({ forcedColors: 'active' });
  await expectOpaqueFallback(page);
});

test('real controls keep focus, editing, playback, and narrow layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/e2e/fixtures/glass-surfaces.html?theme=silver');

  const workspace = page.getByRole('button', { name: 'Open workspace' });
  await page.getByRole('button', { name: 'Open settings sheet', exact: true }).focus();
  await pressTab(page);
  await expect(workspace).toBeFocused();
  expect(await workspace.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
    'none'
  );

  const editor = page.locator('[contenteditable="true"][data-editable-name="Message"]');
  await editor.fill('A readable message');
  await expect(editor).toHaveText('A readable message');

  const player = page.getByRole('region', { name: 'Audio attachment' });
  await player.getByRole('button', { name: 'Play audio', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Pause audio', exact: true })).toBeVisible();

  for (const surface of [
    page.getByTestId('glass-modal'),
    page.getByTestId('glass-menu'),
    page.getByTestId('settings-modal'),
    player,
  ]) {
    const bounds = await surface.boundingBox();
    if (!bounds) throw new Error('Glass surface has no bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
});

test('nested page layouts share the outer material while portal menus own a surface', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/glass-surfaces.html');
  for (const surface of [
    page.getByTestId('settings-modal').locator(':scope > div'),
    page.getByTestId('settings-page'),
    page.getByTestId('settings-header'),
  ]) {
    await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(surface).toHaveCSS('backdrop-filter', 'none');
    await expect(surface).not.toHaveAttribute('data-liquid-glass');
  }
  await expect(page.getByTestId('standalone-page')).not.toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
  await expect(page.getByTestId('plain-heading')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.getByTestId('plain-heading')).not.toHaveAttribute('data-liquid-glass');
  await page.getByRole('button', { name: 'Open nested menu' }).click();
  const menu = page.getByTestId('settings-menu');
  await expect(menu).toBeVisible();
  await expect(menu).not.toHaveCSS('backdrop-filter', 'none');
  expect(await menu.evaluate((element) => element.parentElement === document.body)).toBe(true);
  await expect(page.getByTestId('settings-menu-header')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.getByRole('button', { name: 'Close nested menu' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('custom thread popups receive shared material and retain keyboard actions', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/glass-surfaces.html');
  const overview = page.getByTestId('thread-overview');
  await overview.locator('[data-info-button]').click();
  const stats = overview.getByRole('dialog');
  await expect(stats).toBeVisible();
  expect(await stats.evaluate((element) => getComputedStyle(element).backdropFilter)).not.toBe(
    'none'
  );
  await overview.locator('[data-info-button]').click();
  await expect(stats).toHaveCount(0);

  await overview.locator('[data-add-tag-button]').click();
  expect(
    await overview
      .getByRole('listbox')
      .evaluate((element) => getComputedStyle(element).backdropFilter)
  ).not.toBe('none');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(overview.locator('output')).toHaveText('Tag: priority');
  await expect(overview.getByRole('listbox')).toHaveCount(0);

  await overview.locator('[data-preset-button]').click();
  expect(
    await overview
      .getByRole('listbox')
      .evaluate((element) => getComputedStyle(element).backdropFilter)
  ).not.toBe('none');
  await expect(overview.locator('[data-preset-option="needs-attention"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(overview.locator('[data-preset-option="working"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(overview.locator('output')).toHaveText('Preset: working');
  await expect(overview.getByRole('listbox')).toHaveCount(0);
});
