import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  redactEvent,
  seedRoomOverviewState,
  sendMessageEdit,
  sendReaction,
  sendRoomMessage,
} from '../helpers/matrix';
import { readThreadEventCacheRecords } from '../helpers/storage';

const hasCredentials = !!process.env.E2E_USERNAME;

// CINNY-207 P0.2/P1.2: spec for finding F6 (stop-emoji persisted after
// redaction). Written red in P0.2; green since the P1.2 redaction cache
// lifecycle fix. See docs/mindroom-cache-overhaul-plan.md (AC3).
test.describe('CINNY-207 stop-emoji redaction lifecycle', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('redacted stop reaction disappears in-session, after reopen, and after reload', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const stopKey = '🛑';
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-207 Stop Emoji ${stamp}`,
      topic: 'Live fixture for stop-reaction redaction lifecycle.',
    });
    const rootId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      { msgtype: 'm.text', body: `Stop emoji thread root ${stamp}` },
      'cinny-207'
    );
    const streamingReplyId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: 'Streaming…',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      },
      'cinny-207'
    );
    await sendMessageEdit(
      homeserver,
      accessToken,
      roomId,
      streamingReplyId,
      `Streaming partial answer ${stamp}`,
      'cinny-207'
    );
    const reactionId = await sendReaction(
      homeserver,
      accessToken,
      roomId,
      streamingReplyId,
      stopKey,
      'cinny-207'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });

    const threadUrl = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;
    await page.goto(threadUrl);
    const replyItem = page.locator(`[data-message-id="${streamingReplyId}"]`);
    await expect(replyItem).toBeVisible({ timeout: 30_000 });
    const stopChip = replyItem.getByRole('button', { name: `${stopKey} 1` });
    await expect(stopChip).toBeVisible({ timeout: 30_000 });

    // Stream "completes": final edit + redaction of the stop reaction.
    await sendMessageEdit(
      homeserver,
      accessToken,
      roomId,
      streamingReplyId,
      `Final streamed answer ${stamp}`,
      'cinny-207'
    );
    await redactEvent(homeserver, accessToken, roomId, reactionId, 'stream finished');

    // Baseline capture so infra failures can't masquerade as the intended red.
    console.log(
      `[cinny-207] stop-emoji fixture ready: room=${roomId} reply=${streamingReplyId} reaction=${reactionId}`
    );

    // State A — in-session: the chip must disappear without any navigation.
    await expect(stopChip).toHaveCount(0, { timeout: 15_000 });

    // The cache must hold the redaction record (it is what re-redacts stale
    // un-pruned copies the homeserver may still serve) and no active copy.
    await page.waitForTimeout(2_000);
    const postRedactionRecords = await readThreadEventCacheRecords(page, roomId, rootId);
    expect(postRedactionRecords.some((record) => record.eventType === 'm.room.redaction')).toBe(
      true
    );

    // State B — reopen: leave the thread, come back, chip must stay gone.
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect(page.locator(`[data-message-id="${rootId}"]`).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.goto(threadUrl);
    await expect(replyItem).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3_000); // allow cache hydration to (incorrectly) re-aggregate
    await expect(stopChip).toHaveCount(0);

    // State C — full reload: cached shell must not resurrect the reaction.
    await page.reload();
    await expectLoggedInShellStable(page);
    await page.goto(threadUrl);
    await expect(replyItem).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    await expect(stopChip).toHaveCount(0);
  });
});
