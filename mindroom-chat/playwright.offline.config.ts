import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  testMatch: '**/live/offline-thread-overview.spec.ts',
  projects: [...config.projects!, { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
