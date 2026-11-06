import { expect, test } from '@playwright/test';
import type { WizardState } from '../src/projectWizard/api';

const emptyDraft: WizardState = {
  draft_id: 'composer-draft',
  revision: 0,
  status: 'empty',
  messages: [],
  draft: null,
  pending_message_id: null,
  error: null,
  progress: null,
  config_installed: false,
  owner_user_id: null,
  confirmation_key: null,
  confirmed_revision: null,
  result: null,
  test_mode: false,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const baseUrl = 'https://example.org';
    const userId = '@owner:example.org';
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
  });
  await page.route('**/api/project-wizard/drafts', (route) =>
    route.fulfill({ json: route.request().method() === 'GET' ? [] : emptyDraft })
  );
});

for (const width of [1200, 390]) {
  test(`composer grows, wraps and shrinks at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/discussion');
    const input = page.getByRole('textbox', { name: '描述你想讨论的内容' });
    const height = () => input.evaluate((element) => element.getBoundingClientRect().height);
    const initialHeight = await height();
    await input.fill('第一行\n第二行\n第三行\n第四行');
    await expect.poll(height).toBeGreaterThan(initialHeight + 40);
    expect(
      await input.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('composer-expanded.png') });
    await input.fill('这是用于验证自动换行的讨论内容。'.repeat(12));
    await expect.poll(height).toBeGreaterThan(initialHeight);
    await input.fill('很长的内容\n'.repeat(60));
    await expect.poll(height).toBeLessThanOrEqual(170);
    expect(await input.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true
    );
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await input.fill('');
    await expect.poll(height).toBe(initialHeight);
  });
}

test('shows a first turn before the server responds and merges the eventual reply once', async ({
  page,
}, testInfo) => {
  let releaseDraft!: () => void;
  const draftGate = new Promise<void>((resolve) => {
    releaseDraft = resolve;
  });
  let releaseReply!: () => void;
  const replyGate = new Promise<void>((resolve) => {
    releaseReply = resolve;
  });
  await page.route('**/api/project-wizard/drafts', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }
    await draftGate;
    await route.fulfill({ json: emptyDraft });
  });
  let completed = emptyDraft;
  await page.route('**/api/project-wizard/drafts/composer-draft', (route) =>
    route.fulfill({ json: completed })
  );
  await page.route('**/api/project-wizard/drafts/composer-draft/messages', async (route) => {
    const body = route.request().postDataJSON();
    await replyGate;
    completed = {
      ...emptyDraft,
      revision: 2,
      status: 'discovering',
      messages: [
        { id: body.message_id, role: 'user', content: body.content },
        { id: 'reply-1', role: 'assistant', content: '我们可以先聊目标。' },
      ],
    };
    await route.fulfill({ json: completed });
  });
  await page.goto('/discussion');
  const input = page.getByRole('textbox', { name: '描述你想讨论的内容' });
  await input.fill('想聊聊我的新产品\n还有一些用户反馈');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.wizard-user')).toHaveText('你想聊聊我的新产品\n还有一些用户反馈');
  await expect(input).toHaveValue('');
  await expect(page.locator('.wizard-pending')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('message-pending.png') });
  await expect(page.getByRole('heading', { name: '今天想聊点什么？' })).toHaveCount(0);
  const request = page.waitForRequest('**/api/project-wizard/drafts/composer-draft/messages');
  releaseDraft();
  await request;
  await expect(page.locator('.wizard-user')).toHaveCount(1);
  releaseReply();
  await expect(page.locator('.wizard-assistant')).toContainText('我们可以先聊目标。');
  await expect(page.locator('.wizard-user')).toHaveCount(1);
  await expect(page.locator('.wizard-pending')).toHaveCount(0);
  await expect(input).toBeEnabled();
});

test('keeps the first unsaved message and its retry after recovery on the real discussion route', async ({
  page,
}) => {
  let completed = emptyDraft;
  let attempts = 0;
  const ids: string[] = [];
  await page.route('**/api/project-wizard/drafts/composer-draft', (route) =>
    route.fulfill({ json: completed })
  );
  await page.route('**/api/project-wizard/drafts/composer-draft/messages', async (route) => {
    const body = route.request().postDataJSON();
    ids.push(body.message_id);
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, json: { detail: '暂时无法发送' } });
      return;
    }
    completed = {
      ...emptyDraft,
      revision: 2,
      status: 'discovering',
      messages: [
        { id: body.message_id, role: 'user', content: body.content },
        { id: 'reply-1', role: 'assistant', content: '收到，我们接着聊。' },
      ],
    };
    await route.fulfill({ json: completed });
  });
  await page.goto('/discussion');
  await page.getByRole('textbox', { name: '描述你想讨论的内容' }).fill('请保留这条消息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('暂时无法发送');
  await expect(page.locator('.wizard-user')).toContainText('请保留这条消息');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.wizard-assistant')).toContainText('收到，我们接着聊。');
  await expect(page.locator('.wizard-user')).toHaveCount(1);
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});
