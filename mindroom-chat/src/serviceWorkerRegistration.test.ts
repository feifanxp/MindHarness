import { afterEach, describe, expect, it } from 'vitest';
import { createServiceWorkerUrl } from './serviceWorkerRegistration';

describe('service worker registration URL', () => {
  const runtime = globalThis as {
    __APP_BASE_PATH__?: string;
    __SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__?: unknown;
  };
  const originalBasePath = runtime.__APP_BASE_PATH__;
  const originalExcludePaths = runtime.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__;

  afterEach(() => {
    runtime.__APP_BASE_PATH__ = originalBasePath;
    runtime.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__ = originalExcludePaths;
  });

  it('carries deployment exclusions through initial and update registrations', () => {
    runtime.__APP_BASE_PATH__ = '/';
    runtime.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__ = [
      '/other-app',
      '/control-panel/',
    ];

    const url = createServiceWorkerUrl('abc123', 'https://chat.example.com');

    expect(url.pathname).toBe('/sw.js');
    expect(url.searchParams.get('version')).toBe('abc123');
    expect(url.searchParams.get('non-disruptive-update')).toBe('1');
    expect(url.searchParams.getAll('navigation-fallback-exclude')).toEqual([
      '/other-app',
      '/control-panel',
    ]);
  });
});
