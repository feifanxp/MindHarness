import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createPrivateRoom,
  loginToMatrix,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

/**
 * Scroll-stability probe for the virtualized thread timeline (informational).
 * Expands all rows, then wheel-scrolls up fast with real input while sampling
 * the viewport position of a mid-screen row every frame. A frame where the
 * row's viewport delta does not match the scroll delta is a user-visible jump
 * (content shifted under the viewport). Reports jump count/magnitude.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = Number(process.env.PERF_REPLY_COUNT ?? 250);

test.describe('PERF: thread scroll stability under expand-all', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(600_000);

  test('measure visible jumps during fast upward wheel scrolling', async ({ page }, testInfo) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // Reset the account settings to their defaults.
    await setAccountData(
      homeserver,
      session.accessToken,
      session.userId,
      'io.mindroom.settings',
      {}
    );
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Scroll stability ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Scroll stability root',
    });
    for (let i = 1; i <= REPLY_COUNT; i += 1) {
      const lines = Array.from(
        { length: 10 },
        (_v, l) => `line ${l} of reply ${i} with some longer text for real row height`
      ).join('\n');
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Stability reply ${i}\n${lines}`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    }

    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await page.waitForTimeout(2_500);

    await page.getByRole('button', { name: '[+all]' }).click();
    await page.waitForTimeout(1_200);

    await page.evaluate(() => {
      const win = window as Window & {
        __jumpSamples?: { st: number; anchorTop: number; anchorSwitched: boolean }[];
      };
      win.__jumpSamples = [];
      const row = document.querySelector('[data-message-item]');
      let el: HTMLElement | null = row?.parentElement ?? null;
      while (el) {
        const { overflowY } = getComputedStyle(el);
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight)
          break;
        el = el.parentElement;
      }
      const scroller = el;
      // Track ONE row by identity while it stays mounted and on-screen; when
      // it leaves, re-anchor to the row nearest the viewport centre and skip
      // that frame in the comparison.
      let anchor: Element | null = null;
      const pickAnchor = (): Element | null => {
        const rows = Array.from(document.querySelectorAll('[data-message-item]'));
        const mid = window.innerHeight / 2;
        let best: Element | null = null;
        let bestDist = Infinity;
        rows.forEach((r) => {
          const rect = r.getBoundingClientRect();
          const d = Math.abs((rect.top + rect.bottom) / 2 - mid);
          if (d < bestDist) {
            bestDist = d;
            best = r;
          }
        });
        return best;
      };
      const sample = () => {
        let switched = false;
        if (!anchor || !anchor.isConnected) {
          anchor = pickAnchor();
          switched = true;
        } else {
          const rect = anchor.getBoundingClientRect();
          if (rect.bottom < -1000 || rect.top > window.innerHeight + 1000) {
            anchor = pickAnchor();
            switched = true;
          }
        }
        const rect = anchor?.getBoundingClientRect();
        win.__jumpSamples?.push({
          st: scroller ? Math.round(scroller.scrollTop) : -1,
          anchorTop: rect ? Math.round(rect.top) : -1,
          anchorSwitched: switched,
        });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    // Real wheel input: fast upward flicks.
    await page.locator('[data-message-item]').first().hover();
    for (let i = 0; i < 60; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -1000);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(35);
    }
    await page.waitForTimeout(2_000);

    const report = await page.evaluate(() => {
      const win = window as Window & {
        __jumpSamples?: { st: number; anchorTop: number; anchorSwitched: boolean }[];
      };
      const s = win.__jumpSamples ?? [];
      let jumps = 0;
      let maxJump = 0;
      let total = 0;
      for (let i = 1; i < s.length; i += 1) {
        if (s[i].anchorSwitched) continue;
        const dSt = s[i].st - s[i - 1].st;
        if (Math.abs(dSt) > 2000) continue;
        const dAnchor = s[i].anchorTop - s[i - 1].anchorTop;
        const residual = Math.abs(dAnchor + dSt);
        if (residual > 40 && s[i].anchorTop !== -1 && s[i - 1].anchorTop !== -1) {
          jumps += 1;
          maxJump = Math.max(maxJump, residual);
          total += residual;
        }
      }
      return {
        frames: s.length,
        anchoredFrames: s.filter((sample) => sample.anchorTop !== -1).length,
        visibleJumpFrames: jumps,
        maxVisibleJumpPx: maxJump,
        totalJumpPx: total,
      };
    });

    // eslint-disable-next-line no-console
    console.log(`PERF-SCROLL-STABILITY ${JSON.stringify(report, null, 2)}`);
    await testInfo.attach('perf-scroll-stability.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    // The jump metric is informational, but a run that never sampled — or
    // whose sampler never located an anchor row, which silently zeroes the
    // jump counts — must not pass as a no-op.
    expect(report.frames).toBeGreaterThan(20);
    expect(report.anchoredFrames).toBeGreaterThan(20);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'perf-thread-scroll-stability');
  });
});
