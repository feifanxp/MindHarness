import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getHomeserver, getPrimaryCredentials } from './env';
import { loginWithPassword } from './helpers/auth';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  seedRoomOverviewState,
} from './helpers/matrix';
import {
  APP_STORE_SCREENSHOT_DEVICES,
  APP_STORE_SCREENSHOT_SCENES,
  type AppStoreScreenshotDevice,
  type AppStoreScreenshotScene,
  getAppStoreScreenshotRelativePath,
} from '../src/app/mindroom/appstore/appStoreScreenshots';

const FIXTURE_ROOM_ALIAS =
  process.env.E2E_FIXTURE_ROOM_ALIAS ?? '#mindroom-app-store-personal-showcase:matrix.localhost';
const DINNER_THREAD_TITLE = 'Vegetarian weeknight dinners: five quick meals and one grocery list.';
const HOME_AUTOMATION_THREAD_TITLE =
  'Heading out: lights off, front door locked, heating set to 17°C.';
const TRIP_THREAD_TITLE = 'Lisbon weekend for two: old town, by the sea, or a long weekend.';
const REMINDER_THREAD_TITLE = 'Call Rosa at four: reminder scheduled in this thread.';
const WEEK_THREAD_TITLE =
  'Your week: Lisbon plans, quick dinners, a cozy home, and one timely reminder.';
const PNG_MAGIC_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const sceneById = (id: AppStoreScreenshotScene['id']): AppStoreScreenshotScene => {
  const scene = APP_STORE_SCREENSHOT_SCENES.find((candidate) => candidate.id === id);
  if (!scene) throw new Error(`Unknown App Store screenshot scene: ${id}`);
  return scene;
};

const readPngMetadata = async (path: string) => {
  const bytes = await readFile(path);
  const signature = bytes.subarray(0, PNG_MAGIC_SIGNATURE.length);
  const hasPngSignature = PNG_MAGIC_SIGNATURE.every((byte, index) => signature[index] === byte);
  if (!hasPngSignature) {
    throw new Error(`${path} is not a PNG file.`);
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    digest: createHash('sha256').update(bytes).digest('hex'),
  };
};

const applySceneTheme = async (page: Page, scene: AppStoreScreenshotScene) => {
  await page.evaluate((themeId) => {
    let storedSettings: Record<string, unknown> = {};
    try {
      const storedValue = localStorage.getItem('settings');
      const parsedSettings = storedValue ? (JSON.parse(storedValue) as unknown) : undefined;
      if (
        parsedSettings !== null &&
        typeof parsedSettings === 'object' &&
        !Array.isArray(parsedSettings)
      ) {
        storedSettings = parsedSettings as Record<string, unknown>;
      }

      localStorage.setItem(
        'settings',
        JSON.stringify({
          ...storedSettings,
          useSystemTheme: false,
          themeId,
        })
      );
    } catch {
      throw new Error('App Store screenshot capture requires localStorage for theme selection.');
    }
  }, `${scene.theme}-theme`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.evaluate(() => document.body.classList.contains('dark-theme')))
    .toBe(scene.theme === 'dark');
};

const installAppStoreScreenshotStyles = async (page: Page) => {
  await page.addStyleTag({
    content: `
      [data-testid="client-sync-status"] {
        display: none !important;
      }
    `,
  });
};

const waitForNextPaint = async (page: Page) => {
  await page.evaluate(
    () =>
      new Promise<void>((resolvePaint) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolvePaint());
        });
      })
  );
};

