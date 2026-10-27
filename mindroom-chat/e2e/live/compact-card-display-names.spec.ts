import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const displayName = 'Alex Morgan';

const buildThreadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

test.describe('compact card display names', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('renders room member display names in summary and reply text', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomName = `Compact card display names ${Date.now()}`;
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Live fixture for compact card Matrix ID display-name rendering.',
    });

    await sendStateEvent(homeserver, session.accessToken, roomId, 'm.room.member', session.userId, {
      membership: 'join',
      displayname: displayName,
    });

    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `Ask ${session.userId} to review the launch plan.`,
      },
      'compact-card-display-name-root'
    );
    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `Waiting for ${session.userId}.`,
        'm.relates_to': buildThreadRelation(rootId),
      },
      'compact-card-display-name-reply'
    );
    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.notice',
        body: `Ask ${session.userId} to review the launch plan.`,
        'io.mindroom.thread_summary': {
          version: 1,
          summary: `Ask ${session.userId} to review the launch plan.`,
          generated_at: '2026-07-10T12:00:00.000Z',
          message_count: 2,
        },
        'm.relates_to': buildThreadRelation(rootId),
      },
      'compact-card-display-name-summary'
    );
    await sendStateEvent(
      homeserver,
      session.accessToken,
      roomId,
      'com.mindroom.thread.tags',
      JSON.stringify([rootId, 'resolved']),
      {
        set_by: session.userId,
        set_at: '2026-08-27T12:00:00.000Z',
      }
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

    const roomLink = page.getByRole('link', { name: roomName }).first();
    await expect(roomLink).toBeVisible({ timeout: 30_000 });
    await roomLink.click();

    const threadCard = page.locator(`[data-thread-root-id="${rootId}"]`);
    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(threadCard).toBeVisible({ timeout: 30_000 });
    await expect(threadCard).toHaveAccessibleName(new RegExp(`Resolved by ${displayName}`));
    await expect(threadCard).toHaveAttribute('data-attention-state', 'resolved');
    const cardResolverByline = threadCard.locator('[data-compact-card-resolution-byline="true"]');
    await expect(cardResolverByline).toBeVisible();
    await expect(cardResolverByline).toHaveText(`Resolved by ${displayName}`);

    if (process.env.E2E_EXPECT_RAW_MATRIX_ID === '1') {
      await expect(threadCard).toContainText(session.userId);
    } else {
      await expect(threadCard).toContainText(`Ask ${displayName} to review the launch plan.`);
      await expect(threadCard).toContainText(`${displayName}: Waiting for ${displayName}.`);
      await expect(threadCard).not.toContainText(session.userId);
    }

    const screenshotVariant = process.env.E2E_SCREENSHOT_VARIANT;
    if (screenshotVariant) {
      await threadCard.screenshot({
        path: `ui-audit/compact-card-display-names-${screenshotVariant}.png`,
      });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(cardResolverByline).toBeVisible();
    await expect(cardResolverByline).toHaveText(`Resolved by ${displayName}`);
    if (screenshotVariant) {
      await threadCard.screenshot({
        path: `ui-audit/compact-card-touch-resolver-${screenshotVariant}.png`,
      });
    }

    await threadCard.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBe(rootId);

    const resolverByline = page.locator('[data-thread-resolution-byline="true"]');
    const resolvedButton = page.getByRole('button', { name: 'Resolved' });
    await resolvedButton.hover();
    await expect(page.getByRole('tooltip')).toContainText(`Resolved by ${displayName}`);
    await page.mouse.move(0, 0);
    await expect(resolverByline).toBeVisible();
    // After the title, so a separator may come first.
    await expect(resolverByline).toContainText(`by ${displayName}`);
    await expect(resolverByline).toHaveAttribute('aria-label', `Resolved by ${displayName}`);

    if (screenshotVariant) {
      await resolverByline.locator('xpath=../../..').screenshot({
        path: `ui-audit/thread-resolver-byline-${screenshotVariant}.png`,
      });
    }

    await expect(resolverByline).toBeVisible();
  });
});
