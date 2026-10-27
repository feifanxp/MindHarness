import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { abortRelationsContinuations } from '../helpers/rideRecorder';
import { loadAllOlderThreadMessages } from '../helpers/threadTimeline';

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = 450;
const iPhone13 = devices['iPhone 13'];

test.use({
  viewport: iPhone13.viewport,
  userAgent: iPhone13.userAgent,
  deviceScaleFactor: iPhone13.deviceScaleFactor,
  isMobile: iPhone13.isMobile,
  hasTouch: iPhone13.hasTouch,
});

type VisibleAnchor = {
  bottom: number;
  eventId: string;
  top: number;
  text: string;
  viewportBottom: number;
  viewportTop: number;
};

type LoadOlderClick = {
  clicked: boolean;
  clickedAt: number;
};

type ThreadViewport = {
  anchorIntersects: boolean;
  bottomGap: number;
  threadCount: number;
};

type HeldContinuation = {
  eventIds: string[];
  requestStartedAt: number;
  status: number;
  url: string;
};

type AnchorSample = {
  found: boolean;
  textMatches: boolean;
  threadCount: number;
  top: number | null;
};

type CleanupStep = {
  name: string;
  run: () => Promise<unknown> | unknown;
};

const waitForContinuationWithDeadline = async <T>(
  continuation: Promise<T>,
  timeoutMs = 5_000
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      continuation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `Timed out after ${timeoutMs}ms waiting for the target thread continuation after Load Older activation`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

const runReleaseFirstCleanup = async (
  releaseBarrier: () => Promise<unknown> | unknown,
  steps: CleanupStep[]
): Promise<void> => {
  const failures: { name: string; reason: unknown }[] = [];
  try {
    await releaseBarrier();
  } catch (reason) {
    failures.push({ name: 'release barrier', reason });
  }

  const results = await Promise.allSettled(
    steps.map(async (step) => {
      await step.run();
    })
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failures.push({ name: steps[index].name, reason: result.reason });
    }
  });

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `CINNY-070 cleanup failed: ${failures.map((failure) => failure.name).join(', ')}`
    );
  }
};

const readThreadViewport = async (page: import('@playwright/test').Page): Promise<ThreadViewport> =>
  page.evaluate(() => {
    const firstMessage = document.querySelector<HTMLElement>('[data-message-id]');
    let scrollContainer: HTMLElement | null = firstMessage?.parentElement ?? null;
    while (scrollContainer) {
      const { overflowY } = window.getComputedStyle(scrollContainer);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        scrollContainer.scrollHeight > scrollContainer.clientHeight
      ) {
        break;
      }
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer) {
      return { anchorIntersects: false, bottomGap: 0, threadCount: -1 };
    }

    const viewport = scrollContainer.getBoundingClientRect();
    const anchorIntersects = Array.from(
      scrollContainer.querySelectorAll<HTMLElement>('[data-message-id]')
    ).some((message) => {
      const rect = message.getBoundingClientRect();
      return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
    });
    const threadCount = Number(
      scrollContainer.querySelector<HTMLElement>('[data-thread-count]')?.dataset.threadCount ?? -1
    );
    return {
      anchorIntersects,
      bottomGap:
        scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop,
      threadCount,
    };
  });

const wheelToSettledReadingPosition = async (
  page: import('@playwright/test').Page
): Promise<ThreadViewport> => {
  await page.locator('[data-message-id]').last().hover();
  await page.mouse.wheel(0, -800);
  await expect
    .poll(async () => {
      const viewport = await readThreadViewport(page);
      return viewport.bottomGap > 0 && viewport.anchorIntersects;
    })
    .toBe(true);
  return readThreadViewport(page);
};

