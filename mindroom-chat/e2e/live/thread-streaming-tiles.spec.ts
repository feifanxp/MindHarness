import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  sendMessageEdit,
  sendReaction,
  sendRoomMessage,
} from '../helpers/matrix';

const scrollState = (page: Page) =>
  page.evaluate(() => {
    let element = document.querySelector<HTMLElement>('[data-thread-count]')?.parentElement;
    while (element && !/auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element = element.parentElement;
    }
    if (!element) throw new Error('Thread scroller missing');
    return {
      top: element.scrollTop,
      bottom: element.scrollHeight - element.clientHeight - element.scrollTop,
    };
  });

test.describe('streaming relation tiles', () => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(180_000);
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps tiles bounded through edits, scrolling, and a following reply', async ({ page }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Streaming tiles ${Date.now()}`,
      topic: 'Edit and reaction virtualization regression',
    });
    const send = (content: Record<string, unknown>) =>
      sendRoomMessage(homeserver, session.accessToken, roomId, content);
    const rootId = await send({ msgtype: 'm.text', body: 'Streaming tiles root' });
    const relation = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    };
    let targetId = '';
    for (let index = 0; index < 60; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      targetId = await send({
        msgtype: 'm.text',
        body: `Reply ${index}: ${'Some readable message content. '.repeat(4)}`,
        'm.relates_to': relation,
      });
    }
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    const target = page.locator(`[data-message-id="${targetId}"]`);
    await expect(target).toBeInViewport({ timeout: 60_000 });

    const edit = (body: string) =>
      sendMessageEdit(homeserver, session.accessToken, roomId, targetId, body);
    for (let index = 0; index < 80; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await edit(`Streaming revision ${index}`);
      // Let several sync batches reach the mounted timeline.
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(25);
    }
    await sendReaction(homeserver, session.accessToken, roomId, targetId, '👍');
    await expect(target).toContainText('Streaming revision 79');
    await expect(target).toContainText('👍');
    const timeline = page.locator('[data-thread-count]');
    // Invisible relations must not grow the mounted/observed tile set with
    // every token burst. Allow a few unrelated zero-output event types.
    await expect
      .poll(async () =>
        timeline.evaluate(
          (element) =>
            element.querySelectorAll(':scope > [data-index]').length -
            element.querySelectorAll('[data-message-id]').length
        )
      )
      .toBeLessThanOrEqual(4);
    await expect(target).toBeInViewport();

    await page.mouse.move(190, 420);
    for (let index = 0; index < 5; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -500);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(100);
    }
    await expect.poll(async () => (await scrollState(page)).bottom).toBeGreaterThan(400);
    await page.waitForTimeout(500);
    const before = await scrollState(page);
    await edit('Streaming revision while reading history');
    await page.waitForTimeout(1_000);
    expect(Math.abs((await scrollState(page)).top - before.top)).toBeLessThan(100);
    await page.getByRole('button', { name: 'Jump to Latest' }).click();
    await expect(target).toBeInViewport();
    await expect(target).toContainText('Streaming revision while reading history');

    const nextId = await send({
      msgtype: 'm.text',
      body: 'Next reply after the edit burst',
      'm.relates_to': relation,
    });
    await expect(page.locator(`[data-message-id="${nextId}"]`)).toBeInViewport();
    await expect.poll(async () => (await scrollState(page)).bottom).toBeLessThan(48);
  });
});
