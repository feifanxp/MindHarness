import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendStateEvent } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });

type MessagesPage = {
  chunk: { type: string; sender: string; content: Record<string, unknown> }[];
};

test('the jobs bar lists agents’ background jobs, cancels them, and marks the room', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `jobs_viewer_${suffix}`;
  const viewer = await register(username);
  const coder = await register(`mindroom_coder_${suffix}`);
  const researcher = await register(`mindroom_researcher_${suffix}`);
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Release prep',
    topic: 'Background jobs bar',
    rootBody: 'Run the test suite and check the changelog',
    replyBody: 'Started the suite in the background',
    invite: [coder.user_id, researcher.user_id],
  });
  await joinRoom(homeserver!, coder.access_token, fixture.roomId);
  await joinRoom(homeserver!, researcher.access_token, fixture.roomId);
  // MindRoom lets its agents publish their jobs; this room's creator does the same.
  const powerLevelsPath = `/rooms/${encodeURIComponent(fixture.roomId)}/state/m.room.power_levels`;
  const powerLevels = await matrixFetch<Record<string, unknown>>(homeserver!, powerLevelsPath, {
    accessToken: viewer.access_token,
  });
  await sendStateEvent(
    homeserver!,
    viewer.access_token,
    fixture.roomId,
    'm.room.power_levels',
    '',
    {
      ...powerLevels,
      events: {
        ...(powerLevels.events as Record<string, number>),
        'io.mindroom.background_jobs': 0,
      },
    }
  );
  const job = (jobId: string, threadId: string | null, tool: string, extra = {}) => ({
    job_id: jobId,
    thread_id: threadId,
    kind: 'tool',
    tool,
    status: 'running',
    requester_id: viewer.user_id,
    started_at: `2026-10-11T12:00:0${jobId.slice(-1)}+00:00`,
    ...extra,
  });
  const publish = (agent: typeof coder, jobs: Record<string, unknown>[]) =>
    sendStateEvent(
      homeserver!,
      agent.access_token,
      fixture.roomId,
      'io.mindroom.background_jobs',
      agent.user_id,
      { jobs }
    );
  const coderJobs = [
    job('job_1', fixture.rootId, 'run_tests'),
    job('job_2', fixture.rootId, 'shell', { status: 'awaiting_approval' }),
  ];
  await publish(coder, coderJobs);
  await publish(researcher, [
    job('job_3', fixture.rootId, 'research', { kind: 'subagent' }),
    job('job_4', null, 'web_search'),
  ]);

  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [homeserver],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });

  // The room list marks the room while it has jobs.
  await expect(page.getByLabel('Background jobs running')).toBeVisible();

  // The thread shows its own three jobs, not the main timeline's.
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
  const bar = page.getByRole('region', { name: '3 background jobs' });
  await expect(bar).toBeVisible();
  // Several jobs show as one line. A resting mouse lists them over the timeline, without growing
  // the footer (the timeline pads itself for the footer, so it would move under the pointer).
  const footer = page.locator('[data-room-footer="true"]');
  const footerHeight = () => footer.evaluate((element) => element.getBoundingClientRect().height);
  const collapsedHeight = await footerHeight();
  await expect(bar.getByRole('listitem')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('desktop-collapsed-light.png') });
  const title = bar.getByRole('button', { name: '3 background jobs' });
  await title.hover();
  await expect(bar.getByRole('listitem')).toHaveCount(3);
  expect(await footerHeight()).toBe(collapsedHeight);
  await page.mouse.move(0, 0);
  await expect(bar.getByRole('listitem')).toHaveCount(0);
  // From the keyboard, the jobs come right after the title, before Stop all.
  await title.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(bar.getByRole('button', { name: 'Stop run_tests' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(title).toBeFocused();
  await expect(bar.getByRole('listitem')).toHaveCount(0);
  // Pressing the title keeps them listed.
  await title.click();
  await page.mouse.move(0, 0);
  await expect(bar).toContainText('run_tests');
  await expect(bar.getByRole('listitem').filter({ hasText: 'shell' })).toContainText(
    'Waiting for approval'
  );
  await expect(bar).toContainText('research (subagent)');
  await expect(bar).not.toContainText('web_search');
  await page.screenshot({ path: testInfo.outputPath('desktop-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('desktop-dark.png') });

  // Stop sends the job's cancel in its thread, and the job shows Stopping… until it leaves the state.
  await bar.getByRole('button', { name: 'Stop run_tests' }).click();
  await expect(bar).toContainText('Stopping…');
  await expect
    .poll(async () => {
      const messages = await matrixFetch<MessagesPage>(
        homeserver!,
        `/rooms/${encodeURIComponent(fixture.roomId)}/messages?dir=b&limit=20`,
        { accessToken: viewer.access_token }
      );
      return messages.chunk
        .filter((event) => event.type === 'io.mindroom.background_job_cancel')
        .map((event) => ({ sender: event.sender, content: event.content }));
    })
    .toEqual([
      {
        sender: viewer.user_id,
        content: {
          job_id: 'job_1',
          'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
        },
      },
    ]);
  await publish(coder, [{ ...coderJobs[0], status: 'cancel_requested' }, coderJobs[1]]);
  await expect(bar.getByRole('button', { name: 'Stop run_tests' })).toHaveCount(0);
  // A job cancelled from another client shows Stopping… here too, without its Stop.
  const researchCancel = bar.getByRole('button', { name: 'Stop research (subagent)' });
  await expect(researchCancel).toBeVisible();
  await publish(researcher, [
    job('job_3', fixture.rootId, 'research', { kind: 'subagent', status: 'cancel_requested' }),
    job('job_4', null, 'web_search'),
  ]);
  await expect(researchCancel).toHaveCount(0);
  await publish(researcher, [
    job('job_3', fixture.rootId, 'research', { kind: 'subagent' }),
    job('job_4', null, 'web_search'),
  ]);
  await publish(coder, [coderJobs[1]]);
  await expect(page.getByRole('region', { name: '2 background jobs' })).not.toContainText(
    'run_tests'
  );

  // The main timeline shows every job of the room.
  await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
  const room = page.getByRole('region', { name: '3 background jobs' });
  await room.getByRole('button', { name: '3 background jobs' }).click();
  await expect(room).toContainText('web_search');

  // On a phone, the bar sits above the composer in light and dark.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByRole('region', { name: '2 background jobs' })).toBeVisible();
  await expect(page.getByText(/^Catching up/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('phone-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('phone-light.png') });
  // On a phone, a tap on the title lists the jobs.
  await page
    .getByRole('region', { name: '2 background jobs' })
    .getByRole('button', { name: '2 background jobs' })
    .click();
  await expect(
    page.getByRole('region', { name: '2 background jobs' }).getByRole('listitem')
  ).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('phone-listed-light.png') });

  // A long tool name is cut short and many jobs scroll inside the bar, so every Stop stays reachable.
  const longTool = 'mcp_github_create_pull_request_review_with_inline_comments';
  await publish(
    researcher,
    Array.from({ length: 14 }, (_, index) =>
      job(`job_${index + 5}`, fixture.rootId, index === 0 ? longTool : `tool_${index}`)
    )
  );
  const crowded = page.getByRole('region', { name: '15 background jobs' });
  await expect(crowded).toBeVisible();
  const longCancel = crowded.getByRole('button', { name: `Stop ${longTool}` });
  await longCancel.scrollIntoViewIfNeeded();
  const cancelBox = await longCancel.boundingBox();
  expect(cancelBox && cancelBox.x + cancelBox.width).toBeLessThanOrEqual(390);
  const barBox = await crowded.boundingBox();
  expect(barBox && barBox.height).toBeLessThan(844 / 2);
  await expect(crowded.getByRole('button', { name: 'Stop all' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('phone-many-jobs.png') });

  // A single job with a long name keeps its title and its Stop on screen too.
  await publish(coder, []);
  await publish(researcher, [job('job_5', fixture.rootId, longTool)]);
  const single = page.getByRole('region', { name: `Running: ${longTool}` });
  await expect(single).toBeVisible();
  const singleBox = await single.boundingBox();
  expect(singleBox && singleBox.x + singleBox.width).toBeLessThanOrEqual(390);
  await expect(single.getByRole('button', { name: `Stop ${longTool}` })).toBeInViewport();

  // When the last job ends, the bar goes away.
  await publish(coder, []);
  await publish(researcher, []);
  await expect(
    page.getByRole('region', { name: /background jobs|Running|Waiting|Stopping/ })
  ).toHaveCount(0);
});
