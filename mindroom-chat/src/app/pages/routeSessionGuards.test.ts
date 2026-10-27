import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveAuthRouteRedirect,
  resolveProtectedRouteRedirect,
  resolveRootRouteRedirect,
} from './routeSessionGuards';
import { getHomePath, getLoginPath } from './pathUtils';

describe('routeSessionGuards', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const originalBasePath = (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__;

  afterEach(() => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = originalBasePath;

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it('sends signed-in users at root to home', () => {
    expect(
      resolveRootRouteRedirect('https://chat.mindroom.chat/', {
        sessionId: 'session-a',
        baseUrl: 'https://chat.mindroom.chat',
        userId: '@alice:mindroom.chat',
        deviceId: 'DEVICE',
        accessToken: 'token',
        lastUsedAt: 1,
      })
    ).toEqual({
      redirectTo: getHomePath(),
    });
  });

  it('restores the saved home path for signed-in root visits', () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      },
      configurable: true,
    });

    globalThis.localStorage.setItem(
      'navToActivePath@alice:mindroom.chat',
      JSON.stringify({
        home: {
          pathname: '/home/%23room%3Amindroom.chat',
          search: '?threadId=%24abc',
          hash: '#reply',
        },
      })
    );

    expect(
      resolveRootRouteRedirect('https://chat.mindroom.chat/', {
        sessionId: 'session-a',
        baseUrl: 'https://chat.mindroom.chat',
        userId: '@alice:mindroom.chat',
        deviceId: 'DEVICE',
        accessToken: 'token',
        lastUsedAt: 1,
      })
    ).toEqual({
      redirectTo: '/home/%23room%3Amindroom.chat?threadId=%24abc#reply',
    });
  });

  it('prefers the session last-known path over tab-level home fallback when restoring root visits', () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      },
      configurable: true,
    });

    globalThis.localStorage.setItem(
      'navToActivePath@alice:mindroom.chat',
      JSON.stringify({
        home: {
          pathname: '/home/',
          search: '',
          hash: '',
        },
      })
    );

    expect(
      resolveRootRouteRedirect('https://chat.mindroom.chat/', {
        sessionId: 'session-a',
        baseUrl: 'https://chat.mindroom.chat',
        userId: '@alice:mindroom.chat',
        deviceId: 'DEVICE',
        accessToken: 'token',
        lastUsedAt: 1,
        lastKnownPath: '/home/%23room%3Amindroom.chat?threadId=%24abc#reply',
      })
    ).toEqual({
      redirectTo: '/home/%23room%3Amindroom.chat?threadId=%24abc#reply',
    });
  });

  it('captures after-login path when redirecting signed-out root visits to login', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://chat.mindroom.chat',
        },
      },
      configurable: true,
    });

    expect(
      resolveRootRouteRedirect('https://chat.mindroom.chat/space/%23lobby%3Amindroom.chat')
    ).toEqual({
      redirectTo: getLoginPath(),
      afterLoginPath: '/space/%23lobby%3Amindroom.chat',
    });
  });

  it('keeps auth routes accessible for add-account flows', () => {
    const activeSession = {
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    };

    expect(resolveAuthRouteRedirect('https://chat.mindroom.chat/login', activeSession)).toBe(
      getHomePath()
    );
    expect(
      resolveAuthRouteRedirect('https://chat.mindroom.chat/login?addAccount=1', activeSession)
    ).toBeNull();
  });

  it('redirects protected routes to login when there are no stored sessions', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://chat.mindroom.chat',
        },
      },
      configurable: true,
    });

    expect(
      resolveProtectedRouteRedirect(
        'https://chat.mindroom.chat/home/%23room%3Amindroom.chat',
        undefined,
        false
      )
    ).toEqual({
      redirectTo: getLoginPath(),
      afterLoginPath: '/home/%23room%3Amindroom.chat',
    });
  });

  it('returns to the requested route after login when accounts exist but none is active', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'https://chat.mindroom.chat',
        },
      },
      configurable: true,
    });

    expect(
      resolveProtectedRouteRedirect(
        'https://chat.mindroom.chat/home/%23room%3Amindroom.chat',
        undefined,
        true,
        undefined
      )
    ).toEqual({
      redirectTo: getLoginPath(),
      afterLoginPath: '/home/%23room%3Amindroom.chat',
    });
  });

  it.each(['root', 'protected'])(
    'does not save the recovery marker in a %s login return path',
    (route) => {
      Object.defineProperty(globalThis, 'window', {
        value: { location: { origin: 'https://chat.mindroom.chat' } },
        configurable: true,
      });
      const path = route === 'root' ? '/' : '/home/room';
      const href = `https://chat.mindroom.chat${path}?threadId=reply&authentication-recovery-navigation=1#event`;
      const decision =
        route === 'root'
          ? resolveRootRouteRedirect(href, undefined)
          : resolveProtectedRouteRedirect(href, undefined, false, undefined);
      expect(decision?.afterLoginPath).toBe(`${path}?threadId=reply#event`);
    }
  );

  it('allows protected routes when an active session exists', () => {
    expect(
      resolveProtectedRouteRedirect('https://chat.mindroom.chat/home', undefined, true, {
        sessionId: 'session-a',
        baseUrl: 'https://chat.mindroom.chat',
        userId: '@alice:mindroom.chat',
        deviceId: 'DEVICE',
        accessToken: 'token',
        lastUsedAt: 1,
      })
    ).toBeNull();
  });
});
