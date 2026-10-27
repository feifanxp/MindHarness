import { expect, test } from '@playwright/test';
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

test.describe('live cinny-060 thread summary consistency', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('room overview and thread banner both show the latest thread summary after reloads', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomName = `CINNY-060 Summary ${stamp}`;
    const olderSummaryText = `One-line thread summary ${stamp}`;
    const latestSummaryText = [
      '## Summary',
      '',
      `I've completed a massive parallel code review ${stamp}.`,
      'Latest thread summary should win everywhere.',
    ].join('\n');
    const latestSummaryLead = `I've completed a massive parallel code review ${stamp}.`;

    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Live fixture for thread summary consistency across room and thread surfaces.',
    });

    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `CINNY-060 root ${stamp}`,
      },
      'cinny-060'
    );

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `CINNY-060 reply ${stamp}`,
        'm.relates_to': buildThreadRelation(rootId),
      },
      'cinny-060'
    );

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      buildThreadSummaryContent(rootId, olderSummaryText, '2026-04-09T19:40:00.000Z', 144),
      'cinny-060'
    );

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      buildThreadSummaryContent(rootId, latestSummaryText, '2026-04-09T20:40:00.000Z', 151),
      'cinny-060'
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

    await openRoomByName(page, roomName);

    const threadCard = page.locator(`[data-thread-root-id="${rootId}"]`);
    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(threadCard).toBeVisible({ timeout: 30_000 });
    await expect(threadCard).toContainText(latestSummaryLead);
    await expect(threadCard).not.toContainText(olderSummaryText);

    await page.reload();
    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(threadCard).toBeVisible({ timeout: 30_000 });
    await expect(threadCard).toContainText(latestSummaryLead);
    await expect(threadCard).not.toContainText(olderSummaryText);

    await threadCard.click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('threadId'), {
        timeout: 10_000,
        message: 'Thread card should open the target thread view',
      })
      .toBe(rootId);

    const threadSummary = page.locator('[data-thread-context-summary="true"]').first();
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(threadSummary).toContainText(latestSummaryLead);
    await expect(threadSummary).not.toContainText(olderSummaryText);

    await page.reload();
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await expect(threadSummary).toContainText(latestSummaryLead);
    await expect(threadSummary).not.toContainText(olderSummaryText);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-060-thread-summary-consistency');
  });
});
