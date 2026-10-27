import { expect, test } from '@playwright/test';
import { buildLoginPath, buildRegisterPath, buildResetPasswordPath, getHomeserver } from './env';

const expectAddAccountUrl = (pageUrl: string, expectedPathPrefix: string) => {
  const url = new URL(pageUrl);
  expect(url.pathname.replace(/\/$/, '')).toContain(expectedPathPrefix.replace(/\/$/, ''));
  expect(url.searchParams.get('addAccount')).toBe('1');
};

test('preserves explicit auth router state for add-account flows', async ({ page }) => {
  const homeserver = getHomeserver();

  await page.goto(buildLoginPath(homeserver, true));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  expectAddAccountUrl(page.url(), `/login/${encodeURIComponent(homeserver)}/`);

  await page.goto(buildRegisterPath(homeserver, true));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  expectAddAccountUrl(page.url(), `/register/${encodeURIComponent(homeserver)}/`);

  await page.goto(buildResetPasswordPath(homeserver, true));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  expectAddAccountUrl(page.url(), `/reset-password/${encodeURIComponent(homeserver)}/`);

  await page.getByRole('link', { name: 'Login' }).click();
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  expectAddAccountUrl(page.url(), `/login/${encodeURIComponent(homeserver)}/`);
});

test('supports direct router entry for register and reset-password pages', async ({ page }) => {
  const homeserver = getHomeserver();

  await page.goto(buildRegisterPath(homeserver));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  await expect(page.getByText('Already have an account?')).toBeVisible();

  await page.goto(buildResetPasswordPath(homeserver));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  await expect(page.getByText('Remember your password?')).toBeVisible();
});
