import { type WritableAtom, atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import { createUserScopedAtomRegistry } from '../cache/userScopedAtomRegistry';

const RECENTLY_OPENED_PANEL_HEIGHT = 'recentlyOpenedPanelHeight';

export const DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT = 320;
export const MIN_RECENTLY_OPENED_PANEL_HEIGHT = 96;
export const MAX_RECENTLY_OPENED_PANEL_HEIGHT = 1200;
export const RECENTLY_OPENED_PANEL_RESERVED_HEIGHT = 140;

type RecentlyOpenedPanelHeightAtom = WritableAtom<number, [number], undefined>;

export const normalizeRecentlyOpenedPanelHeight = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(
        Math.max(MIN_RECENTLY_OPENED_PANEL_HEIGHT, Math.round(value)),
        MAX_RECENTLY_OPENED_PANEL_HEIGHT
      )
    : DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT;

export const getRecentlyOpenedPanelHeightStoreKey = (userId: string): string =>
  `${RECENTLY_OPENED_PANEL_HEIGHT}:${userId}`;

const createRecentlyOpenedPanelHeightAtom = (userId: string): RecentlyOpenedPanelHeightAtom => {
  const persistedAtom = atomWithLocalStorage<number>(
    getRecentlyOpenedPanelHeightStoreKey(userId),
    (key) =>
      normalizeRecentlyOpenedPanelHeight(
        getLocalStorageItem<unknown>(key, DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT)
      ),
    (key, height) => setLocalStorageItem(key, normalizeRecentlyOpenedPanelHeight(height))
  );

  return atom<number, [number], undefined>(
    (get) => get(persistedAtom),
    (_get, set, height) => set(persistedAtom, normalizeRecentlyOpenedPanelHeight(height))
  );
};

const recentlyOpenedPanelHeightRegistry =
  createUserScopedAtomRegistry<RecentlyOpenedPanelHeightAtom>({
    create: createRecentlyOpenedPanelHeightAtom,
    getStorageKey: getRecentlyOpenedPanelHeightStoreKey,
  });

export const makeRecentlyOpenedPanelHeightAtom = recentlyOpenedPanelHeightRegistry.getOrCreate;

export const clearRecentlyOpenedPanelHeightStore = (userId: string): void => {
  recentlyOpenedPanelHeightRegistry.clear(userId);
};
