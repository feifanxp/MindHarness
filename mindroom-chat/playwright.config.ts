import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const webServerCommand =
  process.env.E2E_SERVER_COMMAND ?? `npm run start -- --host 127.0.0.1 --port ${port} --strictPort`;
const reuseExistingServer =
  process.env.E2E_REUSE_EXISTING_SERVER === '1'
    ? true
    : process.env.E2E_REUSE_EXISTING_SERVER === '0'
    ? false
    : !process.env.CI;
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  ['/run/current-system/sw/bin/chromium', '/run/current-system/sw/bin/chromium-browser'].find(
    (candidate) => existsSync(candidate)
  );

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: chromiumExecutablePath
          ? {
              executablePath: chromiumExecutablePath,
            }
          : undefined,
      },
    },
  ],
  webServer:
    process.env.E2E_NO_WEB_SERVER === '1'
      ? undefined
      : {
          command: webServerCommand,
          url: baseURL,
          reuseExistingServer,
          timeout: 120_000,
          env: { MINDROOM_E2E_PROVISIONING_URL: new URL(baseURL).origin },
        },
});
