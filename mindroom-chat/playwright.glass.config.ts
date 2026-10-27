import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  testMatch: [
    '**/card-glass-highlight.spec.ts',
    '**/glass-surfaces.spec.ts',
    '**/dialog-menu-glass.spec.ts',
    '**/live/following-glass.spec.ts',
    '**/live/composer-glass.spec.ts',
    '**/live/approval-glass.spec.ts',
    '**/live/space-header-glass.spec.ts',
    '**/live/navigation-header-glass.spec.ts',
    '**/live/members-header-glass.spec.ts',
    '**/live/settings-header-glass.spec.ts',
    '**/live/dialog-header-layout.spec.ts',
    '**/live/room-glass-overlays.spec.ts',
    '**/live/thread-banner-overlay.spec.ts',
    '**/live/message-disclosure-overlay.spec.ts',
  ],
  projects: [...config.projects!, { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
