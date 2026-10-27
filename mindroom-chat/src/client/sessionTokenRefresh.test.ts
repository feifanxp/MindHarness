// @vitest-environment jsdom

import {
  HttpApiEvent,
  MatrixError,
  TokenRefreshError,
  TokenRefreshLogoutError,
  createClient,
  type IRefreshTokenResponse,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMatrixClient } from '../app/mindroom/matrix/matrixClientFactory';
import { getSessionStore, putSession, updateSessionCredentials } from '../app/state/sessions';
import {
  TOKEN_REFRESH_TIMEOUT_MS,
  createSessionTokenRefresh,
  createStoredSessionTokenRefresh,
} from './sessionTokenRefresh';

vi.mock('../app/mindroom/matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

const createRefresh = (
  refresh: (refreshToken: string) => Promise<IRefreshTokenResponse> = vi.fn()
) =>
  createSessionTokenRefresh({
    sessionId: 'session-a',
    deviceId: 'DEVICE',
    refresh,
  });

const storeSession = (tokens: { accessToken: string; refreshToken: string; deviceId?: string }) =>
  putSession({
    baseUrl: 'https://example.com',
    userId: '@alice:example.com',
    deviceId: tokens.deviceId ?? 'DEVICE',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });

// Minimal Web Locks double: one exclusive holder per name, shared by every
// refresher in this realm, like tabs of one origin.
const installWebLocks = () => {
  const tails = new Map<string, Promise<unknown>>();
  const request = vi.fn((name: string, callback: () => Promise<unknown>) => {
    const previous = tails.get(name) ?? Promise.resolve();
    const result = previous.then(callback, callback);
    tails.set(
      name,
      result.catch(() => undefined)
    );
    return result;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return request;
};

const removeWebLocks = () => {
  Reflect.deleteProperty(navigator, 'locks');
};

describe('createSessionTokenRefresh', () => {
  it.each([
    {
      name: 'rate limiting',
      error: new MatrixError(
        { errcode: 'M_LIMIT_EXCEEDED', error: 'Slow down', retry_after_ms: 1_000 },
        429
      ),
    },
    {
      name: 'a homeserver failure',
      error: new MatrixError({ errcode: 'M_UNKNOWN', error: 'Unavailable' }, 503),
    },
  ])('classifies $name as a retryable SDK refresh failure', async ({ error }) => {
    const refresh = createRefresh(vi.fn().mockRejectedValue(error));

    const result = refresh('refresh-a');

    await expect(result).rejects.toBeInstanceOf(TokenRefreshError);
    await expect(result).rejects.not.toBeInstanceOf(TokenRefreshLogoutError);
  });

  it('leaves network failures retryable', async () => {
    const networkError = new Error('Network unavailable');
    const refresh = createRefresh(vi.fn().mockRejectedValue(networkError));

    await expect(refresh('refresh-a')).rejects.toBe(networkError);
  });

  it.each([
    { errcode: 'M_UNKNOWN_TOKEN', status: 401 },
    { errcode: 'M_FORBIDDEN', status: 403 },
  ])('classifies $errcode from refresh as a definitive SDK logout', async ({ errcode, status }) => {
    const invalidToken = new MatrixError({ errcode, error: 'Invalid refresh token' }, status);
    const refresh = createRefresh(vi.fn().mockRejectedValue(invalidToken));

    const result = refresh('refresh-a');

    await expect(result).rejects.toBeInstanceOf(TokenRefreshLogoutError);
    await expect(result).rejects.not.toBeInstanceOf(TokenRefreshError);
  });

  it.each([
    { errcode: 'M_UNKNOWN_TOKEN', status: 401, logout: true },
    { errcode: 'M_FORBIDDEN', status: 403, logout: true },
    { errcode: 'M_LIMIT_EXCEEDED', status: 429, logout: false },
    { errcode: 'M_UNKNOWN', status: 503, logout: false },
  ])(
    'SDK emits logout only for a rejected session: $errcode',
    async ({ errcode, status, logout }) => {
      const invalidAccessToken = { errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown access token.' };
      const refresh = vi
        .fn()
        .mockRejectedValue(new MatrixError({ errcode, error: 'Refresh failed.' }, status));
      const mx = createClient({
        baseUrl: 'https://example.com',
        accessToken: 'access-a',
        refreshToken: 'refresh-a',
        tokenRefreshFunction: createRefresh(refresh),
        fetchFn: vi.fn(
          async () =>
            new Response(JSON.stringify(invalidAccessToken), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
        ),
      });
      const onLogout = vi.fn();
      mx.on(HttpApiEvent.SessionLoggedOut, onLogout);

      const result = mx.getPushRules();

      await expect(result).rejects.toBeInstanceOf(logout ? MatrixError : TokenRefreshError);
      expect(refresh).toHaveBeenCalledWith('refresh-a');
      expect(onLogout).toHaveBeenCalledTimes(logout ? 1 : 0);
    }
  );
});

describe('cross-tab refresh-token rotation', () => {
  afterEach(() => {
    removeWebLocks();
    localStorage.clear();
  });

  it('adopts a rotation another tab stored instead of spending a stale refresh token', async () => {
    const session = storeSession({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    const refresh = vi.fn();

    const tokens = await createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    })('refresh-a');

    expect(refresh).not.toHaveBeenCalled();
    expect(tokens).toEqual({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      expiry: undefined,
    });
  });

  it('adopts a rotation another tab stored while this tab spent the same token', async () => {
    const session = storeSession({ accessToken: 'access-a', refreshToken: 'refresh-a' });
    const refresh = vi.fn(async () => {
      // Without Web Locks, the other tab wins the race and stores its rotation.
      updateSessionCredentials(session.sessionId, {
        accessToken: 'access-b',
        refreshToken: 'refresh-b',
      });
      throw new MatrixError(
        { errcode: 'M_FORBIDDEN', error: 'Refresh token is unrecognized.' },
        403
      );
    });

    const tokens = await createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    })('refresh-a');

    expect(refresh).toHaveBeenCalledWith('refresh-a');
    expect(tokens).toEqual({ accessToken: 'access-b', refreshToken: 'refresh-b' });
  });

  it('does not adopt credentials stored for a different device of the same account', async () => {
    const session = storeSession({
      accessToken: 'access-new-device',
      refreshToken: 'refresh-new-device',
      deviceId: 'NEWDEVICE',
    });
    const refresh = vi
      .fn()
      .mockResolvedValue({ access_token: 'access-b', refresh_token: 'refresh-b' });

    const tokens = await createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    })('refresh-a');

    expect(refresh).toHaveBeenCalledWith('refresh-a');
    expect(tokens).toMatchObject({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    expect(getSessionStore().sessions[0]).toMatchObject({ accessToken: 'access-new-device' });
  });

  it('performs one network refresh when two tabs refresh the same session at once', async () => {
    const locks = installWebLocks();
    const session = storeSession({ accessToken: 'access-a', refreshToken: 'refresh-a' });
    let finishRefresh: (value: IRefreshTokenResponse) => void = () => undefined;
    const refresh = vi.fn(
      () =>
        new Promise<IRefreshTokenResponse>((resolve) => {
          finishRefresh = resolve;
        })
    );
    const firstTab = createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    });
    const secondTab = createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh,
    });

    const first = firstTab('refresh-a');
    const second = secondTab('refresh-a');
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    finishRefresh({ access_token: 'access-b', refresh_token: 'refresh-b', expires_in_ms: 60_000 });

    await expect(first).resolves.toMatchObject({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    });
    await expect(second).resolves.toMatchObject({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(locks).toHaveBeenCalledWith(
      `mindroom-token-refresh:${session.sessionId}`,
      expect.any(Function)
    );
  });
});

describe('hung token refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
    removeWebLocks();
    localStorage.clear();
  });

  it('times out a hung holder so the next tab can refresh', async () => {
    vi.useFakeTimers();
    installWebLocks();
    const session = storeSession({ accessToken: 'access-a', refreshToken: 'refresh-a' });
    const hungRefresh = vi.fn(
      () =>
        new Promise<IRefreshTokenResponse>(() => {
          // Never settles, like a request stuck behind a dead connection.
        })
    );
    const workingRefresh = vi.fn().mockResolvedValue({
      access_token: 'access-b',
      refresh_token: 'refresh-b',
      expires_in_ms: 60_000,
    });

    const hung = createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh: hungRefresh,
    })('refresh-a');
    const hungOutcome = hung.catch((error: unknown) => error);
    const next = createSessionTokenRefresh({
      sessionId: session.sessionId,
      deviceId: 'DEVICE',
      refresh: workingRefresh,
    })('refresh-a');

    await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_TIMEOUT_MS);

    const hungError = await hungOutcome;
    expect(hungError).toBeInstanceOf(Error);
    expect(hungError).not.toBeInstanceOf(TokenRefreshLogoutError);
    await expect(next).resolves.toMatchObject({ accessToken: 'access-b' });
    expect(workingRefresh).toHaveBeenCalledWith('refresh-a');
  });
});

