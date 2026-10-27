import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  testMatch: '**/live/thread-indexeddb-loss.spec.ts',
  projects: [...config.projects!, { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
