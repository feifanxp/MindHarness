import { expect, test } from '@playwright/test';
import {
  buildLoginPath,
  buildRegisterPath,
  buildResetPasswordPath,
  getHomeserver,
} from './env';

const isLocalHomeserver = (homeserver: string) =>
  /(^https?:\/\/127\.0\.0\.1)|(^https?:\/\/localhost)|matrix\.localhost|127\.0\.0\.1|localhost/.test(
    homeserver
  );

const expectAddAccountUrl = (pageUrl: string, expectedPathPrefix: string) => {
  const url = new URL(pageUrl);
  expect(url.pathname.replace(/\/$/, '')).toContain(expectedPathPrefix.replace(/\/$/, ''));
  expect(url.searchParams.get('addAccount')).toBe('1');
};

test('deployed login route renders the SSO-only auth shell with explicit server state', async ({
  page,
}) => {
  const homeserver = getHomeserver();
  test.skip(isLocalHomeserver(homeserver), 'Hosted SSO shell is not available on the local docker stack.');

  await page.goto(buildLoginPath(homeserver, true));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  await expect(page.getByRole('paragraph').filter({ hasText: 'Login' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with Apple' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
  expectAddAccountUrl(page.url(), `/login/${encodeURIComponent(homeserver)}/`);
});

test('deployed register route renders the SSO sign-up shell and keeps add-account routing', async ({
  page,
}) => {
  const homeserver = getHomeserver();
  test.skip(isLocalHomeserver(homeserver), 'Hosted SSO shell is not available on the local docker stack.');

  await page.goto(buildRegisterPath(homeserver, true));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  await expect(page.getByRole('paragraph').filter({ hasText: 'Register' })).toBeVisible();
  await expect(
    page.getByText('This homeserver only allows sign up with Apple, Google, or GitHub.')
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up with Apple' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Login' })).toHaveAttribute(
    'href',
    expect.stringContaining(`/login/${encodeURIComponent(homeserver)}`)
  );
  expectAddAccountUrl(page.url(), `/register/${encodeURIComponent(homeserver)}/`);
});

test('deployed reset-password route renders the local reset form and keeps add-account routing', async ({
  page,
}) => {
  const homeserver = getHomeserver();

  await page.goto(buildResetPasswordPath(homeserver, true));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(homeserver);
  await expect(page.getByRole('paragraph').filter({ hasText: 'Reset Password' })).toBeVisible();
  await expect(
    page.getByText(`Homeserver ${homeserver} will send you an email`, { exact: false })
  ).toBeVisible();
  await expect(page.getByText('Email', { exact: true })).toBeVisible();
  await expect(page.getByText('New Password', { exact: true })).toBeVisible();
  await expect(page.getByText('Confirm Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Login' })).toHaveAttribute(
    'href',
    expect.stringContaining(`/login/${encodeURIComponent(homeserver)}`)
  );
  expectAddAccountUrl(page.url(), `/reset-password/${encodeURIComponent(homeserver)}/`);
});
