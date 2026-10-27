import { LocalMindroomConnection } from './api';

export const DEFAULT_MINDROOM_DOCS_URL = 'https://docs.mindroom.chat/';
const WELCOME_SETUP_PROMPT_DELAY_MS = 24 * 60 * 60 * 1000;

export const getMindroomDocsUrl = (url?: string): string =>
  url?.trim() || DEFAULT_MINDROOM_DOCS_URL;

type ResolveProvisioningRequest = {
  sessionHomeserverUrl?: string;
  provisioningOverrideUrl?: string;
  accessToken?: string;
};

export type LocalMindroomProvisioningRequest = {
  provisioningBaseUrl?: string;
  canAuthenticate: boolean;
};

const getOrigin = (url?: string): string | undefined => {
  const value = url?.trim();
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

export const resolveMindroomProvisioningRequest = ({
  sessionHomeserverUrl,
  provisioningOverrideUrl,
  accessToken,
}: ResolveProvisioningRequest): LocalMindroomProvisioningRequest => {
  const sessionOrigin = getOrigin(sessionHomeserverUrl);
  const overrideOrigin = getOrigin(provisioningOverrideUrl);
  const provisioningBaseUrl = overrideOrigin ?? sessionOrigin;

  if (!provisioningBaseUrl) return { canAuthenticate: false };

  const isCrossOriginOverride =
    overrideOrigin !== undefined && sessionOrigin !== undefined && overrideOrigin !== sessionOrigin;

  // Cross-origin accounts cannot authenticate to this provisioning service.
  if (isCrossOriginOverride) return { provisioningBaseUrl, canAuthenticate: false };

  return {
    provisioningBaseUrl,
    canAuthenticate: Boolean(accessToken),
  };
};

export const getWelcomeSetupFirstSeenStorageKey = (userId: string): string =>
  `mindroom_welcome_setup_first_seen_at::${userId}`;

export type WelcomeSetupPromptState = {
  activeConnectionCount: number;
  firstSeenAtMs: number | undefined;
  nowMs?: number;
};

export const shouldShowWelcomeSetupPrompt = ({
  activeConnectionCount,
  firstSeenAtMs,
  nowMs = Date.now(),
}: WelcomeSetupPromptState): boolean =>
  activeConnectionCount === 0 &&
  firstSeenAtMs !== undefined &&
  nowMs - firstSeenAtMs >= WELCOME_SETUP_PROMPT_DELAY_MS;

export const getConnectionId = (connection: LocalMindroomConnection): string | undefined => {
  if (typeof connection.id === 'string' && connection.id.length > 0) return connection.id;

  const rawId = connection.connection_id;
  if (typeof rawId === 'string' && rawId.length > 0) return rawId;

  const numericId = connection.connection_id;
  if (typeof numericId === 'number') return numericId.toString();

  return undefined;
};

export const getConnectionName = (connection: LocalMindroomConnection, index: number): string => {
  if (typeof connection.client_name === 'string' && connection.client_name.trim()) {
    return connection.client_name;
  }

  const altName = connection.clientName;
  if (typeof altName === 'string' && altName.trim()) return altName;

  return `Local MindRoom ${index + 1}`;
};

export const getConnectionCreatedAt = (connection: LocalMindroomConnection): string | undefined => {
  if (typeof connection.created_at === 'string' && connection.created_at)
    return connection.created_at;

  const alt = connection.createdAt;
  if (typeof alt === 'string' && alt) return alt;

  return undefined;
};

export const getConnectionLastSeenAt = (
  connection: LocalMindroomConnection
): string | undefined => {
  if (typeof connection.last_seen_at === 'string' && connection.last_seen_at) {
    return connection.last_seen_at;
  }

  const alt = connection.lastSeenAt;
  if (typeof alt === 'string' && alt) return alt;

  return undefined;
};

export const getConnectionRevokedAt = (connection: LocalMindroomConnection): string | undefined => {
  const direct = connection.revoked_at;
  if (typeof direct === 'string' && direct) return direct;

  const alt = connection.revokedAt;
  if (typeof alt === 'string' && alt) return alt;

  return undefined;
};

export const isConnectionRevoked = (connection: LocalMindroomConnection): boolean =>
  getConnectionRevokedAt(connection) !== undefined;

export const formatLocalTimestamp = (
  timestamp?: string,
  locale?: string,
  unknownLabel = 'Unknown'
): string => {
  if (!timestamp) return unknownLabel;
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return unknownLabel;
  return date.toLocaleString(locale);
};
