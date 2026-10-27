import React from 'react';
import { Capacitor } from '@capacitor/core';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import {
  ClientConfigAuthenticationError,
  ClientConfigLoader,
  fetchClientConfig,
  readCachedClientConfig,
} from './ClientConfigLoader';
import { recoverAuthentication } from '../../authenticationRecovery';
import { AUTHENTICATION_RECOVERY_NAVIGATION_PARAM } from '../../serviceWorkerNavigation';

const originalFetch = globalThis.fetch;

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

const response = (overrides: Partial<Response> = {}): Response =>
  ({
    ok: true,
    status: 200,
    type: 'basic',
    json: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as Response);

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage());
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('client configuration loading', () => {
  it('requests config.json from the provided base path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchClientConfig('/mindroom');

    expect(fetchMock).toHaveBeenCalledWith('/mindroom/config.json', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
  });

  it.each([0, 401, 403])(
    'classifies authentication response %s as requiring sign-in',
    async (status) => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          response({ ok: false, status, type: status === 0 ? 'opaqueredirect' : 'basic' })
        );

      await expect(fetchClientConfig('/mindroom')).rejects.toBeInstanceOf(
        ClientConfigAuthenticationError
      );
    }
  );

  it('rejects unsuccessful HTTP responses before parsing JSON', async () => {
    const json = vi.fn();
    globalThis.fetch = vi.fn().mockResolvedValue(response({ ok: false, status: 503, json }));

    await expect(fetchClientConfig('/mindroom')).rejects.toThrow(
      'Failed to load client configuration (HTTP 503).'
    );
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects malformed configuration without caching it', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        json: vi.fn().mockResolvedValue([]),
      })
    );

    await expect(fetchClientConfig('/mindroom')).rejects.toThrow(
      'Client configuration must be a JSON object.'
    );
    expect(readCachedClientConfig('/mindroom')).toBeUndefined();
  });

  it('caches the last valid configuration by base path', async () => {
    const config = { homeserverList: ['https://matrix.example.test'] };
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        json: vi.fn().mockResolvedValue(config),
      })
    );

    await fetchClientConfig('/mindroom');

    expect(readCachedClientConfig('/mindroom')).toEqual(config);
    expect(readCachedClientConfig('/other-app')).toBeUndefined();
  });

  it('uses the last valid configuration when the user continues offline after an authentication error', async () => {
    const cachedConfig = { homeserverList: ['https://matrix.example.test'] };
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        json: vi.fn().mockResolvedValue(cachedConfig),
      })
    );
    await fetchClientConfig();

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(response({ ok: false, status: 0, type: 'opaqueredirect' }));
    let continueOffline: (() => void) | undefined;
    let renderedConfig: unknown;
    let renderer!: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            error: (_error, _retry, ignore) => {
              continueOffline = ignore;
              return React.createElement('span', null, 'Sign in');
            },
          },
          (config) => {
            renderedConfig = config;
            return React.createElement('span', null, 'Cached chats');
          }
        )
      );
    });

    await vi.waitFor(() => expect(continueOffline).toBeTypeOf('function'));
    expect(renderer.root.findByType('span').children).toEqual(['Sign in']);
    act(() => continueOffline?.());

    expect(renderedConfig).toEqual(cachedConfig);
    expect(renderer.root.findByType('span').children).toEqual(['Cached chats']);
    act(() => renderer.unmount());
  });

  it('loads this native app build config before mounting a router even with an older cached config', async () => {
    const oldConfig = { mindroom: { canvas: { enabled: false } } };
    globalThis.fetch = vi.fn().mockResolvedValue(response({ json: async () => oldConfig }));
    await fetchClientConfig();
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    let finish!: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    const renderedConfigs: unknown[] = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            fallback: () => React.createElement('span', null, 'Loading bundled config'),
          },
          (config) => {
            renderedConfigs.push(config);
            return React.createElement('span', null, 'Ready');
          }
        )
      );
    });
    expect(renderedConfigs).toEqual([]);
    expect(renderer.root.findByType('span').children).toEqual(['Loading bundled config']);
    const bundledConfig = { mindroom: { canvas: { enabled: true, libraries: true } } };
    await act(async () => {
      finish(response({ json: async () => bundledConfig }));
    });
    expect(renderedConfigs).toEqual([bundledConfig]);
    act(() => renderer.unmount());
  });

  it('keeps the cached router and route mounted while refreshing configuration', async () => {
    const cachedConfig = { homeserverList: ['https://matrix.example.test'] };
    globalThis.fetch = vi.fn().mockResolvedValue(response({ json: async () => cachedConfig }));
    await fetchClientConfig();
    let finish!: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    const routers: ReturnType<typeof createMemoryRouter>[] = [];
    const renderedConfigs: unknown[] = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            fallback: () => React.createElement('span', null, 'Loading'),
          },
          (config) => {
            renderedConfigs.push(config);
            const router = createMemoryRouter([
              { path: '*', element: React.createElement('span', null, 'Chats') },
            ]);
            routers.push(router);
            return React.createElement(RouterProvider, { router });
          }
        )
      );
    });
    try {
      expect(renderer.root.findByType('span').children).toEqual(['Chats']);
      expect(routers).toHaveLength(1);
      await act(async () => {
        await routers[0].navigate('/room/thread');
      });
      const refreshedConfig = { ...cachedConfig, hashRouter: true };
      await act(async () => finish(response({ json: async () => refreshedConfig })));
      expect(routers).toHaveLength(1);
      expect(routers[0].state.location.pathname).toBe('/room/thread');
      expect(renderedConfigs).toEqual([cachedConfig]);
      expect(readCachedClientConfig()).toEqual(refreshedConfig);
    } finally {
      act(() => renderer.unmount());
      routers.forEach((router) => router.dispose());
    }
  });

  it.each(['offline', 'server', 'invalid'] as const)(
    'keeps cached startup usable after a background %s failure',
    async (failure) => {
      const cachedConfig = { homeserverList: ['https://matrix.example.test'] };
      globalThis.fetch = vi.fn().mockResolvedValue(response({ json: async () => cachedConfig }));
      await fetchClientConfig();
      globalThis.fetch =
        failure === 'offline'
          ? vi.fn().mockRejectedValue(new TypeError('offline'))
          : vi
              .fn()
              .mockResolvedValue(
                failure === 'server'
                  ? response({ ok: false, status: 503 })
                  : response({ json: async () => [] })
              );
      let renderer!: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(
          React.createElement(
            ClientConfigLoader,
            {
              fallback: () => React.createElement('span', null, 'Loading'),
              error: () => React.createElement('span', null, 'Error'),
            },
            (config) => React.createElement('span', null, config.homeserverList?.[0])
          )
        );
      });
      expect(renderer.root.findByType('span').children).toEqual(['https://matrix.example.test']);
      expect(readCachedClientConfig()).toEqual(cachedConfig);
      act(() => renderer.unmount());
    }
  );

  it('waits for explicit authentication recovery before showing cached content again', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(response({ json: async () => ({ hashRouter: true }) }));
    await fetchClientConfig();
    let finish!: (value: Response) => void;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: false, status: 0, type: 'opaqueredirect' }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          })
      );
    let retry!: () => void;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            fallback: () => React.createElement('span', null, 'Loading'),
            error: (_error, retryRequest) => {
              retry = retryRequest;
              return React.createElement('span', null, 'Sign in');
            },
          },
          (config) =>
            React.createElement('span', null, config.hashRouter ? 'Cached chats' : 'Fresh chats')
        )
      );
    });
    expect(renderer.root.findByType('span').children).toEqual(['Sign in']);
    await act(async () => retry());
    expect(renderer.root.findByType('span').children).toEqual(['Loading']);
    await act(async () => finish(response()));
    expect(renderer.root.findByType('span').children).toEqual(['Fresh chats']);
    act(() => renderer.unmount());
  });

  it('keeps the loading screen on first launch until fresh configuration is available', async () => {
    let finish!: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            fallback: () => React.createElement('span', null, 'Loading'),
          },
          (config) => React.createElement('span', null, config.homeserverList?.[0])
        )
      );
    });
    expect(renderer.root.findByType('span').children).toEqual(['Loading']);
    await act(async () =>
      finish(response({ json: async () => ({ homeserverList: ['https://new.example'] }) }))
    );
    expect(renderer.root.findByType('span').children).toEqual(['https://new.example']);
    act(() => renderer.unmount());
  });

  it('does not offer offline continuation without a cached configuration', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    let errorRendered = false;
    let continueOffline: (() => void) | undefined;

    await act(async () => {
      create(
        React.createElement(
          ClientConfigLoader,
          {
            error: (_error, _retry, ignore) => {
              errorRendered = true;
              continueOffline = ignore;
              return null;
            },
          },
          () => null
        )
      );
    });

    await vi.waitFor(() => expect(errorRendered).toBe(true));
    expect(continueOffline).toBeUndefined();
  });

  it('delegates sign-in to the native recovery owner after bootstrap loads', async () => {
    const navigate = vi.fn().mockResolvedValue('blocked');
    let ready!: () => void;
    vi.stubGlobal('window', {
      __AUTHENTICATION_RECOVERY_READY__: new Promise<void>((resolve) => {
        ready = resolve;
      }),
      __AUTHENTICATION_RECOVERY__: { navigate },
    });
    recoverAuthentication();
    expect(navigate).not.toHaveBeenCalled();
    ready();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('notifies native recovery only after successful fresh configuration validation', async () => {
    const configurationLoaded = vi.fn();
    vi.stubGlobal('window', { __AUTHENTICATION_RECOVERY__: { configurationLoaded } });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(response({ json: async () => ({ hashRouter: true }) }));
    await fetchClientConfig();
    expect(configurationLoaded).toHaveBeenCalledTimes(1);
    readCachedClientConfig();
    expect(configurationLoaded).toHaveBeenCalledTimes(1);
    globalThis.fetch = vi.fn().mockResolvedValue(response({ status: 401, ok: false }));
    await expect(fetchClientConfig()).rejects.toBeInstanceOf(ClientConfigAuthenticationError);
    globalThis.fetch = vi.fn().mockResolvedValue(response({ json: async () => [] }));
    await expect(fetchClientConfig()).rejects.toThrow();
    expect(configurationLoaded).toHaveBeenCalledTimes(1);
  });

  it('reports blocked native recovery and keeps the connection retry available', async () => {
    const navigate = vi.fn().mockResolvedValue('blocked');
    vi.stubGlobal('window', {
      location: { href: 'https://chat.example/room' },
      __AUTHENTICATION_RECOVERY__: { navigate },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(response({ status: 401, ok: false }));
    let authenticate!: () => void;
    let retry!: () => void;
    let shownError: unknown;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            error: (error, retryRequest, _ignore, signIn) => {
              shownError = error;
              retry = retryRequest;
              authenticate = signIn;
              return null;
            },
          },
          () => null
        )
      );
    });
    expect(shownError).toBeInstanceOf(ClientConfigAuthenticationError);
    await act(async () => authenticate());
    expect((shownError as Error).message).toContain('Sign-in recovery could not complete');
    await act(async () => retry());
    expect(shownError).toBeInstanceOf(ClientConfigAuthenticationError);
    expect(navigate).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('loads fresh configuration after sign-in finds an already healthy session', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(response({ json: async () => ({ hashRouter: true }) }));
    await fetchClientConfig();
    let finish!: (value: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ status: 401, ok: false }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          })
      );
    globalThis.fetch = fetchMock;
    const navigate = vi.fn().mockResolvedValue('healthy');
    vi.stubGlobal('window', {
      location: { href: 'https://chat.example/room' },
      __AUTHENTICATION_RECOVERY__: { navigate },
    });
    let authenticate!: () => void;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            fallback: () => React.createElement('span', null, 'Loading'),
            error: (_error, _retry, _ignore, signIn) => {
              authenticate = signIn;
              return React.createElement('span', null, 'Sign in');
            },
          },
          (config) => React.createElement('span', null, config.hashRouter ? 'Cached' : 'Fresh')
        )
      );
    });
    expect(renderer.root.findByType('span').children).toEqual(['Sign in']);
    await act(async () => authenticate());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByType('span').children).toEqual(['Loading']);
    await act(async () => finish(response({ json: async () => ({ hashRouter: false }) })));
    expect(renderer.root.findByType('span').children).toEqual(['Fresh']);
    act(() => renderer.unmount());
  });

  it('shows the fresh configuration error after a blocked sign-in later recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ status: 401, ok: false }))
      .mockResolvedValueOnce(response({ status: 503, ok: false }));
    globalThis.fetch = fetchMock;
    const navigate = vi.fn().mockResolvedValueOnce('blocked').mockResolvedValueOnce('healthy');
    vi.stubGlobal('window', {
      location: { href: 'https://chat.example/room' },
      __AUTHENTICATION_RECOVERY__: { navigate },
    });
    let authenticate!: () => void;
    let shownError: unknown;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            error: (error, _retry, _ignore, signIn) => {
              shownError = error;
              authenticate = signIn;
              return null;
            },
          },
          () => null
        )
      );
    });
    expect(shownError).toBeInstanceOf(ClientConfigAuthenticationError);
    await act(async () => authenticate());
    expect((shownError as Error).message).toContain('Sign-in recovery could not complete');
    await act(async () => authenticate());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((shownError as Error).message).toBe('Failed to load client configuration (HTTP 503).');
    act(() => renderer.unmount());
  });

  it('removes only the authentication recovery marker on normal startup', async () => {
    const historyState = { route: 'thread', unsentDraft: true };
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      history: { replaceState, state: historyState },
      location: {
        href: `https://chat.example.com/home/room?tab=members&${AUTHENTICATION_RECOVERY_NAVIGATION_PARAM}=1#event`,
      },
    });
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>(() => {
          // Held configuration request.
        })
    );
    let renderer!: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          { fallback: () => React.createElement('span', null, 'Loading') },
          () => React.createElement('span', null, 'Chats')
        )
      );
    });

    expect(replaceState).toHaveBeenCalledWith(historyState, '', '/home/room?tab=members#event');
    act(() => renderer.unmount());
  });
});