const holdNextRelationsContinuation = async (
  page: import('@playwright/test').Page,
  roomId: string,
  rootId: string
): Promise<{
  dispose: () => Promise<void>;
  ready: Promise<HeldContinuation>;
  release: () => void;
}> => {
  const matcher = (url: URL) => {
    const path = decodeURIComponent(url.pathname);
    return path.includes(`/rooms/${roomId}/relations/${rootId}`) && url.searchParams.has('from');
  };
  let resolveReady!: (value: HeldContinuation) => void;
  let rejectReady!: (reason: unknown) => void;
  let resolveRelease!: () => void;
  let captured = false;
  let released = false;
  const ready = new Promise<HeldContinuation>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const releaseGate = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const release = () => {
    if (released) return;
    released = true;
    resolveRelease();
  };
  const handler = async (route: import('@playwright/test').Route) => {
    if (captured) {
      if (released) {
        await route.continue();
      } else {
        await route.abort();
      }
      return;
    }
    captured = true;
    const requestStartedAt = Date.now();
    try {
      const response = await route.fetch();
      const body = (await response.json()) as { chunk?: { event_id?: unknown }[] };
      resolveReady({
        eventIds: (body.chunk ?? [])
          .map((event) => event.event_id)
          .filter((eventId): eventId is string => typeof eventId === 'string'),
        requestStartedAt,
        status: response.status(),
        url: route.request().url(),
      });
      await releaseGate;
      await route.fulfill({ response });
    } catch (error) {
      rejectReady(error);
      throw error;
    }
  };
  await page.route(matcher, handler);
  return {
    dispose: async () => {
      release();
      await page.unroute(matcher, handler);
    },
    ready,
    release,
  };
};

const startAnchorSampler = async (
  page: import('@playwright/test').Page,
  anchor: VisibleAnchor
): Promise<void> =>
  page.evaluate((expected) => {
    const sampleWindow = window as typeof window & {
      __cinny070AnchorSampler?: {
        active: boolean;
        samples: AnchorSample[];
      };
    };
    const sampler = { active: true, samples: [] as AnchorSample[] };
    sampleWindow.__cinny070AnchorSampler = sampler;
    const sample = () => {
      const anchorElement = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(expected.eventId)}"]`
      );
      const scrollContainer = (() => {
        const firstMessage = document.querySelector<HTMLElement>('[data-message-id]');
        let candidate: HTMLElement | null = firstMessage?.parentElement ?? null;
        while (candidate) {
          const { overflowY } = window.getComputedStyle(candidate);
          if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            candidate.scrollHeight > candidate.clientHeight
          ) {
            break;
          }
          candidate = candidate.parentElement;
        }
        return candidate;
      })();
      sampler.samples.push({
        found: !!anchorElement,
        textMatches: anchorElement?.textContent === expected.text,
        threadCount: Number(
          scrollContainer?.querySelector<HTMLElement>('[data-thread-count]')?.dataset.threadCount ??
            -1
        ),
        top: anchorElement?.getBoundingClientRect().top ?? null,
      });
      if (sampler.active) window.requestAnimationFrame(sample);
    };
    window.requestAnimationFrame(sample);
  }, anchor);

const stopAnchorSampler = async (page: import('@playwright/test').Page): Promise<AnchorSample[]> =>
  page.evaluate(() => {
    const sampleWindow = window as typeof window & {
      __cinny070AnchorSampler?: {
        active: boolean;
        samples: AnchorSample[];
      };
    };
    const sampler = sampleWindow.__cinny070AnchorSampler;
    if (!sampler) return [];
    sampler.active = false;
    return sampler.samples;
  });

const readAnchorSamples = async (page: import('@playwright/test').Page): Promise<AnchorSample[]> =>
  page.evaluate(() => {
    const sampleWindow = window as typeof window & {
      __cinny070AnchorSampler?: { samples: AnchorSample[] };
    };
    return sampleWindow.__cinny070AnchorSampler?.samples ?? [];
  });

