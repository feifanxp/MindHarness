import type { ClientConfig } from '../../hooks/useClientConfig';

export const MINDROOM_HOMESERVER = 'mindroom.chat';
export const MINDROOM_TENANT_HOMESERVER_SUFFIX = '.matrix.mindroom.chat';

// Only the hostname identifies a server; a base URL's path, query or userinfo must not count.
export const normalizeHomeserverName = (server: string): string => {
  try {
    return new URL(/^https?:\/\//i.test(server) ? server : `https://${server}`).hostname;
  } catch {
    return '';
  }
};

export const isPrimaryMindroomHomeserver = (server: string): boolean =>
  normalizeHomeserverName(server) === MINDROOM_HOMESERVER;

export const isMindroomTenantHomeserver = (server: string): boolean =>
  normalizeHomeserverName(server).endsWith(MINDROOM_TENANT_HOMESERVER_SUFFIX);

export const isMindroomHomeserver = (server: string): boolean => {
  const normalizedServer = normalizeHomeserverName(server);
  return normalizedServer === MINDROOM_HOMESERVER || isMindroomTenantHomeserver(normalizedServer);
};

export const shouldDisablePasswordLogin = (
  server: string,
  authConfig: ClientConfig['auth'] | undefined
): boolean => authConfig?.disablePasswordLogin === true || isPrimaryMindroomHomeserver(server);

export const shouldUseSsoOnlyRegistration = (server: string): boolean =>
  isPrimaryMindroomHomeserver(server);

export const shouldRequireAppleProvider = (
  server: string,
  authConfig: ClientConfig['auth'] | undefined
): boolean => authConfig?.requireAppleProvider === true && isPrimaryMindroomHomeserver(server);
