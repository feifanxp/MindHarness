import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { openSettingsFromAccountRail } from './helpers/accounts';

// Only this explicit fixture file enables the spec. Never use the default homeserver.
const fixturePath = process.env.E2E_COMPUTER_FIXTURE;
type Fixture = {
  api_origin: string;
  ui_origin: string;
  homeserver: string;
  room_id: string;
  thread_id: string;
  agent_user_id: string;
  viewer: { username: string; password: string; access_token: string; user_id: string };
};

const requireLoopback = (origin: string) => {
  const url = new URL(origin);
  expect(url.protocol).toBe('http:');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
};

test('watch, type, resume in the originating thread, and recover on desktop/mobile', async ({
  page,
  context,
  request,
}, testInfo) => {
  test.skip(!fixturePath, 'Set E2E_COMPUTER_FIXTURE to the isolated local gateway fixture JSON.');
  const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8')) as Fixture;
  [fixture.api_origin, fixture.ui_origin, fixture.homeserver].forEach(requireLoopback);
  expect(testInfo.project.use.baseURL).toBe(fixture.ui_origin);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const continuations: { eventId: string; content: Record<string, unknown> }[] = [];
  page.on('response', async (response) => {
    if (!response.url().includes('/send/m.room.message/') || !response.ok()) return;
    const content = response.request().postDataJSON() as Record<string, unknown>;
    const { event_id: eventId } = await response.json();
    continuations.push({ eventId, content });
  });
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [fixture.homeserver],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
        mindroom: { ...config.mindroom, computers: { apiUrl: '' } },
      },
    });
  });
  await loginWithPassword(page, { homeserver: fixture.homeserver, ...fixture.viewer });
  await page.goto(
    '/home/' +
      encodeURIComponent(fixture.room_id) +
      '?threadId=' +
      encodeURIComponent(fixture.thread_id)
  );
  // No agent showed this computer, so only the room menu offers it; the header button follows once it is open.
  const showComputer = page.getByRole('button', { name: 'Show Computer', exact: true });
  const showComputerFromMenu = async () => {
    await page.getByRole('button', { name: 'More Options', exact: true }).click();
    await showComputer.click();
  };
  // Leave Room is always in the menu, so an absent entry is not just a menu that has not rendered.
  const expectNoShowComputerInMenu = async () => {
    await page.getByRole('button', { name: 'More Options', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Leave Room', exact: true })).toBeVisible();
    await expect(showComputer).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Leave Room', exact: true })).toHaveCount(0);
  };
  await expectNoShowComputerInMenu();
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'General', exact: true }).click();
  const serviceInput = page.getByRole('textbox', { name: 'Computer service URL', exact: true });
  await serviceInput.fill(fixture.api_origin);
  await page.getByRole('button', { name: 'Save computer service', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Computer service saved.' })
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'More Options', exact: true }).click();
  await expect(showComputer).toBeVisible();
  await showComputer.click();
  const panel = page.getByRole('complementary', { name: 'Computer panel' });
  await expect(panel.getByText('Watch mode', { exact: true })).toBeVisible();
  const canvas = panel.locator('[data-mindroom-computer-input] canvas');
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const c = element as HTMLCanvasElement;
        return Array.from(c.getContext('2d')!.getImageData(1200, 700, 1, 1).data);
      })
    )
    .toEqual([17, 51, 85, 255]);
  const desktop = await panel.boundingBox();
  expect(desktop!.x).toBeGreaterThan(500);
  expect(desktop!.width).toBeLessThan(800);
  expect(desktop!.x + desktop!.width).toBeLessThanOrEqual(1600);
  await page.screenshot({ path: testInfo.outputPath('desktop-watch.png') });

  await panel.getByRole('button', { name: 'Take control', exact: true }).click();
  await expect(panel.getByText('You have control', { exact: true })).toBeVisible();
  const bounds = await canvas.boundingBox();
  // The fixture input lies at these framebuffer coordinates, before noVNC scaling.
  await page.mouse.click(
    bounds!.x + (150 * bounds!.width) / 1280,
    bounds!.y + (440 * bounds!.height) / 800
  );
  await page.keyboard.press('Control+a');
  await page.keyboard.type('typed-through-chat');
  await panel.getByRole('button', { name: 'Resume agent', exact: true }).click();
  await expect(panel.getByText('Watch mode', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const response = await request.get(fixture.api_origin + '/fixture/text');
      expect(response.ok()).toBe(true);
      const readback = await response.json();
      return {
        value: readback.value,
        snapshotHasTypedValue: readback.snapshot.includes('typed-through-chat'),
      };
    })
    .toEqual({ value: 'typed-through-chat', snapshotHasTypedValue: true });
  // Capture the completed native input after the agent sees it and Watch reconnects.
  await page.screenshot({ path: testInfo.outputPath('desktop-resumed.png') });
  await panel.getByRole('button', { name: 'Take control', exact: true }).click();
  await expect(panel.getByText('You have control', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-control.png') });
  await expect.poll(() => continuations.length).toBe(1);
  const continuation = continuations[0];
  expect(continuation.content['m.mentions']).toEqual({ user_ids: [fixture.agent_user_id] });
  expect(continuation.content['m.relates_to']).toMatchObject({
    rel_type: 'm.thread',
    event_id: fixture.thread_id,
  });
  const eventResponse = await request.get(
    fixture.homeserver +
      '/_matrix/client/v3/rooms/' +
      encodeURIComponent(fixture.room_id) +
      '/event/' +
      encodeURIComponent(continuation.eventId),
    { headers: { Authorization: 'Bearer ' + fixture.viewer.access_token } }
  );
  expect(eventResponse.ok()).toBe(true);
  expect((await eventResponse.json()).sender).toBe(fixture.viewer.user_id);
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await showComputerFromMenu();
  await expect(panel.getByText('Watch mode', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await panel.boundingBox();
  expect(mobile!.x).toBe(0);
  expect(mobile!.y).toBe(0);
  expect(mobile!.width).toBe(390);
  expect(mobile!.height).toBe(844);
  await expect(panel.getByRole('button', { name: 'Close computer', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-watch.png') });
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(panel.getByText('Computer stopped', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Start computer', exact: true }).click();
  await expect(panel.getByText('Watch mode', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await expect(serviceInput).toHaveValue(fixture.api_origin);
  await serviceInput.fill('');
  await page.getByRole('button', { name: 'Save computer service', exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-slate-editor="true"]').first()).toBeVisible();
  await expectNoShowComputerInMenu();
  expect(continuations).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});
