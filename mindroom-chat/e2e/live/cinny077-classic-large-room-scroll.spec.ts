import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  setAccountData,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const MESSAGE_COUNT = 700;
type Row = { id: string; top: number; bottom: number; height: number };
type Sample = {
  time: number;
  phase: 'raf' | 'task';
  rootTop: number;
  rootBottom: number;
  clientHeight: number;
  scrollTop: number;
  scrollHeight: number;
  latest: Row | null;
  latestPaintVisible: boolean;
  rows: Row[];
};
type RecorderWindow = Window & { classicSamples: Sample[]; classicStop: boolean };
type Paint = { timestamp: number; data: string };
type PaintedMarker = {
  timestamp: number;
  latestTop: number | null;
  latestBottom: number | null;
  rootBottom: number | null;
  anchorTop: number | null;
  anchorBottom: number | null;
};

const sendLargeRoomMessages = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  stamp: number
) => {
  let nextIndex = 1;
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      while (nextIndex <= MESSAGE_COUNT) {
        const index = nextIndex;
        nextIndex += 1;
        await matrixFetch(
          homeserver,
          `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/cinny-077-${stamp}-${index}`,
          {
            method: 'PUT',
            accessToken,
            body: JSON.stringify({
              msgtype: 'm.text',
              body: `CINNY-077 classic large room ${stamp} message ${String(index).padStart(
                4,
                '0'
              )}`,
            }),
          }
        );
      }
    })
  );
  // Concurrent workers do not define event order. Preserve the server's latest event.
  const tail = await matrixFetch<{ chunk: { event_id: string }[] }>(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=2`,
    { accessToken }
  );
  expect(tail.chunk).toHaveLength(2);
  return { latestEventId: tail.chunk[0].event_id, anchorEventId: tail.chunk[1].event_id };
};

test.describe('CINNY-077: classic large room loading scroll stability', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test('opening a large classic room does not jump while backfill is loading', async ({
    page,
  }, testInfo) => {
    test.slow();
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    await setAccountData(homeserver, accessToken, userId, 'io.mindroom.settings', {
      simpleMode: false,
    });
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-077 Classic Large ${stamp}`,
      topic: 'Regression fixture for classic large-room loading scroll stability.',
    });
    const { latestEventId, anchorEventId } = await sendLargeRoomMessages(
      homeserver,
      accessToken,
      roomId,
      stamp
    );
    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      viewMode: 'classic',
      filterState: createDefaultThreadFilterState(),
    });
    // The visible timeline pages backward from its sync token. The engine's
    // offline save of the focused room starts at the live end (no `from`),
    // because this fresh account has no committed offline cursor yet.
    const timelineBackPages: string[] = [];
    let offlineHistoryPages = 0;
    const backfillReleases: number[] = [];
    await page.route(/\/rooms\/.*\/messages(?:\?|$)/, async (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('dir') === 'b') {
        const from = params.get('from');
        if (from) timelineBackPages.push(from);
        else offlineHistoryPages += 1;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
      if (new URL(route.request().url()).searchParams.get('dir') === 'b')
        backfillReleases.push(Date.now());
      await route.continue();
    });
    await page.addInitScript(
      ({ latestId, anchorId }) => {
        const recorder = window as RecorderWindow;
        recorder.classicSamples = [];
        recorder.classicStop = false;
        let root: HTMLElement | null = null;
        let started = false;
        const sample = (phase: 'raf' | 'task') => {
          if (recorder.classicStop) return;
          const latest = document.querySelector<HTMLElement>(
            `[data-message-id="${CSS.escape(latestId)}"]`
          );
          if (!root && latest) {
            let candidate = latest.parentElement;
            while (candidate) {
              if (['auto', 'scroll'].includes(getComputedStyle(candidate).overflowY)) {
                root = candidate;
                break;
              }
              candidate = candidate.parentElement;
            }
          }
          if (!root) return;
          // Outlines affect paint only; neither marker changes layout or measurement.
          root.style.outline = '3px solid rgb(0, 255, 255)';
          root.style.outlineOffset = '-3px';
          if (latest) {
            latest.style.outline = '3px solid rgb(255, 0, 255)';
            latest.style.outlineOffset = '-3px';
          }
          const anchor = document.querySelector<HTMLElement>(
            `[data-message-id="${CSS.escape(anchorId)}"]`
          );
          if (anchor) {
            anchor.style.outline = '3px solid rgb(255, 255, 0)';
            anchor.style.outlineOffset = '-3px';
          }
          const rect = root.getBoundingClientRect();
          const row = (element: HTMLElement): Row => {
            const bounds = element.getBoundingClientRect();
            return {
              id: element.dataset.messageId ?? '',
              top: bounds.top,
              bottom: bounds.bottom,
              height: bounds.height,
            };
          };
          const latestRow = latest ? row(latest) : null;
          if (latestRow && latestRow.bottom > rect.top && latestRow.top < rect.bottom)
            started = true;
          if (!started) return;
          recorder.classicSamples.push({
            time: performance.now(),
            phase,
            rootTop: rect.top,
            rootBottom: rect.bottom,
            clientHeight: root.clientHeight,
            scrollTop: root.scrollTop,
            scrollHeight: root.scrollHeight,
            latest: latestRow,
            latestPaintVisible: !!latest && getComputedStyle(latest).visibility === 'visible',
            rows: Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).map(row),
          });
        };
        const tick = () => {
          if (recorder.classicStop) return;
          sample('raf');
          // ResizeObserver runs after rAF; pair it with a task and retain painted proof.
          setTimeout(() => sample('task'), 0);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { latestId: latestEventId, anchorId: anchorEventId }
    );
    const session = await page.context().newCDPSession(page);
    const frames: Paint[] = [];
    const acknowledgements: Promise<void>[] = [];
    const captureErrors: string[] = [];
    session.on('Page.screencastFrame', (frame) => {
      frames.push({ timestamp: frame.metadata.timestamp ?? 0, data: frame.data });
      acknowledgements.push(
        session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).then(
          () => undefined,
          (error: unknown) => {
            captureErrors.push(String(error));
          }
        )
      );
    });
    await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const latestRow = page
      .getByTestId('room-virtual-inner')
      .locator(`[data-message-id="${latestEventId}"]`);
    await expect(latestRow).toHaveCount(1);
    await expect(latestRow).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(12_000);
    const samples = await page.evaluate(() => {
      const recorder = window as RecorderWindow;
      recorder.classicStop = true;
      return recorder.classicSamples;
    });
    await session.send('Page.stopScreencast');
    await Promise.all(acknowledgements);
    await session.detach();
    const painted = await page.evaluate(async (captured): Promise<PaintedMarker[]> => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Compositor frame decoding unavailable');
      const output: PaintedMarker[] = [];
      for (const frame of captured) {
        // eslint-disable-next-line no-await-in-loop
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Missing compositor image'));
          img.src = `data:image/png;base64,${frame.data}`;
        });
        canvas.width = image.width;
        canvas.height = image.height;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        let latestTop: number | null = null;
        let latestBottom: number | null = null;
        let rootBottom: number | null = null;
        let anchorTop: number | null = null;
        let anchorBottom: number | null = null;
        for (let y = 0; y < image.height; y += 1) {
          for (let x = 0; x < image.width; x += 1) {
            const offset = (y * image.width + x) * 4;
            const r = pixels[offset];
            const g = pixels[offset + 1];
            const b = pixels[offset + 2];
            if (r > 245 && g < 10 && b > 245) {
              latestTop ??= y;
              latestBottom = y;
            }
            if (r < 10 && g > 245 && b > 245) rootBottom = y;
            if (r > 245 && g > 245 && b < 10) {
              anchorTop ??= y;
              anchorBottom = y;
            }
          }
        }
        output.push({
          timestamp: frame.timestamp,
          latestTop,
          latestBottom,
          rootBottom,
          anchorTop,
          anchorBottom,
        });
      }
      return output;
    }, frames);
    const firstMarker = painted.findIndex(
      (frame) => frame.latestTop !== null && frame.rootBottom !== null
    );
    const trackedFrames = painted.slice(Math.max(0, firstMarker));
    const taskSamples = samples.filter((sample) => sample.phase === 'task');
    const taskDrifts = taskSamples.slice(1).map((sample, index) => {
      const previous = taskSamples[index];
      if (!sample.latest || !previous.latest) return Infinity;
      const topMove = sample.latest.top - previous.latest.top;
      const resize = sample.rootBottom - previous.rootBottom;
      const ownResize = sample.latest.height - previous.latest.height;
      return Math.min(Math.abs(topMove - resize), Math.abs(topMove - resize + ownResize));
    });
    const paintDrifts = trackedFrames.slice(1).map((frame, index) => {
      const previous = trackedFrames[index];
      if (
        frame.latestTop === null ||
        frame.latestBottom === null ||
        frame.rootBottom === null ||
        previous.latestTop === null ||
        previous.latestBottom === null ||
        previous.rootBottom === null
      )
        return Infinity;
      const resize = frame.rootBottom - previous.rootBottom;
      return Math.min(
        Math.abs(frame.latestTop - previous.latestTop - resize),
        Math.abs(frame.latestBottom - previous.latestBottom - resize)
      );
    });
    const baseline = trackedFrames[0];
    const totalPaintDrifts = trackedFrames.map((frame) => {
      if (
        !baseline ||
        frame.latestTop === null ||
        frame.latestBottom === null ||
        frame.rootBottom === null ||
        baseline.latestTop === null ||
        baseline.latestBottom === null ||
        baseline.rootBottom === null
      )
        return Infinity;
      const resize = frame.rootBottom - baseline.rootBottom;
      return Math.min(
        Math.abs(frame.latestTop - baseline.latestTop - resize),
        Math.abs(frame.latestBottom - baseline.latestBottom - resize)
      );
    });
    const anchorPaintDrifts = trackedFrames.map((frame) => {
      if (
        !baseline ||
        frame.anchorTop === null ||
        frame.anchorBottom === null ||
        frame.rootBottom === null ||
        baseline.anchorTop === null ||
        baseline.anchorBottom === null ||
        baseline.rootBottom === null
      )
        return Infinity;
      const resize = frame.rootBottom - baseline.rootBottom;
      return Math.min(
        Math.abs(frame.anchorTop - baseline.anchorTop - resize),
        Math.abs(frame.anchorBottom - baseline.anchorBottom - resize)
      );
    });
    await testInfo.attach('classic-visual-evidence', {
      body: JSON.stringify(
        {
          latestEventId,
          anchorEventId,
          timelineBackPages,
          offlineHistoryPages,
          backfillReleases,
          samples,
          painted,
          taskDrifts,
          paintDrifts,
          totalPaintDrifts,
          anchorPaintDrifts,
          captureErrors,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    const badFrame = paintDrifts.findIndex((drift) => drift > 2);
    if (badFrame >= 0)
      await testInfo.attach('classic-bad-painted-frame', {
        body: Buffer.from(frames[firstMarker + badFrame + 1].data, 'base64'),
        contentType: 'image/png',
      });
    expect(firstMarker, 'Latest marker never reached compositor').toBeGreaterThanOrEqual(0);
    expect(captureErrors, 'Compositor acknowledgement failed').toEqual([]);
    expect(trackedFrames.length, 'Insufficient compositor coverage').toBeGreaterThanOrEqual(3);
    expect(taskSamples.length, 'Missing post-rAF samples').toBeGreaterThan(100);
    expect(backfillReleases.length, 'Fixture must exercise real backward fill').toBeGreaterThan(0);
    expect(
      baseline.timestamp * 1000,
      'Original visible anchor must precede first backfill release'
    ).toBeLessThan(backfillReleases[0]);
    expect(
      trackedFrames[trackedFrames.length - 1].timestamp * 1000,
      'Missing compositor coverage after backfill'
    ).toBeGreaterThan(backfillReleases[backfillReleases.length - 1]);
    expect(
      Math.max(...paintDrifts, ...totalPaintDrifts, ...anchorPaintDrifts),
      'Painted latest-event displacement, corrected for viewport and own row resize'
    ).toBeLessThanOrEqual(2);
    expect(timelineBackPages, 'Visible timeline must fill with one backward page').toHaveLength(1);
    // Unknown (non-Wi-Fi) connections allow one 200-event offline page per visit.
    expect(
      offlineHistoryPages,
      'Offline history must stay within its visit allowance'
    ).toBeLessThanOrEqual(1);
  });
});
