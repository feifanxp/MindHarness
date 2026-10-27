import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Room } from 'matrix-js-sdk';

import {
  INVITE_AUTOCOMPLETE_LIMIT,
  INVITE_SERVER_FALLBACK_MIN_LOCAL_RESULTS,
  INVITE_SERVER_SEARCH_LIMIT,
  isUserDirectoryCacheFresh,
  mergeUserDirectoryUsers,
  normalizeUserDirectoryUsers,
  type ServerUserDirectoryUser,
  type UserDirectoryCacheState,
} from '../state/userDirectoryCache';
import {
  countStrongInviteUserMatches,
  filterInviteUserCandidates,
  getUserDirectoryQueryVariants,
  rankUsers,
} from '../utils/userDirectorySearch';
import { useAlive } from './useAlive';
import { useDebounce } from './useDebounce';
import { useDirectUsers } from './useDirectUsers';
import { useMatrixClient } from './useMatrixClient';
import { useUserDirectoryCache } from './useUserDirectoryCache';

type ServerSearchResult = {
  term: string;
  ownerKey?: string;
  users: ServerUserDirectoryUser[];
};

type InviteUserSearchResult = {
  suggestions: ServerUserDirectoryUser[];
  isFetching: boolean;
};

const EMPTY_USER_SUGGESTIONS: ServerUserDirectoryUser[] = [];

const getSelfUserId = (mx: ReturnType<typeof useMatrixClient>): string | undefined =>
  mx.getSafeUserId() ?? undefined;

const getFilteredUsers = (
  users: readonly ServerUserDirectoryUser[],
  room: Room | undefined,
  selfUserId?: string
): ServerUserDirectoryUser[] => filterInviteUserCandidates(users, room, selfUserId);

const shouldSearchServer = (
  trimmedQuery: string,
  localSearchTerm: string,
  cache: UserDirectoryCacheState,
  localSuggestions: readonly ServerUserDirectoryUser[]
): boolean =>
  trimmedQuery.length >= 2 &&
  (cache.status !== 'ready' ||
    !isUserDirectoryCacheFresh(cache) ||
    cache.limited ||
    cache.isBootstrapOnly ||
    // Weak matches (shared agent prefix, fuzzy noise) can flood the local
    // list while the intended user only exists on the server; only strong
    // local matches may suppress the server fallback.
    countStrongInviteUserMatches(localSuggestions, localSearchTerm) <
      INVITE_SERVER_FALLBACK_MIN_LOCAL_RESULTS);

