// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativeIOS: vi.fn(),
  installFlightRecorder: vi.fn(),
  initializeDeepTraceRecorder: vi.fn(),
  installIndexedDbLossRecovery: vi.fn(),
  readRecoveryReloadAge: vi.fn(),
  recordDeepTraceEvent: vi.fn(),
  isServiceWorkerEnabled: vi.fn(),
  render: vi.fn(),
  createRoot: vi.fn(),
  getActiveSession: vi.fn(),
  waitForServiceWorkerControl: vi.fn(),
  fetchPublishedAppVersion: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  createRoot: mocks.createRoot,
}));

vi.mock('@capacitor/app', () => ({
  App: {},
}));

vi.mock('./app/mindroom/native/nativeSso', () => ({
  isNativeIOS: mocks.isNativeIOS,
  isNativeApp: () => false,
  registerNativeAppUrlCallbacks: vi.fn(),
}));

vi.mock('./app/mindroom/diagnostics/flightRecorder', () => ({
  installFlightRecorder: mocks.installFlightRecorder,
}));

vi.mock('./app/mindroom/diagnostics/deepTrace', () => ({
  initializeDeepTraceRecorder: mocks.initializeDeepTraceRecorder,
  recordDeepTraceEvent: mocks.recordDeepTraceEvent,
}));

vi.mock('./app/mindroom/matrix/indexedDbLossRecovery', () => ({
  installIndexedDbLossRecovery: mocks.installIndexedDbLossRecovery,
  readRecoveryReloadAge: mocks.readRecoveryReloadAge,
}));

vi.mock('./app/theme/themeBootstrap', () => ({
  applyThemeToDom: vi.fn(),
  resolveInitialTheme: vi.fn(),
}));

vi.mock('./app/mindroom/threads/rideTraceRecorder', () => ({
  bootstrapRideTraceFlagFromUrl: vi.fn(),
}));

vi.mock('./app/mindroom/settings/mindroomSettingsStorage', () => ({
  migrateMindroomSettingsStorage: vi.fn(),
}));

vi.mock('./app/mindroom/native/iosPush', () => ({
  migrateLegacyIOSPushEnabled: vi.fn(),
}));

vi.mock('./app/utils/runtimeConfig', () => ({
  isServiceWorkerEnabled: mocks.isServiceWorkerEnabled,
}));

vi.mock('./app/state/sessions', () => ({
  getActiveSession: mocks.getActiveSession,
  subscribeToSessionStore: vi.fn(),
}));

vi.mock('./sw-session', () => ({
  pushSessionToSW: vi.fn(),
  waitForServiceWorkerControl: mocks.waitForServiceWorkerControl,
}));

vi.mock('./appVersion', () => ({
  APP_BUILD_VERSION: 'test-build',
  fetchPublishedAppVersion: mocks.fetchPublishedAppVersion,
  startAppVersionMonitor: vi.fn(),
}));

vi.mock('./serviceWorkerRegistration', () => ({
  createServiceWorkerUrl: vi.fn(),
}));

vi.mock('./app/pages/App', () => ({
  default: () => null,
}));

vi.mock('./app/i18n', () => ({}));

