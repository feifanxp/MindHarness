// @vitest-environment jsdom

import { TokenRefreshLogoutError } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import hostedClientConfig from '../../../../config.mindroom.json';
import {
  approveLocalMindroomPairCode,
  getLocalMindroomConnections,
  inspectLocalMindroomPairCode,
  LocalMindroomApiError,
  revokeLocalMindroomConnection,
} from './api';
import { getPairingAccounts, normalizePairCode, requestAsStoredSession } from './devicePairing';
import {
  getSessionStore,
  putSession,
  removeSession,
  updateSessionCredentials,
  type StoredSession,
} from '../../state/sessions';

const storeSession = (
  userId: string,
  baseUrl: string,
  tokens: { accessToken?: string; refreshToken?: string } = {}
): StoredSession =>
  putSession({
    baseUrl,
    userId,
    deviceId: 'DEVICE',
    accessToken: tokens.accessToken ?? `${userId}-access`,
    refreshToken: tokens.refreshToken,
  });

const unauthorized = () => new LocalMindroomApiError('Invalid Matrix access token', 401);

type RecordedRequest = { url: string; headers: Record<string, string>; body?: string };

const OPENID_PATH = /\/_matrix\/client\/v3\/user\/[^/]+\/openid\/request_token$/;

// Stubs the network: the homeserver mints `openid:<access token>` unless the
// access token is listed as rejected (401) or failing (500), and provisioning
// answers every request.
const installNetwork = (
  rejectedAccessTokens: string[] = [],
  failingAccessTokens: string[] = []
) => {
  const requests: RecordedRequest[] = [];
  const respond = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      requests.push({ url, headers, body: typeof init.body === 'string' ? init.body : undefined });
      if (OPENID_PATH.test(new URL(url).pathname)) {
        const accessToken = headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (rejectedAccessTokens.includes(accessToken)) {
          return respond(401, { errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown token' });
        }
        if (failingAccessTokens.includes(accessToken)) {
          return respond(500, { errcode: 'M_UNKNOWN', error: 'Internal server error' });
        }
        return respond(200, {
          access_token: `openid:${accessToken}`,
          token_type: 'Bearer',
          matrix_server_name: 'mindroom.chat',
          expires_in: 3600,
        });
      }
      if (url.endsWith('/connections')) return respond(200, { connections: [] });
      return respond(200, {
        client_name: 'studio-mac',
        created_at: '2026-09-26T12:00:00.000Z',
        expires_at: '2026-09-26T12:10:00.000Z',
        status: 'pending',
      });
    })
  );
  return requests;
};

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('normalizePairCode', () => {
  it.each([
    ['ABCD-EFGH', 'ABCD-EFGH'],
    ['abcd-efgh', 'ABCD-EFGH'],
    ['  abcdefgh ', 'ABCD-EFGH'],
    ['ABCD EFGH', 'ABCD-EFGH'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizePairCode(input)).toBe(expected);
  });

  it.each(['', 'ABC', 'ABCD-EFGH-J', 'ABCD_EFGH', null, undefined])('rejects %j', (input) => {
    expect(normalizePairCode(input)).toBeUndefined();
  });
});

describe('getPairingAccounts', () => {
  it('keeps only accounts that can authenticate to the provisioning origin', () => {
    const hosted = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    storeSession('@bob:matrix.org', 'https://matrix-client.matrix.org');

    const accounts = getPairingAccounts(
      getSessionStore().sessions,
      'https://mindroom.chat/provisioning'
    );

    expect(accounts).toEqual([{ session: hosted, provisioningBaseUrl: 'https://mindroom.chat' }]);
  });

  it('limits the hosted client to mindroom.chat accounts', () => {
    const hosted = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const foreign = storeSession('@bob:matrix.org', 'https://matrix-client.matrix.org');

    expect(
      getPairingAccounts([hosted, foreign], hostedClientConfig.sidebar.mindRoomProvisioningUrl)
    ).toEqual([{ session: hosted, provisioningBaseUrl: 'https://mindroom.chat' }]);
  });

  it('uses each account homeserver as its provisioning origin without an override', () => {
    const hosted = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const other = storeSession('@bob:example.org', 'https://matrix.example.org');

    expect(getPairingAccounts([hosted, other], undefined)).toEqual([
      { session: hosted, provisioningBaseUrl: 'https://mindroom.chat' },
      { session: other, provisioningBaseUrl: 'https://matrix.example.org' },
    ]);
  });
});

