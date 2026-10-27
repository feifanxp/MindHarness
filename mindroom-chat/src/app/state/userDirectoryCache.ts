import { atom } from 'jotai';

export const USER_DIRECTORY_CACHE_TTL_MS = 30 * 60 * 1000;
export const USER_DIRECTORY_BOOTSTRAP_LIMIT = 5000;
export const INVITE_AUTOCOMPLETE_LIMIT = 8;
export const INVITE_SERVER_SEARCH_LIMIT = 12;
export const INVITE_SERVER_FALLBACK_MIN_LOCAL_RESULTS = 3;

export type ServerUserDirectoryUser = {
  userId: string;
  displayName?: string;
  avatarMxcUrl?: string;
};

type MatrixUserDirectoryUser = {
  user_id: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

export type UserDirectoryCacheState = {
  users: ServerUserDirectoryUser[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  fetchedAt: number;
  limited: boolean;
  isBootstrapOnly: boolean;
  ownerKey?: string;
  error?: string;
};

export const userDirectoryCacheAtom = atom<UserDirectoryCacheState>({
  users: [],
  status: 'idle',
  fetchedAt: 0,
  limited: false,
  isBootstrapOnly: false,
});

const normalizeOptionalString = (value: string | null | undefined): string | undefined =>
  value === undefined || value === null || value === '' ? undefined : value;

export const normalizeUserDirectoryUsers = (
  results: readonly MatrixUserDirectoryUser[]
): ServerUserDirectoryUser[] =>
  results.map((user) => ({
    userId: user.user_id,
    displayName: normalizeOptionalString(user.display_name),
    avatarMxcUrl: normalizeOptionalString(user.avatar_url),
  }));

export const isUserDirectoryCacheFresh = (
  state: UserDirectoryCacheState,
  ownerKey?: string
): boolean =>
  state.status === 'ready' &&
  state.fetchedAt > 0 &&
  (!ownerKey || state.ownerKey === ownerKey) &&
  Date.now() - state.fetchedAt < USER_DIRECTORY_CACHE_TTL_MS;

export const mergeUserDirectoryUsers = (
  existingUsers: readonly ServerUserDirectoryUser[],
  incomingUsers: readonly ServerUserDirectoryUser[]
): ServerUserDirectoryUser[] => {
  const mergedUsers = new Map<string, ServerUserDirectoryUser>();

  existingUsers.forEach((user) => {
    mergedUsers.set(user.userId, user);
  });
  incomingUsers.forEach((user) => {
    const existingUser = mergedUsers.get(user.userId);
    if (!existingUser) {
      mergedUsers.set(user.userId, user);
      return;
    }

    const mergedUser: Record<string, unknown> = { ...existingUser };
    Object.entries(user).forEach(([key, value]) => {
      if (value !== undefined) {
        mergedUser[key] = value;
      }
    });
    mergedUsers.set(user.userId, mergedUser as ServerUserDirectoryUser);
  });

  return Array.from(mergedUsers.values());
};

export const mergeUserDirectoryBootstrapUsers = (
  existingUsers: readonly ServerUserDirectoryUser[],
  freshUsers: readonly ServerUserDirectoryUser[]
): ServerUserDirectoryUser[] => {
  const freshUserIds = new Set(freshUsers.map((user) => user.userId));
  const mergedUsersById = new Map(
    mergeUserDirectoryUsers(existingUsers, freshUsers).map((user) => [user.userId, user])
  );

  return Array.from(freshUserIds, (userId) => mergedUsersById.get(userId)).filter(
    (user): user is ServerUserDirectoryUser => user !== undefined
  );
};
