import { WritableAtom, atom } from 'jotai';
import produce from 'immer';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from './utils/atomWithLocalStorage';

const CLOSED_NAV_CATEGORY = 'closedNavCategories';
const INITIALIZED_NAV_CATEGORY = 'initializedNavCategories';

type ClosedNavCategoriesAction =
  | {
      type: 'PUT';
      categoryId: string;
    }
  | {
      type: 'DELETE';
      categoryId: string;
    };

export type ClosedNavCategoriesAtom = WritableAtom<
  Set<string>,
  [ClosedNavCategoriesAction],
  undefined
>;

export const makeClosedNavCategoriesAtom = (
  userId: string,
  initiallyClosedCategoryIds: Iterable<string> = []
): ClosedNavCategoriesAtom => {
  const storeKey = `${CLOSED_NAV_CATEGORY}${userId}`;
  const initializedStoreKey = `${INITIALIZED_NAV_CATEGORY}${userId}`;
  const initialCategoryIds = Array.from(initiallyClosedCategoryIds);

  const baseClosedNavCategoriesAtom = atomWithLocalStorage<Set<string>>(
    storeKey,
    (key) => {
      const closedCategoryIds = new Set(getLocalStorageItem<string[]>(key, []));
      const initializedCategoryIds = new Set(
        getLocalStorageItem<string[]>(initializedStoreKey, [])
      );
      let initializedDefault = false;

      initialCategoryIds.forEach((categoryId) => {
        if (initializedCategoryIds.has(categoryId)) return;
        initializedCategoryIds.add(categoryId);
        closedCategoryIds.add(categoryId);
        initializedDefault = true;
      });

      if (initializedDefault) {
        setLocalStorageItem(key, Array.from(closedCategoryIds));
        setLocalStorageItem(initializedStoreKey, Array.from(initializedCategoryIds));
      }

      return closedCategoryIds;
    },
    (key, value) => {
      const arrayValue = Array.from(value);
      setLocalStorageItem(key, arrayValue);
    }
  );

  const closedNavCategoriesAtom = atom<Set<string>, [ClosedNavCategoriesAction], undefined>(
    (get) => get(baseClosedNavCategoriesAtom),
    (get, set, action) => {
      if (action.type === 'DELETE') {
        set(
          baseClosedNavCategoriesAtom,
          produce(get(baseClosedNavCategoriesAtom), (draft) => {
            draft.delete(action.categoryId);
          })
        );
        return;
      }
      if (action.type === 'PUT') {
        set(
          baseClosedNavCategoriesAtom,
          produce(get(baseClosedNavCategoriesAtom), (draft) => {
            draft.add(action.categoryId);
          })
        );
      }
    }
  );

  return closedNavCategoriesAtom;
};

export const makeNavCategoryId = (...args: string[]): string => args.join('|');