describe('requestAsStoredSession', () => {
  it('exchanges the chosen account access token for an OpenID token at its homeserver', async () => {
    const requests = installNetwork();
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const request = vi.fn().mockResolvedValue('ok');
    const refresh = vi.fn();

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).resolves.toBe('ok');

    expect(request.mock.calls).toEqual([['openid:@alice:mindroom.chat-access']]);
    expect(requests).toEqual([
      {
        url: 'https://mindroom.chat/_matrix/client/v3/user/%40alice%3Amindroom.chat/openid/request_token',
        headers: expect.objectContaining({
          authorization: 'Bearer @alice:mindroom.chat-access',
        }),
        body: '{}',
      },
    ]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once when the homeserver rejects the access token for an OpenID token', async () => {
    const requests = installNetwork(['access-a']);
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi.fn().mockResolvedValue('ok');
    const refresh = vi.fn().mockResolvedValue('access-b');

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).resolves.toBe('ok');

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(request.mock.calls).toEqual([['openid:access-b']]);
    expect(requests.map((recorded) => recorded.headers.authorization)).toEqual([
      'Bearer access-a',
      'Bearer access-b',
    ]);
  });

  it('never sends the access token to the provisioning service', async () => {
    const requests = installNetwork();
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const provisioningBaseUrl = 'https://mindroom.chat';

    await requestAsStoredSession(session.sessionId, (openIdToken) =>
      inspectLocalMindroomPairCode('ABCD-EFGH', openIdToken, provisioningBaseUrl)
    );
    await requestAsStoredSession(session.sessionId, (openIdToken) =>
      approveLocalMindroomPairCode('ABCD-EFGH', openIdToken, provisioningBaseUrl)
    );
    await requestAsStoredSession(session.sessionId, (openIdToken) =>
      getLocalMindroomConnections(openIdToken, provisioningBaseUrl)
    );
    await requestAsStoredSession(session.sessionId, (openIdToken) =>
      revokeLocalMindroomConnection('conn-1', openIdToken, provisioningBaseUrl)
    );

    const provisioningRequests = requests.filter(({ url }) =>
      url.startsWith(`${provisioningBaseUrl}/v1/local-mindroom/`)
    );
    expect(provisioningRequests).toHaveLength(4);
    for (const { headers } of provisioningRequests) {
      expect(headers['x-matrix-openid-token']).toBe('openid:@alice:mindroom.chat-access');
      expect(headers).not.toHaveProperty('x-matrix-access-token');
      expect(headers).not.toHaveProperty('authorization');
    }
    const accessTokenRequests = requests.filter(({ headers }) =>
      Object.values(headers).some((value) =>
        ['@alice:mindroom.chat-access', 'Bearer @alice:mindroom.chat-access'].includes(value)
      )
    );
    expect(accessTokenRequests).toHaveLength(4);
    expect(accessTokenRequests.every(({ url }) => OPENID_PATH.test(new URL(url).pathname))).toBe(
      true
    );
  });

  it('does not refresh when the provisioning service rejects the OpenID token', async () => {
    installNetwork();
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi.fn().mockRejectedValue(unauthorized());
    const refresh = vi.fn();

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      {
        status: 401,
      }
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(request.mock.calls).toEqual([['openid:access-a']]);
  });

  it('retries only once when the homeserver rejects both old and refreshed tokens', async () => {
    const requests = installNetwork(['access-a', 'access-b']);
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi.fn();
    const refresh = vi.fn().mockResolvedValue('access-b');

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      {
        name: 'HomeserverSignedOutError',
        status: 401,
      }
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(requests.map((recorded) => recorded.headers.authorization)).toEqual([
      'Bearer access-a',
      'Bearer access-b',
    ]);
  });

  it('uses credentials already rotated by another tab without calling refresh', async () => {
    const requests = installNetwork(['access-a']);
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi.fn().mockResolvedValue('ok');
    const refresh = vi.fn();

    // Simulate another tab rotating credentials while the first mint is pending and fails
    const requestPromise = requestAsStoredSession(session.sessionId, request, refresh);

    // Rotate credentials before the rejection is handled
    updateSessionCredentials(session.sessionId, {
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
    });

    await expect(requestPromise).resolves.toBe('ok');

    expect(refresh).not.toHaveBeenCalled();
    expect(request.mock.calls).toEqual([['openid:access-b']]);
    expect(requests.map((recorded) => recorded.headers.authorization)).toEqual([
      'Bearer access-a',
      'Bearer access-b',
    ]);
  });

  it('reports an account removed while its token is rejected as signed out', async () => {
    installNetwork(['access-a']);
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi.fn();
    const refresh = vi.fn();

    const requestPromise = requestAsStoredSession(session.sessionId, request, refresh);
    removeSession(session.sessionId);

    await expect(requestPromise).rejects.toMatchObject({ name: 'HomeserverSignedOutError' });
    expect(refresh).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects accounts that are no longer stored as signed out', async () => {
    installNetwork();
    const request = vi.fn();

    await expect(requestAsStoredSession('missing-session', request, vi.fn())).rejects.toMatchObject(
      { name: 'HomeserverSignedOutError', status: 401 }
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('does not refresh when the homeserver fails for a reason other than an invalid token', async () => {
    installNetwork([], ['access-a']);
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi.fn();
    const refresh = vi.fn();

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      { name: 'LocalMindroomApiError', status: 500 }
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('rethrows a non-401 failure of the second mint instead of signing out', async () => {
    installNetwork(['access-a'], ['access-b']);
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi.fn();
    const refresh = vi.fn().mockResolvedValue('access-b');

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      { name: 'LocalMindroomApiError', status: 500 }
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('throws HomeserverSignedOutError when the account cannot be refreshed', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    installNetwork([session.accessToken]);
    const request = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      {
        name: 'HomeserverSignedOutError',
        status: 401,
      }
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a rejected refresh token as the homeserver signed-out error', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      refreshToken: 'refresh-a',
    });
    installNetwork([session.accessToken]);
    const request = vi.fn();
    const refresh = vi.fn().mockRejectedValue(new TokenRefreshLogoutError(new Error('gone')));

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      {
        name: 'HomeserverSignedOutError',
        status: 401,
      }
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('surfaces provisioning 401s as LocalMindroomApiError with no extra homeserver calls', async () => {
    const requests = installNetwork(['access-a']);
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi.fn().mockRejectedValue(unauthorized());
    const refresh = vi.fn().mockResolvedValue('access-b');

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      {
        name: 'LocalMindroomApiError',
        status: 401,
      }
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('openid:access-b');
    expect(requests.map((recorded) => recorded.headers.authorization)).toEqual([
      'Bearer access-a',
      'Bearer access-b',
    ]);
  });
});
