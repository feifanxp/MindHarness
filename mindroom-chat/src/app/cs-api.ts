import to from 'await-to-js';
import { trimTrailingSlash } from './utils/common';

export enum AutoDiscoveryAction {
  PROMPT = 'PROMPT',
  IGNORE = 'IGNORE',
  FAIL_PROMPT = 'FAIL_PROMPT',
  FAIL_ERROR = 'FAIL_ERROR',
  FAIL_INSECURE = 'FAIL_INSECURE',
}

export type AutoDiscoveryError = {
  host: string;
  action: AutoDiscoveryAction;
};

export type AutoDiscoveryInfo = Record<string, unknown> & {
  'm.homeserver': {
    base_url: string;
  };
  'm.identity_server'?: {
    base_url: string;
  };
  'org.matrix.msc2965.authentication'?: {
    account?: string;
    issuer?: string;
  };
  'org.matrix.msc4143.rtc_foci'?: [
    {
      livekit_service_url: string;
      type: 'livekit';
    }
  ];
};

const IPV4_PARTS = 4;
const IPV4_OCTET_MAX = 255;

const isLocalIpv4 = (host: string): boolean => {
  const parts = host.split('.');
  if (parts.length !== IPV4_PARTS) return false;

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > IPV4_OCTET_MAX)) {
    return false;
  }

  const [first, second] = octets;
  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 169 && second === 254) return true;

  return false;
};

const isLocalIpv6 = (host: string): boolean => {
  const normalized = host.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  return false;
};

const isLocalHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.local')) return true;
  if (isLocalIpv4(normalized)) return true;
  if (isLocalIpv6(normalized)) return true;
  return false;
};

export const isAllowedHomeserverBaseUrl = (baseUrl: string): boolean => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return false;
  }

  if (parsedUrl.protocol === 'https:') return true;
  if (parsedUrl.protocol !== 'http:') return false;

  return isLocalHost(parsedUrl.hostname);
};

export const autoDiscovery = async (
  request: typeof fetch,
  server: string
): Promise<[AutoDiscoveryError, undefined] | [undefined, AutoDiscoveryInfo]> => {
  const host = /^https?:\/\//.test(server) ? trimTrailingSlash(server) : `https://${server}`;
  if (!isAllowedHomeserverBaseUrl(host)) {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_INSECURE,
      },
      undefined,
    ];
  }
  const autoDiscoveryUrl = `${host}/.well-known/matrix/client`;

  const [err, response] = await to(request(autoDiscoveryUrl, { method: 'GET' }));

  if (err || response.status === 404) {
    // AutoDiscoveryAction.IGNORE
    // We will use default value for IGNORE action
    return [
      undefined,
      {
        'm.homeserver': {
          base_url: host,
        },
      },
    ];
  }
  if (response.status !== 200) {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_PROMPT,
      },
      undefined,
    ];
  }

  const [contentErr, content] = await to<AutoDiscoveryInfo>(response.json());

  if (contentErr || typeof content !== 'object') {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_PROMPT,
      },
      undefined,
    ];
  }

  const baseUrl = content['m.homeserver']?.base_url;
  if (typeof baseUrl !== 'string') {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_PROMPT,
      },
      undefined,
    ];
  }

  if (/^https?:\/\//.test(baseUrl) === false) {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_ERROR,
      },
      undefined,
    ];
  }

  if (!isAllowedHomeserverBaseUrl(baseUrl)) {
    return [
      {
        host,
        action: AutoDiscoveryAction.FAIL_INSECURE,
      },
      undefined,
    ];
  }

  content['m.homeserver'].base_url = trimTrailingSlash(baseUrl);
  if (content['m.identity_server']) {
    content['m.identity_server'].base_url = trimTrailingSlash(
      content['m.identity_server'].base_url
    );
  }

  return [undefined, content];
};

export type SpecVersions = {
  versions: string[];
  unstable_features?: Record<string, boolean>;
};

const SPEC_VERSIONS_REQUEST_TIMEOUT_MS = 12000;

const requestWithTimeout = async (
  request: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<Response> => {
  const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
  const abortController = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abortController?.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      request(url, abortController ? { signal: abortController.signal } : undefined),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

export const specVersions = async (
  request: typeof fetch,
  baseUrl: string,
  timeoutMs = SPEC_VERSIONS_REQUEST_TIMEOUT_MS
): Promise<SpecVersions> => {
  const res = await requestWithTimeout(
    request,
    `${trimTrailingSlash(baseUrl)}/_matrix/client/versions`,
    timeoutMs
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Failed to connect to homeserver (HTTP ${res.status})`);
  }

  const data = (await res.json()) as unknown;

  if (data && typeof data === 'object' && 'versions' in data && Array.isArray(data.versions)) {
    return data as SpecVersions;
  }
  throw new Error('Homeserver URL does not appear to be a valid Matrix homeserver');
};
