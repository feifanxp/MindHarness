import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixError, Method } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { KeyBackupPresence, useKeyBackupPresence } from './useKeyBackupPresence';

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

const useMatrixClientMock = vi.mocked(useMatrixClient);

type MockClient = {
  http: { authedRequest: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};

const buildMockClient = (
  authedRequest: (typeof vi.fn extends () => infer T ? T : never) | undefined
): MockClient => ({
  http: { authedRequest: authedRequest ?? vi.fn() },
  on: vi.fn(),
  removeListener: vi.fn(),
});

type HarnessProps = { onValue: (value: KeyBackupPresence) => void };

function Harness({ onValue }: HarnessProps) {
  const value = useKeyBackupPresence();
  onValue(value);
  return null;
}

const renderHarness = async (): Promise<{
  values: KeyBackupPresence[];
  renderer: ReactTestRenderer;
}> => {
  const values: KeyBackupPresence[] = [];
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(React.createElement(Harness, { onValue: (v) => values.push(v) }));
  });
  return { values, renderer: renderer as ReactTestRenderer };
};

describe('useKeyBackupPresence', () => {
  afterEach(() => {
    useMatrixClientMock.mockReset();
  });

  it('reports present when the server returns a backup version', async () => {
    const authedRequest = vi.fn().mockResolvedValue({ version: '3' });
    useMatrixClientMock.mockReturnValue(buildMockClient(authedRequest) as never);

    const { values } = await renderHarness();

    expect(authedRequest).toHaveBeenCalledWith(
      Method.Get,
      '/room_keys/version',
      undefined,
      undefined,
      { prefix: '/_matrix/client/v3' }
    );
    expect(values[values.length - 1]).toBe('present');
  });

  it('reports absent when the server returns M_NOT_FOUND', async () => {
    const authedRequest = vi
      .fn()
      .mockRejectedValue(new MatrixError({ errcode: 'M_NOT_FOUND', error: 'no backup' }));
    useMatrixClientMock.mockReturnValue(buildMockClient(authedRequest) as never);

    const { values } = await renderHarness();

    expect(values[values.length - 1]).toBe('absent');
  });

  it('reports absent when the request 404s without an M_ errcode', async () => {
    // Some servers reply 404 without the M_NOT_FOUND errcode; keep them mapped
    // to absent so the nudge still fires for the intended case.
    const err = new MatrixError({ errcode: undefined, error: 'not found' });
    (err as unknown as { httpStatus: number }).httpStatus = 404;
    const authedRequest = vi.fn().mockRejectedValue(err);
    useMatrixClientMock.mockReturnValue(buildMockClient(authedRequest) as never);

    const { values } = await renderHarness();

    expect(values[values.length - 1]).toBe('absent');
  });

  it('stays unknown when the request fails with a non-404 error (nudge hidden)', async () => {
    const authedRequest = vi
      .fn()
      .mockRejectedValue(new MatrixError({ errcode: 'M_LIMIT_EXCEEDED', error: 'slow down' }));
    useMatrixClientMock.mockReturnValue(buildMockClient(authedRequest) as never);

    const { values } = await renderHarness();

    expect(values[values.length - 1]).toBe('unknown');
  });

  it('stays unknown when the request rejects with a plain network error', async () => {
    const authedRequest = vi.fn().mockRejectedValue(new Error('network down'));
    useMatrixClientMock.mockReturnValue(buildMockClient(authedRequest) as never);

    const { values } = await renderHarness();

    expect(values[values.length - 1]).toBe('unknown');
  });
});
