import { ClientConfig } from '../hooks/useClientConfig';
import { getActiveSession, hasStoredSessions } from '../state/sessions';
import { getStoredNavToActivePath } from '../state/navToActivePath';
import { isAddAccountSearch } from './auth/addAccount';
import { resolveSessionRestorePath } from './client/sessionRouteRestore';
import { AUTHENTICATION_RECOVERY_NAVIGATION_PARAM } from '../../serviceWorkerNavigation';
import {
  getAppPathFromHref,
  getHomePath,
  getLoginPath,
  getOriginBaseUrl,
  joinPathComponent,
} from './pathUtils';

export type RouteRedirectDecision = {
  redirectTo: string;
  afterLoginPath?: string;
};

const getAfterLoginPath = (baseUrl: string, href: string): string => {
  const url = new URL(href);
  if (!url.searchParams.has(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM)) {
    return getAppPathFromHref(baseUrl, href);
  }
  url.searchParams.delete(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM);
  return getAppPathFromHref(baseUrl, url.href);
};

export const resolveRootRouteRedirect = (
  href: string,
  activeSession = getActiveSession()
): RouteRedirectDecision => {
  if (activeSession) {
    const savedHomePath = getStoredNavToActivePath(activeSession.userId).get('home');
    const sessionRestorePath = activeSession.lastKnownPath;
    return {
      redirectTo: resolveSessionRestorePath(
        sessionRestorePath ?? (savedHomePath ? joinPathComponent(savedHomePath) : undefined)
      ),
    };
  }

  const afterLoginPath = getAfterLoginPath(getOriginBaseUrl(), href);
  return {
    redirectTo: getLoginPath(),
    afterLoginPath: afterLoginPath || undefined,
  };
};

export const resolveAuthRouteRedirect = (
  requestUrl: string,
  activeSession = getActiveSession()
): string | null => {
  if (activeSession && !isAddAccountSearch(new URL(requestUrl).search)) {
    return getHomePath();
  }

  return null;
};

export const resolveProtectedRouteRedirect = (
  href: string,
  hashRouterConfig: ClientConfig['hashRouter'],
  storedSessions = hasStoredSessions(),
  activeSession = getActiveSession()
): RouteRedirectDecision | null => {
  if (storedSessions && activeSession) return null;

  const afterLoginPath = getAfterLoginPath(getOriginBaseUrl(hashRouterConfig), href);
  return {
    redirectTo: getLoginPath(),
    afterLoginPath: afterLoginPath || undefined,
  };
};
