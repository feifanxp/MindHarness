import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { alignUiActionSync } from './helpers/uiActionSync';
import { createThreadFixture, joinRoom, matrixFetch, sendRoomMessage } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

const STEP_ONE = `<p>Which plan?</p>
<button onclick="mindroom.submit({plan: 'basic'}, {label: 'Basic plan'})">Basic</button>
<button onclick="choosePro()">Pro</button>
<script>
  function choosePro() {
    // Keys out of order and a decimal: homeservers store canonical JSON and refuse decimals.
    mindroom.submit({seats: 3, plan: 'pro', price: 12.5}, {label: 'Pro plan'});
    // A later scripted submission must not replace the snapshot the user is reviewing.
    setTimeout(() => mindroom.submit({plan: 'everything'}, {label: 'Everything'}), 1000);
  }
</script>`;
const STEP_TWO = `<form data-mindroom-label="Seats chosen">
  <label>Seats <input name="seats" value="3"></label>
  <button>Continue</button>
</form>`;
const escapeAttempt = (
  exfiltrationOrigin: string,
  navigateTo: string
) => `<p id="state">Trying to leave</p>
<button onclick="location.href = '${navigateTo}'">Try navigation</button>
<script>
  fetch('${exfiltrationOrigin}/fetch').catch(() => undefined);
  const image = new Image();
  image.src = '${exfiltrationOrigin}/image';
</script>`;

