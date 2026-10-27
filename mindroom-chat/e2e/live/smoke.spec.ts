import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, buildLoginPath } from '../env';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';

const hasVisibleLocator = async (locator: Locator) => locator.isVisible().catch(() => false);

const anyAuthProviderVisible = async (page: Page) => {
  const ssoLocators = [
    page.getByRole('link', { name: 'Sign in with Apple' }),
    page.getByRole('link', { name: 'Continue with Google' }),
    page.getByRole('link', { name: 'Continue with GitHub' }),
  ];

  for (const locator of ssoLocators) {
    if (await hasVisibleLocator(locator)) {
      return true;
    }
  }

  return false;
};

test.describe('live smoke', () => {
  test('app loads with MindRoom title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/MindRoom/);
  });

  test('auth shell renders', async ({ page }) => {
    const homeserver = getHomeserver();
    const normalizedHomeserver = homeserver.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    await page.goto(buildLoginPath(homeserver));

    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    if (normalizedHomeserver === 'mindroom.chat') {
      await expect(page.getByRole('link', { name: 'Sign in with Apple' })).toBeVisible();
      return;
    }

    await expect
      .poll(
        async () => {
          const hasSso = await anyAuthProviderVisible(page);
          if (hasSso) return true;
          return hasVisibleLocator(page.getByRole('button', { name: 'Login' }));
        },
        { message: 'expected the auth shell to render either password login or SSO providers' }
      )
      .toBe(true);
  });

  test('SSO providers visible (if configured)', async ({ page }) => {
    const homeserver = getHomeserver();
    await page.goto(buildLoginPath(homeserver));
    const normalizedHomeserver = homeserver.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    const hasSso = await anyAuthProviderVisible(page);

    if (normalizedHomeserver === 'mindroom.chat') {
      await expect(page.getByRole('link', { name: 'Sign in with Apple' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
      return;
    }

    if (hasSso) {
      return;
    }

    await expect(page.locator('input[name="usernameInput"]')).toBeVisible();
    await expect(page.locator('input[name="passwordInput"]')).toBeVisible();
  });

  test('no known-critical console errors on load', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    await page.goto(buildLoginPath(homeserver));

    // Give the app a moment to settle
    await page.waitForTimeout(2000);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'smoke-load');
  });
});
