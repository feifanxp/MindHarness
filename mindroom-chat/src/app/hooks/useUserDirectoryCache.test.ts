import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';

import { USER_DIRECTORY_CACHE_TTL_MS, userDirectoryCacheAtom } from '../state/userDirectoryCache';
import { MatrixClientProvider } from './useMatrixClient';
import { useUserDirectoryCache } from './useUserDirectoryCache';

type MockMatrixClient = Pick<MatrixClient, 'baseUrl' | 'getSafeUserId' | 'searchUserDirectory'>;
type SearchUserDirectoryResponse = Awaited<ReturnType<MatrixClient['searchUserDirectory']>>;

const makeMx = (): MockMatrixClient => ({
  baseUrl: 'https://example.org',
  getSafeUserId: vi.fn(() => '@me:example.org'),
  searchUserDirectory: vi.fn(),
});

const makeMxForUser = (userId: string, baseUrl: string): MockMatrixClient => ({
  baseUrl,
  getSafeUserId: vi.fn(() => userId),
  searchUserDirectory: vi.fn(),
});

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

type CacheHarnessState = ReturnType<typeof useUserDirectoryCache>;

function CacheHarness({ onRender }: { onRender?: (state: CacheHarnessState) => void }) {
  const cache = useUserDirectoryCache();
  onRender?.(cache);
  return null;
}

const renderHarness = (
  store: ReturnType<typeof createStore>,
  mx: MockMatrixClient,
  onRender?: (state: CacheHarnessState) => void
) =>
  create(
    React.createElement(
      Provider,
      { store },
      React.createElement(
        MatrixClientProvider,
        { value: mx as MatrixClient },
        React.createElement(CacheHarness, { onRender })
      )
    )
  );

