import { atomFamily } from 'jotai/utils';
import {
  createDefaultThreadFilterState,
  deserializeThreadFilterState,
  isDefaultThreadFilterState,
  serializeThreadFilterState,
  type ThreadFilterState,
} from './roomThreadOverviewModel';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import {
  getSafeLocalStorage,
  getStorageKeysSafe,
  removeStorageItemSafe,
} from '../../utils/safeLocalStorage';

const ROOM_THREAD_FILTER = 'roomThreadFilter';
const trackedRoomThreadFilterStoreKeys = new Set<string>();

export const getRoomThreadFilterStorageKey = (userId: string, roomId: string): string =>
  `${ROOM_THREAD_FILTER}:${userId}:${roomId}`;

const baseRoomThreadFilterAtomFamily = atomFamily((storeKey: string) =>
  atomWithLocalStorage<ThreadFilterState>(
    storeKey,
    (key) => {
      const rawValue = getLocalStorageItem<unknown | null>(key, null);
      return rawValue === null
        ? createDefaultThreadFilterState()
        : deserializeThreadFilterState(rawValue);
    },
    (key, value) => {
      if (isDefaultThreadFilterState(value)) {
        removeStorageItemSafe(getSafeLocalStorage(), key);
        return;
      }

      setLocalStorageItem(key, serializeThreadFilterState(value));
    }
  )
);

export const roomThreadFilterAtomFamily = (userId: string, roomId: string) => {
  const storeKey = getRoomThreadFilterStorageKey(userId, roomId);
  trackedRoomThreadFilterStoreKeys.add(storeKey);
  return baseRoomThreadFilterAtomFamily(storeKey);
};

export const clearRoomThreadFiltersStore = (userId: string) => {
  const keyPrefix = `${ROOM_THREAD_FILTER}:${userId}:`;
  const storage = getSafeLocalStorage();
  const storageKeys = getStorageKeysSafe(storage).filter((key) => key.startsWith(keyPrefix));
  const cachedKeys = Array.from(trackedRoomThreadFilterStoreKeys).filter((key) =>
    key.startsWith(keyPrefix)
  );
  const keysToClear = new Set([...storageKeys, ...cachedKeys]);

  keysToClear.forEach((key) => {
    removeStorageItemSafe(storage, key);
    trackedRoomThreadFilterStoreKeys.delete(key);
    baseRoomThreadFilterAtomFamily.remove(key);
  });
};
