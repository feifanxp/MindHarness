/**
 * localStorage access that fails closed: a blocked or unavailable store
 * (Safari private mode, sandboxed iframes, storage-restricted embeds) returns
 * `undefined` instead of throwing, so callers degrade to their no-storage
 * behavior.
 */
export const getSafeLocalStorage = (): Storage | undefined => {
  try {
    if (typeof globalThis.localStorage === 'undefined') return undefined;
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;
type StorageRemover = Pick<Storage, 'removeItem'>;
type StorageEnumerator = Pick<Storage, 'key' | 'length'>;

export const getStorageItemSafe = (
  storage: StorageReader | undefined,
  key: string
): string | null => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export const setStorageItemSafe = (
  storage: StorageWriter | undefined,
  key: string,
  value: string
): boolean => {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const removeStorageItemSafe = (
  storage: StorageRemover | undefined,
  key: string
): boolean => {
  try {
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const getStorageKeysSafe = (storage: StorageEnumerator | undefined): string[] => {
  try {
    if (!storage) return [];
    return Array.from({ length: storage.length }, (_, index) => {
      try {
        return storage.key(index);
      } catch {
        return null;
      }
    }).filter((key): key is string => key !== null);
  } catch {
    return [];
  }
};
