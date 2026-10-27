import type { Page } from '@playwright/test';

/**
 * Activates "Load Older Messages" controls while older thread history remains
 * available and returns how many controls were synchronously activated.
 *
 * The chip's label flips to "Loading..." while a page is in flight, so the
 * loop must keep waiting through that state instead of treating the missing
 * "Load Older Messages" label as completion — and completion itself is only
 * trusted after two consecutive checks with neither label present (the flip
 * between the two labels is not atomic).
 *
 * The sixty-iteration guard bounds this helper's work. Reaching that guard
 * does not prove that all available history was loaded.
 */
export const loadAllOlderThreadMessages = async (page: Page): Promise<number> => {
  let activations = 0;
  for (let i = 0; i < 60; i += 1) {
    const loadOlder = page.getByRole('button', {
      name: 'Load Older Messages',
      exact: true,
    });
    // eslint-disable-next-line no-await-in-loop
    const activated = await loadOlder.evaluateAll((buttons) => {
      if (buttons.length > 1) {
        throw new Error('Multiple "Load Older Messages" buttons matched');
      }
      const button = buttons[0] as HTMLElement | undefined;
      if (
        !button?.isConnected ||
        button.matches(':disabled') ||
        button.getAttribute('aria-disabled') === 'true'
      ) {
        return false;
      }
      button.click();
      return true;
    });
    if (activated) {
      activations += 1;
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(400);
      continue;
    }
    const loading = page.getByRole('button', { name: 'Loading...' });
    // eslint-disable-next-line no-await-in-loop
    if ((await loading.count()) > 0) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(400);
      continue;
    }
    // Neither label present for two consecutive checks -> fully loaded.
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
    // eslint-disable-next-line no-await-in-loop
    if ((await loadOlder.count()) === 0 && (await loading.count()) === 0) return activations;
  }
  return activations;
};
