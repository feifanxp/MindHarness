import { trimLeadingSlash } from './common';
import { normalizeBasePath } from './basePathShared';

type RuntimeConfig = {
  __APP_BASE_PATH__?: string;
};

const getRuntimeBasePath = (): string | undefined => {
  if (typeof globalThis === 'undefined') return undefined;
  const value = (globalThis as RuntimeConfig).__APP_BASE_PATH__;
  if (typeof value !== 'string') return undefined;
  return normalizeBasePath(value);
};

export const getAppBasePath = (): string =>
  getRuntimeBasePath() ?? normalizeBasePath(import.meta.env.BASE_URL ?? '/');

export { normalizeBasePath };

export const ensureBasePathTrailingSlash = (basePath: string): string =>
  basePath === '/' ? '/' : `${basePath}/`;

export const appUrl = (path: string, basePath: string = getAppBasePath()): string => {
  const normalizedBase = normalizeBasePath(basePath);
  const normalizedPath = trimLeadingSlash(path);

  if (normalizedPath === '') return normalizedBase;
  if (normalizedBase === '/') return `/${normalizedPath}`;
  return `${normalizedBase}/${normalizedPath}`;
};
