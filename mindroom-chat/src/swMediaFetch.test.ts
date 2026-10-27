import { describe, expect, it } from 'vitest';
import { buildAuthenticatedMediaRequestInit } from './swMediaFetch';

describe('buildAuthenticatedMediaRequestInit', () => {
  it('upgrades no-cors media requests to cors while preserving same-origin credentials', () => {
    const request = new Request('https://example.com/mindroom/_matrix/client/v1/media/download/s/id', {
      method: 'GET',
      mode: 'no-cors',
      credentials: 'same-origin',
      cache: 'default',
    });

    const init = buildAuthenticatedMediaRequestInit(request, 'secret-token');

    expect(init.mode).toBe('cors');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token');
  });

  it('normalizes only-if-cached requests and preserves headers for regular fetches', () => {
    const request = new Request('https://example.com/mindroom/_matrix/client/v1/media/thumbnail/s/id', {
      method: 'GET',
      mode: 'same-origin',
      cache: 'only-if-cached',
    });

    const init = buildAuthenticatedMediaRequestInit(request, 'secret-token');

    expect(init.cache).toBe('default');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token');
  });
});
