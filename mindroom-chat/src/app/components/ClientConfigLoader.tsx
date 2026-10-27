import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { ClientConfig } from '../hooks/useClientConfig';
import { shouldUseCachedClientConfig } from '../mindroom/native/nativeClientConfig';
import { appUrl, getAppBasePath } from '../utils/basePath';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../utils/safeLocalStorage';
import { AUTHENTICATION_RECOVERY_NAVIGATION_PARAM } from '../../serviceWorkerNavigation';
import {
  authenticationConfigurationLoaded,
  recoverAuthentication,
} from '../../authenticationRecovery';

const CLIENT_CONFIG_STORAGE_PREFIX = 'io.cinny.client-config:';

export class ClientConfigAuthenticationError extends Error {
  constructor() {
    super('Interactive sign-in is required.');
    this.name = 'ClientConfigAuthenticationError';
  }
}

export const isClientConfigAuthenticationError = (
  error: unknown
): error is ClientConfigAuthenticationError => error instanceof ClientConfigAuthenticationError;

export const getClientConfigUrl = (basePath: string = getAppBasePath()): string =>
  appUrl('config.json', basePath);

const getClientConfigStorageKey = (basePath: string = getAppBasePath()): string =>
  `${CLIENT_CONFIG_STORAGE_PREFIX}${getClientConfigUrl(basePath)}`;

const asClientConfig = (value: unknown): ClientConfig => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Client configuration must be a JSON object.');
  }
  return value as ClientConfig;
};

export const readCachedClientConfig = (
  basePath: string = getAppBasePath()
): ClientConfig | undefined => {
  const value = getStorageItemSafe(getSafeLocalStorage(), getClientConfigStorageKey(basePath));
  if (value === null) return undefined;

  try {
    return asClientConfig(JSON.parse(value));
  } catch {
    return undefined;
  }
};

const cacheClientConfig = (config: ClientConfig, basePath: string): void => {
  setStorageItemSafe(
    getSafeLocalStorage(),
    getClientConfigStorageKey(basePath),
    JSON.stringify(config)
  );
};

export const fetchClientConfig = async (
  basePath: string = getAppBasePath()
): Promise<ClientConfig> => {
  const url = getClientConfigUrl(basePath);
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'manual',
  });

  if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) {
    throw new ClientConfigAuthenticationError();
  }
  if (!response.ok) {
    throw new Error(`Failed to load client configuration (HTTP ${response.status}).`);
  }

  const config = asClientConfig(await response.json());
  cacheClientConfig(config, basePath);
  authenticationConfigurationLoaded();
  return config;
};

const clearAuthenticationRecoveryNavigation = (): void => {
  if (typeof window === 'undefined') return;

  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM)) return;

    url.searchParams.delete(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM);
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch {
    // URL cleanup must not block application startup.
  }
};

type ClientConfigLoaderProps = {
  fallback?: () => ReactNode;
  error?: (
    err: unknown,
    retry: () => void,
    ignore: (() => void) | undefined,
    authenticate: () => void
  ) => ReactNode;
  children: (config: ClientConfig) => ReactNode;
};
export function ClientConfigLoader({ fallback, error, children }: ClientConfigLoaderProps) {
  const [state, load] = useAsyncCallback(fetchClientConfig);
  const [ignoreError, setIgnoreError] = useState(false);
  const [recoveryError, setRecoveryError] = useState<Error>();
  const [cachedConfig] = useState(() =>
    shouldUseCachedClientConfig() ? readCachedClientConfig() : undefined
  );
  const [waitForFreshConfig, setWaitForFreshConfig] = useState(false);

  const ignoreCallback = useCallback(() => setIgnoreError(true), []);
  const retryCallback = useCallback(() => {
    setIgnoreError(false);
    setRecoveryError(undefined);
    // An explicit retry follows a known startup/authentication failure. Keep
    // that recovery gated until the request succeeds or the user goes offline.
    setWaitForFreshConfig(true);
    void load().catch(() => undefined);
  }, [load]);
  const authenticateCallback = useCallback(() => {
    void recoverAuthentication()
      .then((result) => {
        if (result === 'healthy') {
          retryCallback();
        } else if (result !== 'navigating') {
          setRecoveryError(
            new Error(
              'Sign-in recovery could not complete. Retry the connection or continue offline.'
            )
          );
        }
      })
      .catch(() => {
        setRecoveryError(
          new Error(
            'Sign-in recovery could not complete. Retry the connection or continue offline.'
          )
        );
      });
  }, [retryCallback]);

  useEffect(() => {
    clearAuthenticationRecoveryNavigation();
    void load().catch(() => undefined);
  }, [load]);

  const authenticationRequired =
    state.status === AsyncStatus.Error && isClientConfigAuthenticationError(state.error);
  const useCachedConfig =
    cachedConfig !== undefined && (ignoreError || (!waitForFreshConfig && !authenticationRequired));
  const resolvedConfig = useCachedConfig
    ? cachedConfig
    : state.status === AsyncStatus.Success
    ? state.data
    : undefined;
  // App's render callback constructs its router. Keep the same subtree while
  // background refresh settles; fetchClientConfig saves fresh data for the next
  // launch. Do not construct a router while authentication recovery is gated.
  const readyContent = useMemo(
    () => (resolvedConfig === undefined ? undefined : children(resolvedConfig)),
    [children, resolvedConfig]
  );

  if (resolvedConfig !== undefined) return readyContent;

  if (state.status === AsyncStatus.Error) {
    return error?.(
      recoveryError ?? state.error,
      retryCallback,
      cachedConfig === undefined ? undefined : ignoreCallback,
      authenticateCallback
    );
  }

  return fallback?.();
}
