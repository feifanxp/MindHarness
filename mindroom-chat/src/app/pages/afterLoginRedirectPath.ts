import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../utils/safeLocalStorage';

const AFTER_LOGIN_REDIRECT_PATH_KEY = 'after_login_redirect_url';

// A saved path belongs to the login it started; an abandoned login must not
// redirect a later, unrelated one (for example to an expired pairing code).
export const AFTER_LOGIN_REDIRECT_PATH_MAX_AGE_MS = 15 * 60 * 1000;

type SavedAfterLoginRedirectPath = {
  path: string;
  savedAt: number;
};

const parseSavedPath = (raw: string): SavedAfterLoginRedirectPath | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'path' in value &&
      typeof value.path === 'string' &&
      'savedAt' in value &&
      typeof value.savedAt === 'number'
    ) {
      return { path: value.path, savedAt: value.savedAt };
    }
  } catch {
    // Values from earlier releases are plain, untimestamped paths.
  }
  return undefined;
};

export const setAfterLoginRedirectPath = (url: string): void => {
  const saved: SavedAfterLoginRedirectPath = { path: url, savedAt: Date.now() };
  setStorageItemSafe(getSafeLocalStorage(), AFTER_LOGIN_REDIRECT_PATH_KEY, JSON.stringify(saved));
};

export const deleteAfterLoginRedirectPath = (): void => {
  removeStorageItemSafe(getSafeLocalStorage(), AFTER_LOGIN_REDIRECT_PATH_KEY);
};

export const getAfterLoginRedirectPath = (): string | undefined => {
  const raw = getStorageItemSafe(getSafeLocalStorage(), AFTER_LOGIN_REDIRECT_PATH_KEY);
  if (raw === null) return undefined;

  const saved = parseSavedPath(raw);
  const age = saved ? Date.now() - saved.savedAt : Number.POSITIVE_INFINITY;
  if (!saved || age < 0 || age >= AFTER_LOGIN_REDIRECT_PATH_MAX_AGE_MS) {
    deleteAfterLoginRedirectPath();
    return undefined;
  }
  return saved.path;
};