// Without a room (e.g. the create-DM flow) membership filtering is skipped and
// only the current user is excluded from suggestions.
export const useInviteUserSearch = (
  room: Room | undefined,
  query: string
): InviteUserSearchResult => {
  const mx = useMatrixClient();
  const alive = useAlive();
  const cache = useUserDirectoryCache();
  const directUsers = useDirectUsers();
  const requestIdRef = useRef(0);
  const [serverResult, setServerResult] = useState<ServerSearchResult>();
  const [isServerFetching, setIsServerFetching] = useState(false);

  const trimmedQuery = query.trim();
  const localSearchTerm = useMemo(
    () => (trimmedQuery.startsWith('@') ? trimmedQuery.slice(1) : trimmedQuery),
    [trimmedQuery]
  );
  const selfUserId = getSelfUserId(mx);

  const directUserCandidates = useMemo<ServerUserDirectoryUser[]>(
    () => directUsers.map((userId) => ({ userId })),
    [directUsers]
  );

  const localUsers = useMemo(
    () => mergeUserDirectoryUsers(directUserCandidates, cache.users),
    [cache.users, directUserCandidates]
  );

  const filteredLocalUsers = useMemo(
    () => getFilteredUsers(localUsers, room, selfUserId),
    [localUsers, room, selfUserId]
  );

  const localSuggestions = useMemo(() => {
    if (localSearchTerm.length === 0) return EMPTY_USER_SUGGESTIONS;
    return rankUsers(filteredLocalUsers, localSearchTerm, INVITE_AUTOCOMPLETE_LIMIT);
  }, [filteredLocalUsers, localSearchTerm]);

  const cacheState = useMemo<UserDirectoryCacheState>(
    () => ({
      users: cache.users,
      status: cache.status,
      fetchedAt: cache.fetchedAt,
      limited: cache.limited,
      isBootstrapOnly: cache.isBootstrapOnly,
      ownerKey: cache.ownerKey,
    }),
    [
      cache.fetchedAt,
      cache.isBootstrapOnly,
      cache.limited,
      cache.ownerKey,
      cache.status,
      cache.users,
    ]
  );

  const needsServerSearch =
    localSearchTerm.length > 0 &&
    shouldSearchServer(trimmedQuery, localSearchTerm, cacheState, localSuggestions);

  const runServerSearch = useCallback(
    async (term: string, queryTerm: string, requestId: number) => {
      if (!alive() || requestId !== requestIdRef.current) return;

      setIsServerFetching(true);

      // The server matches by case-insensitive substring, so a natural spaced
      // query like `mindroom expert` cannot hit a space-less display name like
      // `MindRoomExpert`. Also search a whitespace-compacted variant; the raw
      // term stays so spaced display names keep matching.
      const terms = getUserDirectoryQueryVariants(term);

      // Each variant publishes as soon as it settles: one slow or hung request
      // must not delay or discard the sibling's results. A failed variant adds
      // nothing; if all fail, clear older matching hits without creating new state.
      let unsettledVariants = terms.length;
      let publishedThisRequest = false;
      const settleVariant = (users: ServerUserDirectoryUser[] | undefined) => {
        // A newer effect owns the loading state. Stale settlements must not
        // decrement this request's counter and clear that newer request.
        if (!alive() || requestId !== requestIdRef.current) return;

        if (users) {
          // The first publish of a request replaces any previous result for
          // the same term; later variants of the same request merge into it.
          const mergeIntoCurrent = publishedThisRequest;
          publishedThisRequest = true;
          setServerResult((currentResult) =>
            // The request ID is the primary ownership boundary. Keep this
            // owner check as defense in depth during render-to-effect handoff.
            mergeIntoCurrent &&
            currentResult &&
            currentResult.term === queryTerm &&
            currentResult.ownerKey === cache.ownerKey
              ? { ...currentResult, users: mergeUserDirectoryUsers(currentResult.users, users) }
              : { term: queryTerm, ownerKey: cache.ownerKey, users }
          );
        }

        unsettledVariants -= 1;
        if (unsettledVariants === 0) {
          if (!publishedThisRequest) {
            setServerResult((currentResult) =>
              currentResult?.term === queryTerm &&
              currentResult.ownerKey === cache.ownerKey &&
              currentResult.users.length > 0
                ? { ...currentResult, users: [] }
                : currentResult
            );
          }
          setIsServerFetching(false);
        }
      };

      await Promise.allSettled(
        terms.map((searchTerm) =>
          mx
            .searchUserDirectory({
              term: searchTerm,
              limit: INVITE_SERVER_SEARCH_LIMIT,
            })
            .then((response) => normalizeUserDirectoryUsers(response.results))
            .then(settleVariant, () => settleVariant(undefined))
        )
      );
    },
    [alive, cache.ownerKey, mx]
  );

  const debouncedServerSearch = useDebounce(runServerSearch, { wait: 200 });

  useEffect(() => {
    requestIdRef.current += 1;
    setServerResult((currentResult) =>
      currentResult?.term === trimmedQuery && currentResult.ownerKey === cache.ownerKey
        ? currentResult
        : undefined
    );

    if (!needsServerSearch) {
      setIsServerFetching(false);
      return;
    }

    const serverQuery = trimmedQuery.startsWith('@') ? trimmedQuery.slice(1) : trimmedQuery;
    if (serverQuery.length === 0) {
      setIsServerFetching(false);
      return;
    }

    setIsServerFetching(true);
    debouncedServerSearch(serverQuery, trimmedQuery, requestIdRef.current);
  }, [cache.ownerKey, debouncedServerSearch, needsServerSearch, trimmedQuery]);

  const suggestions = useMemo(() => {
    if (trimmedQuery.length === 0) return [];
    if (serverResult?.term !== trimmedQuery || serverResult.ownerKey !== cache.ownerKey) {
      return localSuggestions;
    }

    const filteredServerUsers = getFilteredUsers(serverResult.users, room, selfUserId);
    return rankUsers(
      mergeUserDirectoryUsers(filteredLocalUsers, filteredServerUsers),
      localSearchTerm,
      INVITE_AUTOCOMPLETE_LIMIT
    );
  }, [
    cache.ownerKey,
    filteredLocalUsers,
    localSuggestions,
    localSearchTerm,
    room,
    selfUserId,
    serverResult,
    trimmedQuery,
  ]);

  return {
    suggestions,
    isFetching: isServerFetching,
  };
};
