import { expect, test } from '@playwright/test';
import { createSessionId } from '../../src/app/state/sessions';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { seedThreadSummaryCache } from '../helpers/storage';

const hasCredentials = !!process.env.E2E_USERNAME;

const buildThreadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

const buildThreadSummaryContent = (
  rootId: string,
  summaryText: string,
  generatedAt: string,
  messageCount: number
) => ({
  msgtype: 'm.notice',
  body: summaryText,
  'io.mindroom.thread_summary': {
    version: 1,
    summary: summaryText,
    generated_at: generatedAt,
    message_count: messageCount,
  },
  'm.relates_to': buildThreadRelation(rootId),
});

const openRoomByName = async (page: import('@playwright/test').Page, roomName: string) => {
  const roomLink = page.getByRole('link', { name: roomName }).first();
  await expect(roomLink).toBeVisible({ timeout: 30_000 });
  await roomLink.click();
};

test.describe('live cinny-061 thread summary cache upgrade', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('shows cached summary first, then upgrades banner and compact card when a newer live summary arrives', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomName = `CINNY-061 Summary Upgrade ${stamp}`;
    const cachedSummaryText = `Cached summary ${stamp}`;
    const liveSummaryText = `Live summary ${stamp}`;
    const sessionId = createSessionId(homeserver, session.userId);

    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Live fixture for cache-first thread summary upgrades.',
    });

    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `CINNY-061 root ${stamp}`,
      },
      'cinny-061'
    );

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `CINNY-061 reply ${stamp}`,
        'm.relates_to': buildThreadRelation(rootId),
      },
      'cinny-061'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    await seedThreadSummaryCache({
      page,
      sessionId,
      roomId,
      threadRootId: rootId,
      summaryText: cachedSummaryText,
      generatedTs: Date.parse('2026-04-09T19:40:00.000Z'),
      messageCount: 12,
    });

    await openRoomByName(page, roomName);

    const threadCard = page.locator(`[data-thread-root-id="${rootId}"]`);
    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(threadCard).toBeVisible({ timeout: 30_000 });
    await expect(threadCard).toContainText(cachedSummaryText);

    await threadCard.click();

    const threadSummary = page.locator('[data-thread-context-summary="true"]').first();
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(threadSummary).toContainText(cachedSummaryText);

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      buildThreadSummaryContent(rootId, liveSummaryText, '2026-04-09T20:40:00.000Z', 18),
      'cinny-061'
    );

    await expect(threadSummary).toContainText(liveSummaryText, { timeout: 30_000 });
    await expect(threadSummary).not.toContainText(cachedSummaryText);

    await page.goBack();

    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(threadCard).toContainText(liveSummaryText, { timeout: 30_000 });
    await expect(threadCard).not.toContainText(cachedSummaryText);

    await expectNoUnexpectedBrowserDiagnostics(
      diagnostics,
      'cinny-061-thread-summary-cache-upgrade'
    );
  });
});
