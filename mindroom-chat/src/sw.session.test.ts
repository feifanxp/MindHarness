import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: vi.fn(),
  PrecacheController: class PrecacheController {
    strategy = { cacheName: 'test-precache' };

    activate = vi.fn().mockResolvedValue(undefined);

    addToCacheList = vi.fn();

    createHandlerBoundToURL = vi.fn(() => vi.fn());

    install = vi.fn().mockResolvedValue(undefined);
  },
  PrecacheRoute: class PrecacheRoute {},
}));

vi.mock('workbox-routing', () => ({
  NavigationRoute: class NavigationRoute {},
  registerRoute: vi.fn(),
}));

const APP_ORIGIN = 'https://app.example';
const HOMESERVER = 'https://matrix.example';
const MEDIA_URL = `${HOMESERVER}/_matrix/client/v1/media/download/example.org/media-id`;

type CapturedListener = (event: unknown) => void;

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const loadServiceWorker = async () => {
  vi.resetModules();
  // Sets per type: the legacy token fallback registers (and removes) its own
  // transient 'message' listener alongside the main handler.
  const listeners = new Map<string, Set<CapturedListener>>();
  const client = {
    id: 'client-a',
    url: `${APP_ORIGIN}/rooms`,
    postMessage: vi.fn(),
  };
  const clients = {
    claim: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(async (clientId: string) => (clientId === client.id ? client : undefined)),
    matchAll: vi.fn().mockResolvedValue([client]),
  };
  const scope = {
    __WB_MANIFEST: [],
    location: { href: `${APP_ORIGIN}/sw.js?non-disruptive-update=1`, origin: APP_ORIGIN },
    registration: { active: null, scope: `${APP_ORIGIN}/` },
    clients,
    addEventListener: (type: string, listener: CapturedListener) => {
      const typeListeners = listeners.get(type) ?? new Set();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    removeEventListener: (type: string, listener: CapturedListener) => {
      listeners.get(type)?.delete(listener);
    },
    skipWaiting: vi.fn(),
  };
  vi.stubGlobal('self', scope);

  await import('./sw');

  const dispatchMessage = (
    data: Record<string, unknown>,
    source: { id: string; url: string } = client
  ) => {
    [...(listeners.get('message') ?? [])].forEach((listener) => listener({ data, source }));
  };
  const dispatchFetch = (url = MEDIA_URL): Promise<Response> => {
    const request = new Request(url);
    let response: Promise<Response> | undefined;
    [...(listeners.get('fetch') ?? [])][0]?.({
      clientId: client.id,
      request,
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });
    if (!response) throw new Error('Service worker did not handle the media request.');
    return response;
  };

  return { client, dispatchFetch, dispatchMessage };
};

describe('service worker session handshake', () => {
  const fetchMock = vi.fn(async () => new Response('ok'));

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('authenticates matching media without requesting over a mismatched bound session', async () => {
    const { client, dispatchFetch, dispatchMessage } = await loadServiceWorker();
    dispatchMessage({ type: 'setSession', accessToken: 'token-a', baseUrl: HOMESERVER });

    await dispatchFetch();
    const authenticatedInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(authenticatedInit.headers).get('Authorization')).toBe('Bearer token-a');

    fetchMock.mockClear();
    client.postMessage.mockClear();
    await dispatchFetch(
      'https://other.example/_matrix/client/v1/media/download/example.org/media-id'
    );

    expect(client.postMessage).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toHaveLength(1);
  });

  it('ignores cross-origin updates and resolves pending requests after invalidation', async () => {
    const { client, dispatchFetch, dispatchMessage } = await loadServiceWorker();
    dispatchMessage({ type: 'setSession', accessToken: 'token-a', baseUrl: HOMESERVER });
    dispatchMessage(
      { type: 'setSession', accessToken: 'evil-token', baseUrl: HOMESERVER },
      { id: client.id, url: 'https://evil.example/' }
    );

    await dispatchFetch();
    const authenticatedInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(authenticatedInit.headers).get('Authorization')).toBe('Bearer token-a');

    dispatchMessage({ type: 'setSession', accessToken: '', baseUrl: HOMESERVER });
    fetchMock.mockClear();
    client.postMessage.mockClear();
    const pendingFetch = dispatchFetch();
    await flushMicrotasks();
    expect(client.postMessage).toHaveBeenCalledOnce();
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'requestSession' });

    dispatchMessage({ type: 'setSession', accessToken: '', baseUrl: 'not-a-url' });
    // The unresolved session engages the legacy token fallback (1.5s window)
    // before falling through to the unauthenticated fetch.
    await vi.advanceTimersByTimeAsync(1500);
    await pendingFetch;
    expect(fetchMock.mock.calls[0]).toHaveLength(1);
  });

  it('deduplicates concurrent requests and resolves both from one session update', async () => {
    const { client, dispatchFetch, dispatchMessage } = await loadServiceWorker();
    const first = dispatchFetch();
    const second = dispatchFetch();
    await flushMicrotasks();

    expect(client.postMessage).toHaveBeenCalledTimes(1);
    dispatchMessage({ type: 'setSession', accessToken: 'token-a', baseUrl: HOMESERVER });
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mock.calls.forEach(([, init]) => {
      expect(new Headers((init as RequestInit).headers).get('Authorization')).toBe(
        'Bearer token-a'
      );
    });
  });

  it('keeps a later waiter attached after an earlier waiter times out', async () => {
    const { client, dispatchFetch, dispatchMessage } = await loadServiceWorker();
    const first = dispatchFetch();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(2900);
    const second = dispatchFetch();
    await flushMicrotasks();
    expect(client.postMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    // First waiter timed out; it drains the legacy token fallback window
    // before resolving unauthenticated.
    await vi.advanceTimersByTimeAsync(1500);
    await first;
    expect(fetchMock.mock.calls[0]).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);
    dispatchMessage({ type: 'setSession', accessToken: 'token-a', baseUrl: HOMESERVER });
    await second;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const authenticatedInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(new Headers(authenticatedInit.headers).get('Authorization')).toBe('Bearer token-a');
  });

  it('allows a fresh request after a pending session request times out', async () => {
    const { client, dispatchFetch, dispatchMessage } = await loadServiceWorker();
    const first = dispatchFetch();
    await flushMicrotasks();
    expect(client.postMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(1500);
    await first;

    const second = dispatchFetch();
    await flushMicrotasks();
    // Counting only session requests: the legacy token fallback interleaves
    // its own {type: 'token'} post between the two.
    expect(
      client.postMessage.mock.calls.filter(([message]) => message?.type === 'requestSession')
    ).toHaveLength(2);

    dispatchMessage({ type: 'setSession', accessToken: '', baseUrl: HOMESERVER });
    await vi.advanceTimersByTimeAsync(1500);
    await second;
  });
});
