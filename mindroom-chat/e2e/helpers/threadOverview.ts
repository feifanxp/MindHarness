import { type Page } from '@playwright/test';

export const getThreadOverviewSortButton = (page: Page) =>
  page.locator('[data-room-thread-overview="true"] button[data-sort-by]');
