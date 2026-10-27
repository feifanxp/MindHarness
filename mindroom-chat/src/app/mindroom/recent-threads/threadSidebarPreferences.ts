import { type WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import { isRecord } from '../../utils/isRecord';
import { createUserScopedAtomRegistry } from '../cache/userScopedAtomRegistry';
import { parseCrossRoomThreadIndexKey } from '../cross-room-threads/crossRoomThreadIndex';

const THREAD_SIDEBAR_PREFERENCES = 'threadSidebarPreferences';
const THREAD_SIDEBAR_PREFERENCES_VERSION = 1;
const MAX_PINNED_SIDEBAR_THREADS = 50;

export type ThreadSidebarPreferences = {
  pinnedThreadKeys: string[];
};

type ThreadSidebarPreferencesStore = ThreadSidebarPreferences & {
  v: typeof THREAD_SIDEBAR_PREFERENCES_VERSION;
};

export type ThreadSidebarPreferencesAction = {
  type: 'TOGGLE_PIN';
  threadKey: string;
};

type ThreadSidebarPreferencesAtom = WritableAtom<
  ThreadSidebarPreferences,
  [ThreadSidebarPreferencesAction],
  undefined
>;

export const DEFAULT_THREAD_SIDEBAR_PREFERENCES: ThreadSidebarPreferences = {
  pinnedThreadKeys: [],
};

const isValidThreadKey = (value: unknown): value is string =>
  typeof value === 'string' && parseCrossRoomThreadIndexKey(value) !== undefined;

export const sanitizeThreadSidebarPreferences = (value: unknown): ThreadSidebarPreferences => {
  if (!isRecord(value) || value.v !== THREAD_SIDEBAR_PREFERENCES_VERSION) {
    return DEFAULT_THREAD_SIDEBAR_PREFERENCES;
  }

  const pinnedThreadKeys = Array.isArray(value.pinnedThreadKeys)
    ? Array.from(new Set(value.pinnedThreadKeys.filter(isValidThreadKey))).slice(
        0,
        MAX_PINNED_SIDEBAR_THREADS
      )
    : [];

  return {
    pinnedThreadKeys,
  };
};

const serializeThreadSidebarPreferences = (
  preferences: ThreadSidebarPreferences
): ThreadSidebarPreferencesStore => ({
  ...preferences,
  v: THREAD_SIDEBAR_PREFERENCES_VERSION,
});

export const getThreadSidebarPreferencesStoreKey = (userId: string): string =>
  `${THREAD_SIDEBAR_PREFERENCES}:${userId}`;

const createThreadSidebarPreferencesAtom = (userId: string): ThreadSidebarPreferencesAtom => {
  const storeKey = getThreadSidebarPreferencesStoreKey(userId);
  const persistedAtom = atomWithLocalStorage<ThreadSidebarPreferences>(
    storeKey,
    (key) => sanitizeThreadSidebarPreferences(getLocalStorageItem<unknown | null>(key, null)),
    (key, preferences) => setLocalStorageItem(key, serializeThreadSidebarPreferences(preferences))
  );

  return atom<ThreadSidebarPreferences, [ThreadSidebarPreferencesAction], undefined>(
    (get) => get(persistedAtom),
    (get, set, action) => {
      const current = get(persistedAtom);

      if (!isValidThreadKey(action.threadKey)) return;
      const isPinned = current.pinnedThreadKeys.includes(action.threadKey);
      const pinnedThreadKeys = isPinned
        ? current.pinnedThreadKeys.filter((threadKey) => threadKey !== action.threadKey)
        : [action.threadKey, ...current.pinnedThreadKeys].slice(0, MAX_PINNED_SIDEBAR_THREADS);
      set(persistedAtom, { ...current, pinnedThreadKeys });
    }
  );
};

const threadSidebarPreferencesRegistry = createUserScopedAtomRegistry<ThreadSidebarPreferencesAtom>(
  {
    create: createThreadSidebarPreferencesAtom,
    getStorageKey: getThreadSidebarPreferencesStoreKey,
  }
);

export const makeThreadSidebarPreferencesAtom = threadSidebarPreferencesRegistry.getOrCreate;

export const clearThreadSidebarPreferencesStore = (userId: string): void => {
  threadSidebarPreferencesRegistry.clear(userId);
};