const expectFixtureAvatars = async (page: Page, requiredNames: string[], timeout = 15_000) => {
  await expect
    .poll(
      () =>
        page.locator('img[src]').evaluateAll((images, names) => {
          const visible = images.filter((image) => image.getBoundingClientRect().width > 0);
          return (
            names.every((name) => visible.some((image) => image.getAttribute('alt') === name)) &&
            visible.every(
              (image) =>
                (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
            )
          );
        }, requiredNames),
      { timeout }
    )
    .toBe(true);
};

const captureScene = async (
  page: Page,
  device: AppStoreScreenshotDevice,
  scene: AppStoreScreenshotScene,
  capturedDigests: Map<string, string>
) => {
  const outputPath = resolve(process.cwd(), getAppStoreScreenshotRelativePath(device, scene));
  await mkdir(dirname(outputPath), { recursive: true });
  await installAppStoreScreenshotStyles(page);
  await page.mouse.move(1, 1);
  await page
    .getByRole('button', { name: /jump to latest/i })
    .evaluateAll((buttons) => {
      buttons.forEach((button) => {
        (button as HTMLElement).style.display = 'none';
      });
    })
    .catch(() => undefined);
  await page
    .getByRole('button', { name: /show less/i })
    .evaluateAll((buttons) => {
      buttons.forEach((button) => {
        (button as HTMLElement).style.display = 'none';
      });
    })
    .catch(() => undefined);
  await page
    .getByRole('button', { name: /load newer messages/i })
    .evaluateAll((buttons) => {
      buttons.forEach((button) => {
        (button as HTMLElement).style.display = 'none';
      });
    })
    .catch(() => undefined);
  await expect(page.getByText('Catching up...', { exact: true })).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText('Loading...', { exact: true }).first()).toBeHidden({
    timeout: 10_000,
  });
  const agentsByScene = {
    'personal-workspace': ['Hearth', 'Pantry', 'Atlas'],
    'mindroom-explained': ['Pantry'],
    'campground-monitor': ['Hearth'],
    'car-search': ['Atlas'],
    'home-reminders': ['Hearth'],
  };
  await expectFixtureAvatars(page, ['Sam Rivera', ...agentsByScene[scene.id]]);
  await waitForNextPaint(page);
  await page.screenshot({
    path: outputPath,
    fullPage: false,
    animations: 'disabled',
    scale: 'device',
  });

  const { width, height, digest } = await readPngMetadata(outputPath);
  expect({ width, height }).toEqual(device.expectedPixels);

  const duplicateScene = capturedDigests.get(digest);
  expect(
    duplicateScene,
    `${scene.id} duplicated the pixels captured for ${duplicateScene ?? 'another scene'}`
  ).toBeUndefined();
  capturedDigests.set(digest, scene.id);
};

const getThreadEntry = (page: Page, title: string) =>
  page.locator('button[data-thread-root-id]').filter({ hasText: title });

const expectFixtureRoomOverview = async (page: Page) => {
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);

  await expect(getThreadEntry(page, DINNER_THREAD_TITLE)).toBeVisible({ timeout: 30_000 });
  await expect(getThreadEntry(page, HOME_AUTOMATION_THREAD_TITLE)).toBeVisible({ timeout: 30_000 });
  await expect(getThreadEntry(page, TRIP_THREAD_TITLE)).toBeVisible({ timeout: 30_000 });
  await expect(getThreadEntry(page, REMINDER_THREAD_TITLE)).toBeVisible({ timeout: 30_000 });
};

const openFixtureRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expectFixtureRoomOverview(page);
};

const returnToFixtureRoomOverview = async (page: Page) => {
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expectFixtureRoomOverview(page);
};

const expandCollapsedMessages = async (page: Page) => {
  const showMoreButtons = page.getByRole('button', { name: /show more/i });
  const collapsedCount = await showMoreButtons.count();

  for (let expandedCount = 0; expandedCount < collapsedCount; expandedCount += 1) {
    await showMoreButtons.last().click({ force: true });
    await waitForNextPaint(page);
  }
};

test('rejects a missing fixture avatar even when the remaining images loaded', async ({ page }) => {
  const pixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await page.setContent(`<img alt="Sam Rivera" width="32" height="32" src="${pixel}">
    <img alt="Pantry" src="data:image/png;base64,invalid" onerror="this.remove()">`);
  await expect(page.getByRole('img', { name: 'Pantry', exact: true })).toHaveCount(0);
  await expectFixtureAvatars(page, ['Sam Rivera']);
  await expect(expectFixtureAvatars(page, ['Sam Rivera', 'Pantry'], 250)).rejects.toThrow();
});

