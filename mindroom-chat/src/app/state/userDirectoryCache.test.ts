import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  USER_DIRECTORY_CACHE_TTL_MS,
  isUserDirectoryCacheFresh,
  mergeUserDirectoryBootstrapUsers,
  mergeUserDirectoryUsers,
  normalizeUserDirectoryUsers,
  type UserDirectoryCacheState,
} from './userDirectoryCache';

const makeState = (state: Partial<UserDirectoryCacheState>): UserDirectoryCacheState => ({
  users: [],
  status: 'idle',
  fetchedAt: 0,
  limited: false,
  isBootstrapOnly: false,
  ...state,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isUserDirectoryCacheFresh', () => {
  it('treats ready empty user lists as fresh within the TTL', () => {
    vi.setSystemTime(2_000_000);

    expect(
      isUserDirectoryCacheFresh(
        makeState({
          status: 'ready',
          fetchedAt: 2_000_000 - USER_DIRECTORY_CACHE_TTL_MS + 1,
          users: [],
        })
      )
    ).toBe(true);
  });

  it('expires ready cache entries outside the TTL', () => {
    vi.setSystemTime(2_000_000);

    expect(
      isUserDirectoryCacheFresh(
        makeState({
          status: 'ready',
          fetchedAt: 2_000_000 - USER_DIRECTORY_CACHE_TTL_MS,
          users: [{ userId: '@alice:example.org' }],
        })
      )
    ).toBe(false);
  });

  it('requires a ready status and fetchedAt timestamp', () => {
    vi.setSystemTime(2_000_000);

    expect(isUserDirectoryCacheFresh(makeState({ status: 'idle', fetchedAt: 2_000_000 }))).toBe(
      false
    );
    expect(isUserDirectoryCacheFresh(makeState({ status: 'loading', fetchedAt: 2_000_000 }))).toBe(
      false
    );
    expect(isUserDirectoryCacheFresh(makeState({ status: 'error', fetchedAt: 2_000_000 }))).toBe(
      false
    );
    expect(isUserDirectoryCacheFresh(makeState({ status: 'ready', fetchedAt: 0 }))).toBe(false);
  });
});

describe('mergeUserDirectoryUsers', () => {
  it('dedupes by userId and lets incoming users override cached users', () => {
    expect(
      mergeUserDirectoryUsers(
        [
          {
            userId: '@alice:example.org',
            displayName: 'Old Alice',
            avatarMxcUrl: 'mxc://example.org/old',
          },
          { userId: '@bob:example.org', displayName: 'Bob' },
        ],
        [
          {
            userId: '@alice:example.org',
            displayName: 'Fresh Alice',
            avatarMxcUrl: 'mxc://example.org/fresh',
          },
          { userId: '@carol:example.org', displayName: 'Carol' },
        ]
      )
    ).toEqual([
      {
        userId: '@alice:example.org',
        displayName: 'Fresh Alice',
        avatarMxcUrl: 'mxc://example.org/fresh',
      },
      { userId: '@bob:example.org', displayName: 'Bob' },
      { userId: '@carol:example.org', displayName: 'Carol' },
    ]);
  });

  it('preserves cached fields when incoming duplicate users omit them', () => {
    expect(
      mergeUserDirectoryUsers(
        [
          {
            userId: '@alice:example.org',
            displayName: 'Alice',
            avatarMxcUrl: 'mxc://example.org/alice',
          },
        ],
        [
          {
            userId: '@alice:example.org',
            displayName: 'Alice Smith',
          },
        ]
      )
    ).toEqual([
      {
        userId: '@alice:example.org',
        displayName: 'Alice Smith',
        avatarMxcUrl: 'mxc://example.org/alice',
      },
    ]);
  });

  it('preserves cached fields when incoming duplicate server users return null fields', () => {
    expect(
      mergeUserDirectoryUsers(
        [
          {
            userId: '@alice:example.org',
            displayName: 'Alice',
            avatarMxcUrl: 'mxc://example.org/alice',
          },
        ],
        normalizeUserDirectoryUsers([
          {
            user_id: '@alice:example.org',
            display_name: null,
            avatar_url: null,
          },
        ])
      )
    ).toEqual([
      {
        userId: '@alice:example.org',
        displayName: 'Alice',
        avatarMxcUrl: 'mxc://example.org/alice',
      },
    ]);
  });
});

describe('mergeUserDirectoryBootstrapUsers', () => {
  it('preserves cached fields for refreshed users while dropping users missing from the fresh payload', () => {
    expect(
      mergeUserDirectoryBootstrapUsers(
        [
          {
            userId: '@alice:server',
            displayName: 'Alice Wonder',
            avatarMxcUrl: 'mxc://abc',
          },
          {
            userId: '@bob:server',
            displayName: 'Bob',
            avatarMxcUrl: 'mxc://bob',
          },
        ],
        normalizeUserDirectoryUsers([
          {
            user_id: '@alice:server',
            display_name: null,
            avatar_url: null,
          },
        ])
      )
    ).toEqual([
      {
        userId: '@alice:server',
        displayName: 'Alice Wonder',
        avatarMxcUrl: 'mxc://abc',
      },
    ]);
  });
});
