import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from './app/utils/basePath';
import { createServiceWorkerUrl } from './serviceWorkerRegistration';

declare const __MINDROOM_BUILD_VERSION__: string;
declare const __MINDROOM_RELEASE_VERSION__: string;

export const APP_BUILD_VERSION =
  typeof __MINDROOM_BUILD_VERSION__ === 'string' ? __MINDROOM_BUILD_VERSION__ : 'development-build';
export const APP_RELEASE_VERSION =
  typeof __MINDROOM_RELEASE_VERSION__ === 'string'
    ? __MINDROOM_RELEASE_VERSION__
    : 'development-build';
export const APP_VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const APP_VERSION_FETCH_TIMEOUT_MS = 5 * 1000;

type AppVersionManifest = {
  version?: unknown;
};

export const fetchPublishedAppVersion = async (): Promise<string | undefined> => {
  const abortController = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => abortController.abort(),
    APP_VERSION_FETCH_TIMEOUT_MS
  );
  try {
    const url = new URL(appUrl('version.json'), window.location.origin);
    url.searchParams.set('cache-bust', `${Date.now()}`);
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: abortController.signal,
    });
    if (!response.ok) return undefined;

    const manifest = (await response.json()) as AppVersionManifest;
    const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
    return /^[A-Za-z0-9._+-]{1,128}$/.test(version) ? version : undefined;
  } catch {
    // Version discovery must never interfere with offline or degraded use.
    return undefined;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

type AppVersionMonitorOptions = {
  pollIntervalMs?: number;
};

export const startAppVersionMonitor = ({
  pollIntervalMs = APP_VERSION_POLL_INTERVAL_MS,
}: AppVersionMonitorOptions = {}): (() => void) => {
  let stopped = false;
  let checking = false;
  let stagedVersion: string | undefined;

  const check = async () => {
    if (stopped || checking || !navigator.onLine) return;
    checking = true;
    try {
      const publishedVersion = await fetchPublishedAppVersion();
      if (
        !publishedVersion ||
        publishedVersion === APP_BUILD_VERSION ||
        publishedVersion === stagedVersion ||
        stopped
      )
        return;

      const swUrl = createServiceWorkerUrl(publishedVersion);
      await navigator.serviceWorker.register(swUrl, {
        scope: ensureBasePathTrailingSlash(getAppBasePath()),
        type: 'classic',
        updateViaCache: 'none',
      });
      stagedVersion = publishedVersion;
      // Activation may replace the controller, but it must not navigate this
      // document. The new shell takes over on the user's next reload or visit.
    } catch {
      // A failed update check is equivalent to no update. Keep the current,
      // fully loaded application running, especially when connectivity drops.
    } finally {
      checking = false;
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') check().catch(() => undefined);
  };
  const handleOnline = () => {
    check().catch(() => undefined);
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);
  const intervalId = window.setInterval(() => check().catch(() => undefined), pollIntervalMs);
  check().catch(() => undefined);

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('online', handleOnline);
  };
};
