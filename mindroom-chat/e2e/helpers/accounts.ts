import { expect, Page } from '@playwright/test';
import { activeAccountButtonNamePattern, expectLoggedInShellStable } from './auth';

type BrowserSessionStore = {
  activeSessionId?: string;
  sessions: Array<{
    sessionId: string;
    baseUrl?: string;
    userId: string;
    deviceId?: string;
    lastKnownPath?: string;
  }>;
};

const SESSION_STORE_KEY = 'mindroom_multi_account_store';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const readSessionStore = async (page: Page): Promise<BrowserSessionStore> =>
  page.evaluate((storeKey) => {
    const raw = window.localStorage.getItem(storeKey);
    if (!raw) {
      return {
        sessions: [],
      };
    }

    return JSON.parse(raw) as BrowserSessionStore;
  }, SESSION_STORE_KEY);

export const getStoredSessionByUsername = async (page: Page, username: string) => {
  const sessionStore = await readSessionStore(page);
  const session = sessionStore.sessions.find((item) => item.userId.startsWith(`@${username}:`));

  if (!session) {
    throw new Error(`Unable to find stored session for username ${username}.`);
  }

  return session;
};

export const expectActiveStoredUsername = async (page: Page, username: string) => {
  await expect
    .poll(async () => {
      const sessionStore = await readSessionStore(page);
      const activeSession = sessionStore.sessions.find(
        (item) => item.sessionId === sessionStore.activeSessionId
      );
      return activeSession?.userId;
    })
    .toMatch(new RegExp(`^@${escapeRegex(username)}:`));
};

export const expectActiveAccountSwitcherForUsername = async (page: Page, username: string) => {
  await expectLoggedInShellStable(page);
  await expectActiveStoredUsername(page, username);
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible();
};

export const openAccountSwitcher = async (page: Page) => {
  const manageAccountsButton = page.getByRole('button', { name: 'Manage accounts' });
  const manageAccountsVisible = await manageAccountsButton
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (manageAccountsVisible) {
    await manageAccountsButton.click();
  } else {
    await page.getByRole('button', { name: activeAccountButtonNamePattern }).click();
  }
  await expect(page.getByText('Accounts', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Switch accounts, add another account, or remove an inactive one.')
  ).toBeVisible();
};

export const openSettingsFromAccountRail = async (page: Page) => {
  const manageAccountsButton = page.getByRole('button', { name: 'Manage accounts' });
  const manageAccountsVisible = await manageAccountsButton
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (manageAccountsVisible) {
    await manageAccountsButton.click();
    await expect(page.getByText('Accounts', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Switch accounts, add another account, or remove an inactive one.')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
  } else {
    await page.getByRole('button', { name: activeAccountButtonNamePattern }).click();
  }

  await expect(page.getByRole('button', { name: 'General' })).toBeVisible();
};

export const switchToStoredUsername = async (page: Page, username: string) => {
  const session = await getStoredSessionByUsername(page, username);
  await page.getByRole('button', { name: new RegExp(escapeRegex(session.userId)) }).click();
  await expectLoggedInShellStable(page);
  await expectActiveStoredUsername(page, username);
};

export const removeInactiveStoredUsername = async (page: Page, username: string) => {
  const session = await getStoredSessionByUsername(page, username);
  await openAccountSwitcher(page);

  await expect(page.getByText(session.userId, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove from Device' }).click();
  await expect(page.getByText(session.userId, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
};

export const logoutActiveAccount = async (page: Page) => {
  await openSettingsFromAccountRail(page);

  const settingsLogoutButton = page.getByRole('button', { name: 'Logout' }).first();
  await expect(settingsLogoutButton).toBeVisible();
  await settingsLogoutButton.click();

  await expect(page.getByText('You’re about to log out. Are you sure?')).toBeVisible();
  await page.getByRole('button', { name: 'Logout' }).last().click();
};

export const deactivateActiveAccount = async (
  page: Page,
  password: string,
  options: {
    eraseData?: boolean;
  } = {}
) => {
  await openSettingsFromAccountRail(page);

  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByText('Delete / Deactivate Account')).toBeVisible();

  await page.getByRole('button', { name: 'Delete / Deactivate' }).first().click();
  await expect(
    page.getByText('This will request account deactivation on your Matrix homeserver.')
  ).toBeVisible();

  if (options.eraseData) {
    await page.getByRole('switch', { name: 'Erase account data (if supported)' }).click();
  }

  await page.getByRole('button', { name: 'Delete / Deactivate' }).last().click();

  const passwordInput = page.locator('input[name="passwordInput"]');
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
};
