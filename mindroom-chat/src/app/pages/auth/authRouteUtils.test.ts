import { describe, expect, it } from 'vitest';
import { buildAuthRoutePath } from './authRouteUtils';

describe('buildAuthRoutePath', () => {
  it('preserves auth search params while normalizing the server path', () => {
    expect(
      buildAuthRoutePath({
        pathname: '/login/',
        search: '?addAccount=1',
        registrationAllowed: true,
        server: 'https://mindroom.chat',
      })
    ).toBe('/login/https%3A%2F%2Fmindroom.chat?addAccount=1');
  });

  it('preserves search and hash on other auth routes', () => {
    expect(
      buildAuthRoutePath({
        pathname: '/register/',
        search: '?email=test%40example.com&addAccount=1',
        hash: '#oidc',
        registrationAllowed: true,
        server: 'https://mindroom.chat',
      })
    ).toBe(
      '/register/https%3A%2F%2Fmindroom.chat?email=test%40example.com&addAccount=1#oidc'
    );
  });
});
