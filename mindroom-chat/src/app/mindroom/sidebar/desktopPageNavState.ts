import { WritableAtom } from 'jotai';
import { createContext, useContext } from 'react';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';

type MindroomDesktopPageNavState = {
  canCollapse: boolean;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

export const MindroomDesktopPageNavContext = createContext<MindroomDesktopPageNavState | undefined>(
  undefined
);

export function useMindroomDesktopPageNav(): MindroomDesktopPageNavState {
  const value = useContext(MindroomDesktopPageNavContext);
  if (!value) throw new Error('Mindroom desktop page navigation provider is missing.');
  return value;
}

const DESKTOP_PAGE_NAV_COLLAPSED_STORAGE_KEY_PREFIX = 'mindroom.pageNav.desktopCollapsed:';

export const getDesktopPageNavCollapsedStorageKey = (userId: string): string =>
  `${DESKTOP_PAGE_NAV_COLLAPSED_STORAGE_KEY_PREFIX}${userId}`;

const readDesktopPageNavCollapsed = (key: string): boolean =>
  getLocalStorageItem<unknown>(key, false) === true;

const writeDesktopPageNavCollapsed = (key: string, collapsed: boolean): void => {
  setLocalStorageItem(key, collapsed);
};

export const makeDesktopPageNavCollapsedAtom = (
  userId: string
): WritableAtom<boolean, [boolean], undefined> =>
  atomWithLocalStorage(
    getDesktopPageNavCollapsedStorageKey(userId),
    readDesktopPageNavCollapsed,
    writeDesktopPageNavCollapsed
  );
