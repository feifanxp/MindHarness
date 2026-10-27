import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
} from '../helpers/matrix';

test.use({ viewport: { width: 1100, height: 760 } });
test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');

test('approval attention settles, stops on review, and respects actionability and reduced motion', async ({
  page,
}) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const router = await registerAgentAccount(homeserver, 'router');
  const roomName = `Approval attention ${Date.now()}`;
  const fixture = await createThreadFixture(homeserver, session.accessToken, {
    name: roomName,
    topic: 'Local approval attention check',
    rootBody: 'Save the project notes',
    replyBody: 'The notes are ready. I will ask before saving them.',
    invite: [router.userId],
  });
  await joinRoom(homeserver, router.accessToken, fixture.roomId);
  const sendApproval = async (id: string, approver = session.userId) => {
    await matrixFetch(
      homeserver,
      `/rooms/${encodeURIComponent(fixture.roomId)}/send/io.mindroom.tool_approval/${id}`,
      {
        method: 'PUT',
        accessToken: router.accessToken,
        body: JSON.stringify({
          msgtype: 'io.mindroom.tool_approval',
          body: 'Approval required: save_note',
          approval_id: id,
          tool_name: 'save_note',
          agent_name: 'assistant',
          status: 'pending',
          approvable: true,
          approver_user_id: approver,
          requester_id: session.userId,
          approval_scope: {
            id: 'save-note',
            entity_name: 'assistant',
            invoking_agent: 'assistant',
            operation: { tool_name: 'save_note' },
          },
          arguments: { title: 'Project notes', text: 'Ready for the next meeting.' },
          requested_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          thread_id: fixture.rootId,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: fixture.rootId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: fixture.rootId },
          },
        }),
      }
    );
  };

  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({
    page,
    roomId: fixture.roomId,
    userId: session.userId,
    viewMode: 'compact',
  });
  await page.getByRole('link', { name: roomName, exact: true }).first().click();
  await page.locator(`[data-thread-root-id="${fixture.rootId}"]`).click();

  await sendApproval('first');
  const bar = page.getByRole('region', { name: 'Thread approvals' });
  const review = bar.getByRole('button', { name: /^Review/ });
  const reviewDialog = page.getByRole('dialog', { name: /^assistant wants to do \d+ things?$/ });
  await expect(review).toBeVisible();
  const animations = () => review.evaluate((el) => el.getAnimations({ subtree: true }).length);
  await expect.poll(animations).toBe(1);
  await expect(bar.getByRole('status')).toHaveText('assistant is waiting for you · save_note');
  const bounds = await review.boundingBox();
  const timing = await review.evaluate((el) =>
    el.getAnimations({ subtree: true })[0].effect!.getTiming()
  );
  expect(Number(timing.duration) * timing.iterations).toBe(4000);
  expect(timing.iterations).toBe(2);
  await expect.poll(animations, { timeout: 6000 }).toBe(0);
  const halo = await review.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(halo).not.toBe('none');
  expect(await review.boundingBox()).toEqual(bounds);

  await review.click();
  await reviewDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(animations).toBe(0);
  await expect(review).toHaveCSS('box-shadow', halo);

  await sendApproval('second');
  await expect(review).toHaveText('Review 2');
  await expect.poll(animations).toBe(1);
  await review.click();
  await expect.poll(animations).toBe(0);
  // Requests arriving during review must not animate when the dialog closes.
  await sendApproval('third');
  await expect(review).toHaveText('Review 3');
  await reviewDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(animations).toBe(0);
  await expect(review).toHaveCSS('box-shadow', halo);

  await review.click();
  await page.getByRole('button', { name: 'Approve all 3 once', exact: true }).click();
  await expect(bar).toContainText('3 calls awaiting confirmation');
  await reviewDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(review).not.toHaveCSS('box-shadow', halo);
  await expect.poll(animations).toBe(0);

  // Another person's pending decision must not ask this user for attention.
  await sendApproval('other-approver', '@other:matrix.localhost');
  await expect(review).toHaveText('Review 4');
  await expect(review).not.toHaveCSS('box-shadow', halo);
  await expect.poll(animations).toBe(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sendApproval('reduced-motion');
  await expect(review).toHaveText('Review 5');
  await expect(review).toHaveCSS('box-shadow', halo);
  await expect.poll(animations).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(review).not.toHaveCSS('box-shadow', halo);
  await expect(review).not.toHaveCSS('box-shadow', 'none');
  await expect.poll(animations).toBe(0);
});