test('agent canvases run sandboxed, send only confirmed answers, and update in place', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  const origin = new URL(homeserver!);
  expect(origin.protocol).toBe('http:');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(origin.hostname);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `canvas_viewer_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_canvas_${suffix}`);
  const server = viewer.user_id.slice(viewer.user_id.indexOf(':') + 1);
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Agent canvas',
    topic: 'Local canvas regression',
    rootBody: 'Help me choose a plan',
    replyBody: 'The canvas conversation',
    invite: [agent.user_id],
  });
  await joinRoom(homeserver!, agent.access_token, fixture.roomId);
  const originalTitle = 'Choose a plan with a long native panel title';
  const action = (html: string, title = originalTitle) => ({
    version: 1,
    action: 'show_canvas',
    requester_id: viewer.user_id,
    agent_user_id: agent.user_id,
    room_id: fixture.roomId,
    thread_id: fixture.rootId,
    canvas: { title, html },
  });
  const showCanvas = async (html: string) => {
    await page.bringToFront();
    const close = page.getByRole('button', { name: 'Close canvas', exact: true });
    if (await close.isVisible()) await close.focus();
    else await page.locator('[data-slate-editor="true"]').click();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    return sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body: 'Interactive panel: Choose a plan. Open it in MindRoom Chat to respond.',
      'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
      'io.mindroom.ui_action': action(html),
    });
  };
  const updateCanvas = (canvasId: string, html: string, title?: string) =>
    sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body: '* Interactive panel updated.',
      'm.new_content': {
        msgtype: 'm.notice',
        body: 'Interactive panel updated.',
        'io.mindroom.ui_action': action(html, title),
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: canvasId },
    });
  const viewerMessages = async () =>
    (
      await matrixFetch<{
        chunk: Array<{ sender: string; content: Record<string, unknown> }>;
      }>(homeserver!, `/rooms/${encodeURIComponent(fixture.roomId)}/messages?dir=b&limit=50`, {
        accessToken: viewer.access_token,
      })
    ).chunk.filter((event) => event.sender === viewer.user_id);

  // Any request reaching this server would be data leaving the canvas sandbox.
  const escapes: string[] = [];
  const listener = createServer((request, response) => {
    escapes.push(request.url ?? '');
    response.end('escaped');
  });
  await new Promise<void>((resolve) => {
    listener.listen(0, '127.0.0.1', resolve);
  });
  const exfiltrationOrigin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  test.info().attach('exfiltration-origin', { body: exfiltrationOrigin });
  // Chat's own origin and reCAPTCHA are allowed frame destinations for Chat, never for a canvas.
  const allowedOriginProbes: string[] = [];
  await context.route('**/canvas-escape-probe**', async (route) => {
    allowedOriginProbes.push(route.request().url());
    await route.fulfill({ body: 'escaped' });
  });
  await context.route('https://www.google.com/recaptcha/**', async (route) => {
    allowedOriginProbes.push(route.request().url());
    await route.fulfill({ body: 'escaped' });
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // Stand-ins for CDN libraries; a request reaching one of these routes passed the canvas policy.
  let libraries = false;
  const libraryRequests: string[] = [];
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\//, async (route) => {
    const url = route.request().url();
    libraryRequests.push(url);
    await route.fulfill(
      url.endsWith('.css')
        ? { contentType: 'text/css', body: '#library { color: rgb(1, 2, 3); }' }
        : {
            contentType: 'text/javascript',
            body: "document.getElementById('library').textContent = 'loaded';",
          }
    );
  });
  await alignUiActionSync(context, page, homeserver!);
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
        mindroom: {
          ...config.mindroom,
          canvas: { enabled: true, libraries },
          uiActions: { autoOpenFromHomeservers: [server] },
        },
      },
    });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  const waitForLiveSync = () =>
    page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/sync') && url.searchParams.get('timeout') === '30000';
    });
  const initialLiveSync = waitForLiveSync();
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
  await initialLiveSync;
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);

  // The app-wide frame policy still admits same-origin frames such as Element Call.
  const callFrameLoaded = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const frame = document.createElement('iframe');
        frame.src = '/public/element-call/index.html';
        frame.style.display = 'none';
        frame.addEventListener('load', () => {
          resolve(frame.contentWindow?.location.pathname === '/public/element-call/index.html');
          frame.remove();
        });
        document.body.appendChild(frame);
      })
  );
  expect(callFrameLoaded).toBe(true);
  // Frames from any other origin are refused before a request; reCAPTCHA registration stays allowed.
  const framePolicy = await page.evaluate(async () => {
    const violations: string[] = [];
    const record = (event: SecurityPolicyViolationEvent) => violations.push(event.blockedURI);
    document.addEventListener('securitypolicyviolation', record);
    const probe = document.createElement('iframe');
    probe.src = 'https://example.org/frame';
    probe.style.display = 'none';
    document.body.appendChild(probe);
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    probe.remove();
    document.removeEventListener('securitypolicyviolation', record);
    const policy = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content');
    return { violations, policy };
  });
  // Browsers report only the origin of a blocked cross-origin frame.
  expect(framePolicy.violations).toEqual(['https://example.org']);
  expect(framePolicy.policy).toBe(
    "frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/"
  );

  const panel = page.getByRole('complementary', { name: 'Canvas panel' });
  // The panel's frame holds a wrapper; the agent's page runs in the frame inside it.
  const wrapper = page.frameLocator('aside[aria-label="Canvas panel"] iframe');
  const frame = wrapper.frameLocator('iframe');
  const send = panel.getByRole('button', { name: 'Send', exact: true });
  const canvasId = await showCanvas(STEP_ONE);
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Interactive panel from')).toBeVisible();
  // The timeline names the canvas instead of telling the user to open the app they are in.
  await expect(
    page.locator('[data-canvas-notice-title]', { hasText: originalTitle })
  ).toBeVisible();
  await expect(page.getByText('Open it in MindRoom Chat', { exact: false })).toHaveCount(0);
  await expect(panel.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  await expect(wrapper.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-forms');

  await frame.getByRole('button', { name: 'Pro' }).click();
  await expect(panel.getByText('Send to')).toContainText('Pro plan');
  await page.screenshot({ path: testInfo.outputPath('canvas-staged.png') });
  // The canvas's own follow-up submission cannot swap what the user is reviewing.
  await page.waitForTimeout(1_500);
  await expect(panel.getByText('Send to')).toContainText('Pro plan');
  await expect(send).toBeEnabled();
  expect(
    (await viewerMessages()).some((event) => event.content['io.mindroom.canvas_response'])
  ).toBe(false);
  await send.click();
  await expect(panel.getByText(/Sent to .*Pro plan/)).toBeVisible();

  await expect
    .poll(async () =>
      (await viewerMessages()).find((event) => event.content['io.mindroom.canvas_response'])
    )
    .toBeTruthy();
  const [response] = (await viewerMessages()).filter(
    (event) => event.content['io.mindroom.canvas_response']
  );
  expect(response.content['io.mindroom.canvas_response']).toEqual({
    version: 1,
    canvas_event_id: canvasId,
    canvas_revision_event_id: canvasId,
    agent_user_id: agent.user_id,
    label: 'Pro plan',
    data: { plan: 'pro', price: '12.5', seats: 3 },
  });
  expect(response.content.body).toBe(
    `${agent.user_id} Canvas response (${canvasId}, revision ${canvasId}): Pro plan\n{"plan":"pro","price":"12.5","seats":3}`
  );
  expect(response.content['m.mentions']).toEqual({ user_ids: [agent.user_id] });
  const receipt = page.locator(`[data-canvas-receipt="${canvasId}"]`);
  await expect(receipt).toContainText('Pro plan');
  await expect(page.getByText('Canvas response (', { exact: false })).toHaveCount(0);

  // After an answer, the agent's next step replaces the page in place.
  await updateCanvas(canvasId, STEP_TWO, 'Seats');
  await expect(frame.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(panel.getByText('Seats', { exact: true })).toBeVisible();
  // Every earlier version stays one click away.
  await expect(panel.getByText('Version 2 of 2')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 760 });
  for (const name of ['Previous version', 'Next version', 'Close canvas']) {
    const control = panel.getByRole('button', { name, exact: true });
    await expect(control).toBeInViewport({ ratio: 1 });
    const bounds = await control.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(30);
  }
  await panel.getByRole('button', { name: 'Previous version' }).click();
  await expect(frame.getByText('Which plan?')).toBeVisible();
  await expect(panel.getByText('This is an earlier version.')).toBeVisible();
  await expect(panel.getByText(originalTitle, { exact: true })).toBeVisible();
  for (const name of ['Previous version', 'Next version', 'Close canvas']) {
    const control = panel.getByRole('button', { name, exact: true });
    await expect(control).toBeInViewport({ ratio: 1 });
    const bounds = await control.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(30);
  }
  await page.screenshot({ path: testInfo.outputPath('canvas-earlier-version.png') });
  await panel.getByRole('button', { name: 'Show latest' }).click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(frame.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(panel.getByText('This is an earlier version.')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Continue' }).click();
  await expect(panel.getByText('Send to')).toContainText('Seats chosen');
  await expect(send).toBeEnabled();
  await send.click();
  await expect
    .poll(async () =>
      (
        await viewerMessages()
      ).some(
        (event) =>
          (event.content['io.mindroom.canvas_response'] as { data?: unknown } | undefined)?.data &&
          JSON.stringify(
            (event.content['io.mindroom.canvas_response'] as { data: unknown }).data
          ) === '{"seats":"3"}'
      )
    )
    .toBe(true);

  // Work the user has not sent is never replaced without asking.
  await frame.getByRole('textbox').fill('5');
  const chatOrigin = new URL(page.url()).origin;
  await updateCanvas(
    canvasId,
    escapeAttempt(exfiltrationOrigin, `${chatOrigin}/canvas-escape-probe?same-origin`),
    'Escape attempt'
  );
  await expect(panel.getByText(/updated this panel/)).toBeVisible();
  await expect(frame.getByRole('textbox')).toHaveValue('5');
  await panel.getByRole('button', { name: 'Load update' }).click();
  await expect(frame.locator('#state')).toHaveText('Trying to leave');
  await frame.getByRole('button', { name: 'Try navigation' }).click();
  // Whether a browser reports the blocked navigation or not, no request may leave.
  await page.waitForTimeout(1_500);
  expect(escapes).toEqual([]);
  expect(allowedOriginProbes).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('canvas-contained.png') });
  await updateCanvas(
    canvasId,
    escapeAttempt(exfiltrationOrigin, 'https://www.google.com/recaptcha/canvas-escape-probe'),
    'Escape attempt'
  );
  // Focusing the first attack marks the page as touched, so loading remains explicit.
  await expect(panel.getByText(/updated this panel/)).toBeVisible();
  await panel.getByRole('button', { name: 'Load update' }).click();
  await expect(frame.locator('#state')).toHaveText('Trying to leave');
  await frame.getByRole('button', { name: 'Try navigation' }).click();
  await page.waitForTimeout(1_500);
  expect(escapes).toEqual([]);
  expect(allowedOriginProbes).toEqual([]);

  await panel.getByRole('button', { name: 'Close canvas' }).click();
  await expect(panel).toHaveCount(0);
  const openPanel = page.getByRole('button', { name: 'Open canvas', exact: true });
  await expect(openPanel).toBeVisible();
  await openPanel.click();
  await expect(panel).toBeVisible();
  await expect(frame.locator('#state')).toHaveText('Trying to leave');
  await frame.getByRole('button', { name: 'Try navigation' }).click();
  await page.waitForTimeout(1_000);
  expect(escapes).toEqual([]);
  expect(allowedOriginProbes).toEqual([]);

  // A page too large for the event arrives as uploaded media, themed like Chat, and can fill the room.
  const largePage = `<style>main{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
article{background:var(--mr-surface);border:1px solid var(--mr-border);border-radius:var(--mr-radius);padding:8px}</style>
<h1 id="report">Quarterly report</h1><main>${Array.from(
    { length: 600 },
    (_, index) => `<article>Region ${index} <b>${index * 7}</b></article>`
  ).join('')}</main>`;
  const upload = await fetch(`${homeserver}/_matrix/media/v3/upload?filename=canvas.html`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agent.access_token}`, 'Content-Type': 'text/html' },
    body: largePage,
  });
  expect(upload.ok).toBe(true);
  const { content_uri: contentUri } = (await upload.json()) as { content_uri: string };
  await page.bringToFront();
  await panel.getByRole('button', { name: 'Close canvas', exact: true }).focus();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.notice',
    body: 'Interactive panel: Report. Open it in MindRoom Chat to respond.',
    'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
    'io.mindroom.ui_action': {
      ...action(''),
      canvas: {
        title: 'Report',
        document: {
          mimetype: 'text/html',
          size: new TextEncoder().encode(largePage).length,
          url: contentUri,
        },
      },
    },
  });
  await expect(panel.getByText('Report', { exact: true })).toBeVisible();
  await expect(frame.locator('#report')).toHaveText('Quarterly report');
  const srcdoc = (await wrapper.locator('iframe').getAttribute('srcdoc')) ?? '';
  expect(srcdoc).toContain('--mr-surface:');
  expect(srcdoc).toContain('background:var(--mr-bg)');
  const conversation = page.getByText(fixture.replyBody, { exact: true });
  await expect(conversation).toBeVisible();
  await panel.getByRole('button', { name: 'Expand canvas' }).click();
  await expect(conversation).toBeHidden();
  const panelBox = await panel.boundingBox();
  expect(panelBox?.width ?? 0).toBeGreaterThan(900);
  await page.screenshot({ path: testInfo.outputPath('canvas-expanded.png') });
  const expand = panel.getByRole('button', { name: 'Expand canvas' });
  await expect(expand).toHaveAttribute('aria-pressed', 'true');
  await expand.click();
  await expect(conversation).toBeVisible();

  // An edited text too large for one event goes out as a long-text sidecar, as MindRoom's long replies do.
  const paragraph = 'A long paragraph the user edited in the canvas. ';
  const draft = paragraph.repeat(2500);
  const editorId = await showCanvas(`<textarea id="draft"></textarea>
<button onclick="mindroom.submit({text: document.getElementById('draft').value}, {label: 'Edited draft'})">Send edits</button>
<script>document.getElementById('draft').value = '${paragraph}'.repeat(2500);</script>`);
  await frame.getByRole('button', { name: 'Send edits' }).click();
  await expect(panel.getByText('Send to')).toContainText('Edited draft');
  await send.click();
  await expect(panel.getByText(/Sent to .*Edited draft/)).toBeVisible();
  type AnswerEvent = { content: Record<string, unknown> };
  const isLargeAnswer = (event: AnswerEvent) =>
    !!event.content['io.mindroom.long_text'] &&
    (event.content['io.mindroom.canvas_response'] as { canvas_event_id?: string } | undefined)
      ?.canvas_event_id === editorId;
  await expect.poll(async () => (await viewerMessages()).some(isLargeAnswer)).toBe(true);
  const largeAnswer = (await viewerMessages()).find(isLargeAnswer)!;
  expect(largeAnswer.content.msgtype).toBe('m.file');
  expect(largeAnswer.content['m.mentions']).toEqual({ user_ids: [agent.user_id] });
  expect((largeAnswer.content['io.mindroom.canvas_response'] as { data?: unknown }).data).toBe(
    undefined
  );
  const [mediaServer, mediaId] = String(largeAnswer.content.url).slice('mxc://'.length).split('/');
  const sidecar = await fetch(
    `${homeserver}/_matrix/client/v1/media/download/${mediaServer}/${mediaId}`,
    {
      headers: { Authorization: `Bearer ${agent.access_token}` },
    }
  );
  expect(sidecar.ok).toBe(true);
  const fullAnswer = (await sidecar.json()) as Record<string, Record<string, unknown> | string>;
  expect((fullAnswer['io.mindroom.canvas_response'] as { data: { text: string } }).data.text).toBe(
    draft
  );
  expect(fullAnswer.body).toContain('Canvas response (');
  await expect(page.locator(`[data-canvas-receipt="${editorId}"]`)).toContainText('Edited draft');

  // Pages load libraries only from jsDelivr's npm path, and only when the deployment allows it.
  const npmScript = 'https://cdn.jsdelivr.net/npm/canvas-probe@1.0.0/probe.js';
  const npmStyle = 'https://cdn.jsdelivr.net/npm/canvas-probe@1.0.0/probe.css';
  await showCanvas(`<link rel="stylesheet" href="${npmStyle}">
<p id="library">not loaded</p>
<script src="${npmScript}"></script>
<script src="https://cdn.jsdelivr.net/gh/canvas/probe@1.0.0/probe.js"></script>
<script src="https://unpkg.com/canvas-probe@1.0.0/probe.js"></script>`);
  await expect(frame.locator('#library')).toHaveText('not loaded');
  await page.waitForTimeout(1_000);
  await expect(frame.locator('#library')).toHaveText('not loaded');
  expect(libraryRequests).toEqual([]);
  libraries = true;
  // Chat starts from its cached configuration, so drop it to apply the new setting on this load.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('io.cinny.client-config:')) localStorage.removeItem(key);
    }
  });
  await page.reload();
  await expect(conversation).toBeVisible();
  await page.getByRole('button', { name: 'Open canvas', exact: true }).last().click();
  await expect(frame.locator('#library')).toHaveText('loaded');
  await expect(frame.locator('#library')).toHaveCSS('color', 'rgb(1, 2, 3)');
  await page.waitForTimeout(1_000);
  expect([...libraryRequests].sort()).toEqual([npmStyle, npmScript].sort());

  expect(pageErrors).toEqual([]);

  // A page's errors and blocked loads reach the agent only when the user sends them.
  await showCanvas(`<p id="scheme"></p>
<script>document.getElementById('scheme').textContent = mindroom.colorScheme;</script>
<script src="https://unpkg.com/canvas-probe@1.0.0/probe.js"></script>
<svg width="10" height="10"><image href="https://unpkg.com/canvas-probe@1.0.0/probe.png" width="10" height="10"/></svg>
<script>missingFunction();</script>`);
  await expect(frame.locator('#scheme')).toHaveText(/^(light|dark)$/);
  await expect(panel.getByText('This page reported an error.')).toBeVisible();
  const reported = panel.locator('pre');
  await expect(reported).toContainText('missingFunction is not defined (line 5)');
  await expect(reported).toContainText('Blocked https://unpkg.com');
  await expect(reported).toContainText('Blocked https://unpkg.com/canvas-probe@1.0.0/probe.png');
  // A blocked load is reported once, as blocked, SVG images included.
  await expect(reported).not.toContainText('Could not load');
  await page.screenshot({ path: testInfo.outputPath('canvas-error-report.png') });
  await panel.getByRole('button', { name: /^Tell / }).click();
  await expect(panel.getByText(/^Sent the errors to /)).toBeVisible();
  await expect
    .poll(async () =>
      (
        await viewerMessages()
      ).find((event) => String(event.content.body).includes('Canvas error ('))
    )
    .toBeTruthy();
  const errorReport = (await viewerMessages()).find((event) =>
    String(event.content.body).includes('Canvas error (')
  )!;
  expect(String(errorReport.content.body)).toContain('missingFunction is not defined');
  expect(errorReport.content['m.mentions']).toEqual({ user_ids: [agent.user_id] });
  expect(libraryRequests.some((url) => url.startsWith('https://unpkg.com'))).toBe(false);

  // A page keeps what it saves on this device, across a Chat reload and the agent's updates.
  const notesPage = (heading: string) => `<h2>${heading}</h2><textarea id="notes"></textarea>
<script>
  const notes = document.getElementById('notes');
  notes.value = mindroom.state?.notes ?? '';
  notes.addEventListener('input', () => mindroom.saveState({ notes: notes.value }));
</script>`;
  const notesId = await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.notice',
    body: 'Interactive panel: Notes. Open it in MindRoom Chat to respond.',
    'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
    'io.mindroom.ui_action': action(notesPage('Notes'), 'Notes'),
  });
  await frame.locator('#notes').pressSequentially('Remember the milk');
  // Typing never reloads the page, so focus and every keystroke stay.
  await expect(frame.locator('#notes')).toBeFocused();
  await expect(frame.locator('#notes')).toHaveValue('Remember the milk');
  // Saves reach storage within half a second.
  await page.waitForTimeout(1_000);
  await page.reload();
  // Chat names a canvas by its title; the body is the fallback for other clients.
  await expect(page.locator('[data-canvas-notice-title]', { hasText: 'Notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Open canvas', exact: true }).last().click();
  await expect(panel.getByText('Notes', { exact: true })).toBeVisible();
  await expect(frame.locator('#notes')).toHaveValue('Remember the milk');
  await updateCanvas(notesId, notesPage('Notes, updated'), 'Notes');
  await expect(frame.getByText('Notes, updated')).toBeVisible();
  await expect(frame.locator('#notes')).toHaveValue('Remember the milk');
  await page.screenshot({ path: testInfo.outputPath('canvas-saved-state.png') });

  // Sliders and fields keep their values in every version without the page saving anything.
  const ratesPage = (heading: string) => `<h2>${heading}</h2>
<input id="rate" type="range" min="0" max="10" value="2"><output id="shown">2</output>
<label><input type="checkbox" id="monthly"> Monthly</label>
<script>
  const rate = document.getElementById('rate');
  rate.addEventListener('input', () => { document.getElementById('shown').textContent = rate.value; });
</script>`;
  const ratesId = await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.notice',
    body: 'Interactive panel: Rates. Open it in MindRoom Chat to respond.',
    'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
    'io.mindroom.ui_action': action(ratesPage('Rates'), 'Rates'),
  });
  await expect(frame.getByText('Rates', { exact: true })).toBeVisible();
  await frame.locator('#rate').fill('7');
  await frame.locator('#monthly').check();
  await expect(frame.locator('#shown')).toHaveText('7');
  await page.waitForTimeout(1_000);
  await page.reload();
  // Chat names a canvas by its title; the body is the fallback for other clients.
  await expect(page.locator('[data-canvas-notice-title]', { hasText: 'Rates' })).toBeVisible();
  await page.getByRole('button', { name: 'Open canvas', exact: true }).last().click();
  await expect(frame.getByText('Rates', { exact: true })).toBeVisible();
  await expect(frame.locator('#rate')).toHaveValue('7');
  await expect(frame.locator('#shown')).toHaveText('7');
  await expect(frame.locator('#monthly')).toBeChecked();
  await frame.locator('#rate').fill('8');
  await updateCanvas(ratesId, ratesPage('Rates, updated'), 'Rates');
  await panel.getByRole('button', { name: 'Load update' }).click();
  await expect(frame.getByText('Rates, updated')).toBeVisible();
  await expect(frame.locator('#rate')).toHaveValue('8');
  await expect(frame.locator('#shown')).toHaveText('8');
  await expect(frame.locator('#monthly')).toBeChecked();
  await panel.getByRole('button', { name: 'Previous version' }).click();
  await expect(frame.getByText('Rates', { exact: true })).toBeVisible();
  await expect(frame.locator('#shown')).toHaveText('8');
  await page.screenshot({ path: testInfo.outputPath('canvas-kept-inputs.png') });

  // A canvas that shares its state leaves a copy for the agent once the user pauses; others leave none.
  const stateCopies = async (canvasId: string) =>
    (
      await matrixFetch<{
        chunk: Array<{ type: string; sender: string; content: Record<string, unknown> }>;
      }>(
        homeserver!,
        `/rooms/${encodeURIComponent(fixture.roomId)}/relations/${encodeURIComponent(
          canvasId
        )}/m.reference`,
        { accessToken: agent.access_token, apiVersion: 'v1' }
      )
    ).chunk.filter((event) => event.type === 'io.mindroom.canvas_state');
  expect(await stateCopies(ratesId)).toEqual([]);
  const sharedId = await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.notice',
    body: 'Interactive panel: Packing. Open it in MindRoom Chat to respond.',
    'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
    'io.mindroom.ui_action': {
      ...action(
        `<label><input type="checkbox" id="tent"> Tent</label>
<script>document.getElementById('tent').addEventListener('change', (event) => mindroom.saveState({ tent: event.target.checked }));</script>`,
        'Packing'
      ),
      share_state: true,
    },
  });
  await expect(frame.locator('#tent')).toBeVisible();
  await expect(panel.getByText('Saved in this room:', { exact: false })).toBeVisible();
  await frame.locator('#tent').check();
  await expect.poll(() => stateCopies(sharedId), { timeout: 15_000 }).toHaveLength(1);
  const [copy] = await stateCopies(sharedId);
  expect(copy.sender).toBe(viewer.user_id);
  expect(copy.content).toEqual({
    msgtype: 'm.notice',
    version: 1,
    json: '{"tent":true}',
    inputs: '{"#tent":true}',
    'm.relates_to': { rel_type: 'm.reference', event_id: sharedId },
  });
  await page.screenshot({ path: testInfo.outputPath('canvas-shared-state.png') });

  await new Promise((resolve) => {
    listener.close(resolve);
  });
});

test("the room header brings back a conversation's canvases: a menu for several, a toggle for one", async ({
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
  const username = `canvas_header_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_header_${suffix}`);
  const server = viewer.user_id.slice(viewer.user_id.indexOf(':') + 1);
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Canvas header',
    topic: 'Header canvas button regression',
    rootBody: 'Plan my trip',
    replyBody: 'The trip conversation',
    invite: [agent.user_id],
  });
  await joinRoom(homeserver!, agent.access_token, fixture.roomId);
  // A second conversation in the same room, whose canvases must stay apart from the first's.
  const otherRootId = await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Plan my move',
  });
  const otherReplyBody = 'The move conversation';
  await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: otherReplyBody,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: otherRootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: otherRootId },
    },
  });
  const sendCanvas = async (title: string, threadId: string) => {
    // A canvas auto-opens only for a focused window, so move focus into the page first.
    await page.bringToFront();
    const close = page.getByRole('button', { name: 'Close canvas', exact: true });
    if (await close.isVisible()) await close.focus();
    else await page.locator('[data-slate-editor="true"]').click();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    return sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body: `Interactive panel: ${title}. Open it in MindRoom Chat to respond.`,
      'm.relates_to': { rel_type: 'm.thread', event_id: threadId },
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_canvas',
        requester_id: viewer.user_id,
        agent_user_id: agent.user_id,
        room_id: fixture.roomId,
        thread_id: threadId,
        canvas: { title, html: `<h1>${title}</h1>` },
      },
    });
  };

  await alignUiActionSync(context, page, homeserver!);
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
        mindroom: {
          ...config.mindroom,
          canvas: { enabled: true },
          uiActions: { autoOpenFromHomeservers: [server] },
        },
      },
    });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  const openThread = async (threadId: string, replyBody: string) => {
    const liveSync = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/sync') && url.searchParams.get('timeout') === '30000';
    });
    await page.goto(
      `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(threadId)}`
    );
    await expect(page.getByText(replyBody, { exact: true })).toBeVisible();
    await liveSync;
  };
  await openThread(fixture.rootId, fixture.replyBody);

  // The sidebar's Canvases tab shares the menu button's name, so look in the room header only.
  const header = page.locator('header');
  const canvasButton = header.getByRole('button', {
    name: /^(Show Canvas|Hide Canvas|Canvases)$/,
  });
  const panel = page.getByRole('complementary', { name: 'Canvas panel' });
  await expect(canvasButton).toHaveCount(0);

  // One canvas: the button toggles it directly.
  await sendCanvas('Packing list', fixture.rootId);
  await expect(panel.getByText('Packing list', { exact: true })).toBeVisible();
  await expect(canvasButton).toHaveAccessibleName('Hide Canvas');
  await canvasButton.click();
  await expect(panel).toHaveCount(0);
  await expect(canvasButton).toHaveAccessibleName('Show Canvas');
  await canvasButton.click();
  await expect(panel.getByText('Packing list', { exact: true })).toBeVisible();

  // Two canvases: the button opens a menu, newest first, and a choice shows its canvas.
  await sendCanvas('Travel plan', fixture.rootId);
  await expect(panel.getByText('Travel plan', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Close canvas', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(canvasButton).toHaveAccessibleName('Canvases');
  const choices = page.getByRole('button', { name: /^(Packing list|Travel plan)/ });
  await canvasButton.click();
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toContainText('Travel plan');
  await expect(choices.nth(1)).toContainText('Packing list');
  await page.screenshot({ path: testInfo.outputPath('canvas-header-menu.png') });
  await choices.filter({ hasText: 'Packing list' }).click();
  await expect(panel.getByText('Packing list', { exact: true })).toBeVisible();
  await expect(choices).toHaveCount(0);

  await canvasButton.click();
  await expect(choices.filter({ hasText: 'Packing list' })).toHaveAttribute('aria-current', 'true');
  await expect(choices.filter({ hasText: 'Travel plan' })).not.toHaveAttribute('aria-current');
  await choices.filter({ hasText: 'Travel plan' }).click();
  await expect(panel.getByText('Travel plan', { exact: true })).toBeVisible();
  await expect(panel.getByText('Packing list', { exact: true })).toHaveCount(0);

  // Another conversation in the room has no canvas yet, and then lists only its own.
  await openThread(otherRootId, otherReplyBody);
  await expect(canvasButton).toHaveCount(0);
  await sendCanvas('Move checklist', otherRootId);
  await expect(panel.getByText('Move checklist', { exact: true })).toBeVisible();
  await expect(canvasButton).toHaveAccessibleName('Hide Canvas');
  await canvasButton.click();
  await expect(panel).toHaveCount(0);
  await expect(canvasButton).toHaveAccessibleName('Show Canvas');
  await canvasButton.click();
  await expect(panel.getByText('Move checklist', { exact: true })).toBeVisible();

  // Back in the first conversation, the menu still lists its two canvases and not the other's.
  await openThread(fixture.rootId, fixture.replyBody);
  await expect(canvasButton).toHaveAccessibleName('Canvases');
  await canvasButton.click();
  await expect(choices).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Move checklist/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(choices).toHaveCount(0);

  // Many canvases on a short window: the menu stays on screen and scrolls to the oldest choice.
  for (let index = 1; index <= 10; index += 1) {
    await sendCanvas(`Extra ${index}`, fixture.rootId);
    await expect(panel.getByText(`Extra ${index}`, { exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 1600, height: 480 });
  const allChoices = page.getByRole('button', { name: /^(Packing list|Travel plan|Extra \d+)/ });
  await canvasButton.click();
  await expect(allChoices).toHaveCount(12);
  const menu = allChoices.first().locator('xpath=ancestor::*[contains(@style, "max-height")][1]');
  const menuBox = await menu.boundingBox();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(480);
  const oldest = allChoices.filter({ hasText: 'Packing list' });
  await expect(oldest).not.toBeInViewport();
  await oldest.scrollIntoViewIfNeeded();
  await expect(oldest).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('canvas-header-menu-short.png') });
  await oldest.click();
  await expect(panel.getByText('Packing list', { exact: true })).toBeVisible();
});
