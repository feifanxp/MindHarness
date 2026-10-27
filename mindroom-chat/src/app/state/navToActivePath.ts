import { WritableAtom, atom } from 'jotai';
import produce from 'immer';
import { Path } from 'react-router-dom';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from './utils/atomWithLocalStorage';
import { getSafeLocalStorage, removeStorageItemSafe } from '../utils/safeLocalStorage';

const NAV_TO_ACTIVE_PATH = 'navToActivePath';

const getStoreKey = (userId: string): string => `${NAV_TO_ACTIVE_PATH}${userId}`;

type NavToActivePath = Map<string, Path>;

type NavToActivePathAction =
  | {
      type: 'PUT';
      navId: string;
      path: Path;
    }
  | {
      type: 'DELETE';
      navId: string;
    };

export type NavToActivePathAtom = WritableAtom<NavToActivePath, [NavToActivePathAction], undefined>;

export const makeNavToActivePathAtom = (userId: string): NavToActivePathAtom => {
  const storeKey = getStoreKey(userId);

  const baseNavToActivePathAtom = atomWithLocalStorage<NavToActivePath>(
    storeKey,
    (key) => {
      const obj: Record<string, Path> = getLocalStorageItem(key, {});
      return new Map(Object.entries(obj));
    },
    (key, value) => {
      const obj: Record<string, Path> = Object.fromEntries(value);
      setLocalStorageItem(key, obj);
    }
  );

  const navToActivePathAtom = atom<NavToActivePath, [NavToActivePathAction], undefined>(
    (get) => get(baseNavToActivePathAtom),
    (get, set, action) => {
      if (action.type === 'DELETE') {
        set(
          baseNavToActivePathAtom,
          produce(get(baseNavToActivePathAtom), (draft) => {
            draft.delete(action.navId);
          })
        );
        return;
      }
      if (action.type === 'PUT') {
        set(
          baseNavToActivePathAtom,
          produce(get(baseNavToActivePathAtom), (draft) => {
            draft.set(action.navId, action.path);
          })
        );
      }
    }
  );

  return navToActivePathAtom;
};

export const getStoredNavToActivePath = (userId: string): NavToActivePath => {
  try {
    const obj: Record<string, Path> = getLocalStorageItem(getStoreKey(userId), {});
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
};

export const clearNavToActivePathStore = (userId: string) => {
  removeStorageItemSafe(getSafeLocalStorage(), getStoreKey(userId));
};
