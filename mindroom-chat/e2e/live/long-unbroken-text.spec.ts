import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, joinRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

// Run with playwright.long-unbroken-text.config.ts: the freeze only happens in WebKit, whose
// JavaScriptCore regex engine made the rendering cost grow with the square (emoji) or cube
// (Markdown) of a whitespace-free run.

const threadRelation = (root: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: root,
    is_falling_back: true,
    'm.in_reply_to': { event_id: root },
  },
});

type StallProbe = { max: number; last: number };

/** Records the longest gap between 50 ms timer ticks, i.e. the longest main-thread block. */
const installStallProbe = (page: Page) =>
  page.addInitScript(() => {
    const probe = { max: 0, last: performance.now() };
    (window as typeof window & { stallProbe?: StallProbe }).stallProbe = probe;
    setInterval(() => {
      const now = performance.now();
      probe.max = Math.max(probe.max, now - probe.last);
      probe.last = now;
    }, 50);
  });

const resetStall = (page: Page) =>
  page.evaluate(() => {
    (window as typeof window & { stallProbe?: StallProbe }).stallProbe!.max = 0;
  });

const readStall = (page: Page) =>
  page.evaluate(() => (window as typeof window & { stallProbe?: StallProbe }).stallProbe!.max);

test('agent replies with long whitespace-free text render without blocking the page', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const agentCredentials = getSecondaryCredentials();
  test.skip(!agentCredentials, 'Needs E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD.');
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const agent = await loginToMatrix(
    homeserver,
    agentCredentials!.username,
    agentCredentials!.password
  );
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Long unbroken text ${Date.now()}`,
    topic: 'Agent replies with long whitespace-free text',
    invite: [agent.userId],
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  const root = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Root',
  });
  await sendRoomMessage(homeserver, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'First answer',
    ...threadRelation(root),
  });

  await installStallProbe(page);
  await loginWithPassword(page, { homeserver, ...credentials });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(root)}`);
  await expect(page.getByText('First answer')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2_000);

  // A formatted reply whose code block holds one 38 kB line of compact JSON
  // (blocked WebKit for 12.6 s before the fix).
  const json = JSON.stringify(
    Array.from({ length: 900 }, (_, index) => ({ file_name: `src/app/f_${index}.ts`, ok: true }))
  );
  await resetStall(page);
  await sendRoomMessage(homeserver, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Result',
    format: 'org.matrix.custom.html',
    formatted_body: `<p>Result:</p><pre><code>${json}</code></pre><p>JSON reply shown</p>`,
    ...threadRelation(root),
  });
  await expect(page.getByText('JSON reply shown')).toBeVisible({ timeout: 240_000 });
  await page.waitForTimeout(1_000);
  expect(await readStall(page)).toBeLessThan(1_000);

  // The body-only preview MindRoom sends for a reply over the event size limit, holding 4.6 kB of
  // comma-separated paths; its Markdown preview blocked WebKit for 59.1 s before the fix.
  const paths = Array.from({ length: 140 }, (_, index) => `/src/app/dir_${index}/file_${index}.ts`);
  const body = `Large reply shown ${paths.join(',')}`;
  const upload = await fetch(
    `${homeserver}/_matrix/media/v3/upload?filename=message-content.json`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${agent.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.text', body }),
    }
  );
  expect(upload.status).toBe(200);
  const sidecar = (await upload.json()) as { content_uri: string };
  expect(sidecar.content_uri).toMatch(/^mxc:\/\//);
  await resetStall(page);
  await sendRoomMessage(homeserver, agent.accessToken, roomId, {
    msgtype: 'm.file',
    body,
    filename: 'message-content.json',
    url: sidecar.content_uri,
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    ...threadRelation(root),
  });
  await expect(page.getByText('Large reply shown').first()).toBeVisible({ timeout: 240_000 });
  await page.waitForTimeout(2_000);
  expect(await readStall(page)).toBeLessThan(1_000);
});
