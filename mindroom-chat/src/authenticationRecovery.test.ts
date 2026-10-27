import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthenticationRecoveryAssets } from '../scripts/authentication-recovery-assets.mjs';

const assets = await buildAuthenticationRecoveryAssets();
const source = () => assets['authentication-recovery.js'];
const setup = (
  config: unknown = { probeUrl: '/probe', navigationUrl: '/login' },
  values = new Map<string, string>(),
  href = 'https://chat.example/room?tab=one#event',
  reply: unknown = { status: 204, ok: true }
) => {
  const controller = { scriptURL: 'https://chat.example/sw.js' };
  const unregister = vi.fn().mockResolvedValue(true);
  const registration = { active: controller, unregister };
  const assign = vi.fn();
  const fetch = vi.fn().mockResolvedValue(reply);
  const window = {
    __AUTHENTICATION_RECOVERY_CONFIG__: config,
    location: { href, assign },
    navigator: {
      onLine: true,
      serviceWorker: { controller, getRegistration: vi.fn().mockResolvedValue(registration) },
    },
    sessionStorage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    },
    addEventListener: vi.fn(),
    document: { visibilityState: 'visible', addEventListener: vi.fn() },
    fetch,
  };
  runInNewContext(source(), {
    window,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval: vi.fn(),
  });
  const api = (
    window as unknown as {
      __AUTHENTICATION_RECOVERY__: {
        check: () => Promise<string>;
        navigate: () => Promise<string>;
        configurationLoaded: () => void;
      };
    }
  ).__AUTHENTICATION_RECOVERY__;
  return { window, api, assign, fetch, unregister, registration, values };
};
type Settle = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
afterEach(() => vi.useRealTimers());

