import { expect, test, type Page } from '@playwright/test';
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
import { loadAllOlderThreadMessages } from '../helpers/threadTimeline';

/**
 * Fast upward scrolling through a long thread must never draw one message
 * over another, or open a seam between two.
 *
 * Virtual tiles are absolutely positioned from virtualizer offsets. A row
 * mounted at its estimate and painted at its real height covers, or leaves a
 * gap before, the next row until the corrected offsets are committed. The
 * sampler checks the DOM in requestAnimationFrame and from a ResizeObserver
 * created after the virtualizer's, which runs after virtual-core handles a
 * resize and before the browser paints.
 *
 * Each frame moves the scroller up by about two viewports, as a phone fling
 * does while the main thread is busy, so rows mount inside the viewport
 * instead of in the prepared buffer above it.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = 240;
const SCROLL_STEP_PX = 1_500;
// Sub-pixel rounding between adjacent tiles is not visible.
const SEAM_TOLERANCE_PX = 1;

type SeamSample = {
  source: 'frame' | 'resize';
  // Positive when the upper row covers the lower one, negative for a gap.
  overlapPx: number;
  upperIndex: number;
  lowerIndex: number;
};

type SeamState = {
  frames: number;
  resizeChecks: number;
  pairChecks: number;
  startScrollTop: number;
  minScrollTop: number;
  samples: SeamSample[];
  stop: () => void;
};

type SeamWindow = Window & { __threadSeams?: SeamState };

// Rich content renders much taller than the text-based row estimate.
const varietyContent = (i: number): Record<string, unknown> => {
  const words = (count: number) =>
    Array.from({ length: count }, (_v, w) => `word${(i * 7 + w) % 97}`).join(' ');
  switch (i % 6) {
    case 0:
      return { msgtype: 'm.text', body: `Short reply ${i}` };
    case 1:
      return { msgtype: 'm.text', body: `Paragraph reply ${i} ${words(160)}` };
    case 2: {
      const items = Array.from({ length: 6 }, (_v, n) => `item ${n} of reply ${i} ${words(12)}`);
      return {
        msgtype: 'm.text',
        body: `List reply ${i}\n${items.map((item) => `- ${item}`).join('\n')}`,
        format: 'org.matrix.custom.html',
        formatted_body: `<p>List reply ${i}</p><ul>${items
          .map((item) => `<li>${item}</li>`)
          .join('')}</ul>`,
      };
    }
    case 3: {
      const code = Array.from({ length: 7 }, (_v, n) => `const value${n} = ${i * n};`).join('\n');
      return {
        msgtype: 'm.text',
        body: `Code reply ${i}\n\`\`\`ts\n${code}\n\`\`\``,
        format: 'org.matrix.custom.html',
        formatted_body: `<p>Code reply ${i}</p><pre><code class="language-ts">${code}</code></pre>`,
      };
    }
    case 4: {
      const rows = Array.from(
        { length: 5 },
        (_v, n) => `<tr><td>row ${n}</td><td>${words(4)}</td><td>${n * i}</td></tr>`
      ).join('');
      return {
        msgtype: 'm.text',
        body: `Table reply ${i}`,
        format: 'org.matrix.custom.html',
        formatted_body: `<p>Table reply ${i}</p><table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead><tbody>${rows}</tbody></table>`,
      };
    }
    default:
      return {
        msgtype: 'm.text',
        body: `Lines reply ${i}\n${Array.from(
          { length: 5 },
          (_v, n) => `line ${n} ${words(9)}`
        ).join('\n')}`,
      };
  }
};

const seedVarietyThread = async (homeserver: string, accessToken: string) => {
  const roomId = await createPrivateRoom(homeserver, accessToken, {
    name: `Fast scroll overlap ${Date.now()}`,
    topic: 'Synthetic fast-scroll seam regression',
  });
  const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Fast scroll overlap root',
  });
  for (let i = 1; i <= REPLY_COUNT; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, accessToken, roomId, {
      ...varietyContent(i),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
  return { roomId, rootId };
};

const installSeamSampler = (page: Page) =>
  page.evaluate((tolerance) => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]');
    let scroller: HTMLElement | null = inner?.parentElement ?? null;
    while (scroller) {
      const { overflowY } = window.getComputedStyle(scroller);
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scroller = scroller.parentElement;
    }
    if (!inner || !scroller) throw new Error('thread virtual container not found');
    const viewport = scroller;
    // The ride scrolls exactly the element this sampler measures against.
    viewport.dataset.e2eSeamScroller = '1';
    const state: SeamState = {
      frames: 0,
      resizeChecks: 0,
      pairChecks: 0,
      startScrollTop: viewport.scrollTop,
      minScrollTop: viewport.scrollTop,
      samples: [],
      stop: () => undefined,
    };
    (window as SeamWindow).__threadSeams = state;

    const check = (source: SeamSample['source']) => {
      const view = viewport.getBoundingClientRect();
      const tiles = Array.from(inner.children)
        .filter(
          (child): child is HTMLElement => child instanceof HTMLElement && !!child.dataset.index
        )
        .map((tile) => ({ index: Number(tile.dataset.index), rect: tile.getBoundingClientRect() }))
        .filter((tile) => tile.rect.height > 0)
        .sort((a, b) => a.index - b.index);
      state.pairChecks += Math.max(0, tiles.length - 1);
      let worst: SeamSample | undefined;
      for (let k = 1; k < tiles.length; k += 1) {
        const upper = tiles[k - 1];
        const lower = tiles[k];
        // Only the part of a seam inside the viewport is visible.
        const seamTop = Math.max(Math.min(upper.rect.bottom, lower.rect.top), view.top);
        const seamBottom = Math.min(Math.max(upper.rect.bottom, lower.rect.top), view.bottom);
        const visiblePx = seamBottom - seamTop;
        const overlapPx = Math.sign(upper.rect.bottom - lower.rect.top) * visiblePx;
        if (visiblePx > tolerance && (!worst || visiblePx > Math.abs(worst.overlapPx))) {
          worst = {
            source,
            overlapPx: Math.round(overlapPx),
            upperIndex: upper.index,
            lowerIndex: lower.index,
          };
        }
      }
      if (worst) state.samples.push(worst);
    };

    let running = true;
    const frame = () => {
      if (!running) return;
      state.frames += 1;
      state.minScrollTop = Math.min(state.minScrollTop, viewport.scrollTop);
      check('frame');
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    const resizeObserver = new ResizeObserver(() => {
      state.resizeChecks += 1;
      check('resize');
    });
    const observeTiles = () => {
      Array.from(inner.children).forEach((child) => resizeObserver.observe(child));
    };
    observeTiles();
    const mutationObserver = new MutationObserver(observeTiles);
    mutationObserver.observe(inner, { childList: true });
    state.stop = () => {
      running = false;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, SEAM_TOLERANCE_PX);

const scrollThreadToTop = (page: Page) =>
  page.evaluate(
    (stepPx) =>
      new Promise<void>((resolve) => {
        const scroller = document.querySelector<HTMLElement>('[data-e2e-seam-scroller="1"]');
        let frames = 0;
        const step = () => {
          if (!scroller || scroller.scrollTop <= 0 || frames >= 400) {
            resolve();
            return;
          }
          frames += 1;
          scroller.scrollTop -= stepPx;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    SCROLL_STEP_PX
  );

const readSeamReport = (page: Page) =>
  page.evaluate(() => {
    const state = (window as SeamWindow).__threadSeams;
    if (!state) throw new Error('seam sampler was not installed');
    state.stop();
    return {
      frames: state.frames,
      resizeChecks: state.resizeChecks,
      pairChecks: state.pairChecks,
      scrolledPx: Math.round(state.startScrollTop - state.minScrollTop),
      seamFrames: state.samples.length,
      worst: [...state.samples]
        .sort((a, b) => Math.abs(b.overlapPx) - Math.abs(a.overlapPx))
        .slice(0, 8),
    };
  });

test.describe('thread fast-scroll overlap', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(600_000);

  test('fast upward scrolling never paints overlapping or separated messages', async ({
    page,
  }, testInfo) => {
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
    const { roomId, rootId } = await seedVarietyThread(homeserver, session.accessToken);

    await loginWithPassword(page, { homeserver, username, password });
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-thread-count] [data-message-item]', { timeout: 60_000 });
    await loadAllOlderThreadMessages(page);
    await page.waitForTimeout(1_500);

    await installSeamSampler(page);
    await scrollThreadToTop(page);
    await page.waitForTimeout(1_000);
    const report = await readSeamReport(page);
    await testInfo.attach('thread-fast-scroll-overlap.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    // A sampler that never ran or never compared two tiles, or a ride that
    // never left the bottom, would pass vacuously.
    expect(report.frames).toBeGreaterThan(10);
    expect(report.resizeChecks).toBeGreaterThan(0);
    expect(report.pairChecks).toBeGreaterThan(report.frames);
    expect(report.scrolledPx).toBeGreaterThan(10_000);
    expect(report.worst).toEqual([]);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'thread-fast-scroll-overlap');
  });
});
