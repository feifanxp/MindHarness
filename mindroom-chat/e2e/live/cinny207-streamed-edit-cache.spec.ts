import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendMessageEdit,
  sendRoomMessage,
} from '../helpers/matrix';
import { readThreadEventCacheRecords } from '../helpers/storage';

const hasCredentials = !!process.env.E2E_USERNAME;
const EDIT_COUNT = 25;

// CINNY-207 P1.4 (AC4): edit compaction at the write boundary. Streaming a
// message with N edits must produce exactly one cached record for the logical
// message (the target with the bundled latest edit in
// `unsigned['m.relations']['m.replace']`) plus at most the root event; reload
// must paint the final content. Was P0.2-red (test.fail); flipped to real
// green in P1.4. Round-1 review rework: the edits are sent while the client
// session is LIVE (so the editCompactionScheduler path actually runs, not
// just backfill serialization), cache records and probe counters are
// asserted BEFORE the reload, and the cached record's bundled edit content
// is checked against the final body. The post-reload paint check still runs
// with the network up — a cache-only paint proof needs the AC1 harness
// (offline reload), which lands with the Phase 3 background-freshness work.
test.describe('CINNY-207 streamed edit cache compaction', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('a streamed message leaves one cached record with the final content', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-207 Streamed Edits ${stamp}`,
      topic: 'Live fixture for streamed-edit cache compaction.',
    });
    const rootId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      { msgtype: 'm.text', body: `Streamed edits thread root ${stamp}` },
      'cinny-207'
    );
    const replyId = await sendRoomMessage(
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

    // Log in and open the thread FIRST, so the streaming edits below arrive
    // as live events and exercise the compaction scheduler.
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
    const replyItem = page.locator(`[data-message-id="${replyId}"]`);
    await expect(replyItem).toBeVisible({ timeout: 30_000 });

    let streamedBody = '';
    for (let editIndex = 1; editIndex <= EDIT_COUNT; editIndex += 1) {
      streamedBody = `Streamed content ${stamp} token-${editIndex}`;
      // Sequential sends emulate MindRoom streaming (placeholder + rapid edits).
      // eslint-disable-next-line no-await-in-loop
      await sendMessageEdit(homeserver, accessToken, roomId, replyId, streamedBody, 'cinny-207');
    }
    const finalBody = streamedBody;
    await expect(replyItem.getByText(finalBody)).toBeVisible({ timeout: 30_000 });

    // Let the trailing compaction debounce (1 s) fire and the write settle.
    await page.waitForTimeout(3_000);

    // The live compaction path must have fired at least once, and the cache
    // must hold the compacted shape BEFORE any reload-time cleanup runs.
    const probeCounters = await page.evaluate(
      () =>
        (
          window as Window & {
            __MINDROOM_CACHE_PROBE__?: { snapshot: () => Record<string, number> };
          }
        ).__MINDROOM_CACHE_PROBE__?.snapshot() ?? {}
    );
    expect(probeCounters.editCompactions ?? 0).toBeGreaterThanOrEqual(1);

    const liveCachedRecords = await readThreadEventCacheRecords(page, roomId, rootId);
    console.log(
      `[cinny-207] live thread cache records: total=${liveCachedRecords.length} probe=${JSON.stringify(
        probeCounters
      )}`
    );
    const liveReplyRecord = liveCachedRecords.find((record) => record.eventId === replyId);
    expect(liveReplyRecord).toBeDefined();
    // The compacted target record must carry the FINAL edit content bundled
    // into unsigned['m.relations']['m.replace'] — this is the storage claim
    // AC4 actually makes.
    expect(liveReplyRecord?.bundledReplaceBody).toBe(finalBody);
    const liveStandaloneReplaceRecords = liveCachedRecords.filter(
      (record) => record.eventId !== replyId && record.eventId !== rootId
    );
    expect(liveStandaloneReplaceRecords).toEqual([]);

    // Reload and confirm the shell paints the final content, not the
    // placeholder (network up; see header comment for the cache-only proof).
    await page.reload();
    await expectLoggedInShellStable(page);
    await page.goto(threadUrl);
    await expect(replyItem).toBeVisible({ timeout: 30_000 });
    await expect(replyItem.getByText(finalBody)).toBeVisible({ timeout: 30_000 });

    // Post-reload the compacted shape must survive (lazy cleanup must not
    // have dropped the bundled edit).
    const cachedRecords = await readThreadEventCacheRecords(page, roomId, rootId);
    const replyRecord = cachedRecords.find((record) => record.eventId === replyId);
    expect(replyRecord).toBeDefined();
    expect(replyRecord?.bundledReplaceBody).toBe(finalBody);
    const standaloneReplaceRecords = cachedRecords.filter(
      (record) => record.eventId !== replyId && record.eventId !== rootId
    );
    expect(standaloneReplaceRecords).toEqual([]);
  });
});