describe('createStoredSessionTokenRefresh', () => {
  afterEach(() => {
    vi.mocked(createMatrixClient).mockReset();
    localStorage.clear();
  });

  it('returns no refresh function for sessions without a refresh token', () => {
    expect(
      createStoredSessionTokenRefresh({
        sessionId: 'session-a',
        baseUrl: 'https://example.com',
        deviceId: 'DEVICE',
        refreshToken: undefined,
      })
    ).toBeUndefined();
    expect(createMatrixClient).not.toHaveBeenCalled();
  });

  it('refreshes through an unauthenticated client and persists the rotated credentials', async () => {
    const session = putSession({
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const refreshToken = vi.fn().mockResolvedValue({
      access_token: 'access-b',
      refresh_token: 'refresh-b',
    });
    vi.mocked(createMatrixClient).mockReturnValue({ refreshToken } as never);

    const refresh = createStoredSessionTokenRefresh(session);
    const tokens = await refresh?.('refresh-a');

    expect(createMatrixClient).toHaveBeenCalledWith({
      baseUrl: 'https://example.com',
      localTimeoutMs: TOKEN_REFRESH_TIMEOUT_MS,
    });
    expect(refreshToken).toHaveBeenCalledWith('refresh-a');
    expect(tokens).toMatchObject({ accessToken: 'access-b', refreshToken: 'refresh-b' });
    expect(getSessionStore().sessions[0]).toMatchObject({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    });
  });
});
