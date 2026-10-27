import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';
import { loadAllOlderThreadMessages } from '../helpers/threadTimeline';

/**
 * Performance probe for large threads with streaming `m.replace` edits.
 *
 * Not a pass/fail regression test: it seeds a large thread, opens it, and
 * reports (a) mounted message rows + DOM size after open, and (b) main-thread
 * cost while a burst of streaming edits arrives over /sync. Numbers are
 * printed to the test output and attached as JSON for before/after
 * comparisons of timeline performance work.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = Number(process.env.PERF_REPLY_COUNT ?? 400);
const EDIT_COUNT = Number(process.env.PERF_EDIT_COUNT ?? 40);
const EDIT_INTERVAL_MS = Number(process.env.PERF_EDIT_INTERVAL_MS ?? 50);

const replyHtml = (index: number): string =>
  `<p>Streamed reply <strong>${index}</strong> with some <em>formatted</em> content, ` +
  `<a href="https://example.com/${index}">a link</a> and <code>inline code</code>.</p>` +
  `<pre><code>function step${index}() {\n  return compute(${index}) + lookupCache("k${index}");\n}</code></pre>` +
  `<ul><li>first point ${index}</li><li>second point with detail ${index}</li></ul>`;

const editHtml = (step: number): string => {
  const paragraphs = Array.from(
    { length: 1 + Math.floor(step / 8) },
    (_, p) =>
      `<p>Streaming chunk ${step} paragraph ${p} — partial agent output token token token ` +
      `<code>value_${step}_${p}</code> more tokens follow here.</p>`
  ).join('');
  return `${paragraphs}<p>STREAM-EDIT-${step}</p>`;
};

type PerfReport = {
  replyCount: number;
  threadOpenToRowsMs: number;
  mountedRowsAfterOpen: number;
  mountedRowsAfterLoadAll: number;
  loadOlderClicks: number;
  domNodeCount: number;
  usedJsHeapMb: number | null;
  editBurst: {
    editCount: number;
    editIntervalMs: number;
    wallClockMs: number;
    cdpTaskDurationMs: number | null;
    longTaskTotalMs: number;
    longTaskCount: number;
    longTaskMaxMs: number;
  };
};

test.describe('PERF: large thread with streaming edits', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(600_000);

  test('measure thread open and streaming edit cost', async ({ page }, testInfo) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // Replies and edits come from an agent: the viewer's own live edits do not expand their row.
    const agent = await registerAgentAccount(homeserver, 'perf');

    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Perf thread ${Date.now()}`,
      invite: [agent.userId],
    });
    await joinRoom(homeserver, agent.accessToken, roomId);

    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Perf thread root',
    });

    let lastReplyId = '';
    for (let i = 1; i <= REPLY_COUNT; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      lastReplyId = await sendRoomMessage(homeserver, agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Streamed reply ${i}`,
        format: 'org.matrix.custom.html',
        formatted_body: replyHtml(i),
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    }

    await loginWithPassword(page, { homeserver, username, password });

    const threadUrl = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;
    const openStart = Date.now();
    await page.goto(threadUrl);
    await expect(
      page.locator(`[data-message-id="${rootId}"], [data-message-item]`).first()
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(`Streamed reply ${REPLY_COUNT}`).first()).toBeVisible({
      timeout: 60_000,
    });
    const threadOpenToRowsMs = Date.now() - openStart;

    const mountedRowsAfterOpen = await page.locator('[data-message-item]').count();

    const loadOlderClicks = await loadAllOlderThreadMessages(page);
    // The chip can disappear while the opening history chain is still landing
    // pages, so wait for the complete thread before measuring and streaming.
    await expect(page.locator('[data-thread-count]')).toHaveAttribute(
      'data-thread-count',
      String(REPLY_COUNT + 1),
      { timeout: 60_000 }
    );
    // History landing above must not move a reader who opened at the latest reply.
    const latestReply = page.locator(`[data-message-id="${lastReplyId}"]`);
    await expect(latestReply).toBeInViewport();

    const mountedRowsAfterLoadAll = await page.locator('[data-message-item]').count();
    const domNodeCount = await page.evaluate(() => document.getElementsByTagName('*').length);
    const usedJsHeapMb = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null;
    });

    // Scroll the thread to its end so the edited message is in view (realistic
    // streaming UX). The last mounted row only ends the virtual window.
    await latestReply.evaluate((row) => {
      let scroller = row.parentElement;
      while (scroller && !/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(1_000);
    await expect(latestReply).toBeInViewport();

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');

    await page.evaluate(() => {
      const perfWindow = window as Window & {
        __perfLongTasks?: { duration: number }[];
        __perfObserver?: PerformanceObserver;
      };
      perfWindow.__perfLongTasks = [];
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          perfWindow.__perfLongTasks?.push({ duration: entry.duration });
        });
      });
      observer.observe({ type: 'longtask', buffered: false });
      perfWindow.__perfObserver = observer;
    });

    const metricsBefore = await cdp.send('Performance.getMetrics');
    const taskDurationBefore = metricsBefore.metrics.find(
      (metric) => metric.name === 'TaskDuration'
    )?.value;

    const burstStart = Date.now();
    for (let step = 1; step <= EDIT_COUNT; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: `* streaming chunk ${step}`,
        'm.new_content': {
          msgtype: 'm.text',
          body: `streaming chunk ${step}`,
          format: 'org.matrix.custom.html',
          formatted_body: editHtml(step),
        },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: lastReplyId,
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(EDIT_INTERVAL_MS);
    }

    await expect(page.getByText(`STREAM-EDIT-${EDIT_COUNT}`).first()).toBeVisible({
      timeout: 60_000,
    });
    const wallClockMs = Date.now() - burstStart;

    const metricsAfter = await cdp.send('Performance.getMetrics');
    const taskDurationAfter = metricsAfter.metrics.find(
      (metric) => metric.name === 'TaskDuration'
    )?.value;

    const longTasks = await page.evaluate(() => {
      const perfWindow = window as Window & {
        __perfLongTasks?: { duration: number }[];
        __perfObserver?: PerformanceObserver;
      };
      perfWindow.__perfObserver?.disconnect();
      return perfWindow.__perfLongTasks ?? [];
    });

    const report: PerfReport = {
      replyCount: REPLY_COUNT,
      threadOpenToRowsMs,
      mountedRowsAfterOpen,
      mountedRowsAfterLoadAll,
      loadOlderClicks,
      domNodeCount,
      usedJsHeapMb,
      editBurst: {
        editCount: EDIT_COUNT,
        editIntervalMs: EDIT_INTERVAL_MS,
        wallClockMs,
        cdpTaskDurationMs:
          taskDurationBefore !== undefined && taskDurationAfter !== undefined
            ? Math.round((taskDurationAfter - taskDurationBefore) * 1000)
            : null,
        longTaskTotalMs: Math.round(longTasks.reduce((sum, t) => sum + t.duration, 0)),
        longTaskCount: longTasks.length,
        longTaskMaxMs: Math.round(longTasks.reduce((max, t) => Math.max(max, t.duration), 0)),
      },
    };

    // eslint-disable-next-line no-console
    console.log(`PERF-THREAD-STREAMING ${JSON.stringify(report, null, 2)}`);
    await testInfo.attach('perf-thread-streaming.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    expect(mountedRowsAfterLoadAll).toBeGreaterThan(0);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'perf-thread-streaming');
  });
});
