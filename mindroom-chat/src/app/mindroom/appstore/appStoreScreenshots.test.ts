import { describe, expect, it } from 'vitest';
import {
  APP_STORE_SCREENSHOT_DEVICES,
  APP_STORE_SCREENSHOT_LOCALE,
  APP_STORE_SCREENSHOT_SCENES,
  getAppStoreScreenshotFileName,
  getAppStoreScreenshotRelativePath,
} from './appStoreScreenshots';

describe('app store screenshot plan', () => {
  it('captures the required iPhone and iPad App Store device classes', () => {
    expect(APP_STORE_SCREENSHOT_DEVICES).toEqual([
      expect.objectContaining({
        id: 'iphone-6-9',
        label: 'iPhone 6.9"',
        viewport: { width: 440, height: 956 },
        deviceScaleFactor: 3,
        expectedPixels: { width: 1320, height: 2868 },
      }),
      expect.objectContaining({
        id: 'ipad-13',
        label: 'iPad 13"',
        viewport: { width: 1032, height: 1376 },
        deviceScaleFactor: 2,
        expectedPixels: { width: 2064, height: 2752 },
      }),
    ]);
  });

  it('keeps screenshot filenames sorted by scene order within each device class', () => {
    expect(APP_STORE_SCREENSHOT_LOCALE).toBe('en-US');
    expect(APP_STORE_SCREENSHOT_SCENES.map((scene) => scene.id)).toEqual([
      'personal-workspace',
      'mindroom-explained',
      'campground-monitor',
      'car-search',
      'home-reminders',
    ]);

    expect(APP_STORE_SCREENSHOT_SCENES.map((scene) => scene.theme)).toEqual([
      'light',
      'dark',
      'light',
      'dark',
      'light',
    ]);

    expect(
      APP_STORE_SCREENSHOT_SCENES.map((scene) =>
        getAppStoreScreenshotFileName(APP_STORE_SCREENSHOT_DEVICES[0], scene)
      )
    ).toEqual([
      '0_iphone-6-9_light_personal-workspace.png',
      '1_iphone-6-9_dark_mindroom-explained.png',
      '2_iphone-6-9_light_campground-monitor.png',
      '3_iphone-6-9_dark_car-search.png',
      '4_iphone-6-9_light_home-reminders.png',
    ]);
  });

  it('uses unique content and includes both light and dark release screenshots', () => {
    const sceneIds = APP_STORE_SCREENSHOT_SCENES.map((scene) => scene.id);
    const themes = new Set(APP_STORE_SCREENSHOT_SCENES.map((scene) => scene.theme));

    expect(new Set(sceneIds).size).toBe(sceneIds.length);
    expect(themes).toEqual(new Set(['light', 'dark']));
  });

  it('writes screenshots into the fastlane locale folder', () => {
    expect(
      getAppStoreScreenshotRelativePath(
        APP_STORE_SCREENSHOT_DEVICES[1],
        APP_STORE_SCREENSHOT_SCENES[4]
      )
    ).toBe('ios/App/fastlane/screenshots/en-US/4_ipad-13_light_home-reminders.png');
  });
});