for (const device of APP_STORE_SCREENSHOT_DEVICES) {
  test.describe(`App Store screenshots - ${device.label}`, () => {
    test.use({
      timezoneId: 'UTC',
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
    });

    test('captures the release screenshot set', async ({ page }) => {
      test.setTimeout(240_000);
      const capturedDigests = new Map<string, string>();

      const homeserver = getHomeserver();
      const { username, password } = getPrimaryCredentials();
      const matrixSession = await loginToMatrix(homeserver, username, password);
      const fixtureRoomId = await joinRoom(
        homeserver,
        matrixSession.accessToken,
        FIXTURE_ROOM_ALIAS
      );

      await loginWithPassword(page, { homeserver, username, password });
      await seedRoomOverviewState({
        page,
        roomId: fixtureRoomId,
        userId: matrixSession.userId,
        viewMode: 'compact',
        filterState: createDefaultThreadFilterState(),
      });

      await openFixtureRoom(page, fixtureRoomId);
      await applySceneTheme(page, sceneById('personal-workspace'));
      await expectFixtureRoomOverview(page);
      const threadAgents = [
        [WEEK_THREAD_TITLE, 'Atlas'],
        [DINNER_THREAD_TITLE, 'Pantry'],
        [HOME_AUTOMATION_THREAD_TITLE, 'Hearth'],
        [TRIP_THREAD_TITLE, 'Atlas'],
        [REMINDER_THREAD_TITLE, 'Hearth'],
      ];
      // Warm every thread so older cards include their replying agent, too.
      for (const [title] of threadAgents) {
        await getThreadEntry(page, title).click();
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible();
        await returnToFixtureRoomOverview(page);
      }
      for (const [title, agent] of threadAgents) {
        await expect(
          getThreadEntry(page, title).getByRole('img', { name: agent, exact: true })
        ).toBeVisible();
      }
      await expect(getThreadEntry(page, WEEK_THREAD_TITLE)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/Atlas:.*Your week, together/)).toBeVisible();
      await captureScene(page, device, sceneById('personal-workspace'), capturedDigests);

      await getThreadEntry(page, DINNER_THREAD_TITLE).click();
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await applySceneTheme(page, sceneById('mindroom-explained'));
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Dinner, sorted')).toBeVisible({
        timeout: 30_000,
      });
      await expandCollapsedMessages(page);
      await expect(page.getByText('Groceries', { exact: true })).toBeVisible();
      await captureScene(page, device, sceneById('mindroom-explained'), capturedDigests);

      await returnToFixtureRoomOverview(page);
      await getThreadEntry(page, HOME_AUTOMATION_THREAD_TITLE).click();
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await applySceneTheme(page, sceneById('campground-monitor'));
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      const toolCallsButton = page.getByRole('button', { name: /3 tool calls/i }).first();
      await expect(toolCallsButton).toBeVisible({ timeout: 30_000 });
      await expandCollapsedMessages(page);
      await toolCallsButton.click();
      await expect(page.getByText('light.turn_off · all lights', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByRole('button', { name: 'All lights are off.', exact: true })
      ).toBeVisible();
      await expect(page.getByText('All set. Have a lovely evening!')).toBeVisible();
      await captureScene(page, device, sceneById('campground-monitor'), capturedDigests);

      await returnToFixtureRoomOverview(page);
      await getThreadEntry(page, TRIP_THREAD_TITLE).click();
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await applySceneTheme(page, sceneById('car-search'));
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/Three ways to do it under €900/)).toBeVisible({
        timeout: 30_000,
      });
      await expandCollapsedMessages(page);
      await expect(page.getByText(/Old town · €842/)).toBeVisible();
      await captureScene(page, device, sceneById('car-search'), capturedDigests);

      await returnToFixtureRoomOverview(page);
      await getThreadEntry(page, REMINDER_THREAD_TITLE).click();
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await applySceneTheme(page, sceneById('home-reminders'));
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('One less thing to remember')).toBeVisible({ timeout: 30_000 });
      await expandCollapsedMessages(page);

      await captureScene(page, device, sceneById('home-reminders'), capturedDigests);
    });
  });
}
