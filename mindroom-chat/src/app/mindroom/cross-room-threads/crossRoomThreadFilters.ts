import { type WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import { isRecord } from '../../utils/isRecord';
import { createUserScopedAtomRegistry } from '../cache/userScopedAtomRegistry';

const CROSS_ROOM_THREAD_FILTERS = 'crossRoomThreadFilters';
const CROSS_ROOM_THREAD_FILTERS_VERSION = 1;

export type CrossRoomThreadScope = 'involved' | 'all';
export type CrossRoomThreadResolvedFilter = 'all' | 'resolved' | 'unresolved';
export type CrossRoomThreadActivityWindow = 'today' | '7d' | '30d' | 'all';

export type CrossRoomThreadFilters = {
  v: typeof CROSS_ROOM_THREAD_FILTERS_VERSION;
  query: string;
  scope: CrossRoomThreadScope;
  roomIds: string[];
  spaceIds: string[];
  tag: {
    include: string[];
    exclude: string[];
  };
  unreadOnly: boolean;
  resolved: CrossRoomThreadResolvedFilter;
  hasAttention: boolean;
  activityWindow: CrossRoomThreadActivityWindow;
};

export type CrossRoomThreadFiltersUpdate =
  | CrossRoomThreadFilters
  | ((current: CrossRoomThreadFilters) => CrossRoomThreadFilters);

type PersistedCrossRoomThreadFilters = Omit<CrossRoomThreadFilters, 'query'>;

type CrossRoomThreadFiltersAtom = WritableAtom<
  CrossRoomThreadFilters,
  [CrossRoomThreadFiltersUpdate],
  undefined
>;

export const DEFAULT_CROSS_ROOM_THREAD_FILTERS: CrossRoomThreadFilters = {
  v: CROSS_ROOM_THREAD_FILTERS_VERSION,
  query: '',
  scope: 'involved',
  roomIds: [],
  spaceIds: [],
  tag: {
    include: [],
    exclude: [],
  },
  unreadOnly: false,
  resolved: 'all',
  hasAttention: false,
  activityWindow: '7d',
};

const DEFAULT_PERSISTED_CROSS_ROOM_THREAD_FILTERS: PersistedCrossRoomThreadFilters = {
  v: CROSS_ROOM_THREAD_FILTERS_VERSION,
  scope: DEFAULT_CROSS_ROOM_THREAD_FILTERS.scope,
  roomIds: DEFAULT_CROSS_ROOM_THREAD_FILTERS.roomIds,
  spaceIds: DEFAULT_CROSS_ROOM_THREAD_FILTERS.spaceIds,
  tag: DEFAULT_CROSS_ROOM_THREAD_FILTERS.tag,
  unreadOnly: DEFAULT_CROSS_ROOM_THREAD_FILTERS.unreadOnly,
  resolved: DEFAULT_CROSS_ROOM_THREAD_FILTERS.resolved,
  hasAttention: DEFAULT_CROSS_ROOM_THREAD_FILTERS.hasAttention,
  activityWindow: DEFAULT_CROSS_ROOM_THREAD_FILTERS.activityWindow,
};

const resolveCrossRoomThreadFiltersUpdate = (
  current: CrossRoomThreadFilters,
  update: CrossRoomThreadFiltersUpdate
): CrossRoomThreadFilters => (typeof update === 'function' ? update(current) : update);

const validScopes = new Set<CrossRoomThreadScope>(['involved', 'all']);
const validResolved = new Set<CrossRoomThreadResolvedFilter>(['all', 'resolved', 'unresolved']);
const validActivityWindows = new Set<CrossRoomThreadActivityWindow>(['today', '7d', '30d', 'all']);

const getStoreKey = (userId: string): string => `${CROSS_ROOM_THREAD_FILTERS}:${userId}`;

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

const sanitizeQuery = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, 200) : '';

