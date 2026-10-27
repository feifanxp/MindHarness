import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_BUILD_VERSION,
  APP_VERSION_FETCH_TIMEOUT_MS,
  fetchPublishedAppVersion,
  startAppVersionMonitor,
} from './appVersion';

type MockServiceWorkerContainer = EventTarget & {
  register: ReturnType<typeof vi.fn>;
};

describe('app version updates', () => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;
  const originalWindow = globalThis.window;

  let reload: ReturnType<typeof vi.fn>;
  let serviceWorker: MockServiceWorkerContainer;

  beforeEach(() => {
    vi.useFakeTimers();
    reload = vi.fn();
    serviceWorker = new EventTarget() as MockServiceWorkerContainer;
    serviceWorker.register = vi.fn();

    const windowTarget = new EventTarget();
    Object.assign(windowTarget, {
      location: { origin: 'https://chat.example.com', reload },
      setInterval,
      clearInterval,
    });
    const documentTarget = new EventTarget();
    Object.defineProperty(documentTarget, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowTarget });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: documentTarget,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true, serviceWorker },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
  });

  it('returns no version when the opportunistic request fails or is malformed', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ version: '../../not-safe' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ version: '1.0.0+build.123' }),
      });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });

    await expect(fetchPublishedAppVersion()).resolves.toBeUndefined();
    await expect(fetchPublishedAppVersion()).resolves.toBeUndefined();
    await expect(fetchPublishedAppVersion()).resolves.toBe('1.0.0+build.123');
  });

  it('abandons a stalled version request so degraded startup can continue', async () => {
    const fetchMock = vi.fn((_url: URL, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });

    const request = fetchPublishedAppVersion();
    await vi.advanceTimersByTimeAsync(APP_VERSION_FETCH_TIMEOUT_MS);

    await expect(request).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cache-busts the version manifest and does nothing when already current', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ version: APP_BUILD_VERSION }),
    });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
    const stop = startAppVersionMonitor();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const requestedUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requestedUrl.pathname).toBe('/version.json');
    expect(requestedUrl.searchParams.get('cache-bust')).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cache: 'no-store' }));
    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('stages a cache-busted worker without reloading the active page', async () => {
    const publishedVersion = 'abcdef123456';
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ version: publishedVersion }),
      }),
    });
    const nextRegistration = { active: {} };
    serviceWorker.register.mockResolvedValue(nextRegistration);

    const stop = startAppVersionMonitor();
    await vi.waitFor(() => expect(serviceWorker.register).toHaveBeenCalledTimes(1));

    expect(serviceWorker.register).toHaveBeenCalledWith(
      new URL(`https://chat.example.com/sw.js?version=${publishedVersion}&non-disruptive-update=1`),
      expect.objectContaining({ updateViaCache: 'none' })
    );
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('does not register the same staged version again on later checks', async () => {
    const publishedVersion = 'abcdef123456';
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ version: publishedVersion }),
      }),
    });
    serviceWorker.register.mockResolvedValue({ active: {} });

    const stop = startAppVersionMonitor({ pollIntervalMs: 1000 });
    await vi.waitFor(() => expect(serviceWorker.register).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5000);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();

    expect(serviceWorker.register).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('does not fetch or reload while offline', async () => {
    const fetchMock = vi.fn();
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false, serviceWorker },
    });
    const stop = startAppVersionMonitor({ pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });
});
