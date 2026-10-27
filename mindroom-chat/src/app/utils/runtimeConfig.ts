import { normalizeNavigationFallbackExcludePaths } from '../../serviceWorkerNavigation';

type RuntimeConfig = {
  __ENABLE_SERVICE_WORKER__?: boolean | string;
  __SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__?: unknown;
};

export const isServiceWorkerEnabled = (): boolean => {
  if (typeof globalThis === 'undefined') return false;
  const value = (globalThis as RuntimeConfig).__ENABLE_SERVICE_WORKER__;
  if (value === true) return true;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
};

export const getServiceWorkerNavigationFallbackExcludePaths = (): string[] => {
  if (typeof globalThis === 'undefined') return [];
  const value = (globalThis as RuntimeConfig).__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__;
  return normalizeNavigationFallbackExcludePaths(value);
};
