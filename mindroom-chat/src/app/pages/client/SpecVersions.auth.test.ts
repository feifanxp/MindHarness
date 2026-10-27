import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpecVersions } from './SpecVersions';
import { useActiveSession } from '../../hooks/useSessionStore';

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Dialog: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    Button: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('button', null, children),
    Spinner: () => reactModule.createElement('div', null, 'spinner'),
    config: {
      space: {
        S400: '16px',
      },
    },
  };
});

vi.mock('../../components/splash-screen', () => ({
  SplashScreen: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  MindRoomSplashScreen: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../../client/initMatrix', () => ({
  clearAllCacheAndReload: vi.fn(() => Promise.resolve()),
  removeSessionAndReload: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: vi.fn(),
}));

const flushPromises = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

describe('SpecVersions authenticated cold start', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    } as unknown as Storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads uncached versions through the authenticated session request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ versions: ['v1.11'] }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://example.com',
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });

    const renderer = create(
      React.createElement(
        SpecVersions,
        {
          baseUrl: 'https://example.com',
        },
        React.createElement('div', null, 'child')
      )
    );

    await act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/_matrix/client/versions',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer token',
        },
      })
    );
    expect(renderer.root.findByType('div').children).toEqual(['child']);
  });
});
