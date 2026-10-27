import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { readRoomEventCacheEventIds } from '../helpers/storage';

const hasCredentials = !!process.env.E2E_USERNAME;

// CINNY-207 P0.2 → P3.3: F1 (cache write-through only existed for the
// mounted room) is fixed. `MindroomSyncEngine` attaches
// `RoomEvent.Timeline`/`RoomEvent.Redaction` listeners at the client
// scope and writes every live event through the shared write-through,
// regardless of which room is mounted. Expected green on and after
// Phase 3 (AC6). See docs/mindroom-cache-overhaul-plan.md.
test.describe('CINNY-207 background room cache freshness', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('events arriving in a background room reach its cache', async ({ page }) => {

    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomAId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-207 Foreground Room ${stamp}`,
      topic: 'Foreground room for background-freshness fixture.',
    });
    const roomBId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-207 Background Room ${stamp}`,
      topic: 'Background room for background-freshness fixture.',
    });
    const foregroundMessageBody = `Foreground message ${stamp}`;
    await sendRoomMessage(
      homeserver,
      accessToken,
      roomAId,
      { msgtype: 'm.text', body: foregroundMessageBody },
      'cinny-207'
    );
    await sendRoomMessage(
      homeserver,
      accessToken,
      roomBId,
      { msgtype: 'm.text', body: `Background seed message ${stamp}` },
      'cinny-207'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: roomAId,
      userId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });

    // Mount room A; room B stays a background room from here on.
    await page.goto(`/home/${encodeURIComponent(roomAId)}`);
    await expect(page.getByText(foregroundMessageBody)).toBeVisible({ timeout: 30_000 });

    const backgroundEventId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomBId,
      { msgtype: 'm.text', body: `Background live message ${stamp}` },
      'cinny-207'
    );

    // Let /sync deliver the background event and any write-through settle.
    await page.waitForTimeout(8_000);

    const cachedEventIds = await readRoomEventCacheEventIds(page, roomBId);
    console.log(
      `[cinny-207] background room cached events: ${cachedEventIds.length} (looking for ${backgroundEventId})`
    );
    expect(cachedEventIds).toContain(backgroundEventId);
  });
});
