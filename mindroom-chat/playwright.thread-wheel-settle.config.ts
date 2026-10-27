import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  testMatch: '**/live/thread-wheel-at-settle.spec.ts',
  projects: [...config.projects!, { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
