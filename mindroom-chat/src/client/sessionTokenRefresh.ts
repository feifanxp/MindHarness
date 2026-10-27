import {
  MatrixError,
  TokenRefreshError,
  TokenRefreshLogoutError,
  type IRefreshTokenResponse,
  type TokenRefreshFunction,
} from 'matrix-js-sdk';

import { createMatrixClient } from '../app/mindroom/matrix/matrixClientFactory';
import { listSessions, updateSessionCredentials, type StoredSession } from '../app/state/sessions';

type SessionTokenRefreshOptions = {
  sessionId: string;
  deviceId: string;
  refresh: (refreshToken: string) => Promise<IRefreshTokenResponse>;
};

const rethrowForSdkRefreshPolicy = (error: unknown): never => {
  if (!(error instanceof MatrixError)) throw error;

  // The SDK treats every MatrixError from a tokenRefreshFunction as a
  // definitive logout. Refresh endpoints can also return MatrixError for
  // rate limits and server failures, so make the intended policy explicit.
  // Tuwunel returns M_FORBIDDEN for malformed or unrecognized refresh
  // tokens. Retrying those cannot recover the session either.
  if (error.errcode === 'M_UNKNOWN_TOKEN' || error.errcode === 'M_FORBIDDEN') {
    throw new TokenRefreshLogoutError(error);
  }

  throw new TokenRefreshError(error);
};

// Matches the app's longest Matrix request timeout (reconciler scans). A
// refresh holds the cross-tab lock, so it must not wait forever.
export const TOKEN_REFRESH_TIMEOUT_MS = 15_000;

// A plain Error keeps the SDK's retryable-failure path (not a logout).
const withTimeout = <T>(task: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Token refresh timed out')), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

// Web Locks serialize check-and-refresh across tabs of this origin. Where the
// API is missing (old Android System WebView), the stored-rotation check below
// still avoids most stale refreshes, only without closing the race window.
const withSessionRefreshLock = <T>(sessionId: string, task: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return task();
  return locks.request(`mindroom-token-refresh:${sessionId}`, task);
};

const findStoredDeviceSession = (sessionId: string, deviceId: string) =>
  listSessions().find(
    (session) => session.sessionId === sessionId && session.deviceId === deviceId
  );

export const createSessionTokenRefresh = ({
  sessionId,
  deviceId,
  refresh,
}: SessionTokenRefreshOptions): TokenRefreshFunction => {
  // Refresh tokens this refresher already spent. A stored token in this set is
  // older than ours (its write failed), not a rotation from another tab.
  const spentRefreshTokens = new Set<string>();

  // Refresh tokens rotate on use. When another tab (or the pairing page)
  // already rotated this device's token, spending ours fails and would log the
  // account out, so adopt the stored rotation.
  const findStoredRotation = (refreshToken: string) => {
    const stored = findStoredDeviceSession(sessionId, deviceId);
    if (
      !stored?.refreshToken ||
      stored.refreshToken === refreshToken ||
      spentRefreshTokens.has(stored.refreshToken)
    ) {
      return undefined;
    }
    return { accessToken: stored.accessToken, refreshToken: stored.refreshToken };
  };

  return (refreshToken) =>
    withSessionRefreshLock(sessionId, async () => {
      const storedRotation = findStoredRotation(refreshToken);
      if (storedRotation) return storedRotation;

      spentRefreshTokens.add(refreshToken);
      let response: IRefreshTokenResponse;
      try {
        response = await withTimeout(refresh(refreshToken), TOKEN_REFRESH_TIMEOUT_MS);
      } catch (error) {
        // Without Web Locks, another tab can spend the same token first and
        // store its rotation while this refresh is in flight.
        return findStoredRotation(refreshToken) ?? rethrowForSdkRefreshPolicy(error);
      }

      const nextRefreshToken = response.refresh_token ?? refreshToken;
      const expiresInMs =
        typeof response.expires_in_ms === 'number' ? response.expires_in_ms : undefined;
      // A newer login of this account on another device owns the stored record.
      if (findStoredDeviceSession(sessionId, deviceId)) {
        updateSessionCredentials(sessionId, {
          accessToken: response.access_token,
          refreshToken: nextRefreshToken,
          expiresInMs,
        });
      }

      return {
        accessToken: response.access_token,
        refreshToken: nextRefreshToken,
        expiry: expiresInMs === undefined ? undefined : new Date(Date.now() + expiresInMs),
      };
    });
};

export const createStoredSessionTokenRefresh = ({
  sessionId,
  baseUrl,
  deviceId,
  refreshToken,
}: Pick<StoredSession, 'sessionId' | 'baseUrl' | 'deviceId' | 'refreshToken'>):
  | TokenRefreshFunction
  | undefined => {
  if (!refreshToken) return undefined;

  const refreshClient = createMatrixClient({ baseUrl, localTimeoutMs: TOKEN_REFRESH_TIMEOUT_MS });
  return createSessionTokenRefresh({
    sessionId,
    deviceId,
    refresh: (token) => refreshClient.refreshToken(token),
  });
};
