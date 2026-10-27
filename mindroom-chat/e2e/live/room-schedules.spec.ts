import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';

test.describe('room schedules in the chat header', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');

  test('opens schedules on desktop and mobile, follows sync, and navigates to the thread', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(
      homeserver,
      credentials.username,
      credentials.password
    );
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `Room schedules ${Date.now()}`,
      topic: 'Schedule viewer integration test',
    });
    await sendStateEvent(homeserver, accessToken, roomId, 'm.room.member', userId, {
      membership: 'join',
      displayname: 'Schedule creator',
    });
    const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Plan the weekly report',
    });
    const content = {
      status: 'pending',
      created_at: '2026-09-15T12:00:00Z',
      workflow: JSON.stringify({
        schedule_type: 'once',
        execute_at: '2099-01-01T12:00:00Z',
        message: 'Summarize the weekly report',
        description: 'Weekly report',
        model: 'cheap',
        thread_id: rootId,
        new_thread: false,
        created_by: userId,
      }),
    };
    // The client lists only schedules a MindRoom account wrote, as the backend runs only those.
    const agent = await registerAgentAccount(homeserver, 'scheduler');
    const roomPath = `/rooms/${encodeURIComponent(roomId)}`;
    const addAgent = async () => {
      await matrixFetch(homeserver, `${roomPath}/invite`, {
        method: 'POST',
        accessToken,
        body: JSON.stringify({ user_id: agent.userId }),
      });
      await joinRoom(homeserver, agent.accessToken, roomId);
    };
    const removeAgent = () =>
      matrixFetch(homeserver, `${roomPath}/leave`, {
        method: 'POST',
        accessToken: agent.accessToken,
        body: '{}',
      });
    await addAgent();
    const powers = await matrixFetch<{ users: Record<string, number> }>(
      homeserver,
      `${roomPath}/state/m.room.power_levels`,
      { accessToken }
    );
    await matrixFetch(homeserver, `${roomPath}/state/m.room.power_levels`, {
      method: 'PUT',
      accessToken,
      body: JSON.stringify({ ...powers, users: { ...powers.users, [agent.userId]: 50 } }),
    });
    await sendStateEvent(
      homeserver,
      agent.accessToken,
      roomId,
      'com.mindroom.scheduled.task',
      'weekly-report',
      content
    );
    await removeAgent();
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const trigger = page.getByRole('button', { name: 'Scheduled tasks (1)', exact: true });
    await expect(page.getByText('Schedule viewer integration test', { exact: true })).toBeVisible();
    await expect(trigger).toHaveCount(0);
    await addAgent();
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Scheduled tasks', exact: true });
    await expect(dialog.getByText('Summarize the weekly report', { exact: true })).toBeVisible();
    await expect(dialog.getByText('cheap', { exact: true })).toBeVisible();
    const creator = dialog.getByRole('link', { name: '@Schedule creator', exact: true });
    await expect(creator).toHaveAttribute('title', userId);
    await expect(creator).toHaveAttribute('href', `https://matrix.to/#/${userId}`);
    const shareProfile = page.getByRole('button', { name: 'Share', exact: true });
    await creator.click();
    await expect(shareProfile).toBeVisible();
    await shareProfile.focus();
    await expect(shareProfile).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(shareProfile).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(creator).toBeFocused();
    await creator.press('Enter');
    await expect(shareProfile).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(shareProfile).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Open thread', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBe(rootId);

    await page.setViewportSize({ width: 320, height: 720 });
    await expect(trigger).toBeInViewport();
    await trigger.click();
    await expect(dialog.getByText('Weekly report', { exact: true })).toBeVisible();
    await creator.click();
    await expect(shareProfile).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(shareProfile).toHaveCount(0);
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    const workflow = JSON.parse(content.workflow);
    await sendStateEvent(
      homeserver,
      agent.accessToken,
      roomId,
      'com.mindroom.scheduled.task',
      'weekly-report',
      {
        ...content,
        workflow: JSON.stringify({ ...workflow, model: 'premium' }),
        updated_at: '2026-09-16T12:00:00Z',
      }
    );
    await expect(dialog.getByText('premium', { exact: true })).toBeVisible();
    await expect(dialog.getByText('cheap', { exact: true })).toHaveCount(0);
    await expect(dialog.locator('time[datetime="2026-09-16T12:00:00.000Z"]')).toBeVisible();
    await sendStateEvent(
      homeserver,
      agent.accessToken,
      roomId,
      'com.mindroom.scheduled.task',
      'weekly-report',
      { ...content, workflow: JSON.stringify({ ...workflow, model: null }) }
    );
    await expect(
      dialog.getByText('From agent, room, or thread settings', { exact: true })
    ).toBeVisible();
    await expect(dialog.getByText('premium', { exact: true })).toHaveCount(0);
    await sendStateEvent(
      homeserver,
      agent.accessToken,
      roomId,
      'com.mindroom.scheduled.task',
      'weekly-report',
      { ...content, status: 'cancelled' }
    );
    await expect(
      dialog.getByText('No scheduled tasks in this room.', { exact: true })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Scheduled tasks (0)', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Scheduled tasks (0)', exact: true }).click();
    await removeAgent();
    await expect(page.getByRole('button', { name: /^Scheduled tasks \(/ })).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
  });
});
