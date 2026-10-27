import { useCallback, useEffect } from 'react';
import { useAtom } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';

import {
  USER_DIRECTORY_BOOTSTRAP_LIMIT,
  USER_DIRECTORY_CACHE_TTL_MS,
  mergeUserDirectoryBootstrapUsers,
  normalizeUserDirectoryUsers,
  userDirectoryCacheAtom,
  type ServerUserDirectoryUser,
  type UserDirectoryCacheState,
} from '../state/userDirectoryCache';
import { useMatrixClient } from './useMatrixClient';

type UserDirectoryFetchResult = {
  users: ServerUserDirectoryUser[];
  limited: boolean;
};

const fullDirectoryFetchPromises = new WeakMap<MatrixClient, Promise<UserDirectoryFetchResult>>();

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Failed to fetch user directory.';

export const getUserDirectoryCacheOwnerKey = (mx: MatrixClient): string =>
  `${mx.getSafeUserId() ?? ''}|${mx.baseUrl}`;

const emptyCacheForOwner = (ownerKey: string): UserDirectoryCacheState => ({
  users: [],
  status: 'idle',
  fetchedAt: 0,
  limited: false,
  isBootstrapOnly: false,
  ownerKey,
});

const fetchFullUserDirectory = (mx: MatrixClient): Promise<UserDirectoryFetchResult> => {
  const cachedPromise = fullDirectoryFetchPromises.get(mx);
  if (cachedPromise) return cachedPromise;

  const promise = mx
    .searchUserDirectory({
      // Every MXID contains '@', so on Tuwunel's case-insensitive substring
      // matcher this bootstraps all visible users — unlike ' ', which missed
      // space-less display names (e.g. MindRoomExpert). This is a
      // Tuwunel-compatible visible-user bootstrap, NOT a Matrix-standard
      // match-all guarantee. Tuwunel clamps the limit to 500, so the existing
      // `limited` handling stays load-bearing past 500 users.
      term: '@',
      limit: USER_DIRECTORY_BOOTSTRAP_LIMIT,
    })
    .then((response) => {
      if (response.limited) {
        // The per-keystroke server fallback covers entries beyond the bootstrap cap.
        // eslint-disable-next-line no-console
        console.debug('User directory bootstrap response was limited.', {
          limit: USER_DIRECTORY_BOOTSTRAP_LIMIT,
        });
      }

      const limited = response.limited || response.results.length === 0;

      return {
        users: normalizeUserDirectoryUsers(response.results),
        limited,
      };
    })
    .finally(() => {
      fullDirectoryFetchPromises.delete(mx);
    });

  fullDirectoryFetchPromises.set(mx, promise);
  return promise;
};

export const useUserDirectoryCache = () => {
  const mx = useMatrixClient();
  const ownerKey = getUserDirectoryCacheOwnerKey(mx);
  const [cache, setCache] = useAtom(userDirectoryCacheAtom);
  const ownerCache = cache.ownerKey === ownerKey ? cache : emptyCacheForOwner(ownerKey);
  const ownerCacheStatus = ownerCache.status;
  const ownerCacheFetchedAt = ownerCache.fetchedAt;

  const refresh = useCallback(async () => {
    setCache((currentCache) => ({
      ...(currentCache.ownerKey === ownerKey ? currentCache : emptyCacheForOwner(ownerKey)),
      status: 'loading',
      ownerKey,
      error: undefined,
    }));

    try {
      const result = await fetchFullUserDirectory(mx);

      setCache((currentCache) =>
        currentCache.ownerKey === ownerKey
          ? {
              users: mergeUserDirectoryBootstrapUsers(currentCache.users, result.users),
              status: 'ready',
              fetchedAt: Date.now(),
              limited: result.limited,
              isBootstrapOnly: true,
              ownerKey,
            }
          : currentCache
      );
    } catch (error) {
      setCache((currentCache) =>
        currentCache.ownerKey === ownerKey
          ? {
              ...currentCache,
              status: 'error',
              ownerKey,
              error: getErrorMessage(error),
            }
          : currentCache
      );
    }
  }, [mx, ownerKey, setCache]);

  useEffect(() => {
    if (ownerCacheStatus === 'loading' || ownerCacheStatus === 'error') return;
    if (
      ownerCacheStatus === 'ready' &&
      ownerCacheFetchedAt > 0 &&
      Date.now() - ownerCacheFetchedAt < USER_DIRECTORY_CACHE_TTL_MS
    ) {
      const timeoutId = setTimeout(() => {
        void refresh();
      }, USER_DIRECTORY_CACHE_TTL_MS - (Date.now() - ownerCacheFetchedAt));

      return () => {
        clearTimeout(timeoutId);
      };
    }

    void refresh();
    return undefined;
  }, [ownerCacheStatus, ownerCacheFetchedAt, ownerKey, refresh]);

  return {
    users: ownerCache.users,
    status: ownerCache.status,
    fetchedAt: ownerCache.fetchedAt,
    limited: ownerCache.limited,
    isBootstrapOnly: ownerCache.isBootstrapOnly,
    ownerKey,
    refresh,
  };
};