const captureVisibleThreadAnchor = async (
  page: import('@playwright/test').Page,
  expectedEventIds: string[]
): Promise<VisibleAnchor | null> =>
  page.evaluate((expectedIds) => {
    const firstMessage = document.querySelector<HTMLElement>('[data-message-id]');
    if (!firstMessage) return null;

    let scrollContainer: HTMLElement | null = firstMessage.parentElement;
    while (scrollContainer) {
      const { overflowY } = window.getComputedStyle(scrollContainer);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        scrollContainer.scrollHeight > scrollContainer.clientHeight
      ) {
        break;
      }
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer) return null;

    const scrollRect = scrollContainer.getBoundingClientRect();
    const messageItems = Array.from(
      scrollContainer.querySelectorAll<HTMLElement>('[data-message-id]')
    );
    const anchor = messageItems.find((item) => {
      if (!expectedIds.includes(item.getAttribute('data-message-id') ?? '')) return false;
      const rect = item.getBoundingClientRect();
      return rect.top >= scrollRect.top && rect.bottom <= scrollRect.bottom;
    });
    const eventId = anchor?.getAttribute('data-message-id');
    if (!anchor || !eventId) return null;

    return {
      bottom: anchor.getBoundingClientRect().bottom,
      eventId,
      top: anchor.getBoundingClientRect().top,
      text: anchor.textContent ?? '',
      viewportBottom: scrollRect.bottom,
      viewportTop: scrollRect.top,
    };
  }, expectedEventIds);

const clickLoadOlderAtomically = async (
  page: import('@playwright/test').Page
): Promise<LoadOlderClick> =>
  page.evaluate(() => {
    const loadOlderButton = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]')
    ).find((button) => {
      const label =
        button.getAttribute('aria-label') ?? button.getAttribute('title') ?? button.textContent;
      return label?.includes('Load Older Messages');
    });
    const clickedAt = Date.now();
    loadOlderButton?.click();

    return {
      clicked: !!loadOlderButton,
      clickedAt,
    };
  });

const getAnchorDisplacement = async (
  page: import('@playwright/test').Page,
  anchor: VisibleAnchor
): Promise<{ found: boolean; top: number | null; text: string }> =>
  page.evaluate((expected) => {
    const anchorElement = document.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(expected.eventId)}"]`
    );
    if (!anchorElement) {
      return { found: false, top: null, text: '' };
    }
    return {
      found: true,
      top: anchorElement.getBoundingClientRect().top,
      text: anchorElement.textContent ?? '',
    };
  }, anchor);

