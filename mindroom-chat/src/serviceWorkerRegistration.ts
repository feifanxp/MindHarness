import { appUrl } from './app/utils/basePath';
import { getServiceWorkerNavigationFallbackExcludePaths } from './app/utils/runtimeConfig';
import {
  NAVIGATION_FALLBACK_EXCLUDE_PARAM,
  NON_DISRUPTIVE_UPDATE_PARAM,
} from './serviceWorkerNavigation';

export const createServiceWorkerUrl = (version: string, origin = window.location.origin): URL => {
  const url = new URL(appUrl('sw.js'), origin);
  url.searchParams.set('version', version);
  // Old clients omit this marker. The worker can then retire their
  // force-reload registration without activating under the old monitor.
  url.searchParams.set(NON_DISRUPTIVE_UPDATE_PARAM, '1');
  getServiceWorkerNavigationFallbackExcludePaths().forEach((path) => {
    url.searchParams.append(NAVIGATION_FALLBACK_EXCLUDE_PARAM, path);
  });
  return url;
};