export const sanitizeCrossRoomThreadFilters = (value: unknown): CrossRoomThreadFilters => {
  if (!isRecord(value) || value.v !== CROSS_ROOM_THREAD_FILTERS_VERSION) {
    return DEFAULT_CROSS_ROOM_THREAD_FILTERS;
  }

  const tag = isRecord(value.tag) ? value.tag : {};
  const scope = validScopes.has(value.scope as CrossRoomThreadScope)
    ? (value.scope as CrossRoomThreadScope)
    : DEFAULT_CROSS_ROOM_THREAD_FILTERS.scope;
  const resolved = validResolved.has(value.resolved as CrossRoomThreadResolvedFilter)
    ? (value.resolved as CrossRoomThreadResolvedFilter)
    : DEFAULT_CROSS_ROOM_THREAD_FILTERS.resolved;
  const activityWindow = validActivityWindows.has(
    value.activityWindow as CrossRoomThreadActivityWindow
  )
    ? (value.activityWindow as CrossRoomThreadActivityWindow)
    : DEFAULT_CROSS_ROOM_THREAD_FILTERS.activityWindow;

  return {
    v: CROSS_ROOM_THREAD_FILTERS_VERSION,
    query: sanitizeQuery(value.query),
    scope,
    roomIds: sanitizeStringArray(value.roomIds),
    spaceIds: sanitizeStringArray(value.spaceIds),
    tag: {
      include: sanitizeStringArray(tag.include),
      exclude: sanitizeStringArray(tag.exclude),
    },
    unreadOnly: value.unreadOnly === true,
    resolved,
    hasAttention: value.hasAttention === true,
    activityWindow,
  };
};

const sanitizePersistedCrossRoomThreadFilters = (
  value: unknown
): PersistedCrossRoomThreadFilters => {
  const sanitized = sanitizeCrossRoomThreadFilters(value);
  return {
    v: sanitized.v,
    scope: sanitized.scope,
    roomIds: sanitized.roomIds,
    spaceIds: sanitized.spaceIds,
    tag: sanitized.tag,
    unreadOnly: sanitized.unreadOnly,
    resolved: sanitized.resolved,
    hasAttention: sanitized.hasAttention,
    activityWindow: sanitized.activityWindow,
  };
};

const makeEphemeralCrossRoomThreadFiltersAtom = (): CrossRoomThreadFiltersAtom => {
  const baseAtom = atom<CrossRoomThreadFilters>(DEFAULT_CROSS_ROOM_THREAD_FILTERS);
  return atom<CrossRoomThreadFilters, [CrossRoomThreadFiltersUpdate], undefined>(
    (get) => get(baseAtom),
    (get, set, update) => {
      set(
        baseAtom,
        sanitizeCrossRoomThreadFilters(resolveCrossRoomThreadFiltersUpdate(get(baseAtom), update))
      );
      return undefined;
    }
  );
};

const createCrossRoomThreadFiltersAtom = (userId: string): CrossRoomThreadFiltersAtom => {
  if (!userId) return makeEphemeralCrossRoomThreadFiltersAtom();

  const storeKey = getStoreKey(userId);
  const persistedAtom = atomWithLocalStorage<PersistedCrossRoomThreadFilters>(
    storeKey,
    (key) =>
      sanitizePersistedCrossRoomThreadFilters(getLocalStorageItem<unknown | null>(key, null)),
    (key, value) => setLocalStorageItem(key, sanitizePersistedCrossRoomThreadFilters(value))
  );
  const queryAtom = atom(DEFAULT_CROSS_ROOM_THREAD_FILTERS.query);
  const filtersAtom = atom<CrossRoomThreadFilters, [CrossRoomThreadFiltersUpdate], undefined>(
    (get) => ({
      ...DEFAULT_PERSISTED_CROSS_ROOM_THREAD_FILTERS,
      ...get(persistedAtom),
      query: get(queryAtom),
    }),
    (get, set, update) => {
      const current = {
        ...DEFAULT_PERSISTED_CROSS_ROOM_THREAD_FILTERS,
        ...get(persistedAtom),
        query: get(queryAtom),
      };
      const sanitized = sanitizeCrossRoomThreadFilters(
        resolveCrossRoomThreadFiltersUpdate(current, update)
      );
      set(queryAtom, sanitized.query);
      set(persistedAtom, sanitizePersistedCrossRoomThreadFilters(sanitized));
    }
  );

  return filtersAtom;
};

const crossRoomThreadFiltersRegistry = createUserScopedAtomRegistry<CrossRoomThreadFiltersAtom>({
  create: createCrossRoomThreadFiltersAtom,
  getStorageKey: getStoreKey,
  cacheEmptyUserId: false,
});

export const makeCrossRoomThreadFiltersAtom = crossRoomThreadFiltersRegistry.getOrCreate;

export const clearCrossRoomThreadFiltersStore = (userId: string) => {
  crossRoomThreadFiltersRegistry.clear(userId);
};
