import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createThreadFixture, loginToMatrix } from '../helpers/matrix';

(['offline', 'delayed'] as const).forEach((sendMode) => {
  test(`preserves thread drafts and ${sendMode} replies across navigation`, async ({
    page,
    context,
  }, testInfo) => {
    test.skip(!process.env.E2E_USERNAME, 'E2E_USERNAME / E2E_PASSWORD not set');
    test.setTimeout(180_000);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `Thread persistence ${stamp}`,
      topic: 'Draft and local echo persistence regression',
      rootBody: `Persistence root ${stamp}`,
      replyBody: `Existing reply ${stamp}`,
      txnPrefix: `persistence-${stamp}`,
    });
    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(
      `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
    );
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible();
    await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();

    const composer = page.getByRole('textbox').first();
    const draft = `Unsent thread draft ${stamp}`;
    const exitThread = () =>
      page.locator('[data-thread-context-banner]').getByRole('button').first().click();
    const reopenThread = () =>
      page
        .getByTestId('thread-nav-list')
        .getByRole('button', { name: new RegExp(`^Open thread: Persistence root ${stamp}`) })
        .click();

    await composer.fill(draft);
    await exitThread();
    await expect(page.locator('[data-thread-context-banner]')).toHaveCount(0);
    await expect(composer.locator('[data-slate-string]')).toHaveCount(0);
    await reopenThread();
    await expect(composer).toHaveText(draft);
    await page.reload();
    await expect(composer).toHaveText(draft);

    let releaseSend!: () => void;
    if (sendMode === 'offline') await context.setOffline(true);
    else {
      const ready = new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      await page.route('**/_matrix/client/**/send/m.room.message/**', async (route) => {
        await ready;
        await route.continue();
      });
    }
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const message = page.locator('[data-message-item]').filter({ hasText: draft });
    await expect(message).toHaveCount(1);
    await exitThread();
    await expect(page.locator('[data-thread-context-banner]')).toHaveCount(0);
    await reopenThread();
    await expect(message).toHaveCount(1);
    await expect(
      message.getByRole('status', { name: /Message (sending|failed to send)/ })
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('pending-after-navigation.png') });
    if (sendMode === 'offline') await context.setOffline(false);
    else {
      releaseSend();
      await expect(message.getByRole('status')).toHaveCount(0);
      await expect(message).toHaveCount(1);
      await page.reload();
      await expect(message).toHaveCount(1);
      await expect(composer.locator('[data-slate-string]')).toHaveCount(0);
    }
  });
});
