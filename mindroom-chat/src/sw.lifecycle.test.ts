import { afterEach, describe, expect, it, vi } from 'vitest';

const precacheSpies = vi.hoisted(() => ({
  activate: vi.fn().mockResolvedValue(undefined),
  addToCacheList: vi.fn(),
  install: vi.fn().mockResolvedValue(undefined),
  matchPrecache: vi.fn(),
}));
const routingSpies = vi.hoisted(() => ({ registerRoute: vi.fn() }));

vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: vi.fn(),
  PrecacheController: class PrecacheController {
    strategy = { cacheName: 'test-precache' };

    activate = precacheSpies.activate;

    addToCacheList = precacheSpies.addToCacheList;

    createHandlerBoundToURL = vi.fn(() => () => fetch('index.html'));

    install = precacheSpies.install;

    matchPrecache = precacheSpies.matchPrecache;
  },
  PrecacheRoute: class PrecacheRoute {},
}));

vi.mock('workbox-routing', () => ({
  NavigationRoute: class NavigationRoute {
    handler: unknown;

    constructor(handler: unknown) {
      this.handler = handler;
    }
  },
  registerRoute: routingSpies.registerRoute,
}));

const APP_ORIGIN = 'https://app.example';
const PREDECESSOR_ACTIVATION_TIMEOUT_MS = 15 * 1000;
type CapturedListener = (event: unknown) => void;
type PredecessorWorker = EventTarget & { state: string };

type LoadOptions = {
  hasActiveWorker: boolean;
  supportsNonDisruptiveUpdates: boolean;
};

// This is the activation contract used by the deployed predecessor monitor.
// It reloads only when the registered worker reaches `activated` and treats a
// worker retired through unregister() as a failed, non-reloading update.
const waitForPredecessorWorkerActivation = (worker: PredecessorWorker): Promise<boolean> =>
  new Promise((resolve) => {
    let finish: (activated: boolean) => void = () => undefined;
    const handleStateChange = () => {
      if (worker.state === 'activated') finish(true);
      if (worker.state === 'redundant') finish(false);
    };
    const timeoutId = setTimeout(() => finish(false), PREDECESSOR_ACTIVATION_TIMEOUT_MS);
    finish = (activated: boolean) => {
      clearTimeout(timeoutId);
      worker.removeEventListener('statechange', handleStateChange);
      resolve(activated);
    };
    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  });

const loadServiceWorker = async ({
  hasActiveWorker,
  supportsNonDisruptiveUpdates,
}: LoadOptions) => {
  vi.resetModules();
  Object.values(precacheSpies).forEach((spy) => spy.mockClear());
  routingSpies.registerRoute.mockClear();
  const listeners = new Map<string, CapturedListener>();
  const predecessorWorker = Object.assign(new EventTarget(), {
    state: 'installing',
  }) as PredecessorWorker;
  const client = {
    id: 'client-a',
    url: `${APP_ORIGIN}/rooms`,
    navigate: vi.fn().mockResolvedValue(undefined),
  };
  const clients = {
    claim: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    matchAll: vi.fn().mockResolvedValue([client]),
  };
  const unregisterCatch = vi.fn(() => Promise.resolve(false));
  const unregisterResult = {
    catch: unregisterCatch,
    then: () => {
      throw new Error('The install event must not await the queued unregister job.');
    },
  } as unknown as Promise<boolean>;
  const unregister = vi.fn(() => unregisterResult);
  const supportQuery = supportsNonDisruptiveUpdates ? '?non-disruptive-update=1' : '';
  const scope = {
    __WB_MANIFEST: [{ url: 'index.html', revision: 'test' }],
    registration: {
      scope: `${APP_ORIGIN}/`,
      active: hasActiveWorker ? {} : null,
      unregister,
    },
    location: { href: `${APP_ORIGIN}/sw.js${supportQuery}`, origin: APP_ORIGIN },
    clients,
    addEventListener: (type: string, listener: CapturedListener) => {
      listeners.set(type, listener);
    },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
  };

  vi.stubGlobal('self', scope);
  await import('./sw');

  const dispatchExtendableEvent = async (type: 'install' | 'activate') => {
    let lifetimePromise: Promise<unknown> | undefined;
    listeners.get(type)?.({
      waitUntil: (promise: Promise<unknown>) => {
        lifetimePromise = promise;
      },
    });
    expect(lifetimePromise).toBeDefined();
    await lifetimePromise;
  };

  return {
    client,
    clients,
    dispatchExtendableEvent,
    predecessorWorker,
    scope,
    unregisterCatch,
  };
};

