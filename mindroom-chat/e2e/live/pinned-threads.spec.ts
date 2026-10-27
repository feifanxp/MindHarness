import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

test.describe('pinned announcement threads', () => {
  test.skip(!process.env.E2E_USERNAME, 'Local Matrix credentials required');

  test('admins pin and unpin, pins stay ordered and open, moderators cannot manage them', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const secondary = getSecondaryCredentials();
    test.skip(!secondary, 'A second account is required');
    const owner = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const moderator = await loginToMatrix(homeserver, secondary!.username, secondary!.password);
    const roomName = `Pinned announcements ${Date.now()}`;
    const roomId = await createPrivateRoom(homeserver, owner.accessToken, {
      name: roomName,
      invite: [moderator.userId],
    });
    const roomPath = `/rooms/${encodeURIComponent(roomId)}`;
    await matrixFetch(homeserver, `${roomPath}/join`, {
      method: 'POST',
      accessToken: moderator.accessToken,
      body: '{}',
    });
    const powers = await matrixFetch<{ users: Record<string, number> }>(
      homeserver,
      `${roomPath}/state/m.room.power_levels`,
      { accessToken: owner.accessToken }
    );
    await matrixFetch(homeserver, `${roomPath}/state/m.room.power_levels`, {
      method: 'PUT',
      accessToken: owner.accessToken,
      body: JSON.stringify({ ...powers, users: { ...powers.users, [moderator.userId]: 50 } }),
    });
    const first = await sendRoomMessage(homeserver, owner.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'MindRoom updates',
    });
    const second = await sendRoomMessage(homeserver, owner.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Room guidelines',
    });
    await loginWithPassword(page, { homeserver, ...credentials });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId: owner.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const overviewUrl = page.url();
    const card = (id: string) => page.locator(`[data-thread-root-id="${id}"]`);
    for (const id of [first, second]) {
      await expect(card(id)).toBeVisible();
      await card(id).hover();
      await card(id).locator('..').getByRole('button', { name: 'Pin thread', exact: true }).click();
      await expect(
        page.locator('[data-pinned-threads="true"]').locator(`[data-thread-root-id="${id}"]`)
      ).toBeVisible();
    }
    const pins = page.locator('[data-pinned-threads="true"]');
    await expect(pins.locator('[data-thread-root-id]')).toHaveCount(2);
    const pinOrder = () =>
      pins
        .locator('[data-thread-root-id]')
        .evaluateAll((cards) => cards.map((entry) => entry.getAttribute('data-thread-root-id')));
    expect(await pinOrder()).toEqual([second, first]);
    await page.screenshot({ path: testInfo.outputPath('pinned-desktop.png') });
    await sendRoomMessage(homeserver, owner.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'An update reply',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: first,
        is_falling_back: true,
        'm.in_reply_to': { event_id: first },
      },
    });
    await matrixFetch(
      homeserver,
      `${roomPath}/state/com.mindroom.thread.tags/${encodeURIComponent(
        JSON.stringify([first, 'resolved'])
      )}`,
      {
        method: 'PUT',
        accessToken: owner.accessToken,
        body: JSON.stringify({ set_by: owner.userId, set_at: new Date().toISOString() }),
      }
    );
    await page.reload();
    await expect(pins.locator('[data-thread-root-id]')).toHaveCount(2);
    expect(await pinOrder()).toEqual([second, first]);
    await expect(pins.locator('[data-compact-thread-resolve]')).toHaveCount(0);
    await card(first).click();
    await expect(page.getByRole('button', { name: 'Unpin thread', exact: true })).toBeVisible();
    await expect(page.getByText('Pinned', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('pinned-banner-admin.png') });
    await expect(page.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resolved', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Unpin thread', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resolved', exact: true })).toBeVisible();

    const context = await browser.newContext();
    const memberPage = await context.newPage();
    try {
      await loginWithPassword(memberPage, { homeserver, ...secondary! });
      await expectLoggedInShellStable(memberPage);
      await seedRoomOverviewState({
        page: memberPage,
        roomId,
        userId: moderator.userId,
        viewMode: 'compact',
        filterState: createDefaultThreadFilterState(),
      });
      await memberPage.goto(overviewUrl);
      const pinnedCard = memberPage.locator(
        `[data-pinned-threads="true"] [data-thread-root-id="${second}"]`
      );
      await expect(pinnedCard).toBeVisible();
      await pinnedCard.hover();
      await expect(memberPage.locator('[data-compact-thread-pin]')).toHaveCount(0);
      await expect(
        memberPage.locator('[data-pinned-threads="true"] [data-compact-thread-resolve]')
      ).toHaveCount(0);
      await pinnedCard.click();
      await expect(
        memberPage.getByRole('button', { name: /^(Unpin thread|Pin thread|Resolve|Resolved)$/ })
      ).toHaveCount(0);
      await expect(memberPage.getByRole('img', { name: 'Pinned', exact: true })).toBeVisible();
      await expect(memberPage.getByText('Pinned', { exact: true })).toHaveCount(0);
      await memberPage.screenshot({ path: testInfo.outputPath('pinned-banner-member.png') });
    } finally {
      await context.close();
    }
    const afterPowers = await matrixFetch(homeserver, `${roomPath}/state/m.room.power_levels`, {
      accessToken: owner.accessToken,
    });
    expect(afterPowers).toEqual({ ...powers, users: { ...powers.users, [moderator.userId]: 50 } });
  });

  test('finds an old zero-reply pin outside the initial room timeline', async ({
    page,
  }, testInfo) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const owner = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const roomName = `Old announcement ${Date.now()}`;
    const roomId = await createPrivateRoom(homeserver, owner.accessToken, { name: roomName });
    const root = await sendRoomMessage(homeserver, owner.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Persistent room announcement',
    });
    for (let index = 0; index < 60; index += 1) {
      await sendRoomMessage(homeserver, owner.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Later discussion ${index}`,
      });
    }
    await matrixFetch(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events`,
      {
        method: 'PUT',
        accessToken: owner.accessToken,
        body: JSON.stringify({ pinned: [root] }),
      }
    );
    await loginWithPassword(page, { homeserver, ...credentials });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId: owner.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const pin = page.locator(`[data-pinned-threads="true"] [data-thread-root-id="${root}"]`);
    await expect(pin).toContainText('Persistent room announcement');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(pin).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('pinned-mobile.png') });
    await pin.click();
    await expect(page.getByRole('button', { name: 'Unpin thread', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(0);
  });
});
