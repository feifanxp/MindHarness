import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';

import {
  INVITE_SERVER_SEARCH_LIMIT,
  userDirectoryCacheAtom,
  type UserDirectoryCacheState,
} from '../state/userDirectoryCache';
import { MatrixClientProvider } from './useMatrixClient';
import { useInviteUserSearch } from './useInviteUserSearch';

const directUsersMock = vi.hoisted(() => ({
  users: [] as string[],
}));

vi.mock('./useDirectUsers', () => ({
  useDirectUsers: () => directUsersMock.users,
}));

type MockMatrixClient = Pick<MatrixClient, 'baseUrl' | 'getSafeUserId' | 'searchUserDirectory'>;
type SearchUserDirectoryResponse = Awaited<ReturnType<MatrixClient['searchUserDirectory']>>;

type SearchHarnessState = ReturnType<typeof useInviteUserSearch>;

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

// Dual-variant searches settle through Promise.allSettled, which adds
// microtask hops beyond a single awaited request.
const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const readyCache = (
  users: UserDirectoryCacheState['users'] = [],
  isBootstrapOnly = false,
  ownerKey = '@me:example.org|https://example.org'
): UserDirectoryCacheState => ({
  users,
  status: 'ready',
  fetchedAt: Date.now(),
  limited: false,
  isBootstrapOnly,
  ownerKey,
});

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

const makeRoom = (): Pick<Room, 'getMember'> => ({
  getMember: () => null,
});

const originalWindow = globalThis.window;

function SearchHarness({
  room,
  query,
  onRender,
}: {
  room: Pick<Room, 'getMember'> | undefined;
  query: string;
  onRender: (state: SearchHarnessState) => void;
}) {
  const result = useInviteUserSearch(room as Room | undefined, query);
  onRender(result);
  return null;
}

const searchHarnessTree = (
  store: ReturnType<typeof createStore>,
  mx: MockMatrixClient,
  room: Pick<Room, 'getMember'> | undefined,
  query: string,
  onRender: (state: SearchHarnessState) => void
) =>
  React.createElement(
    Provider,
    { store },
    React.createElement(
      MatrixClientProvider,
      { value: mx as MatrixClient },
      React.createElement(SearchHarness, {
        room,
        query,
        onRender,
      })
    )
  );

const renderSearch = ({
  store = createStore(),
  mx = makeMx(),
  room = makeRoom(),
  query,
  cacheState,
}: {
  store?: ReturnType<typeof createStore>;
  mx?: MockMatrixClient;
  // Pass null to render the create-chat flow, which has no destination room.
  room?: Pick<Room, 'getMember'> | null;
  query: string;
  cacheState?: UserDirectoryCacheState;
}) => {
  if (cacheState) store.set(userDirectoryCacheAtom, cacheState);

  const resolvedRoom = room ?? undefined;
  let latestResult!: SearchHarnessState;
  const renders: SearchHarnessState[] = [];
  let renderer!: ReturnType<typeof create>;
  const onRender = (state: SearchHarnessState) => {
    latestResult = state;
    renders.push(state);
  };

  act(() => {
    renderer = create(searchHarnessTree(store, mx, resolvedRoom, query, onRender));
  });

  return {
    store,
    renderer,
    getResult: () => latestResult,
    getRenders: () => renders,
    update: (
      nextMx: MockMatrixClient,
      nextCacheState?: UserDirectoryCacheState,
      nextQuery?: string
    ) => {
      act(() => {
        if (nextCacheState) store.set(userDirectoryCacheAtom, nextCacheState);
        renderer.update(
          searchHarnessTree(store, nextMx, resolvedRoom, nextQuery ?? query, onRender)
        );
      });
    },
  };
};

