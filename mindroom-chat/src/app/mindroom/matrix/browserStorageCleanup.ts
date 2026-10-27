import { appUrl, ensureBasePathTrailingSlash, normalizeBasePath } from '../../utils/basePath';
import {
  MINDROOM_SINGLETON_INDEXED_DB_NAMES,
  getMindroomSessionIndexedDbNames,
} from '../cache/sessionCleanup';
import {
  LEGACY_SESSION_STORAGE_KEYS,
  StoredSession,
  getLegacySessionRustCryptoStoreNames,
  getSessionIndexedDbStoreName,
  getSessionRustCryptoStoreNames,
  listSessions,
} from '../../state/sessions';

export type SessionCleanupContext = Pick<
  StoredSession,
  'sessionId' | 'baseUrl' | 'userId' | 'deviceId'
>;

export const deleteNamedDatabase = async (name: string): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
};

export const deleteNamedDatabases = async (names: string[]): Promise<void> => {
  const uniqueNames = Array.from(new Set(names));
  if (uniqueNames.length === 0) return;

  await Promise.all(uniqueNames.map((name) => deleteNamedDatabase(name)));
};

export const getCacheBustedAppReloadTarget = (appBasePath: string): string => {
  const reloadUrl = new URL(appBasePath, window.location.origin);
  reloadUrl.pathname = ensureBasePathTrailingSlash(normalizeBasePath(reloadUrl.pathname));
  reloadUrl.searchParams.set('clear_cache', `${Date.now()}`);
  return `${reloadUrl.pathname}${reloadUrl.search}${reloadUrl.hash}`;
};

const LEGACY_APP_SINGLETON_INDEXED_DB_NAMES = ['matrix-js-sdk:web-sync-store'];
const APP_SINGLETON_INDEXED_DB_NAMES: readonly string[] = [...MINDROOM_SINGLETON_INDEXED_DB_NAMES];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getStoredSessionCleanupContexts = (): SessionCleanupContext[] =>
  listSessions().map((session) => ({
    sessionId: session.sessionId,
    baseUrl: session.baseUrl,
    userId: session.userId,
    deviceId: session.deviceId,
  }));

export const mergeSessionCleanupContexts = (
  contexts: SessionCleanupContext[]
): SessionCleanupContext[] => {
  const mergedContexts = new Map<string, SessionCleanupContext>();

  contexts.forEach((context) => {
    mergedContexts.set(context.sessionId, context);
  });

  return Array.from(mergedContexts.values());
};

const getSessionCacheIndexedDbNames = (session: SessionCleanupContext): string[] => {
  const indexedDbStoreNames = getSessionIndexedDbStoreName(session);

  return [indexedDbStoreNames.sync, ...getMindroomSessionIndexedDbNames(session.sessionId)];
};

const getFallbackAppOwnedIndexedDbNames = (
  sessions: SessionCleanupContext[],
  legacySessionStoragePresent: boolean
): string[] =>
  Array.from(
    new Set([
      ...APP_SINGLETON_INDEXED_DB_NAMES,
      ...(legacySessionStoragePresent ? LEGACY_APP_SINGLETON_INDEXED_DB_NAMES : []),
      ...sessions.flatMap((session) => getSessionCacheIndexedDbNames(session)),
    ])
  );

const isSessionRustCryptoDbName = (name: string, sessionId: string): boolean => {
  const escapedSessionId = escapeRegExp(sessionId);
  const pattern = new RegExp(
    `^matrix-js-sdk::${escapedSessionId}(?:::.*)?::matrix-sdk-crypto(?:-meta)?$`
  );
  return pattern.test(name);
};

export const getAllSessionRustCryptoDbNames = async (
  session: SessionCleanupContext
): Promise<string[]> => {
  const fallbackNames = [
    ...getSessionRustCryptoStoreNames(session),
    ...getLegacySessionRustCryptoStoreNames(session),
  ];
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    return fallbackNames;
  }

  try {
    const databases = await indexedDB.databases();
    return Array.from(
      new Set([
        ...fallbackNames,
        ...databases.flatMap(({ name }) =>
          name && isSessionRustCryptoDbName(name, session.sessionId) ? [name] : []
        ),
      ])
    );
  } catch {
    return fallbackNames;
  }
};