describe('useUserDirectoryCache', () => {
  it('keeps late bootstrap results from a previous MatrixClient owner out of the active cache', async () => {
    const store = createStore();
    const clientA = makeMxForUser('@a:example.org', 'https://a.example.org');
    const clientB = makeMxForUser('@b:example.org', 'https://b.example.org');
    const bootstrapA = createDeferred<SearchUserDirectoryResponse>();
    const bootstrapB = createDeferred<SearchUserDirectoryResponse>();
    let renderer!: ReactTestRenderer;

    vi.mocked(clientA.searchUserDirectory).mockReturnValue(bootstrapA.promise);
    vi.mocked(clientB.searchUserDirectory).mockReturnValue(bootstrapB.promise);

    act(() => {
      renderer = renderHarness(store, clientA);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(clientA.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(store.get(userDirectoryCacheAtom)).toMatchObject({
      status: 'loading',
      users: [],
      ownerKey: '@a:example.org|https://a.example.org',
    });

    act(() => {
      renderer.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            MatrixClientProvider,
            { value: clientB as MatrixClient },
            React.createElement(CacheHarness)
          )
        )
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(clientB.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(store.get(userDirectoryCacheAtom)).toMatchObject({
      status: 'loading',
      users: [],
      ownerKey: '@b:example.org|https://b.example.org',
    });

    await act(async () => {
      bootstrapA.resolve({
        limited: false,
        results: [{ user_id: '@from-a:a.example.org', display_name: 'From A' }],
      });
      await bootstrapA.promise;
      await Promise.resolve();
    });

    expect(store.get(userDirectoryCacheAtom)).toMatchObject({
      status: 'loading',
      users: [],
      ownerKey: '@b:example.org|https://b.example.org',
    });

    await act(async () => {
      bootstrapB.resolve({
        limited: false,
        results: [{ user_id: '@from-b:b.example.org', display_name: 'From B' }],
      });
      await bootstrapB.promise;
      await Promise.resolve();
    });

    expect(store.get(userDirectoryCacheAtom)).toMatchObject({
      status: 'ready',
      users: [{ userId: '@from-b:b.example.org', displayName: 'From B' }],
      ownerKey: '@b:example.org|https://b.example.org',
    });
  });

  it('keeps a failed bootstrap terminal across unmount and remount for the same owner', async () => {
    const store = createStore();
    const mx = makeMx();
    let renderer!: ReactTestRenderer;

    vi.mocked(mx.searchUserDirectory).mockRejectedValue(new Error('directory unavailable'));

    act(() => {
      renderer = renderHarness(store, mx);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(store.get(userDirectoryCacheAtom).status).toBe('error');

    act(() => {
      renderer.unmount();
    });

    act(() => {
      renderer = renderHarness(store, mx);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(store.get(userDirectoryCacheAtom)).toMatchObject({
      status: 'error',
      error: 'directory unavailable',
    });
  });

  it('allows an explicit refresh after a failed bootstrap for the same owner', async () => {
    const store = createStore();
    const mx = makeMx();
    let latestCache!: CacheHarnessState;

    vi.mocked(mx.searchUserDirectory)
      .mockRejectedValueOnce(new Error('temporary directory failure'))
      .mockResolvedValueOnce({
        limited: false,
        results: [{ user_id: '@fresh:example.org', display_name: 'Fresh User' }],
      });

    act(() => {
      renderHarness(store, mx, (cache) => {
        latestCache = cache;
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(store.get(userDirectoryCacheAtom).status).toBe('error');

    await act(async () => {
      await latestCache.refresh();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(2);
    expect(store.get(userDirectoryCacheAtom)).toMatchObject({
      status: 'ready',
      users: [{ userId: '@fresh:example.org', displayName: 'Fresh User' }],
    });
  });

  it('does not hot-loop bootstrap retries after persistent failure for the same owner', async () => {
    const store = createStore();
    const mx = makeMx();
    let renderer!: ReactTestRenderer;

    vi.mocked(mx.searchUserDirectory).mockRejectedValue(new Error('directory unavailable'));

    act(() => {
      renderer = renderHarness(store, mx);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    for (let index = 0; index < 5; index += 1) {
      act(() => {
        renderer.update(
          React.createElement(
            Provider,
            { store },
            React.createElement(
              MatrixClientProvider,
              { value: mx as MatrixClient },
              React.createElement(CacheHarness)
            )
          )
        );
      });

      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(store.get(userDirectoryCacheAtom)).toMatchObject({
      status: 'error',
      error: 'directory unavailable',
    });
  });

  it('allows an explicit refresh to override a terminal bootstrap error after remount', async () => {
    const store = createStore();
    const mx = makeMx();
    let renderer!: ReactTestRenderer;
    let latestCache!: CacheHarnessState;

    vi.mocked(mx.searchUserDirectory)
      .mockRejectedValueOnce(new Error('temporary directory failure'))
      .mockResolvedValueOnce({
        limited: false,
        results: [{ user_id: '@retry:example.org', display_name: 'Retry User' }],
      });

    act(() => {
      renderer = renderHarness(store, mx);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(store.get(userDirectoryCacheAtom).status).toBe('error');

    act(() => {
      renderer.unmount();
    });

    act(() => {
      renderer = renderHarness(store, mx, (cache) => {
        latestCache = cache;
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latestCache.refresh();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(2);
    expect(store.get(userDirectoryCacheAtom)).toMatchObject({
      status: 'ready',
      users: [{ userId: '@retry:example.org', displayName: 'Retry User' }],
    });
  });

  it('refreshes a ready cache for the same owner after the TTL expires', async () => {
    vi.useFakeTimers();

    try {
      const store = createStore();
      const mx = makeMx();
      let renderer!: ReactTestRenderer;

      vi.mocked(mx.searchUserDirectory)
        .mockResolvedValueOnce({
          limited: false,
          results: [{ user_id: '@first:example.org', display_name: 'First User' }],
        })
        .mockResolvedValueOnce({
          limited: false,
          results: [{ user_id: '@second:example.org', display_name: 'Second User' }],
        });

      act(() => {
        renderer = renderHarness(store, mx);
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);
      expect(store.get(userDirectoryCacheAtom)).toMatchObject({
        status: 'ready',
        users: [{ userId: '@first:example.org', displayName: 'First User' }],
      });

      await act(async () => {
        vi.advanceTimersByTime(USER_DIRECTORY_CACHE_TTL_MS + 1);
      });

      act(() => {
        renderer.update(
          React.createElement(
            Provider,
            { store },
            React.createElement(
              MatrixClientProvider,
              { value: mx as MatrixClient },
              React.createElement(CacheHarness)
            )
          )
        );
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mx.searchUserDirectory).toHaveBeenCalledTimes(2);
      expect(store.get(userDirectoryCacheAtom)).toMatchObject({
        status: 'ready',
        users: [{ userId: '@second:example.org', displayName: 'Second User' }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks an empty non-limited bootstrap as limited', async () => {
    const store = createStore();
    const mx = makeMx();

    vi.mocked(mx.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [],
    });

    act(() => {
      renderHarness(store, mx);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(store.get(userDirectoryCacheAtom)).toMatchObject({
      status: 'ready',
      users: [],
      limited: true,
    });
  });

  it('bootstraps the directory with the @ term at the full bootstrap limit', async () => {
    const store = createStore();
    const mx = makeMx();

    vi.mocked(mx.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [],
    });

    act(() => {
      renderHarness(store, mx);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(mx.searchUserDirectory).toHaveBeenCalledWith({ term: '@', limit: 5000 });
  });

  it('caches a space-less display-name user that only the @ bootstrap term returns', async () => {
    const store = createStore();
    const mx = makeMx();

    vi.mocked(mx.searchUserDirectory).mockImplementation(async ({ term }) => {
      if (term === '@') {
        return {
          limited: false,
          results: [
            {
              user_id: '@mindroom_mindroom_expert:mindroom.chat',
              display_name: 'MindRoomExpert',
              avatar_url: 'mxc://mindroom.chat/expert',
            },
          ],
        };
      }

      // A whitespace term only substring-matches display names containing a
      // literal space, so the space-less expert stays invisible to it.
      return { limited: false, results: [] };
    });

    act(() => {
      renderHarness(store, mx);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.get(userDirectoryCacheAtom).status).toBe('ready');
    expect(store.get(userDirectoryCacheAtom).users).toEqual([
      {
        userId: '@mindroom_mindroom_expert:mindroom.chat',
        displayName: 'MindRoomExpert',
        avatarMxcUrl: 'mxc://mindroom.chat/expert',
      },
    ]);
  });
});
