import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  sendMessageEdit,
  sendRoomMessage,
} from '../helpers/matrix';

declare global {
  interface Window {
    __closeExistingMessagePorts?: () => number;
    __schedulerWakeupReplacements?: number;
  }
}

/**
 * WebKit brokers MessagePorts through its networking process. When that process
 * exits, WebKit closes every existing port without an event, while ports created
 * afterwards work. Record native channels so the test can reproduce that loss.
 */
const installMessagePortLoss = () => {
  const NativeMessageChannel = window.MessageChannel;
  const channels: MessageChannel[] = [];
  function RecordedMessageChannel() {
    const channel = new NativeMessageChannel();
    channels.push(channel);
    return channel;
  }
  RecordedMessageChannel.prototype = NativeMessageChannel.prototype;
  window.MessageChannel = RecordedMessageChannel as unknown as typeof MessageChannel;
  window.__schedulerWakeupReplacements = 0;
  window.addEventListener('mindroom:scheduler-wakeup-replaced', () => {
    window.__schedulerWakeupReplacements = (window.__schedulerWakeupReplacements ?? 0) + 1;
  });
  window.__closeExistingMessagePorts = () => {
    const closed = channels.splice(0);
    closed.forEach((channel) => {
      channel.port1.close();
      channel.port2.close();
    });
    return closed.length;
  };
};

test.describe('thread live updates after MessagePort loss', () => {
  test.skip(!hasPrimaryCredentials(), 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(180_000);

  test('renders a reply and its streamed edit that arrive after existing ports close', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const stamp = Date.now();
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `MessagePort loss ${stamp}`,
      topic: 'Open thread live updates after WebKit networking-process loss',
      rootBody: `MessagePort loss root ${stamp}`,
      replyBody: `Reply before port loss ${stamp}`,
    });

    await page.addInitScript(installMessagePortLoss);
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(
      `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
    );
    await expect(page.locator(`[data-message-id="${fixture.replyId}"]`)).toContainText(
      fixture.replyBody,
      { timeout: 60_000 }
    );
    // Let opening settle so the loss hits a thread idling on live sync.
    await page.waitForTimeout(2_000);

    const loss = await page.evaluate(() => ({
      replacementsBefore: window.__schedulerWakeupReplacements ?? 0,
      closedChannelCount: window.__closeExistingMessagePorts?.() ?? 0,
    }));
    expect(loss.closedChannelCount).toBeGreaterThan(0);

    const replyBody = `Reply after port loss ${stamp}`;
    const replyId = await sendRoomMessage(homeserver, session.accessToken, fixture.roomId, {
      msgtype: 'm.text',
      body: replyBody,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: fixture.rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: fixture.rootId },
      },
    });
    const reply = page.locator(`[data-message-id="${replyId}"]`);
    await expect(reply).toContainText(replyBody, { timeout: 15_000 });

    const revision = `Streamed revision after port loss ${stamp}`;
    await sendMessageEdit(homeserver, session.accessToken, fixture.roomId, replyId, revision);
    await expect(reply).toContainText(revision, { timeout: 15_000 });
    // Recovery went through React Scheduler's own channel, not an unrelated one.
    expect(await page.evaluate(() => window.__schedulerWakeupReplacements ?? 0)).toBeGreaterThan(
      loss.replacementsBefore
    );
  });
});