export const hasLegacySessionStorage = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    return LEGACY_SESSION_STORAGE_KEYS.some((key) => Boolean(localStorage.getItem(key)));
  } catch {
    return false;
  }
};

const isAppOwnedIndexedDbName = (
  name: string,
  sessions: SessionCleanupContext[],
  legacySessionStoragePresent: boolean
): boolean => {
  if (APP_SINGLETON_INDEXED_DB_NAMES.includes(name)) return true;
  if (legacySessionStoragePresent && LEGACY_APP_SINGLETON_INDEXED_DB_NAMES.includes(name))
    return true;

  // Clearing caches retains Matrix logins, so their encryption identity must
  // survive too. Account removal separately deletes all session crypto stores.
  return sessions.some((session) => getSessionCacheIndexedDbNames(session).includes(name));
};

export const getAppOwnedIndexedDbNames = async (
  sessions: SessionCleanupContext[],
  legacySessionStoragePresent: boolean
): Promise<string[]> => {
  const fallbackNames = getFallbackAppOwnedIndexedDbNames(sessions, legacySessionStoragePresent);
  if (typeof indexedDB === 'undefined') return [];
  if (typeof indexedDB.databases !== 'function') return fallbackNames;

  try {
    const dbs = await indexedDB.databases();

    return dbs
      .map((idbInfo) => idbInfo.name)
      .filter((name): name is string => Boolean(name))
      .filter((name) => isAppOwnedIndexedDbName(name, sessions, legacySessionStoragePresent));
  } catch {
    return fallbackNames;
  }
};

type AppScopedBrowserCleanupContext = {
  appScopeUrl: string;
  appServiceWorkerScriptUrls: Set<string>;
  normalizeUrl: (url: string) => string;
};

const getAppScopedBrowserCleanupContext = (
  appBasePath: string,
  origin: string = window.location.origin
): AppScopedBrowserCleanupContext => {
  const normalizeUrl = (url: string): string => {
    const parsed = new URL(url, origin);
    parsed.hash = '';
    parsed.search = '';
    return parsed.href;
  };

  return {
    appScopeUrl: new URL(ensureBasePathTrailingSlash(appBasePath), origin).href,
    appServiceWorkerScriptUrls: new Set([
      normalizeUrl(appUrl('sw.js', appBasePath)),
      normalizeUrl(appUrl('dev-sw.js', appBasePath)),
    ]),
    normalizeUrl,
  };
};

export const clearAppScopedServiceWorkers = async (appBasePath: string): Promise<void> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const { appScopeUrl, appServiceWorkerScriptUrls, normalizeUrl } =
    getAppScopedBrowserCleanupContext(appBasePath);
  const registrations = await navigator.serviceWorker.getRegistrations();

  await Promise.all(
    registrations
      .filter((registration) => {
        const workerScriptUrls = [
          registration.active,
          registration.installing,
          registration.waiting,
        ]
          .filter((worker): worker is ServiceWorker => Boolean(worker))
          .map((worker) => normalizeUrl(worker.scriptURL));

        if (
          workerScriptUrls.some((workerScriptUrl) =>
            appServiceWorkerScriptUrls.has(workerScriptUrl)
          )
        ) {
          return true;
        }

        return normalizeUrl(registration.scope) === normalizeUrl(appScopeUrl);
      })
      .map((registration) => registration.unregister())
  );
};

export const clearAppScopedCacheStorage = async (appBasePath: string): Promise<void> => {
  if (typeof window === 'undefined' || !('caches' in window)) return;

  const { appScopeUrl, normalizeUrl } = getAppScopedBrowserCleanupContext(appBasePath);
  const cacheNames = await window.caches.keys();

  await Promise.all(
    cacheNames.map(async (cacheName) => {
      const cache = await window.caches.open(cacheName);
      const requests = await cache.keys();

      await Promise.all(
        requests
          .filter((request) => normalizeUrl(request.url).startsWith(appScopeUrl))
          .map((request) => cache.delete(request))
      );

      const remainingRequests = await cache.keys();
      if (remainingRequests.length === 0 && requests.length > 0) {
        await window.caches.delete(cacheName);
      }
    })
  );
};
