import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  testMatch: ['**/live/navigation-panel.spec.ts', '**/live/member-sidebar.spec.ts'],
  projects: [...config.projects!, { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
