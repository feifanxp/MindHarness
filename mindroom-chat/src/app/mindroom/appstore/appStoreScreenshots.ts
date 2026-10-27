export type AppStoreScreenshotDevice = {
  id: 'iphone-6-9' | 'ipad-13';
  label: string;
  viewport: {
    width: number;
    height: number;
  };
  deviceScaleFactor: number;
  expectedPixels: {
    width: number;
    height: number;
  };
  isMobile: boolean;
  hasTouch: boolean;
};

export type AppStoreScreenshotScene = {
  id:
    | 'personal-workspace'
    | 'mindroom-explained'
    | 'campground-monitor'
    | 'car-search'
    | 'home-reminders';
  order: number;
  theme: 'light' | 'dark';
};

export const APP_STORE_SCREENSHOT_LOCALE = 'en-US';
export const APP_STORE_SCREENSHOT_ROOT = 'ios/App/fastlane/screenshots';

export const APP_STORE_SCREENSHOT_DEVICES: AppStoreScreenshotDevice[] = [
  {
    id: 'iphone-6-9',
    label: 'iPhone 6.9"',
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    expectedPixels: { width: 1320, height: 2868 },
    isMobile: true,
    hasTouch: true,
  },
  {
    id: 'ipad-13',
    label: 'iPad 13"',
    viewport: { width: 1032, height: 1376 },
    deviceScaleFactor: 2,
    expectedPixels: { width: 2064, height: 2752 },
    isMobile: false,
    hasTouch: true,
  },
];

export const APP_STORE_SCREENSHOT_SCENES: AppStoreScreenshotScene[] = [
  { id: 'personal-workspace', order: 0, theme: 'light' },
  { id: 'mindroom-explained', order: 1, theme: 'dark' },
  { id: 'campground-monitor', order: 2, theme: 'light' },
  { id: 'car-search', order: 3, theme: 'dark' },
  { id: 'home-reminders', order: 4, theme: 'light' },
];

export const getAppStoreScreenshotFileName = (
  device: AppStoreScreenshotDevice,
  scene: AppStoreScreenshotScene
): string => `${scene.order}_${device.id}_${scene.theme}_${scene.id}.png`;

export const getAppStoreScreenshotRelativePath = (
  device: AppStoreScreenshotDevice,
  scene: AppStoreScreenshotScene,
  locale = APP_STORE_SCREENSHOT_LOCALE
): string =>
  `${APP_STORE_SCREENSHOT_ROOT}/${locale}/${getAppStoreScreenshotFileName(device, scene)}`;
