import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

/**
 * Performance probe for the compact room view (thread-card list).
 * Informational, like perf-thread-streaming: seeds a room with many threads,
 * opens the compact overview, and reports mounted cards / DOM size plus
 * main-thread cost while one thread streams m.replace edits (each edit
 * refreshes the thread index that feeds every card's view model).
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const THREAD_COUNT = Number(process.env.PERF_THREAD_COUNT ?? 150);
const EDIT_COUNT = Number(process.env.PERF_EDIT_COUNT ?? 40);
const EDIT_INTERVAL_MS = Number(process.env.PERF_EDIT_INTERVAL_MS ?? 50);

test.describe('PERF: compact room view with many threads', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(900_000);

  test('measure compact view open and streaming edit cost', async ({ page }, testInfo) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Perf compact ${Date.now()}`,
    });

    let lastReplyId = '';
    for (let t = 1; t <= THREAD_COUNT; t += 1) {
      // eslint-disable-next-line no-await-in-loop
      const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Compact thread ${t}: a reasonably descriptive root message title`,
      });
      // eslint-disable-next-line no-await-in-loop
      lastReplyId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Reply in thread ${t}`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    }

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    const openStart = Date.now();
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await page.waitForSelector('[data-compact-room-view]', { timeout: 60_000 });
    await page.waitForTimeout(3_000);
    const openMs = Date.now() - openStart;

    const state = await page.evaluate(() => ({
      cards: document.querySelectorAll('[data-compact-room-view] [data-thread-root-id]').length,
      domNodeCount: document.getElementsByTagName('*').length,
      usedJsHeapMb: (() => {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory;
        return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null;
      })(),
    }));

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const before = await cdp.send('Performance.getMetrics');
    const taskBefore = before.metrics.find((m) => m.name === 'TaskDuration')?.value;

    const burstStart = Date.now();
    for (let step = 1; step <= EDIT_COUNT; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: `* streamed compact chunk ${step}`,
        'm.new_content': { msgtype: 'm.text', body: `streamed compact chunk ${step}` },
        'm.relates_to': { rel_type: 'm.replace', event_id: lastReplyId },
      });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(EDIT_INTERVAL_MS);
    }
    await page.waitForTimeout(1_500);
    const wallClockMs = Date.now() - burstStart;

    const after = await cdp.send('Performance.getMetrics');
    const taskAfter = after.metrics.find((m) => m.name === 'TaskDuration')?.value;

    const report = {
      threadCount: THREAD_COUNT,
      openMs,
      ...state,
      editBurst: {
        editCount: EDIT_COUNT,
        editIntervalMs: EDIT_INTERVAL_MS,
        wallClockMs,
        cdpTaskDurationMs:
          taskBefore !== undefined && taskAfter !== undefined
            ? Math.round((taskAfter - taskBefore) * 1000)
            : null,
      },
    };
    // eslint-disable-next-line no-console
    console.log(`PERF-COMPACT-VIEW ${JSON.stringify(report, null, 2)}`);
    await testInfo.attach('perf-compact-view.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    expect(state.cards).toBeGreaterThanOrEqual(THREAD_COUNT);
  });
});
