import { expect, test, type Page } from '@playwright/test';

async function signInLocally(page: Page, user = 'alice') {
  await page.evaluate((name) => {
    const baseUrl = 'https://example.org';
    const userId = '@' + name + ':example.org';
    const sessionId = encodeURIComponent(baseUrl) + '::' + encodeURIComponent(userId);
    localStorage.setItem(
      'mindroom_multi_account_store',
      JSON.stringify({
        version: 1,
        activeSessionId: sessionId,
        sessions: [
          {
            sessionId,
            baseUrl,
            userId,
            accessToken: 'fixture-token',
            deviceId: 'FIXTURE',
            lastUsedAt: Date.now(),
          },
        ],
      })
    );
  }, user);
}

for (const width of [1200, 390]) {
  test(
    'preserves first-send input through login return at ' + width + 'px',
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      let creates = 0;
      await page.route('**/api/project-wizard/drafts', (route) => {
        if (route.request().method() === 'POST') creates += 1;
        return route.fulfill({ json: [] });
      });
      await page.goto('/discussion');
      await page.getByRole('textbox', { name: '描述你想讨论的内容' }).fill('我想讨论一个产品想法');
      await page.screenshot({ path: testInfo.outputPath('guest-discussion.png') });
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(page).toHaveURL(/\/login/);
      expect(creates).toBe(0);
      await signInLocally(page);
      await page.goto('/discussion');
      await expect(page.getByRole('textbox', { name: '描述你想讨论的内容' })).toHaveValue(
        '我想讨论一个产品想法'
      );
      if (width === 390) await page.getByRole('button', { name: '我的讨论', exact: true }).click();
      await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
      await expect(page.locator('.discussion-account-identity')).toContainText(
        '@alice:example.org'
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('signed-in-discussion.png') });
    }
  );
}

test('sidebar registration preserves the text already entered', async ({ page }) => {
  await page.goto('/discussion');
  await page.getByRole('textbox', { name: '描述你想讨论的内容' }).fill('先写再注册');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/register/);
  await signInLocally(page);
  await page.goto('/discussion');
  await expect(page.getByRole('textbox', { name: '描述你想讨论的内容' })).toHaveValue('先写再注册');
});

test('switching accounts replaces personal discussion history', async ({ page }) => {
  await page.route('**/api/project-wizard/drafts', (route) =>
    route.fulfill({
      json: [
        {
          draft_id: 'private-draft',
          revision: 0,
          status: 'empty',
          archived: false,
          updated_at: 0,
          name:
            route.request().headers()['x-mindroom-discussion-user'] === '@alice:example.org'
              ? 'Alice 的讨论'
              : 'Bob 的讨论',
        },
      ],
    })
  );
  await page.goto('/discussion');
  await signInLocally(page);
  await page.goto('/discussion');
  await expect(page.getByText('Alice 的讨论', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('mindroom_multi_account_store')!);
    const other = {
      ...store.sessions[0],
      userId: '@bob:example.org',
      sessionId:
        encodeURIComponent('https://example.org') + '::' + encodeURIComponent('@bob:example.org'),
    };
    store.sessions.push(other);
    localStorage.setItem('mindroom_multi_account_store', JSON.stringify(store));
    window.dispatchEvent(new Event('storage'));
  });
  await page.reload();
  await page
    .getByRole('combobox', { name: '切换账号' })
    .selectOption({ label: '@bob:example.org' });
  await expect(page.getByText('Bob 的讨论', { exact: true })).toBeVisible();
  await expect(page.getByText('Alice 的讨论', { exact: true })).toHaveCount(0);
});

test.describe('discussion authentication with the production hash router', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/config.json', (route) =>
      route.fulfill({
        json: {
          defaultHomeserver: 0,
          homeserverList: ['https://matrix.example.org'],
          allowCustomHomeservers: true,
          hashRouter: { enabled: true, basename: '/' },
          auth: { allowRegistration: true },
        },
      })
    );
    await page.route('https://matrix.example.org/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/.well-known/matrix/client'))
        return route.fulfill({
          json: { 'm.homeserver': { base_url: 'https://matrix.example.org' } },
        });
      if (path.endsWith('/versions')) return route.fulfill({ json: { versions: ['v1.11'] } });
      if (path.endsWith('/register'))
        return route.fulfill({
          status: 401,
          json: { session: 'registration', flows: [{ stages: ['m.login.dummy'] }], params: {} },
        });
      if (path.endsWith('/login'))
        return route.fulfill({ json: { flows: [{ type: 'm.login.password' }] } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.route('**/api/project-wizard/drafts', (route) => route.fulfill({ json: [] }));
  });

  for (const register of [false, true]) {
    test(
      'opens the actual ' +
        (register ? 'registration' : 'login') +
        ' form in a fresh browser context',
      async ({ page }, testInfo) => {
        await page.goto('/discussion#/discussion');
        await page
          .getByRole('textbox', { name: '描述你想讨论的内容' })
          .fill('保留隐身窗口里的想法');
        await page.getByRole('button', { name: register ? '注册' : '登录', exact: true }).click();
        await expect(page).toHaveURL(register ? /#\/register\// : /#\/login\//);
        await expect(page.locator('input[name="usernameInput"]')).toBeVisible();
        await expect(page.getByRole('heading', { name: '今天想聊点什么？' })).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(register ? 'hash-register.png' : 'hash-login.png'),
        });
        await signInLocally(page);
        await page.goto('/discussion#/discussion');
        await expect(page.getByRole('textbox', { name: '描述你想讨论的内容' })).toHaveValue(
          '保留隐身窗口里的想法'
        );
      }
    );
  }

  test('first send preserves the hash route and input through login', async ({ page }) => {
    await page.goto('/discussion#/discussion?view=notes');
    await page.getByRole('textbox', { name: '描述你想讨论的内容' }).fill('登录后继续');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('input[name="usernameInput"]')).toBeVisible();
    const saved = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('mindroom.discussion.pending-input')!)
    );
    expect(saved.path).toBe('/discussion?view=notes');
    await signInLocally(page);
    await page.goto('/discussion#/discussion?view=notes');
    await expect(page.getByRole('textbox', { name: '描述你想讨论的内容' })).toHaveValue(
      '登录后继续'
    );
  });
});
