import { getSafeLocalStorage, getStorageKeysSafe, removeStorageItemSafe } from './safeLocalStorage';

export const CACHE_OWNED_LOCAL_STORAGE_PREFIXES = [
  'cinny_',
  'mx_pending_events_',
  'mxjssdk_memory_filter_',
] as const;

export const isCacheOwnedLocalStorageKey = (key: string): boolean =>
  CACHE_OWNED_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));

export const clearAppOwnedCacheLocalStorage = (
  storage: Storage | undefined = getSafeLocalStorage()
): void => {
  getStorageKeysSafe(storage).forEach((key) => {
    if (!isCacheOwnedLocalStorageKey(key)) return;
    removeStorageItemSafe(storage, key);
  });
};
