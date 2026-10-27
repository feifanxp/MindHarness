import { expect, test } from '@playwright/test';

// Twelve seconds of silent PCM: exercises real browser media without external files.
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

test.beforeEach(async ({ page }) => {
  await page.route('**/_matrix/media/**', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: audio })
  );
});

test('shared audio controls play, scrub, change speed and expose downloads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/e2e/fixtures/audio-player.html');
  for (const name of ['Audio attachment', 'Voice message']) {
    const player = page.getByRole('region', { name, exact: true });
    const label = name === 'Voice message' ? 'voice message' : 'audio';
    await expect(player.getByTitle('0:00 / 0:12', { exact: true })).toHaveText('0:12');
    await expect(player.getByRole('button', { name: /Playback speed/ })).toBeVisible();
    await player.getByRole('button', { name: `Play ${label}`, exact: true }).click();
    await expect(player.getByRole('button', { name: `Pause ${label}`, exact: true })).toBeVisible();
    await player.getByRole('button', { name: `Pause ${label}`, exact: true }).click();

    const slider = player.getByRole('slider', { name: `Seek ${label}` });
    const bounds = await slider.boundingBox();
    if (!bounds) throw new Error('Seek slider has no bounds');
    await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    await expect
      .poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
      .toBeGreaterThan(8);
    await expect(player.getByTitle(/0:0[89] \/ 0:12/)).toHaveText(/0:0[89]/);
    await slider.press('Home');
    await expect(slider).toHaveValue('0');
    await expect(player.getByTitle('0:00 / 0:12', { exact: true })).toHaveText('0:00');
    await slider.press('ArrowRight');
    await expect(slider).toHaveValue('5');
    await expect(slider).toHaveAttribute('aria-valuetext', '0:00 of 0:12');

    await player.getByRole('button', { name: /Playback speed/ }).click();
    await expect
      .poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => el.playbackRate))
      .toBeGreaterThan(1);
    await expect(page.getByRole('button', { name: /Voice volume, currently/ })).toHaveCount(0);
    await player.getByRole('button', { name: 'More audio options' }).click();
    await expect(page.getByRole('button', { name: /^Download / })).toBeVisible();
    await page.getByRole('button', { name: /Voice volume, currently/ }).click();
    const volume = page.getByRole('slider', { name: 'Voice volume', exact: true });
    await volume.press('ArrowLeft');
    await expect
      .poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => el.volume))
      .toBeCloseTo(name === 'Voice message' ? 0.9 : 0.95);
    await page.keyboard.press('Escape');
    await expect(volume).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Download / })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});

for (const theme of ['light', 'dark']) {
  test(`audio cards fit narrow bubbles in ${theme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/e2e/fixtures/audio-player.html?theme=${theme}`);
    await expect(
      page.getByText('Interview with the design team.wav', { exact: true })
    ).toBeVisible();
    for (const region of await page.getByRole('region').all()) {
      const bounds = await region.boundingBox();
      if (!bounds) throw new Error('Audio card has no bounds');
      expect(bounds.width).toBeGreaterThan(240);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
      const voice = (await region.getAttribute('aria-label')) === 'Voice message';
      expect.soft(bounds.height).toBeLessThanOrEqual(voice ? 60 : 82);
      const playBounds = await region.getByRole('button', { name: /^Play / }).boundingBox();
      const capsuleBounds = await region.locator('audio').locator('..').boundingBox();
      if (!playBounds || !capsuleBounds) throw new Error('Playback controls have no bounds');
      expect.soft(Math.abs(playBounds.width - playBounds.height)).toBeLessThan(1);
      const waveform = region.getByRole('slider');
      const timer = region.getByTitle('0:00 / 0:12', { exact: true });
      const waveformBounds = await waveform.boundingBox();
      const timerBounds = await timer.boundingBox();
      if (!waveformBounds || !timerBounds) throw new Error('Waveform or timer has no bounds');
      expect.soft(timerBounds.x).toBeGreaterThanOrEqual(waveformBounds.x + waveformBounds.width);
      for (const control of [...(await region.getByRole('button').all()), waveform, timer]) {
        const controlBounds = await control.boundingBox();
        if (!controlBounds) throw new Error('Audio control has no bounds');
        expect
          .soft(
            Math.abs(
              controlBounds.y +
                controlBounds.height / 2 -
                capsuleBounds.y -
                capsuleBounds.height / 2
            )
          )
          .toBeLessThan(1);
      }
      for (const control of await region.locator('button, input[type="range"]').all()) {
        const controlBounds = await control.boundingBox();
        if (!controlBounds) throw new Error('Audio control has no bounds');
        expect(controlBounds.x).toBeGreaterThanOrEqual(bounds.x);
        expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(
          bounds.x + bounds.width + 1
        );
      }
    }
    await page
      .locator('#root > div')
      .screenshot({ path: testInfo.outputPath(`audio-${theme}.png`) });
  });
}

test('audio controls fit a narrow panel on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/e2e/fixtures/audio-player.html');
  await expect(page.getByRole('button', { name: 'Play audio', exact: true })).toBeVisible();
  await page.getByRole('region').evaluateAll((regions) => {
    regions.forEach((region) => {
      region.style.width = '220px';
    });
  });
  for (const region of await page.getByRole('region').all()) {
    const bounds = await region.boundingBox();
    if (!bounds) throw new Error('Audio card has no bounds');
    expect(bounds.width).toBe(220);
    for (const control of await region.locator('button, input[type="range"]').all()) {
      const controlBounds = await control.boundingBox();
      if (!controlBounds) throw new Error('Audio control has no bounds');
      expect(controlBounds.x).toBeGreaterThanOrEqual(bounds.x);
      expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(
        bounds.x + bounds.width + 1
      );
    }
  }
});

test.describe('mobile audio seeking', () => {
  test.use({ isMobile: true, hasTouch: true });

  for (const width of [320, 390]) {
    test(`first touch seeks through loading and dragging works at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/e2e/fixtures/audio-player.html');
      const touch = await page.context().newCDPSession(page);

      for (const name of ['Audio attachment', 'Voice message']) {
        const player = page.getByRole('region', { name, exact: true });
        const slider = player.getByRole('slider');
        await expect(slider).toBeEnabled();
        const bounds = await slider.boundingBox();
        if (!bounds) throw new Error('Seek slider has no bounds');
        expect.soft(bounds.height).toBeGreaterThanOrEqual(44);

        await page.touchscreen.tap(bounds.x + bounds.width * 0.75, bounds.y + 2);
        await expect
          .poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
          .toBeGreaterThan(8);
        await expect(player.getByRole('button', { name: /^Play / })).toBeVisible();

        const point = (progress: number) => ({
          x: bounds.x + bounds.width * progress,
          y: bounds.y + bounds.height / 2,
          id: 1,
        });
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [point(0.2)],
        });
        await expect
          .poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
          .toBeLessThan(3);
        for (const progress of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [point(progress)],
          });
        }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect
          .poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
          .toBeGreaterThan(9);
      }
      await touch.detach();
    });
  }
});