describe('useInviteUserSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    directUsersMock.users = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        performance: {
          now: vi.fn(() => 0),
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('keeps matching direct-message contacts available when directory search rejects', async () => {
    const mx = makeMx();
    directUsersMock.users = ['@direct-alice:example.org'];
    vi.mocked(mx.searchUserDirectory).mockRejectedValue(new Error('directory disabled'));
    const view = renderSearch({ mx, query: 'direct', cacheState: readyCache() });

    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual([
      '@direct-alice:example.org',
    ]);
    const stableRenderCount = view.getRenders().length;

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'direct',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual([
      '@direct-alice:example.org',
    ]);
    expect(
      view
        .getRenders()
        .slice(stableRenderCount)
        .every((state) => state.suggestions.length > 0)
    ).toBe(true);
  });

  it('searches the server for a real query when local matches came only from the directory bootstrap', async () => {
    const mx = makeMx();
    const view = renderSearch({
      mx,
      query: 'alice',
      cacheState: readyCache(
        [
          { userId: '@alice-one:example.org', displayName: 'Alice One' },
          { userId: '@alice-two:example.org', displayName: 'Alice Two' },
          { userId: '@alice-three:example.org', displayName: 'Alice Three' },
          { userId: '@alice-four:example.org', displayName: 'Alice Four' },
          { userId: '@alice-five:example.org', displayName: 'Alice Five' },
        ],
        true
      ),
    });
    vi.mocked(mx.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@alice-server:example.org', display_name: 'Alice Server' }],
    });

    expect(view.getResult().suggestions).toHaveLength(5);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'alice',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
  });

  it('strips a leading @ from the server search term', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@alice:example.org', display_name: 'Alice' }],
    });
    const view = renderSearch({ mx, query: '@alice', cacheState: readyCache() });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'alice',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual(['@alice:example.org']);
  });

  it('does not expose per-keystroke server results from a previous MatrixClient owner', async () => {
    const clientA = makeMxForUser('@a:example.org', 'https://a.example.org');
    const clientB = makeMxForUser('@b:example.org', 'https://b.example.org');
    vi.mocked(clientA.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@remote-a:a.example.org', display_name: 'Remote A' }],
    });
    vi.mocked(clientB.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@remote-b:b.example.org', display_name: 'Remote B' }],
    });
    const view = renderSearch({
      mx: clientA,
      query: 'remote',
      cacheState: readyCache([], false, '@a:example.org|https://a.example.org'),
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(view.getResult().suggestions.map((user) => user.userId)).toContain(
      '@remote-a:a.example.org'
    );

    view.update(clientB, readyCache([], false, '@b:example.org|https://b.example.org'));

    expect(view.getResult().suggestions.map((user) => user.userId)).not.toContain(
      '@remote-a:a.example.org'
    );
  });

  it('returns no suggestions and skips server search when the query is exactly @', async () => {
    const mx = makeMx();
    const view = renderSearch({
      mx,
      query: '@',
      cacheState: readyCache([
        { userId: '@alice:example.org', displayName: 'Alice' },
        { userId: '@bob:example.org', displayName: 'Bob' },
      ]),
    });

    expect(view.getResult().suggestions).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).not.toHaveBeenCalled();
  });

  it('searches the server when local results only collide on the shared agent prefix', async () => {
    const mx = makeMx();
    const bareAgents = [
      'alpha',
      'basil',
      'clio',
      'delta',
      'echo',
      'fable',
      'gamma',
      'helix',
      'iris',
      'juno',
      'kilo',
      'lyra',
      'mind',
      'nova',
      'oracle',
      'pico',
      'quill',
      'rho',
      'sarro',
      'tesla',
    ].map((name) => ({ userId: `@mindroom_${name}:example.org` }));
    vi.mocked(mx.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@mindroom_mind:example.org', display_name: 'Mind' }],
    });
    const view = renderSearch({
      mx,
      query: 'mind',
      cacheState: readyCache(bareAgents),
    });

    expect(view.getResult().suggestions.length).toBeGreaterThanOrEqual(3);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'mind',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
    expect(view.getResult().suggestions[0]?.userId).toBe('@mindroom_mind:example.org');
    expect(view.getResult().suggestions[0]?.displayName).toBe('Mind');
  });

  it('keeps the server fallback suppressed when enough strong local matches exist', async () => {
    const mx = makeMx();
    const view = renderSearch({
      mx,
      query: 'ali',
      cacheState: readyCache([
        { userId: '@alice:example.org', displayName: 'Alice Adams' },
        { userId: '@alicia:example.org', displayName: 'Alicia Keys' },
        { userId: '@malia:example.org', displayName: 'Alina Cooper' },
      ]),
    });

    expect(view.getResult().suggestions.length).toBeGreaterThanOrEqual(3);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).not.toHaveBeenCalled();
  });

  it('strips a leading @ before ranking local suggestions', () => {
    const view = renderSearch({
      query: '@a',
      cacheState: readyCache([
        { userId: '@zephyr:example.org', displayName: 'Aardvark Team' },
        { userId: '@alpha:example.org', displayName: 'Alpha User' },
        { userId: '@brvo:server.org', displayName: 'Brvo User' },
      ]),
    });

    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual([
      '@alpha:example.org',
      '@zephyr:example.org',
    ]);
    expect(
      view
        .getResult()
        .suggestions.every(
          (user) =>
            user.userId.slice(1).startsWith('a') ||
            user.displayName?.toLocaleLowerCase().startsWith('a')
        )
    ).toBe(true);
  });

  it('merges deduplicated raw and whitespace-compacted results for a spaced query', async () => {
    const mx = makeMx();
    const overlappingUser = {
      user_id: '@mindroom_shared:mindroom.chat',
      display_name: 'Mindroom Expert Twin',
    };
    vi.mocked(mx.searchUserDirectory).mockImplementation(async ({ term }) => {
      if (term === 'mindroom expert') {
        return { limited: false, results: [overlappingUser] };
      }
      if (term === 'mindroomexpert') {
        return {
          limited: false,
          results: [
            overlappingUser,
            {
              user_id: '@mindroom_mindroom_expert:mindroom.chat',
              display_name: 'MindRoomExpert',
            },
          ],
        };
      }
      return { limited: false, results: [] };
    });
    const view = renderSearch({ mx, query: 'mindroom expert', cacheState: readyCache() });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(2);
    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'mindroom expert',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'mindroomexpert',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });

    const userIds = view.getResult().suggestions.map((user) => user.userId);
    expect(userIds).toContain('@mindroom_mindroom_expert:mindroom.chat');
    expect(userIds.filter((userId) => userId === '@mindroom_shared:mindroom.chat')).toHaveLength(1);
    expect(view.getResult().isFetching).toBe(false);
  });

  it('issues a single request for a query without internal whitespace', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockResolvedValue({ limited: false, results: [] });
    renderSearch({ mx, query: 'mindroomexpert', cacheState: readyCache() });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'mindroomexpert',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
  });

  it('does not issue a compact variant when the compacted term is a single character', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockResolvedValue({ limited: false, results: [] });
    renderSearch({ mx, query: '@ x', cacheState: readyCache() });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(1);
    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: ' x',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
  });

  it('keeps compact-variant results when the raw spaced request rejects', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockImplementation(async ({ term }) => {
      if (term === 'mindroom expert') throw new Error('raw variant failed');
      return {
        limited: false,
        results: [
          {
            user_id: '@mindroom_mindroom_expert:mindroom.chat',
            display_name: 'MindRoomExpert',
          },
        ],
      };
    });
    const view = renderSearch({ mx, query: 'mindroom expert', cacheState: readyCache() });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(2);
    expect(view.getResult().suggestions.map((user) => user.userId)).toContain(
      '@mindroom_mindroom_expert:mindroom.chat'
    );
    expect(view.getResult().isFetching).toBe(false);
  });

  it('preserves local suggestions when both spaced-query requests reject', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockRejectedValue(new Error('directory unavailable'));
    const view = renderSearch({
      mx,
      query: 'mindroom expert',
      cacheState: readyCache([
        { userId: '@legacy:example.org', displayName: 'Mindroom Expert Legacy' },
      ]),
    });

    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual([
      '@legacy:example.org',
    ]);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(2);
    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual([
      '@legacy:example.org',
    ]);
    expect(view.getResult().isFetching).toBe(false);
  });

  it('invalidates older server results after the query changes away and back', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockImplementation(async ({ term }) => ({
      limited: false,
      results:
        term === 'mindroomexpert'
          ? [
              {
                user_id: '@stale-server:example.org',
                display_name: 'MindRoomExpert',
              },
            ]
          : [],
    }));
    const view = renderSearch({
      mx,
      query: 'mindroom expert',
      cacheState: readyCache([
        { userId: '@local:example.org', displayName: 'Mindroom Expert Local' },
      ]),
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(view.getResult().suggestions.map((user) => user.userId)).toContain(
      '@stale-server:example.org'
    );

    view.update(mx, undefined, '');
    view.update(mx, undefined, 'mindroom expert');

    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual(['@local:example.org']);
  });

  it('clears older same-query results when a fresh same-owner search fully fails', async () => {
    const firstClient = makeMx();
    vi.mocked(firstClient.searchUserDirectory).mockImplementation(async ({ term }) => ({
      limited: false,
      results:
        term === 'mindroomexpert'
          ? [
              {
                user_id: '@stale-server:example.org',
                display_name: 'MindRoomExpert',
              },
            ]
          : [],
    }));
    const view = renderSearch({
      mx: firstClient,
      query: 'mindroom expert',
      cacheState: readyCache([
        { userId: '@local:example.org', displayName: 'Mindroom Expert Local' },
      ]),
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(view.getResult().suggestions.map((user) => user.userId)).toContain(
      '@stale-server:example.org'
    );

    const retryClient = makeMx();
    vi.mocked(retryClient.searchUserDirectory).mockRejectedValue(
      new Error('directory unavailable')
    );
    view.update(retryClient);

    // Same term and owner preserve the prior result until the fresh search
    // settles, so only the all-failed path can clear it.
    expect(view.getResult().suggestions.map((user) => user.userId)).toContain(
      '@stale-server:example.org'
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(retryClient.searchUserDirectory).toHaveBeenCalledTimes(2);
    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual(['@local:example.org']);
    expect(view.getResult().isFetching).toBe(false);
  });

  it('ignores dual-request results that resolve after the query changes', async () => {
    const mx = makeMx();
    const staleRawDeferred = createDeferred<SearchUserDirectoryResponse>();
    const staleCompactDeferred = createDeferred<SearchUserDirectoryResponse>();
    const currentRawDeferred = createDeferred<SearchUserDirectoryResponse>();
    const currentCompactDeferred = createDeferred<SearchUserDirectoryResponse>();
    vi.mocked(mx.searchUserDirectory).mockImplementation(({ term }) => {
      if (term === 'mindroom expert') return staleRawDeferred.promise;
      if (term === 'mindroomexpert') return staleCompactDeferred.promise;
      if (term === 'zephyr crew') return currentRawDeferred.promise;
      return currentCompactDeferred.promise;
    });
    const view = renderSearch({ mx, query: 'mindroom expert', cacheState: readyCache() });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(2);

    view.update(mx, undefined, 'zephyr crew');

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledTimes(4);

    // The stale display names match the current query, so if the guards
    // leaked them into the current term they would rank and become visible.
    await act(async () => {
      staleRawDeferred.resolve({
        limited: false,
        results: [{ user_id: '@stale-raw:example.org', display_name: 'Zephyr Crew Raw' }],
      });
      staleCompactDeferred.resolve({
        limited: false,
        results: [{ user_id: '@stale-compact:example.org', display_name: 'Zephyr Crew Compact' }],
      });
      await flushMicrotasks();
    });

    const staleUserIds = view.getResult().suggestions.map((user) => user.userId);
    expect(staleUserIds).not.toContain('@stale-raw:example.org');
    expect(staleUserIds).not.toContain('@stale-compact:example.org');
    // A stale settlement must not clear the current request's loading state.
    expect(view.getResult().isFetching).toBe(true);

    await act(async () => {
      currentRawDeferred.resolve({
        limited: false,
        results: [{ user_id: '@zephyr-raw:example.org', display_name: 'Zephyr Crew' }],
      });
      currentCompactDeferred.resolve({
        limited: false,
        results: [{ user_id: '@zephyr-compact:example.org', display_name: 'ZephyrCrew' }],
      });
      await flushMicrotasks();
    });

    const currentUserIds = view.getResult().suggestions.map((user) => user.userId);
    expect(currentUserIds).toContain('@zephyr-raw:example.org');
    expect(currentUserIds).toContain('@zephyr-compact:example.org');
    expect(view.getResult().isFetching).toBe(false);
  });

  it('does not expose dual-request results from a previous MatrixClient owner', async () => {
    const clientA = makeMxForUser('@a:example.org', 'https://a.example.org');
    const clientB = makeMxForUser('@b:example.org', 'https://b.example.org');
    const rawDeferred = createDeferred<SearchUserDirectoryResponse>();
    const compactDeferred = createDeferred<SearchUserDirectoryResponse>();
    vi.mocked(clientA.searchUserDirectory).mockImplementation(({ term }) =>
      term === 'remote crew' ? rawDeferred.promise : compactDeferred.promise
    );
    vi.mocked(clientB.searchUserDirectory).mockImplementation(async ({ term }) =>
      term === 'remote crew'
        ? {
            limited: false,
            results: [{ user_id: '@remote-b:b.example.org', display_name: 'Remote Crew B' }],
          }
        : { limited: false, results: [] }
    );
    const view = renderSearch({
      mx: clientA,
      query: 'remote crew',
      cacheState: readyCache([], false, '@a:example.org|https://a.example.org'),
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(clientA.searchUserDirectory).toHaveBeenCalledTimes(2);

    view.update(clientB, readyCache([], false, '@b:example.org|https://b.example.org'));

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(view.getResult().suggestions.map((user) => user.userId)).toContain(
      '@remote-b:b.example.org'
    );
    expect(view.getResult().isFetching).toBe(false);

    // The old owner's late settlement shares the current term, so a missing
    // guard would replace and displace the new owner's published results.
    await act(async () => {
      rawDeferred.resolve({
        limited: false,
        results: [{ user_id: '@remote-raw:a.example.org', display_name: 'Remote Crew Raw' }],
      });
      compactDeferred.resolve({
        limited: false,
        results: [
          { user_id: '@remote-compact:a.example.org', display_name: 'Remote Crew Compact' },
        ],
      });
      await flushMicrotasks();
    });

    const userIds = view.getResult().suggestions.map((user) => user.userId);
    expect(userIds).toContain('@remote-b:b.example.org');
    expect(userIds).not.toContain('@remote-raw:a.example.org');
    expect(userIds).not.toContain('@remote-compact:a.example.org');
    expect(view.getResult().isFetching).toBe(false);
  });

  it('publishes a settled variant while the sibling request is still pending', async () => {
    const mx = makeMx();
    const rawDeferred = createDeferred<SearchUserDirectoryResponse>();
    const compactDeferred = createDeferred<SearchUserDirectoryResponse>();
    vi.mocked(mx.searchUserDirectory).mockImplementation(({ term }) =>
      term === 'mindroom expert' ? rawDeferred.promise : compactDeferred.promise
    );
    const view = renderSearch({ mx, query: 'mindroom expert', cacheState: readyCache() });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    await act(async () => {
      compactDeferred.resolve({
        limited: false,
        results: [
          {
            user_id: '@mindroom_mindroom_expert:mindroom.chat',
            display_name: 'MindRoomExpert',
          },
        ],
      });
      await flushMicrotasks();
    });

    // The compact hit is visible even though the raw request has not settled,
    // and the still-outstanding variant keeps the loading state active.
    expect(view.getResult().suggestions.map((user) => user.userId)).toContain(
      '@mindroom_mindroom_expert:mindroom.chat'
    );
    expect(view.getResult().isFetching).toBe(true);

    await act(async () => {
      rawDeferred.resolve({
        limited: false,
        results: [
          { user_id: '@mindroom_spaced:mindroom.chat', display_name: 'Mindroom Expert Spaced' },
        ],
      });
      await flushMicrotasks();
    });

    const userIds = view.getResult().suggestions.map((user) => user.userId);
    expect(userIds).toContain('@mindroom_mindroom_expert:mindroom.chat');
    expect(userIds).toContain('@mindroom_spaced:mindroom.chat');
    expect(view.getResult().isFetching).toBe(false);
  });

  it('displays a compact-only hit whose spacing exceeds fuzzy tolerance', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockImplementation(async ({ term }) =>
      term === 'r2d2'
        ? {
            limited: false,
            results: [{ user_id: '@r2d2:example.org', display_name: 'R2D2' }],
          }
        : { limited: false, results: [] }
    );
    const view = renderSearch({ mx, query: 'r 2 d 2', cacheState: readyCache() });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'r2d2',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
    // The server returned the user only for the compacted term; ranking must
    // not drop it against the raw spaced query.
    expect(view.getResult().suggestions.map((user) => user.userId)).toEqual(['@r2d2:example.org']);
  });

  it('serves compact-query results in the create-chat flow without room filtering', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockImplementation(async ({ term }) =>
      term === 'mindroomexpert'
        ? {
            limited: false,
            results: [
              {
                user_id: '@mindroom_mindroom_expert:mindroom.chat',
                display_name: 'MindRoomExpert',
              },
              { user_id: '@me:example.org', display_name: 'Mindroom Expert Self' },
            ],
          }
        : { limited: false, results: [] }
    );
    const view = renderSearch({
      mx,
      room: null,
      query: 'mindroom expert',
      cacheState: readyCache(),
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushMicrotasks();
    });

    const userIds = view.getResult().suggestions.map((user) => user.userId);
    expect(userIds).toContain('@mindroom_mindroom_expert:mindroom.chat');
    // Even without a destination room, the current user stays excluded.
    expect(userIds).not.toContain('@me:example.org');
  });
});