describe('native authentication recovery', () => {
  it('is opt-in and rejects cross-origin, credentialed and non-HTTP URLs', async () => {
    for (const config of [
      undefined,
      {},
      { probeUrl: '//other.example/probe', navigationUrl: '/' },
      // eslint-disable-next-line no-script-url -- rejected unsafe configuration regression
      { probeUrl: '/probe', navigationUrl: 'javascript:alert(1)' },
      { probeUrl: '/probe', navigationUrl: 'https://user@chat.example/' },
      { probeUrl: '/probe', navigationUrl: '//other.example/login' },
      { probeUrl: '/probe', navigationUrl: '   ' },
      { probeUrl: '/probe', navigationUrl: '/%2f%2fother.example/login' },
      { probeUrl: '/probe', navigationUrl: '/%5c%5cother.example/login' },
      { probeUrl: '/probe', navigationUrl: '/%2e%2e/login' },
      { probeUrl: '/probe', navigationUrl: '/login\\other' },
    ]) {
      const { api, fetch, assign, unregister } = setup(config === undefined ? null : config);
      expect(await api.check()).toBe('disabled');
      expect(fetch).not.toHaveBeenCalled();
      expect(unregister).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
    }
  });

  it.each(['\n', '\r', '\t'])(
    'disables malformed probe and navigation URLs containing %s before any recovery effect',
    async (control) => {
      for (const field of ['probeUrl', 'navigationUrl'] as const) {
        for (const unsafe of [
          `/chat/%2${control}f%2${control}fother.example/login`,
          `/chat/%2${control}e%2${control}e/login`,
          `/chat/${control}../login`,
        ]) {
          const config = { probeUrl: '/probe', navigationUrl: '/login', [field]: unsafe };
          const { api, fetch, unregister, assign } = setup(config);
          expect(await api.check()).toBe('disabled');
          expect(fetch).not.toHaveBeenCalled();
          expect(unregister).not.toHaveBeenCalled();
          expect(assign).not.toHaveBeenCalled();
        }
      }
    }
  );

  it.each([
    ['U+0085', '\u0085'],
    ['U+009F', '\u009f'],
  ])('disables raw %s controls anywhere in configured URLs', async (_name, control) => {
    for (const field of ['probeUrl', 'navigationUrl'] as const) {
      for (const unsafe of ['/login/' + control, '/login?value=' + control, '/login#' + control]) {
        const config = { probeUrl: '/probe', navigationUrl: '/login', [field]: unsafe };
        const { api, fetch, unregister, assign } = setup(config);
        expect(await api.check()).toBe('disabled');
        expect(fetch).not.toHaveBeenCalled();
        expect(unregister).not.toHaveBeenCalled();
        expect(assign).not.toHaveBeenCalled();
      }
    }
  });

  it.each([undefined, ''])(
    'returns to the current deep link when navigationUrl is %s',
    async (navigationUrl) => {
      const config = {
        probeUrl: '/probe',
        ...(navigationUrl === undefined ? {} : { navigationUrl }),
      };
      const { api, fetch, assign } = setup(
        config,
        new Map(),
        'https://chat.example/chat/rooms/example?thread=123#latest'
      );
      await api.check();
      fetch.mockResolvedValue({ status: 401 });
      expect(await api.check()).toBe('navigating');
      expect(assign).toHaveBeenCalledWith(
        'https://chat.example/chat/rooms/example?thread=123&authentication-recovery-navigation=1#latest'
      );
    }
  );

  it.each([
    [
      '/login?next=\\folder',
      'https://chat.example/login?next=%5Cfolder&authentication-recovery-navigation=1#event',
    ],
    [
      '/login#section\\part',
      'https://chat.example/login?authentication-recovery-navigation=1#section\\part',
    ],
  ])(
    'allows a backslash outside the configured destination path: %s',
    async (navigationUrl, expected) => {
      const { api, fetch, assign } = setup({ probeUrl: '/probe', navigationUrl });
      await api.check();
      fetch.mockResolvedValue({ status: 401 });
      expect(await api.check()).toBe('navigating');
      expect(assign).toHaveBeenCalledWith(expected);
    }
  );

  it('allows a backslash in the probe query while retaining the validated probe path', async () => {
    const { api, fetch } = setup({ probeUrl: '/probe?item=\\part', navigationUrl: '/login' });
    expect(await api.check()).toBe('healthy');
    expect(fetch).toHaveBeenCalledWith(
      'https://chat.example/probe?item=\\part',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it.each([401, 0])(
    'recovers confirmed expiry %s once and preserves the fragment',
    async (status) => {
      const { api, fetch, assign, unregister, values } = setup();
      await api.check();
      fetch.mockResolvedValue({
        status,
        ok: false,
        type: status === 0 ? 'opaqueredirect' : 'basic',
      });
      expect(await api.check()).toBe('navigating');
      expect(unregister).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith(
        'https://chat.example/login?authentication-recovery-navigation=1#event'
      );
      expect(values.size).toBe(1);
      expect(await api.check()).toBe('navigating');
      expect(assign).toHaveBeenCalledTimes(1);
    }
  );

  it('treats forbidden as denial for automatic checks but signs in on a click', async () => {
    const { api, fetch, assign } = setup();
    await api.check();
    fetch.mockResolvedValue({ status: 403 });
    expect(await api.check()).toBe('denied');
    expect(assign).not.toHaveBeenCalled();
    expect(await api.navigate()).toBe('navigating');
    expect(assign).toHaveBeenCalledWith(
      'https://chat.example/login?authentication-recovery-navigation=1#event'
    );
  });

  it.each([
    ['expiry', { status: 401 }],
    ['a redirect', { status: 0, type: 'opaqueredirect' }],
    ['denial', { status: 403 }],
    ['a server failure', { status: 502 }],
  ])('signs in again on a click after %s even when the tab spent its attempt', async (_, reply) => {
    const { api, fetch, assign, unregister, values } = setup();
    await api.check();
    values.set('mindroom.authentication-recovery:https://chat.example/probe', '1');
    fetch.mockResolvedValue(reply);
    expect(await api.navigate()).toBe('navigating');
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(values.size).toBe(1);
  });

  it('keeps automatic checks bounded after a click navigated', async () => {
    const values = new Map<string, string>();
    const first = setup(undefined, values);
    await first.api.check();
    first.fetch.mockResolvedValue({ status: 401 });
    expect(await first.api.navigate()).toBe('navigating');
    // The navigation returned the cached shell to a tab whose session is still expired.
    const returned = setup(undefined, values, undefined, { status: 401 });
    expect(await returned.api.check()).toBe('blocked');
    expect(returned.assign).not.toHaveBeenCalled();
    expect(await returned.api.navigate()).toBe('navigating');
    expect(returned.assign).toHaveBeenCalledTimes(1);
  });

  it('does not let a pending automatic check answer a click', async () => {
    const { api, fetch, assign, values } = setup();
    await api.check();
    values.set('mindroom.authentication-recovery:https://chat.example/probe', '1');
    let finish!: (value: unknown) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    // Clicking into an unfocused window starts an automatic check just before the click.
    const automatic = api.check();
    fetch.mockResolvedValue({ status: 401 });
    const click = api.navigate();
    finish({ status: 401 });
    expect(await click).toBe('navigating');
    expect(await automatic).toBe('blocked');
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('signs in on a click when the worker cannot be removed', async () => {
    const { api, fetch, unregister, assign } = setup();
    await api.check();
    unregister.mockRejectedValue(new Error('denied'));
    fetch.mockResolvedValue({ status: 401 });
    expect(await api.navigate()).toBe('navigating');
    const other = setup();
    await other.api.check();
    other.registration.active = { scriptURL: 'https://chat.example/sw.js' };
    other.fetch.mockResolvedValue({ status: 401 });
    expect(await other.api.navigate()).toBe('navigating');
    expect(other.unregister).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(other.assign).toHaveBeenCalledTimes(1);
  });

  it('keeps the offline screen on a click when the probe fails or times out', async () => {
    vi.useFakeTimers();
    const { api, fetch, unregister, assign } = setup();
    await api.check();
    fetch.mockRejectedValue(new TypeError('network failure'));
    expect(await api.navigate()).toBe('unavailable');
    fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const pending = api.navigate();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe('unavailable');
    expect(unregister).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ['rejects', (finish: Settle) => finish.reject(new TypeError('network failure'))],
    ['still answers expiry', (finish: Settle) => finish.resolve({ status: 401 })],
  ])('keeps the offline screen when connectivity drops while the probe %s', async (_, settle) => {
    const { api, window, fetch, unregister, assign } = setup();
    await api.check();
    let finish!: Settle;
    fetch.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = { resolve, reject };
        })
    );
    const click = api.navigate();
    window.navigator.onLine = false;
    settle(finish);
    expect(await click).toBe('unavailable');
    expect(unregister).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the offline screen when connectivity drops while the worker is removed', async () => {
    const { api, window, fetch, unregister, assign } = setup();
    await api.check();
    fetch.mockResolvedValue({ status: 401 });
    unregister.mockImplementation(async () => {
      window.navigator.onLine = false;
      return true;
    });
    expect(await api.navigate()).toBe('unavailable');
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not navigate on a click while offline or when the session is healthy', async () => {
    const { api, window, fetch, assign, values } = setup();
    await api.check();
    window.navigator.onLine = false;
    expect(await api.navigate()).toBe('unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
    window.navigator.onLine = true;
    values.set('mindroom.authentication-recovery:https://chat.example/probe', '1');
    expect(await api.navigate()).toBe('healthy');
    expect(values.size).toBe(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([502, 503, 404, 200])('does not navigate for ambiguous HTTP %s', async (status) => {
    const { api, fetch, unregister, assign } = setup();
    await api.check();
    fetch.mockResolvedValue({ status, ok: status === 200 });
    expect(await api.check()).toBe('unavailable');
    expect(unregister).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not navigate offline or on a failed or timed out request', async () => {
    vi.useFakeTimers();
    const { api, window, fetch, assign } = setup();
    await api.check();
    window.navigator.onLine = false;
    expect(await api.check()).toBe('unavailable');
    window.navigator.onLine = true;
    fetch.mockRejectedValue(new TypeError('network failure'));
    expect(await api.check()).toBe('unavailable');
    fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const pending = api.check();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe('unavailable');
    expect(assign).not.toHaveBeenCalled();
  });

  it('coalesces concurrent probes and navigations', async () => {
    const { api, fetch, assign } = setup();
    await api.check();
    let finish!: (value: unknown) => void;
    fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = api.check();
    const second = api.check();
    expect(first).toBe(second);
    finish({ status: 401 });
    await Promise.all([first, second]);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('fails closed when unregister fails or the matching controller cannot be found', async () => {
    const { api, fetch, unregister, assign } = setup();
    await api.check();
    unregister.mockRejectedValue(new Error('denied'));
    fetch.mockResolvedValue({ status: 401 });
    expect(await api.check()).toBe('blocked');
    expect(assign).not.toHaveBeenCalled();
    const other = setup();
    await other.api.check();
    // A different registration may use the same script; object identity proves ownership.
    other.registration.active = { scriptURL: 'https://chat.example/sw.js' };
    other.fetch.mockResolvedValue({ status: 401 });
    expect(await other.api.check()).toBe('blocked');
    expect(other.unregister).not.toHaveBeenCalled();
  });

  it('bounds a second boot and fails closed when its retry record cannot be saved', async () => {
    const { api, fetch, values, assign } = setup();
    await api.check();
    values.set('mindroom.authentication-recovery:https://chat.example/probe', '1');
    fetch.mockResolvedValue({ status: 401 });
    expect(await api.check()).toBe('blocked');
    expect(assign).not.toHaveBeenCalled();
    const denied = setup();
    await denied.api.check();
    denied.window.sessionStorage.setItem.mockImplementation(() => {
      throw new Error('denied');
    });
    denied.fetch.mockResolvedValue({ status: 401 });
    expect(await denied.api.check()).toBe('blocked');
    expect(denied.assign).not.toHaveBeenCalled();
  });

  it('navigates without a worker and resets the budget only after HTTP 204', async () => {
    const { api, fetch, window, values, assign } = setup();
    await api.check();
    values.set('mindroom.authentication-recovery:https://chat.example/probe', '1');
    expect(await api.check()).toBe('healthy');
    expect(values.size).toBe(0);
    Object.assign(window.navigator.serviceWorker, { controller: null });
    fetch.mockResolvedValue({ status: 401 });
    expect(await api.check()).toBe('navigating');
    expect(window.navigator.serviceWorker.getRegistration).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
  });
  it('blocks safely when service-worker unregister never settles', async () => {
    vi.useFakeTimers();
    const { api, fetch, unregister, assign } = setup();
    await api.check();
    unregister.mockImplementation(() => new Promise(() => {}));
    fetch.mockResolvedValue({ status: 401 });
    const pending = api.check();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe('blocked');
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not require removal when another tab already unregistered the controller', async () => {
    const { api, fetch, window, unregister, assign } = setup();
    await api.check();
    window.navigator.serviceWorker.getRegistration.mockResolvedValue(undefined);
    fetch.mockResolvedValue({ status: 401 });
    expect(await api.check()).toBe('navigating');
    expect(unregister).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('keeps the configured fragment rather than overwriting it', async () => {
    const { api, fetch, assign } = setup({
      probeUrl: '/probe',
      navigationUrl: '/login#configured',
    });
    await api.check();
    fetch.mockResolvedValue({ status: 401 });
    await api.check();
    expect(assign).toHaveBeenCalledWith(
      'https://chat.example/login?authentication-recovery-navigation=1#configured'
    );
  });
  it('allows a later healthy probe to release a failed recovery budget', async () => {
    const { api, fetch, unregister, assign } = setup();
    await api.check();
    unregister.mockRejectedValueOnce(new Error('transient unregister failure'));
    fetch.mockResolvedValue({ status: 401 });
    expect(await api.check()).toBe('blocked');
    fetch.mockResolvedValue({ status: 204 });
    expect(await api.check()).toBe('healthy');
    fetch.mockResolvedValue({ status: 401 });
    expect(await api.check()).toBe('navigating');
    expect(assign).toHaveBeenCalledTimes(1);
  });
  it('signs in again on every unconfigured click and resets only that record on fresh configuration', async () => {
    const values = new Map<string, string>();
    const first = setup(null, values);
    expect(await first.api.navigate()).toBe('navigating');
    const stillExpired = setup(null, values);
    expect(await stillExpired.api.navigate()).toBe('navigating');
    expect(stillExpired.assign).toHaveBeenCalledTimes(1);
    const signedIn = setup(null, values);
    signedIn.api.configurationLoaded();
    expect(values.size).toBe(0);
    expect(await signedIn.api.navigate()).toBe('navigating');
    expect(signedIn.assign).toHaveBeenCalledTimes(1);

    const configured = setup();
    await configured.api.check();
    configured.values.set('mindroom.authentication-recovery:https://chat.example/probe', '1');
    configured.api.configurationLoaded();
    expect(configured.values.size).toBe(1);
  });

  it('rejects relative configurations across successive returned-shell boots', async () => {
    const values = new Map<string, string>();
    for (let boot = 0; boot < 4; boot += 1) {
      const client = setup(
        { probeUrl: 'probe', navigationUrl: 'login/' },
        values,
        'https://chat.example/chat/' + 'login/'.repeat(boot)
      );
      client.fetch.mockResolvedValue({ status: 401 });
      expect(await client.api.check()).toBe('disabled');
      expect(client.assign).not.toHaveBeenCalled();
      expect(client.fetch).not.toHaveBeenCalled();
    }
    expect(values.size).toBe(0);
  });
});
