import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const MODULE_PATH = '/src/app/mindroom/diagnostics/flightRecorder.ts';
const SAVE_MODULE_PATH = '/src/app/mindroom/native/nativeFileSave.ts';
const CURRENT_KEY = 'mindroom.flight.current.v1';
const ABNORMAL_KEY = 'mindroom.flight.abnormal.v1';

test('records a heartbeat gap after the main thread recovers from a synchronous stall', async ({
  page,
}) => {
  await page.goto('/login/');
  await page.evaluate(
    ([currentKey, abnormalKey]) => {
      localStorage.removeItem(currentKey);
      localStorage.removeItem(abnormalKey);
    },
    [CURRENT_KEY, ABNORMAL_KEY] as const
  );
  await page.evaluate(async (modulePath) => {
    const recorder = await import(modulePath);
    recorder.installFlightRecorder(localStorage);
  }, MODULE_PATH);

  const initialBeatAt = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).lastBeatAt : null;
  }, CURRENT_KEY);
  expect(initialBeatAt).not.toBeNull();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw).lastBeatAt : null;
      }, CURRENT_KEY)
    )
    .toBeGreaterThan(initialBeatAt!);

  await page.evaluate(() => {
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline) {
      // Hold the main thread so the next heartbeat can only report after recovery.
    }
  });

  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return (
          JSON.parse(raw).events.find(
            (event: { type: string }) => event.type === 'heartbeat_gap'
          ) ?? null
        );
      }, CURRENT_KEY)
    )
    .toEqual(expect.objectContaining({ type: 'heartbeat_gap', delayMs: expect.any(Number) }));
});

test('retains and exports a fast-relaunch abnormal voice session without inventing a gap', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login/');
  await page.evaluate(
    ([key, now]) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          buildVersion: 'seed-build',
          sessionId: '11111111-1111-4111-8111-111111111111',
          startedAt: now - 2000,
          lastBeatAt: now - 1000,
          visibility: 'visible',
          route: 'auth',
          hasThreadId: false,
          voiceCapture: 'recording',
          expectedEndAt: null,
          endReason: null,
          events: [],
        })
      );
      localStorage.removeItem('mindroom.flight.abnormal.v1');
    },
    [CURRENT_KEY, Date.now()] as const
  );

  await page.reload();
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const seeded = JSON.parse(raw);
    seeded.lastBeatAt = Date.now();
    localStorage.setItem(key, JSON.stringify(seeded));
  }, CURRENT_KEY);
  await page.evaluate(async (modulePath) => {
    const recorder = await import(modulePath);
    recorder.installFlightRecorder(localStorage);
  }, MODULE_PATH);

  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      }, ABNORMAL_KEY)
    )
    .not.toBeNull();

  const retained = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, ABNORMAL_KEY);
  expect(retained).toMatchObject({
    sessionId: '11111111-1111-4111-8111-111111111111',
    voiceCapture: 'recording',
    expectedEndAt: null,
  });
  expect(retained.startupGapMs).toBeLessThan(5000);
  expect(retained.events).not.toContainEqual(expect.objectContaining({ type: 'heartbeat_gap' }));

  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(
    async ([modulePath, saveModulePath]) => {
      const recorder = await import(modulePath);
      const { saveFile } = await import(saveModulePath);
      const { blob, fileName } = recorder.buildFlightRecorderExport();
      await saveFile(blob, fileName);
    },
    [MODULE_PATH, SAVE_MODULE_PATH] as const
  );
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toMatch(/^mindroom-diagnostics-.*Z\.json$/);
  expect(downloadPath).not.toBeNull();
  const payload = JSON.parse(await readFile(downloadPath!, 'utf8'));

  expect(payload.abnormalSession.sessionId).toBe(retained.sessionId);
  expect(payload.currentOrPreservedSession.sessionId).not.toBe(retained.sessionId);
  expect(await page.evaluate((key) => localStorage.getItem(key), ABNORMAL_KEY)).not.toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), CURRENT_KEY)).not.toBeNull();

  await context.close();
});
