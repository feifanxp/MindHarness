import type { Page } from '@playwright/test';

export const pressTab = async (page: Page, backwards = false): Promise<void> => {
  // macOS WebKit uses Option-Tab to visit buttons as well as text fields.
  // https://support.apple.com/guide/safari/cpsh003/mac
  const option =
    process.platform === 'darwin' && page.context().browser()?.browserType().name() === 'webkit';
  await page.keyboard.press(`${backwards ? 'Shift+' : ''}${option ? 'Alt+' : ''}Tab`);
};