describe('service worker upgrade lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retires a predecessor registration without triggering its activation reload', async () => {
    vi.useFakeTimers();
    const { client, clients, dispatchExtendableEvent, predecessorWorker, scope, unregisterCatch } =
      await loadServiceWorker({
        hasActiveWorker: true,
        supportsNonDisruptiveUpdates: false,
      });
    const activation = waitForPredecessorWorkerActivation(predecessorWorker);
    const reload = vi.fn();

    await dispatchExtendableEvent('install');
    predecessorWorker.state = 'installed';
    predecessorWorker.dispatchEvent(new Event('statechange'));
    await vi.advanceTimersByTimeAsync(PREDECESSOR_ACTIVATION_TIMEOUT_MS);
    if (await activation) reload();

    expect(scope.registration.unregister).toHaveBeenCalledOnce();
    expect(unregisterCatch).toHaveBeenCalledOnce();
    expect(precacheSpies.install).not.toHaveBeenCalled();
    expect(scope.skipWaiting).not.toHaveBeenCalled();
    expect(clients.claim).not.toHaveBeenCalled();
    expect(client.navigate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('claims the page and cleans the precache on a marked first install', async () => {
    const { clients, dispatchExtendableEvent, scope } = await loadServiceWorker({
      hasActiveWorker: false,
      supportsNonDisruptiveUpdates: true,
    });

    await dispatchExtendableEvent('install');
    expect(scope.registration.unregister).not.toHaveBeenCalled();
    expect(precacheSpies.install).toHaveBeenCalledOnce();
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
    await dispatchExtendableEvent('activate');

    expect(precacheSpies.activate).toHaveBeenCalledOnce();
    expect(clients.claim).toHaveBeenCalledOnce();
  });

  it('leaves later marked upgrades waiting until the browser can activate them safely', async () => {
    const { clients, dispatchExtendableEvent, scope } = await loadServiceWorker({
      hasActiveWorker: true,
      supportsNonDisruptiveUpdates: true,
    });

    await dispatchExtendableEvent('install');
    expect(scope.registration.unregister).not.toHaveBeenCalled();
    expect(precacheSpies.install).toHaveBeenCalledOnce();
    expect(scope.skipWaiting).not.toHaveBeenCalled();

    await dispatchExtendableEvent('activate');
    expect(precacheSpies.activate).toHaveBeenCalledOnce();
    expect(clients.claim).toHaveBeenCalledOnce();
  });

  it('uses the original no-store navigation when the precached shell is missing', async () => {
    await loadServiceWorker({
      hasActiveWorker: true,
      supportsNonDisruptiveUpdates: true,
    });
    precacheSpies.matchPrecache.mockResolvedValue(undefined);
    const request = new Request(`${APP_ORIGIN}/home/room`);
    const networkResponse = { ok: false, type: 'opaqueredirect' } as Response;
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(input === 'index.html' ? new Response('network index') : networkResponse)
    );
    vi.stubGlobal('fetch', fetchMock);
    const navigationRoute = routingSpies.registerRoute.mock.calls[0][0] as {
      handler: (options: { request: Request }) => Promise<Response>;
    };

    await expect(navigationRoute.handler({ request })).resolves.toBe(networkResponse);
    expect(precacheSpies.matchPrecache).toHaveBeenCalledWith('index.html');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(request, { cache: 'no-store' });
  });
});