describe('application bootstrap', () => {
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
    mocks.isNativeIOS.mockReturnValue(false);
    mocks.isServiceWorkerEnabled.mockReturnValue(false);
    mocks.createRoot.mockReturnValue({ render: mocks.render });
    mocks.getActiveSession.mockReturnValue(undefined);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });

  it.each([
    ['native iOS', true, 1],
    ['another platform', false, 0],
  ])('installs the flight recorder on %s', async (_platform, nativeIOS, installs) => {
    mocks.isNativeIOS.mockReturnValue(nativeIOS);

    await import('./index');

    expect(mocks.installFlightRecorder).toHaveBeenCalledTimes(installs);
    expect(mocks.initializeDeepTraceRecorder).toHaveBeenCalledTimes(installs);
    expect(mocks.createRoot).toHaveBeenCalledOnce();
  });

  it('continues boot when recorder route classification throws', async () => {
    mocks.isNativeIOS.mockReturnValue(true);
    mocks.installFlightRecorder.mockImplementationOnce(() => {
      throw new TypeError('route classification failed');
    });

    await expect(import('./index')).resolves.toBeDefined();

    expect(mocks.installFlightRecorder).toHaveBeenCalledOnce();
    expect(mocks.initializeDeepTraceRecorder).toHaveBeenCalledOnce();
    expect(mocks.createRoot).toHaveBeenCalledOnce();
  });

  it('continues boot when opt-in tracing setup throws', async () => {
    mocks.isNativeIOS.mockReturnValue(true);
    mocks.initializeDeepTraceRecorder.mockImplementationOnce(() => {
      throw new TypeError('indexeddb setup failed');
    });

    await expect(import('./index')).resolves.toBeDefined();

    expect(mocks.installFlightRecorder).toHaveBeenCalledOnce();
    expect(mocks.initializeDeepTraceRecorder).toHaveBeenCalledOnce();
    expect(mocks.createRoot).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    'watches for IndexedDB server loss (native iOS: %s)',
    async (nativeIOS) => {
      mocks.isNativeIOS.mockReturnValue(nativeIOS);

      await import('./index');

      expect(mocks.installIndexedDbLossRecovery).toHaveBeenCalledOnce();
      expect(mocks.createRoot).toHaveBeenCalledOnce();
    }
  );

  it('records a recovery reload after the deep trace recorder starts', async () => {
    mocks.isNativeIOS.mockReturnValue(true);
    mocks.readRecoveryReloadAge.mockReturnValueOnce(1_500);

    await import('./index');

    expect(mocks.recordDeepTraceEvent).toHaveBeenCalledWith('storage.indexeddb_loss_reload', {
      reload_ms_ago: 1_500,
    });
    // Recorded earlier, the event would be dropped silently.
    expect(mocks.initializeDeepTraceRecorder.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordDeepTraceEvent.mock.invocationCallOrder[0]
    );
    expect(mocks.installIndexedDbLossRecovery).toHaveBeenCalledOnce();
  });

  it('records nothing without a recovery reload', async () => {
    mocks.readRecoveryReloadAge.mockReturnValueOnce(undefined);

    await import('./index');

    expect(mocks.recordDeepTraceEvent).not.toHaveBeenCalled();
    expect(mocks.installIndexedDbLossRecovery).toHaveBeenCalledOnce();
  });

  it('continues boot when IndexedDB loss recovery setup throws', async () => {
    mocks.installIndexedDbLossRecovery.mockImplementationOnce(() => {
      throw new TypeError('indexeddb unavailable');
    });

    await expect(import('./index')).resolves.toBeDefined();

    expect(mocks.createRoot).toHaveBeenCalledOnce();
  });

  it('mounts the app while service worker registration is pending', async () => {
    const never = new Promise<never>(() => {
      // Intentionally pending.
    });
    const serviceWorker = {
      addEventListener: vi.fn(),
      ready: never,
      register: vi.fn(() => never),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });
    mocks.isServiceWorkerEnabled.mockReturnValue(true);

    await import('./index');

    await vi.waitFor(() => expect(mocks.createRoot).toHaveBeenCalledOnce());
    expect(serviceWorker.register).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'restores control safely when history replacement fails: %s',
    async (historyFails) => {
      const browserWindow = window;
      const originalUrl = browserWindow.location.href;
      browserWindow.history.replaceState(
        { room: 'selected' },
        '',
        '/home/room?threadId=reply#event'
      );
      const navigationUrls: string[] = [];
      vi.stubGlobal(
        'window',
        new Proxy(browserWindow, {
          get(target, property) {
            if (property === 'location') {
              return {
                get href() {
                  return target.location.href;
                },
                reload: () => navigationUrls.push(target.location.href),
              };
            }
            return Reflect.get(target, property);
          },
        })
      );
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          controller: null,
          addEventListener: vi.fn(),
          ready: Promise.resolve(),
          register: vi.fn().mockResolvedValue({ active: {} }),
          getRegistration: vi.fn().mockResolvedValue({ active: {} }),
        },
      });
      mocks.isServiceWorkerEnabled.mockReturnValue(true);
      mocks.getActiveSession.mockReturnValue({ baseUrl: 'https://matrix.example.com' });
      mocks.waitForServiceWorkerControl.mockResolvedValue(false);
      mocks.fetchPublishedAppVersion.mockResolvedValue('new-build');
      const replaceState = vi.spyOn(browserWindow.history, 'replaceState');
      if (historyFails) {
        replaceState.mockImplementationOnce(() => {
          throw new DOMException('History unavailable', 'SecurityError');
        });
      }

      try {
        await import('./index');
        if (historyFails) {
          await vi.waitFor(() => expect(replaceState).toHaveBeenCalled());
          expect(navigationUrls).toHaveLength(0);
          expect(browserWindow.sessionStorage.getItem('mindroom_sw_control_reloaded')).toBeNull();
          return;
        }
        await vi.waitFor(() => expect(navigationUrls).toHaveLength(1));

        const destination = new URL(navigationUrls[0]);
        expect(destination.pathname + destination.search + destination.hash).toBe(
          '/home/room?threadId=reply&authentication-recovery-navigation=1#event'
        );
        expect(browserWindow.history.state).toEqual({ room: 'selected' });
        expect(browserWindow.sessionStorage.getItem('mindroom_sw_control_reloaded')).toBe('1');

        // Exercise the real worker navigation handler with an older cached shell.
        const { fetchNavigationWithShellFallback } = await import('./serviceWorkerNavigation');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('new build')));
        const response = await fetchNavigationWithShellFallback(
          new Request(destination),
          async () => new Response('old build')
        );
        expect(await response.text()).toBe('new build');
      } finally {
        replaceState.mockRestore();
        browserWindow.history.replaceState(null, '', originalUrl);
      }
    }
  );
});
