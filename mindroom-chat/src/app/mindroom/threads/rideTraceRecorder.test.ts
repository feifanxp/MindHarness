// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRideTraceRecorder } from './rideTraceRecorder';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
  ledgerQuiescenceSettles: 0,
  ledgerBoundarySettles: 0,
}));

vi.mock('../../utils/dom', () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock('./cacheProbe', () => ({
  getCacheProbeSnapshot: () => ({}),
  getCacheProbeCounter: (key: string) =>
    key === 'ledgerQuiescenceSettles'
      ? mocks.ledgerQuiescenceSettles
      : key === 'ledgerBoundarySettles'
      ? mocks.ledgerBoundarySettles
      : 0,
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
}));

const clickOverlay = async (overlay: HTMLButtonElement): Promise<void> => {
  const result = overlay.onclick?.call(overlay, new MouseEvent('click'));
  await result;
};

describe('ride trace clipboard export', () => {
  beforeEach(() => {
    mocks.ledgerQuiescenceSettles = 0;
    mocks.ledgerBoundarySettles = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    document.querySelectorAll('[data-ride-trace-overlay]').forEach((element) => element.remove());
    vi.restoreAllMocks();
  });

  it('uses the shared clipboard path and confirms a successful export', async () => {
    mocks.copyToClipboard.mockResolvedValue(true);
    const cleanup = installRideTraceRecorder(document.createElement('div'), () => null, {
      roomId: '!room:example.org',
    });
    const overlay = document.querySelector<HTMLButtonElement>('[data-ride-trace-overlay]')!;

    await clickOverlay(overlay);

    expect(mocks.copyToClipboard).toHaveBeenCalledWith(
      expect.stringContaining('"kind":"mindroom-ride-trace"')
    );
    expect(overlay.textContent).toMatch(/^TRACE copied ✓/);
    cleanup();
  });

  it('does not claim clipboard success when every copy path fails', async () => {
    mocks.copyToClipboard.mockResolvedValue(false);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cleanup = installRideTraceRecorder(document.createElement('div'), () => null, {
      roomId: '!room:example.org',
    });
    const overlay = document.querySelector<HTMLButtonElement>('[data-ride-trace-overlay]')!;

    await clickOverlay(overlay);

    expect(overlay.textContent).toBe('TRACE in console');
    expect(consoleLog).toHaveBeenCalledWith(
      '[ride-trace]',
      expect.stringContaining('"kind":"mindroom-ride-trace"')
    );
    cleanup();
  });

  it('exports per-frame ledger settlement causes in the v3 trace schema', async () => {
    mocks.copyToClipboard.mockResolvedValue(true);
    const animationFrames: FrameRequestCallback[] = [];
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    const cleanup = installRideTraceRecorder(scroller, () => null, {
      roomId: '!room:example.org',
      threadId: '$thread',
    });

    animationFrames.shift()?.(16);
    mocks.ledgerQuiescenceSettles = 1;
    animationFrames.shift()?.(32);
    mocks.ledgerBoundarySettles = 2;
    animationFrames.shift()?.(48);
    const overlay = document.querySelector<HTMLButtonElement>('[data-ride-trace-overlay]')!;
    await clickOverlay(overlay);

    const payload = mocks.copyToClipboard.mock.calls.at(-1)?.[0];
    expect(payload).toBeDefined();
    const trace = JSON.parse(payload!) as {
      version: number;
      frames: Array<{ lq?: number; lb?: number }>;
    };
    expect(trace.version).toBe(3);
    expect(trace.frames).toHaveLength(3);
    expect(trace.frames.map(({ lq, lb }) => ({ lq, lb }))).toEqual([
      { lq: 0, lb: 0 },
      { lq: 1, lb: 0 },
      { lq: 1, lb: 2 },
    ]);

    cleanup();
    scroller.remove();
  });
});
