import { expect, test, type Locator } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { activeAccountButtonNamePattern, loginWithPassword } from '../helpers/auth';
import { createPrivateSpace, loginToMatrix, matrixFetch } from '../helpers/matrix';

test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');

test('section icons reopen collapsed navigation while bottom actions leave it collapsed', async ({
  page,
}) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const settingsPath = `/user/${encodeURIComponent(
    session.userId
  )}/account_data/io.mindroom.settings`;
  const settingsResponse = await page.request.get(
    `${homeserver}/_matrix/client/v3${settingsPath}`,
    {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    }
  );
  let settings: Record<string, unknown> = {};
  if (settingsResponse.status() === 404) {
    expect(await settingsResponse.json()).toMatchObject({ errcode: 'M_NOT_FOUND' });
  } else {
    expect(settingsResponse.ok()).toBe(true);
    settings = await settingsResponse.json();
  }
  const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
    name: `Sidebar selection ${Date.now()}`,
    topic: 'Navigation expansion regression',
  });

  try {
    await page.route('**/config.json', async (route) => {
      const response = await route.fetch();
      const config = await response.json();
      await route.fulfill({
        response,
        json: {
          ...config,
          sidebar: { ...config.sidebar, showThreads: true, showExploreCommunity: true },
        },
      });
    });
    await matrixFetch(homeserver, settingsPath, {
      method: 'PUT',
      accessToken: session.accessToken,
      body: JSON.stringify({ ...settings, simpleMode: false }),
    });
    await loginWithPassword(page, { homeserver, ...credentials });
    const collapse = page.getByRole('button', { name: 'Collapse navigation panel', exact: true });
    const expand = page.getByRole('button', { name: 'Expand navigation panel', exact: true });
    const spaceButton = page.locator('button[data-id="' + spaceId + '"]');
    const scrollableRail = spaceButton.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
    const primarySections = scrollableRail.locator(
      'xpath=./*[@role="separator"][1]/preceding-sibling::*[1]'
    );
    const optionalSections = scrollableRail.locator(
      'xpath=./*[@role="separator"][last()]/following-sibling::*[1]'
    );
    const activeAccount = page.getByRole('button', { name: activeAccountButtonNamePattern });
    const inbox = activeAccount.locator('xpath=../preceding-sibling::*[1]//button');
    const storageKey = `mindroom.pageNav.desktopCollapsed:${session.userId}`;
    const savedCollapse = () => page.evaluate((key) => localStorage.getItem(key), storageKey);
    const selectTab = async (button: Locator, label: string, keyboard = false) => {
      await button.hover();
      await expect(page.getByRole('tooltip')).toHaveText(label);
      if (keyboard) {
        await button.focus();
        await button.press('Enter');
      } else {
        await button.click();
      }
    };

    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 800 });
      for (const [index, label] of ['Home', 'Direct Messages', 'Threads'].entries()) {
        await collapse.click();
        await expect(expand).toBeVisible();
        await selectTab(primarySections.getByRole('button').nth(index), label, width === 800);
        await expect(collapse).toBeVisible();
        await expect.poll(savedCollapse).toBe('false');

        // Reselecting the active section must work even when its URL is unchanged.
        const activeUrl = page.url();
        await collapse.click();
        await selectTab(primarySections.getByRole('button').nth(index), label);
        await expect(collapse).toBeVisible();
        await expect(page).toHaveURL(activeUrl);
      }

      await collapse.click();
      const beforeSuppressedClick = page.url();
      await spaceButton.evaluate((button) => {
        button.addEventListener('click', (event) => event.preventDefault(), {
          capture: true,
          once: true,
        });
      });
      await spaceButton.click();
      await expect(expand).toBeVisible();
      await expect(page).toHaveURL(beforeSuppressedClick);
      await spaceButton.click();
      await expect(collapse).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/${encodeURIComponent(spaceId)}/lobby$`));

      await collapse.click();
      await selectTab(optionalSections.getByRole('button').first(), 'Explore Community');
      await expect(collapse).toBeVisible();
      await expect(page.getByRole('link', { name: 'Featured', exact: true })).toBeVisible();

      await collapse.click();
      await expect(page.getByRole('link', { name: 'Featured', exact: true })).toHaveCount(0);
      await activeAccount.click();
      await expect.poll(savedCollapse).toBe('true');
      await page.keyboard.press('Escape');
      await expect(expand).toBeVisible();

      await selectTab(inbox, 'Inbox');
      await expect(page).toHaveURL(/\/inbox/);
      await expect(expand).toBeVisible();
      await expect.poll(savedCollapse).toBe('true');
      await expand.click();
    }
  } finally {
    try {
      await matrixFetch(homeserver, settingsPath, {
        method: 'PUT',
        accessToken: session.accessToken,
        body: JSON.stringify(settings),
      });
    } finally {
      await matrixFetch(homeserver, `/rooms/${encodeURIComponent(spaceId)}/leave`, {
        method: 'POST',
        accessToken: session.accessToken,
        body: '{}',
      });
    }
  }
});