test.describe('CINNY-070: thread prepend pagination preserves scroll anchor', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('loading older thread messages does not jump back to the thread bottom', async ({
    page,
  }, testInfo) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `CINNY-070 ${stamp}`,
      topic: 'Regression fixture for thread prepend scroll anchoring',
    });
    const rootBody = `CINNY-070 long thread root ${stamp}`;

    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: rootBody,
      },
      'cinny-070-root'
    );

    const replyIds: string[] = [];
    for (let index = 1; index <= REPLY_COUNT; index += 1) {
      const replyId = await sendRoomMessage(
        homeserver,
        session.accessToken,
        roomId,
        {
          msgtype: 'm.text',
          body: `CINNY-070 reply ${index}`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: rootId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: rootId },
          },
        },
        `cinny-070-reply-${index}`
      );
      replyIds.push(replyId);
    }

    const initialResponseIds = new Set<string>();
    const initialResponseReads: Promise<void>[] = [];
    const recordInitialRelationResponse = (response: import('@playwright/test').Response) => {
      const url = new URL(response.url());
      const path = decodeURIComponent(url.pathname);
      if (!path.includes(`/rooms/${roomId}/relations/${rootId}`) || url.searchParams.has('from')) {
        return;
      }
      initialResponseReads.push(
        response.json().then((body: { chunk?: { event_id?: unknown }[] }) => {
          (body.chunk ?? []).forEach((event) => {
            if (typeof event.event_id === 'string') initialResponseIds.add(event.event_id);
          });
        })
      );
    };
    page.on('response', recordInitialRelationResponse);

    let unrouteAbort: (() => Promise<void>) | undefined;
    let continuationBarrier: Awaited<ReturnType<typeof holdNextRelationsContinuation>> | undefined;
    let samplerStarted = false;
    let samples: AnchorSample[] = [];

    try {
      // Abort continuation pages before login so room overview work cannot
      // drain this target thread before its reading position is established.
      unrouteAbort = await abortRelationsContinuations(page);

      await loginWithPassword(page, { homeserver, username, password });
      await seedRoomOverviewState({
        page,
        roomId,
        userId: session.userId,
        viewMode: 'threaded',
        filterState: createDefaultThreadFilterState(),
      });

      await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);

      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-message-id]').first()).toBeVisible({ timeout: 30_000 });

      const loadOlderButton = page.getByRole('button', { name: 'Load Older Messages' });
      await expect(loadOlderButton).toBeVisible({ timeout: 30_000 });

      const readingViewport = await wheelToSettledReadingPosition(page);
      expect(readingViewport.bottomGap).toBeGreaterThan(0);
      expect(readingViewport.anchorIntersects).toBe(true);
      expect(readingViewport.threadCount).toBeGreaterThan(0);
      expect(readingViewport.threadCount).toBeLessThan(REPLY_COUNT + 1);
      const initialViewport = readingViewport;

      const anchor = await captureVisibleThreadAnchor(page, replyIds);
      expect(anchor).not.toBeNull();
      if (!anchor) throw new Error('No fully intersecting thread anchor was available');
      expect(anchor.bottom).toBeLessThanOrEqual(anchor.viewportBottom);
      expect(anchor.top).toBeGreaterThanOrEqual(anchor.viewportTop);
      expect(replyIds).toContain(anchor.eventId);
      expect(anchor.text).toContain('CINNY-070 reply');

      await startAnchorSampler(page, anchor);
      samplerStarted = true;

      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => resolve());
          })
      );
      const preReleaseSamples = await readAnchorSamples(page);
      const preReleaseSample = preReleaseSamples.at(-1);
      expect(preReleaseSample?.found).toBe(true);
      expect(preReleaseSample?.textMatches).toBe(true);
      expect(preReleaseSample?.threadCount).toBe(initialViewport.threadCount);

      // Newer route handlers run before older handlers. Install a one-page
      // real-response barrier while abort remains armed, then use the chip's
      // DOM activation so Playwright cannot scroll it into view and disturb
      // the established anchor.
      continuationBarrier = await holdNextRelationsContinuation(page, roomId, rootId);
      const loadOlderClick = await clickLoadOlderAtomically(page);
      expect(loadOlderClick.clicked).toBe(true);
      const heldContinuation = await waitForContinuationWithDeadline(continuationBarrier.ready);
      expect((await readThreadViewport(page)).threadCount).toBe(initialViewport.threadCount);
      await Promise.all(initialResponseReads);
      page.off('response', recordInitialRelationResponse);
      const preReleaseResponseIds = [...initialResponseIds];
      const preReleaseResponseIdSet = new Set(preReleaseResponseIds);
      const newlyIntroducedReplyIds = heldContinuation.eventIds.filter(
        (eventId) => replyIds.includes(eventId) && !preReleaseResponseIdSet.has(eventId)
      );
      expect(heldContinuation.status).toBe(200);
      expect(newlyIntroducedReplyIds.length).toBeGreaterThan(0);

      await unrouteAbort();
      unrouteAbort = undefined;
      continuationBarrier.release();

      await expect
        .poll(async () => (await readThreadViewport(page)).threadCount, {
          message: 'Expected the held real continuation page to grow the partial thread window',
        })
        .toBeGreaterThan(initialViewport.threadCount);
      const observedCountAfterFirstGrowth = (await readThreadViewport(page)).threadCount;

      const drainActivations = await loadAllOlderThreadMessages(page);
      await expect
        .poll(async () => (await readThreadViewport(page)).threadCount, {
          timeout: 30_000,
          message: 'Expected the thread window to cover the root and all 450 replies',
        })
        .toBe(REPLY_COUNT + 1);

      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
          })
      );
      samples = await stopAnchorSampler(page);
      samplerStarted = false;

      expect(samples.length).toBeGreaterThan(0);
      const missingAnchorSampleCount = samples.filter((sample) => !sample.found).length;
      const textMismatchSampleCount = samples.filter((sample) => !sample.textMatches).length;
      expect(missingAnchorSampleCount).toBe(0);
      expect(textMismatchSampleCount).toBe(0);
      const growthSamples = samples.filter(
        (sample) => sample.threadCount > initialViewport.threadCount
      );
      expect(growthSamples.length).toBeGreaterThan(0);
      const firstSampledGrowthCount = growthSamples[0]?.threadCount ?? -1;
      expect(firstSampledGrowthCount).toBeGreaterThan(initialViewport.threadCount);
      const maxAnchorDrift = Math.max(
        ...samples.map((sample) => Math.abs((sample.top ?? Number.POSITIVE_INFINITY) - anchor.top))
      );
      expect(maxAnchorDrift).toBeLessThanOrEqual(64);

      const displacement = await getAnchorDisplacement(page, anchor);
      expect(displacement.found).toBe(true);
      expect(displacement.text).toBe(anchor.text);
      expect(Math.abs((displacement.top ?? 0) - anchor.top)).toBeLessThanOrEqual(64);
      await expect(page.getByText('Failed to load this thread')).toHaveCount(0);

      const requestOwnership =
        heldContinuation.requestStartedAt >= loadOlderClick.clickedAt
          ? 'manual-click-correlated'
          : 'background-before-click';
      const evidence = {
        anchor: {
          eventId: anchor.eventId,
          initialBottom: anchor.bottom,
          maxDriftPx: maxAnchorDrift,
          text: anchor.text,
          top: anchor.top,
          viewportBottom: anchor.viewportBottom,
          viewportTop: anchor.viewportTop,
        },
        drainActivations,
        finalThreadCount: (await readThreadViewport(page)).threadCount,
        firstSampledGrowthCount,
        growthSampleCount: growthSamples.length,
        heldResponseEventIds: heldContinuation.eventIds,
        initialResponseEventIds: preReleaseResponseIds,
        initialThreadCount: initialViewport.threadCount,
        missingAnchorSampleCount,
        newlyIntroducedReplyIds,
        observedCountAfterFirstGrowth,
        preReleaseSample,
        readingPosition: readingViewport,
        requestOwnership,
        requestStartedAt: heldContinuation.requestStartedAt,
        sampleCount: samples.length,
        textMismatchSampleCount,
      };
      // eslint-disable-next-line no-console
      console.log(
        `CINNY-070-PREPEND ${JSON.stringify({
          anchor: evidence.anchor,
          finalThreadCount: evidence.finalThreadCount,
          firstSampledGrowthCount,
          growthSampleCount: growthSamples.length,
          heldResponseEventCount: heldContinuation.eventIds.length,
          initialThreadCount: initialViewport.threadCount,
          missingAnchorSampleCount,
          newlyIntroducedReplyIds,
          observedCountAfterFirstGrowth,
          readingPosition: readingViewport,
          requestOwnership,
          sampleCount: samples.length,
          textMismatchSampleCount,
        })}`
      );
      await testInfo.attach('cinny070-prepend-evidence.json', {
        body: JSON.stringify({ evidence, samples }, null, 2),
        contentType: 'application/json',
      });

      await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny070-thread-prepend-scroll');
    } finally {
      await runReleaseFirstCleanup(
        () => continuationBarrier?.release(),
        [
          {
            name: 'anchor sampler',
            run: async () => {
              if (samplerStarted) samples = await stopAnchorSampler(page);
            },
          },
          {
            name: 'continuation route',
            run: () => continuationBarrier?.dispose(),
          },
          {
            name: 'abort route',
            run: () => unrouteAbort?.(),
          },
          {
            name: 'response listener',
            run: () => page.off('response', recordInitialRelationResponse),
          },
          {
            name: 'response readers',
            run: () => Promise.all(initialResponseReads),
          },
        ]
      );
    }
  });
});
