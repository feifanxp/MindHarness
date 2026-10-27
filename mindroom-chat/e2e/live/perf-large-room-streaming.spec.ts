import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

type Manifest = {
  version: number;
  homeserver: string;
  username: string;
  userId: string;
  roomId: string;
  config: { threads: number; replies: number; edits: number };
  threads: { index: number; rootId: string; latestReplyId: string; complete: boolean }[];
};
type ThreadPage = {
  chunk: { event_id: string; unsigned?: { 'm.relations'?: { 'm.thread'?: { count: number } } } }[];
  next_batch?: string;
};
type PerfWindow = Window & {
  __largeRoomPerf?: {
    frames: number[];
    longTasks: number[];
    active: boolean;
    observer: PerformanceObserver;
  };
};
const manifestPath = process.env.PERF_STRESS_MANIFEST;
const cardSelector = '[data-compact-room-view] [data-thread-root-id]';
const streamCount = 20;
const steps = 20;
const batchPauseMs = 50;

test.use({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {} : { channel: 'chrome', launchOptions: {} }),
  viewport: { width: 1440, height: 1000 },
  locale: 'en-US',
  // Auth happens before profiling; never capture credentials in Playwright artifacts.
  trace: 'off',
  video: 'off',
  screenshot: 'off',
});

test.describe('PERF: seeded large room with concurrent streaming edits', () => {
  test.skip(!manifestPath, 'Set PERF_STRESS_MANIFEST to run this dedicated fixture probe');
  test.describe.configure({ retries: 0, timeout: 900_000 });
  test('all 20 previews catch up after a 400-edit burst', async ({ page, browser }, testInfo) => {
    const password = process.env.E2E_PASSWORD;
    if (!password) throw new Error('Set E2E_PASSWORD to the seeded fixture account password.');
    const fixture = JSON.parse(await readFile(manifestPath!, 'utf8')) as Manifest;
    expect(fixture.version).toBe(1);
    expect(fixture.roomId).toMatch(/^!/);
    expect(fixture.userId).toMatch(/^@/);
    for (const count of [fixture.config.threads, fixture.config.replies, fixture.config.edits]) {
      expect(Number.isSafeInteger(count) && count > 0).toBe(true);
    }
    expect(fixture.config.threads).toBeGreaterThanOrEqual(streamCount);
    expect(fixture.threads).toHaveLength(fixture.config.threads);
    expect(new Set(fixture.threads.map(({ rootId }) => rootId)).size).toBe(fixture.config.threads);
    fixture.threads.forEach((thread, index) => {
      expect(thread.index).toBe(index);
      expect(thread.complete).toBe(true);
      expect(thread.rootId).toMatch(/^\$/);
      expect(thread.latestReplyId).toMatch(/^\$/);
    });
    const homeserver = new URL(process.env.E2E_HOMESERVER ?? fixture.homeserver);
    expect(['http:', 'https:']).toContain(homeserver.protocol);
    expect(
      ['localhost', '[::1]'].includes(homeserver.hostname) ||
        /^127\.\d+\.\d+\.\d+$/.test(homeserver.hostname)
    ).toBe(true);
    if (homeserver.href !== `${homeserver.origin}/` || homeserver.origin !== fixture.homeserver) {
      throw new Error('E2E_HOMESERVER must match the manifest and contain only a server origin.');
    }
    const username = process.env.E2E_USERNAME ?? fixture.username;
    expect(username).toBe(fixture.username);
    const session = await loginToMatrix(homeserver.origin, username, password);
    expect(session.userId).toBe(fixture.userId);
    const expectedRoots = new Set(fixture.threads.map(({ rootId }) => rootId));
    const seenRoots = new Set<string>();
    const seenTokens = new Set<string>();
    let token: string | undefined;
    let repliesBeforeReplay = 0;
    do {
      const query = new URLSearchParams({ limit: '100', include: 'all' });
      if (token) query.set('from', token);
      const result = await matrixFetch<ThreadPage>(
        homeserver.origin,
        `/rooms/${encodeURIComponent(fixture.roomId)}/threads?${query}`,
        { accessToken: session.accessToken, apiVersion: 'v1' }
      );
      for (const root of result.chunk) {
        expect(expectedRoots.has(root.event_id) && !seenRoots.has(root.event_id)).toBe(true);
        const count = root.unsigned?.['m.relations']?.['m.thread']?.count;
        expect(Number.isSafeInteger(count) && count! >= fixture.config.replies).toBe(true);
        repliesBeforeReplay += count!;
        seenRoots.add(root.event_id);
      }
      token = result.next_batch;
      if (token !== undefined) {
        expect(typeof token === 'string' && token.length > 0 && !seenTokens.has(token)).toBe(true);
        seenTokens.add(token);
      }
    } while (token);
    expect(seenRoots.size).toBe(fixture.config.threads);
    await loginWithPassword(page, { homeserver: homeserver.origin, username, password });
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    const roomUrl = `/home/${encodeURIComponent(fixture.roomId)}`;
    const openStart = performance.now();
    await page.goto(roomUrl);
    await expect
      .poll(
        () =>
          page
            .locator(cardSelector)
            .evaluateAll((cards) =>
              cards.map((card) => card.getAttribute('data-thread-root-id')).sort()
            ),
        { timeout: 180_000 }
      )
      .toEqual(fixture.threads.map(({ rootId }) => rootId).sort());
    const openMs = performance.now() - openStart;
    const targets = fixture.threads.slice(0, streamCount);

    const runId = randomUUID();
    const marker = (index: number, step: number) => `PERF-${runId}-${index}-${step}`;
    const content = (index: number, step: number) => ({
      msgtype: step === steps ? 'm.text' : 'm.notice',
      body: `${marker(
        index,
        step
      )} Streaming response ${'with formatted content and inline code. '.repeat(
        1 + Math.floor(step / 5)
      )}`,
      format: 'org.matrix.custom.html',
      formatted_body: `<p>${marker(
        index,
        step
      )} Streaming response ${'with <strong>formatted content</strong> and <code>inline code</code>. '.repeat(
        1 + Math.floor(step / 5)
      )}</p>`,
      'io.mindroom.stream_status':
        step === steps ? 'completed' : step === 0 ? 'pending' : 'streaming',
    });
    const send = (body: Record<string, unknown>) =>
      sendRoomMessage(homeserver.origin, session.accessToken, fixture.roomId, body, runId);
    const replies = await Promise.all(
      targets.map((thread, index) =>
        send({
          ...content(index, 0),
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: thread.rootId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: thread.latestReplyId },
          },
        })
      )
    );
    const waitForPreviews = (step: number) =>
      page.waitForFunction(
        ({ selector, roots, markers, terminal }) => {
          const cards = new Map(
            Array.from(document.querySelectorAll(selector), (card) => [
              card.getAttribute('data-thread-root-id'),
              card,
            ])
          );
          return roots.every((root, index) => {
            const card = cards.get(root);
            const label = card?.getAttribute('aria-label');
            const state = card?.getAttribute('data-attention-state');
            return (
              label?.includes(markers[index]) &&
              state &&
              (terminal ? state !== 'streaming' : state === 'streaming')
            );
          });
        },
        {
          selector: cardSelector,
          roots: targets.map(({ rootId }) => rootId),
          markers: targets.map((_, index) => marker(index, step)),
          terminal: step === steps,
        },
        { timeout: 120_000, polling: 250 }
      );
    await waitForPreviews(0);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.evaluate(() => {
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      const state = { frames: [] as number[], longTasks, active: true, observer };
      (window as PerfWindow).__largeRoomPerf = state;
      observer.observe({ type: 'longtask' });
      let previous = performance.now();
      const frame = (now: number) => {
        if (!state.active) return;
        state.frames.push(now - previous);
        previous = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    const before = (await cdp.send('Performance.getMetrics')).metrics;
    await cdp.send('Profiler.start');
    const burstStart = performance.now();
    let sentEdits = 0;
    let sendMs: number | undefined;
    let caughtUp = false;
    try {
      for (let step = 1; step <= steps; step += 1) {
        await Promise.all(
          replies.map(async (eventId, index) => {
            const next = content(index, step);
            await send({
              ...next,
              body: `* ${next.body}`,
              'm.new_content': next,
              'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
            });
            sentEdits += 1;
          })
        );
        if (step < steps) await sleep(batchPauseMs);
      }
      sendMs = performance.now() - burstStart;
      await waitForPreviews(steps);
      caughtUp = true;
    } finally {
      const elapsedMs = performance.now() - burstStart;
      const after = (await cdp.send('Performance.getMetrics')).metrics;
      const { profile } = await cdp.send('Profiler.stop');
      const observations = await page.evaluate(() => {
        const state = (window as PerfWindow).__largeRoomPerf!;
        state.active = false;
        state.longTasks.push(...state.observer.takeRecords().map((entry) => entry.duration));
        state.observer.disconnect();
        const frames = state.frames.slice().sort((a, b) => a - b);
        return {
          frameGapsMs: state.frames,
          p95FrameMs: frames[Math.floor(frames.length * 0.95)] ?? null,
          maxFrameMs: frames.at(-1) ?? null,
          longTasksMs: state.longTasks,
          longTaskCount: state.longTasks.length,
          longTaskTotalMs: state.longTasks.reduce((sum, duration) => sum + duration, 0),
          longTaskMaxMs: Math.max(0, ...state.longTasks),
          domNodes: document.querySelectorAll('*').length,
        };
      });
      const report = {
        surface: 'overview',
        browserVersion: browser.version(),
        fixture: fixture.config,
        historicalSeedMessageEvents:
          fixture.config.threads * (1 + fixture.config.replies * (1 + fixture.config.edits)),
        repliesBeforeReplay,
        addedReplies: replies.length,
        activeStreams: streamCount,
        steps,
        batchPauseMs,
        openMs,
        sentEdits,
        sendMs,
        sendRateEditsPerSecond: sendMs ? (sentEdits * 1000) / sendMs : null,
        catchupAfterSendMs: sendMs === undefined ? null : elapsedMs - sendMs,
        caughtUp,
        ...observations,
        metricsBefore: before,
        metricsAfter: after,
        metricsDelta: Object.fromEntries(
          after.map(({ name, value }) => [
            name,
            value - (before.find((metric) => metric.name === name)?.value ?? 0),
          ])
        ),
      };
      await mkdir(testInfo.outputDir, { recursive: true });
      const profilePath = testInfo.outputPath('large-room-streaming.cpuprofile');
      const reportPath = testInfo.outputPath('large-room-streaming.json');
      await writeFile(profilePath, JSON.stringify(profile));
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      await testInfo.attach('large-room-streaming.cpuprofile', {
        path: profilePath,
        contentType: 'application/json',
      });
      await testInfo.attach('large-room-streaming.json', {
        path: reportPath,
        contentType: 'application/json',
      });
      await cdp.detach();
    }
    expect(caughtUp).toBe(true);
  });
});
