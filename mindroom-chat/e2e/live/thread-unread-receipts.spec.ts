import { expect, test } from '@playwright/test';
import {
  getHomeserver,
  getPrimaryCredentials,
  getSecondaryCredentials,
  hasPrimaryCredentials,
} from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

test('clears thread unread indicators through room mark-read and opening a thread', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials() || !getSecondaryCredentials(), 'Two Matrix accounts required');
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const secondCredentials = getSecondaryCredentials()!;
  const reader = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const writer = await loginToMatrix(
    homeserver,
    secondCredentials.username,
    secondCredentials.password
  );
  const stamp = Date.now();
  const roomName = `Thread unread receipts ${stamp}`;
  const roomId = await createPrivateRoom(homeserver, reader.accessToken, {
    name: roomName,
    topic: 'Thread read receipts regression fixture.',
    invite: [writer.userId],
  });
  await joinRoom(homeserver, writer.accessToken, roomId);
  // Keep room notification counts at zero while unread replies still mark their threads unread.
  await matrixFetch(homeserver, `/pushrules/global/room/${encodeURIComponent(roomId)}`, {
    method: 'PUT',
    accessToken: reader.accessToken,
    body: JSON.stringify({ actions: ['dont_notify'] }),
  });
  const sendReply = (rootId: string, body: string, token = writer.accessToken) =>
    sendRoomMessage(homeserver, token, roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  const rootIds: string[] = [];
  for (const name of ['First', 'Second']) {
    const rootId = await sendRoomMessage(homeserver, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `${name} unread thread ${stamp}`,
    });
    rootIds.push(rootId);
    const initialReply = await sendReply(rootId, `${name} initial reply`, reader.accessToken);
    await matrixFetch(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(initialReply)}`,
      {
        method: 'POST',
        accessToken: reader.accessToken,
        body: JSON.stringify({ thread_id: rootId }),
      }
    );
  }

  await loginWithPassword(page, { homeserver, ...credentials });
  await expectLoggedInShellStable(page);
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  const roomLink = page.getByRole('link', { name: roomName }).first();
  await roomLink.click();
  const firstCard = page.locator(`[data-thread-root-id="${rootIds[0]}"]`);
  const secondCard = page.locator(`[data-thread-root-id="${rootIds[1]}"]`);
  const expectUnread = (card: typeof firstCard, unread: boolean) =>
    unread
      ? expect(card).toHaveAttribute('data-thread-unread', 'true')
      : expect(card).not.toHaveAttribute('data-thread-unread');
  await expect(firstCard).toBeVisible();
  await expect(secondCard).toBeVisible();

  await sendReply(rootIds[0], 'First new unread reply');
  await sendReply(rootIds[1], 'Second new unread reply');
  await expectUnread(firstCard, true);
  await expectUnread(secondCard, true);
  await expect(roomLink.locator('..')).toHaveAttribute('data-highlight', 'false');

  await roomLink.click({ button: 'right' });
  await page.getByRole('button', { name: 'Mark as Read', exact: true }).click();
  await expectUnread(firstCard, false);
  await expectUnread(secondCard, false);

  await page.reload();
  await expect(firstCard).toBeVisible();
  await expectUnread(firstCard, false);
  await expectUnread(secondCard, false);

  const latestReply = await sendReply(rootIds[0], 'Reply to read by opening');
  await expectUnread(firstCard, true);
  const threadReceipt = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().includes(`/receipt/m.read/${encodeURIComponent(latestReply)}`) &&
      request.postDataJSON()?.thread_id === rootIds[0]
  );
  await firstCard.click();
  await threadReceipt;
  await expect(page.getByText('Reply to read by opening', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(firstCard).toBeVisible();
  await expectUnread(firstCard, false);
});
