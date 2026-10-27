import { afterEach, describe, expect, it } from 'vitest';
import { appUrl, getAppBasePath, normalizeBasePath } from './basePath';

describe('normalizeBasePath', () => {
  it('normalizes empty and root values to "/"', () => {
    expect(normalizeBasePath()).toBe('/');
    expect(normalizeBasePath('')).toBe('/');
    expect(normalizeBasePath('/')).toBe('/');
    expect(normalizeBasePath('.')).toBe('/');
    expect(normalizeBasePath('./')).toBe('/');
  });

  it('normalizes subpaths with or without slashes', () => {
    expect(normalizeBasePath('mindroom')).toBe('/mindroom');
    expect(normalizeBasePath('/mindroom')).toBe('/mindroom');
    expect(normalizeBasePath('/mindroom/')).toBe('/mindroom');
    expect(normalizeBasePath('///mindroom///')).toBe('/mindroom');
  });
});

describe('appUrl', () => {
  it('builds URLs at root base path', () => {
    expect(appUrl('config.json', '/')).toBe('/config.json');
    expect(appUrl('/config.json', '/')).toBe('/config.json');
  });

  it('builds URLs under a subpath base', () => {
    expect(appUrl('config.json', '/mindroom')).toBe('/mindroom/config.json');
    expect(appUrl('/config.json', '/mindroom/')).toBe('/mindroom/config.json');
  });
});

describe('getAppBasePath', () => {
  const originalValue = (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__;

  afterEach(() => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = originalValue;
  });

  it('prefers runtime base path when provided', () => {
    (globalThis as { __APP_BASE_PATH__?: string }).__APP_BASE_PATH__ = '/mindroom';
    expect(getAppBasePath()).toBe('/mindroom');
  });
});
