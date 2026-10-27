import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalMindroomApiError,
  approveLocalMindroomPairCode,
  getLocalMindroomConnections,
  getLocalMindroomErrorMessage,
  inspectLocalMindroomPairCode,
  requestMatrixOpenIdToken,
  revokeLocalMindroomConnection,
} from './api';

const capacitorMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  nativeRequest: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: capacitorMocks.isNativePlatform,
  },
  CapacitorHttp: {
    request: capacitorMocks.nativeRequest,
  },
}));

type MockResponse = Pick<Response, 'ok' | 'status' | 'json'>;

const createResponse = (status: number, body?: unknown): MockResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(body),
});

const pendingPairDevice = {
  client_name: 'studio-mac',
  created_at: '2026-09-26T12:00:00.000Z',
  expires_at: '2026-09-26T12:10:00.000Z',
  status: 'pending',
};

const toHeaderRecord = (headers: HeadersInit | undefined): Record<string, string> =>
  Object.fromEntries(new Headers(headers).entries());

afterEach(() => {
  capacitorMocks.isNativePlatform.mockReturnValue(false);
  capacitorMocks.nativeRequest.mockReset();
});

describe('local mindroom api', () => {
  it('inspects a device pair code with the OpenID token and a JSON body', async () => {
    const request = vi.fn().mockResolvedValue(createResponse(200, pendingPairDevice));

    const data = await inspectLocalMindroomPairCode(
      'ABCD-EFGH',
      'openid-token-123',
      undefined,
      request as unknown as typeof fetch
    );

    expect(data).toEqual(pendingPairDevice);
    expect(request).toHaveBeenCalledWith('/v1/local-mindroom/pair/device/inspect', {
      credentials: 'omit',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Matrix-OpenID-Token': 'openid-token-123',
      },
      body: JSON.stringify({ pair_code: 'ABCD-EFGH' }),
    });
  });

  it('approves a device pair code at the provisioning base url', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(createResponse(200, { ...pendingPairDevice, status: 'approved' }));

    const data = await approveLocalMindroomPairCode(
      'ABCD-EFGH',
      'openid-token-123',
      'https://provisioning.example/',
      request as unknown as typeof fetch
    );

    expect(data.status).toBe('approved');
    expect(request).toHaveBeenCalledWith(
      'https://provisioning.example/v1/local-mindroom/pair/device/approve',
      {
        credentials: 'omit',
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Matrix-OpenID-Token': 'openid-token-123',
        },
        body: JSON.stringify({ pair_code: 'ABCD-EFGH' }),
      }
    );
  });

  it('keeps the HTTP status and server detail on pairing errors', async () => {
    const request = vi.fn().mockResolvedValue(createResponse(410, { detail: 'Pair code expired' }));

    const result = approveLocalMindroomPairCode(
      'ABCD-EFGH',
      'openid-token-123',
      undefined,
      request as unknown as typeof fetch
    );

    await expect(result).rejects.toMatchObject({ status: 410, message: 'Pair code expired' });
  });

  it('revokes a linked connection', async () => {
    const request = vi.fn().mockResolvedValue(createResponse(204));

    await revokeLocalMindroomConnection(
      'conn-1',
      'openid-token-123',
      undefined,
      request as unknown as typeof fetch
    );

    expect(request).toHaveBeenCalledWith('/v1/local-mindroom/connections/conn-1', {
      credentials: 'omit',
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'X-Matrix-OpenID-Token': 'openid-token-123',
      },
    });
  });

  it('surfaces api error message payloads', async () => {
    const request = vi.fn().mockResolvedValue(
      createResponse(400, {
        detail: 'Invalid or expired pair code',
      })
    );

    await expect(
      getLocalMindroomConnections('openid-token-123', undefined, request as unknown as typeof fetch)
    ).rejects.toThrow('Invalid or expired pair code');
  });

  it('returns fallback message for unknown errors', () => {
    expect(getLocalMindroomErrorMessage(null)).toBe('Request failed. Please try again.');
  });

  it('throws clear error for non-json successful responses', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    } as unknown as Response);

    await expect(
      inspectLocalMindroomPairCode(
        'ABCD-EFGH',
        'openid-token-123',
        undefined,
        request as unknown as typeof fetch
      )
    ).rejects.toThrow(
      'Provisioning API returned invalid JSON. Verify provisioning URL/proxy configuration.'
    );
  });

  it('sends the JSON body through native http transport on native platforms', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.nativeRequest.mockResolvedValue({
      status: 200,
      data: { ...pendingPairDevice, status: 'approved' },
      headers: {},
      url: 'https://mindroom.chat/v1/local-mindroom/pair/device/approve',
    });

    const data = await approveLocalMindroomPairCode(
      'ABCD-EFGH',
      'openid-token-123',
      'https://mindroom.chat'
    );

    expect(data.status).toBe('approved');
    expect(capacitorMocks.nativeRequest).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/v1/local-mindroom/pair/device/approve',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Matrix-OpenID-Token': 'openid-token-123',
      },
      data: JSON.stringify({ pair_code: 'ABCD-EFGH' }),
      responseType: 'json',
    });
  });

  it('keeps native requests without a body free of request data', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.nativeRequest.mockResolvedValue({
      status: 200,
      data: { connections: [] },
      headers: {},
      url: 'https://mindroom.chat/v1/local-mindroom/connections',
    });

    await getLocalMindroomConnections('openid-token-123', 'https://mindroom.chat');

    expect(capacitorMocks.nativeRequest).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/v1/local-mindroom/connections',
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Matrix-OpenID-Token': 'openid-token-123',
      },
      responseType: 'json',
    });
  });

  it('keeps native error statuses for pairing requests', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.nativeRequest.mockResolvedValue({
      status: 401,
      data: { detail: 'Invalid Matrix OpenID token' },
      headers: {},
      url: 'https://mindroom.chat/v1/local-mindroom/pair/device/inspect',
    });

    await expect(
      inspectLocalMindroomPairCode('ABCD-EFGH', 'stale-token', 'https://mindroom.chat')
    ).rejects.toMatchObject({ status: 401, message: 'Invalid Matrix OpenID token' });
  });

  it('replaces browser transport errors with a user-facing provisioning error', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('Load failed'));

    await expect(
      inspectLocalMindroomPairCode(
        'ABCD-EFGH',
        'openid-token-123',
        undefined,
        request as unknown as typeof fetch
      )
    ).rejects.toThrow(
      'Unable to reach the provisioning API. Verify the server/proxy is reachable from this app.'
    );
  });

  it('requests an OpenID token from the account homeserver with its access token', async () => {
    const request = vi.fn().mockResolvedValue(
      createResponse(200, {
        access_token: 'openid-token-123',
        token_type: 'Bearer',
        matrix_server_name: 'mindroom.chat',
        expires_in: 3600,
      })
    );

    const token = await requestMatrixOpenIdToken(
      {
        baseUrl: 'https://mindroom.chat/',
        userId: '@alice:mindroom.chat',
        accessToken: 'matrix-token-123',
      },
      request as unknown as typeof fetch
    );

    expect(token).toBe('openid-token-123');
    expect(request).toHaveBeenCalledWith(
      'https://mindroom.chat/_matrix/client/v3/user/%40alice%3Amindroom.chat/openid/request_token',
      {
        credentials: 'omit',
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer matrix-token-123',
        },
        body: '{}',
      }
    );
  });

  it('requests OpenID tokens through native http transport on native platforms', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.nativeRequest.mockResolvedValue({
      status: 200,
      data: { access_token: 'openid-token-123', token_type: 'Bearer' },
      headers: {},
      url: 'https://mindroom.chat/_matrix/client/v3/user/%40alice%3Amindroom.chat/openid/request_token',
    });

    await expect(
      requestMatrixOpenIdToken({
        baseUrl: 'https://mindroom.chat',
        userId: '@alice:mindroom.chat',
        accessToken: 'matrix-token-123',
      })
    ).resolves.toBe('openid-token-123');
    expect(capacitorMocks.nativeRequest).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/user/%40alice%3Amindroom.chat/openid/request_token',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer matrix-token-123',
      },
      data: '{}',
      responseType: 'json',
    });
  });

  it('keeps the status of a rejected access token when requesting an OpenID token', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        createResponse(401, { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid access token passed.' })
      );

    await expect(
      requestMatrixOpenIdToken(
        {
          baseUrl: 'https://mindroom.chat',
          userId: '@alice:mindroom.chat',
          accessToken: 'stale-token',
        },
        request as unknown as typeof fetch
      )
    ).rejects.toMatchObject({ status: 401, message: 'Invalid access token passed.' });
  });

  it('rejects an OpenID response without a token', async () => {
    const request = vi.fn().mockResolvedValue(createResponse(200, { token_type: 'Bearer' }));

    await expect(
      requestMatrixOpenIdToken(
        {
          baseUrl: 'https://mindroom.chat',
          userId: '@alice:mindroom.chat',
          accessToken: 'matrix-token-123',
        },
        request as unknown as typeof fetch
      )
    ).rejects.toBeInstanceOf(LocalMindroomApiError);
  });

  it('never sends a Matrix access token to the provisioning service', async () => {
    const request = vi.fn(async (url: string) =>
      createResponse(200, url.endsWith('/connections') ? { connections: [] } : pendingPairDevice)
    );
    const fetchLike = request as unknown as typeof fetch;

    await inspectLocalMindroomPairCode('ABCD-EFGH', 'openid-token-123', undefined, fetchLike);
    await approveLocalMindroomPairCode('ABCD-EFGH', 'openid-token-123', undefined, fetchLike);
    await getLocalMindroomConnections('openid-token-123', undefined, fetchLike);
    await revokeLocalMindroomConnection('conn-1', 'openid-token-123', undefined, fetchLike);

    expect(request).toHaveBeenCalledTimes(4);
    for (const [url, init] of request.mock.calls as unknown as [string, RequestInit][]) {
      expect(url.startsWith('/v1/local-mindroom/')).toBe(true);
      const headerNames = Object.keys(toHeaderRecord(init.headers)).map((name) =>
        name.toLowerCase()
      );
      expect(headerNames).toContain('x-matrix-openid-token');
      expect(headerNames).not.toContain('x-matrix-access-token');
      expect(headerNames).not.toContain('authorization');
    }
  });
});
