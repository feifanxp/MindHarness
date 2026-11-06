import { expect, test } from '@playwright/test';
import type { RouterDebugSnapshot } from '../src/projectWizard/RouterDebugger';

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test('router debugging at width ' + viewport.width, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const requests: string[] = [];
    const snapshot: RouterDebugSnapshot = {
      session_id: '',
      revision: 0,
      settings: {
        strategy: 'configured',
        model: null,
        prompt_template: null,
        history_messages: 3,
        history_chars: 100,
        timeout_seconds: null,
        retries: 0,
      },
      configured: {
        model: 'default',
        models: ['default', 'fast'],
        prompt_template: 'Choose from {agents_info}. Message: {message}',
        judgment: null,
        peer_discussion: false,
      },
      events: [
        {
          sequence: 1,
          timestamp: 1793863310,
          event_id: '$example',
          stage: 'received',
          detail: '请给出两个具体例子。',
          truncated: false,
        },
        {
          sequence: 2,
          timestamp: 1793863316,
          event_id: '$example',
          stage: 'output',
          detail: '{"type":"str","content":"无法确定回答者"}',
          truncated: false,
        },
        {
          sequence: 3,
          timestamp: 1793863316,
          event_id: '$example',
          stage: 'validation_failed',
          detail: '{"reason":"invalid_response_format","will_retry":false}',
          truncated: false,
        },
      ],
    };
    await page.route('**/api/project-wizard/drafts/fixture/router-debug', async (route) => {
      const request = route.request();
      requests.push(request.method());
      const body = request.postDataJSON();
      snapshot.session_id = body.session_id;
      if (request.method() === 'PUT') {
        snapshot.settings = body.settings;
        snapshot.revision += 1;
      }
      await route.fulfill({ json: snapshot });
    });
    await page.goto('/e2e/fixtures/router-debugger.html');
    await expect(page.getByRole('button', { name: 'Router 调试', exact: true })).toBeVisible();
    expect(requests).toHaveLength(0);
    await page.getByRole('button', { name: 'Router 调试', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('正在记录当前房间');
    await page.getByText('结果校验失败', { exact: false }).click();
    await expect(page.getByText('invalid_response_format', { exact: false })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('router-debugger.png'), fullPage: true });
    await page.getByText('工作方式与参数', { exact: true }).click();
    await page.getByLabel('选人模型').selectOption('fast');
    await page.getByRole('button', { name: '应用到本房间' }).click();
    await expect.poll(() => snapshot.settings.model).toBe('fast');
    await expect(page.getByRole('button', { name: '应用到本房间' })).toBeDisabled();
    await page.getByRole('button', { name: '恢复原配置' }).click();
    await expect.poll(() => snapshot.settings.model).toBe(null);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.getByRole('button', { name: '关闭 Router 调试' }).click();
    await expect.poll(() => requests.includes('DELETE')).toBe(true);
    await expect(page.getByLabel('示例聊天输入')).toBeVisible();
  });
}
