import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { IIdentityProvider, SSOAction } from 'matrix-js-sdk';
import {
  getSSOProviderButtonTitle,
  hasAppleIdentityProvider,
  isAppleIdentityProvider,
  isGitHubIdentityProvider,
  isGoogleIdentityProvider,
  sortIdentityProviders,
} from './ssoProviders';

const provider = (id: string, name: string, brand?: string): IIdentityProvider => ({
  id,
  name,
  brand,
});

describe('isAppleIdentityProvider', () => {
  it('detects Apple provider by brand', () => {
    expect(isAppleIdentityProvider(provider('oidc-1', 'Corporate SSO', 'apple'))).toBe(true);
  });

  it('detects Apple provider by id and name fallback', () => {
    expect(isAppleIdentityProvider(provider('apple-oidc', 'Corporate SSO'))).toBe(true);
    expect(isAppleIdentityProvider(provider('oidc-1', 'Sign in with Apple'))).toBe(true);
  });

  it('returns false for non-Apple provider', () => {
    expect(isAppleIdentityProvider(provider('google-oidc', 'Google', 'google'))).toBe(false);
  });
});

describe('provider brand detection', () => {
  it('detects Google and GitHub providers', () => {
    expect(isGoogleIdentityProvider(provider('google-oidc', 'Google', 'google'))).toBe(true);
    expect(isGitHubIdentityProvider(provider('github-oidc', 'GitHub', 'github'))).toBe(true);
  });

  it('does not classify unrelated provider as Google or GitHub', () => {
    const genericProvider = provider('corp-sso', 'Corporate SSO');
    expect(isGoogleIdentityProvider(genericProvider)).toBe(false);
    expect(isGitHubIdentityProvider(genericProvider)).toBe(false);
  });
});

describe('hasAppleIdentityProvider', () => {
  it('returns true when any provider is Apple', () => {
    expect(
      hasAppleIdentityProvider([provider('google', 'Google', 'google'), provider('apple', 'Apple')])
    ).toBe(true);
  });

  it('returns false for empty provider list', () => {
    expect(hasAppleIdentityProvider([])).toBe(false);
    expect(hasAppleIdentityProvider(undefined)).toBe(false);
  });
});

describe('sortIdentityProviders', () => {
  it('returns Apple, then Google, then GitHub providers while preserving relative order', () => {
    const sorted = sortIdentityProviders([
      provider('github-1', 'GitHub 1', 'github'),
      provider('other', 'Corporate SSO'),
      provider('google', 'Google', 'google'),
      provider('apple-1', 'Apple Work'),
      provider('github-2', 'GitHub 2', 'github'),
      provider('apple-2', 'Apple Personal'),
      provider('google-2', 'Google Workspace', 'google'),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      'apple-1',
      'apple-2',
      'google',
      'google-2',
      'github-1',
      'github-2',
      'other',
    ]);
  });
});

describe('getSSOProviderButtonTitle', () => {
  it('uses Apple-specific labels', () => {
    const appleProvider = provider('apple', 'Apple', 'apple');

    expect(getSSOProviderButtonTitle(appleProvider, i18next.t, SSOAction.LOGIN)).toBe(
      'Sign in with Apple'
    );
    expect(getSSOProviderButtonTitle(appleProvider, i18next.t, SSOAction.REGISTER)).toBe(
      'Sign up with Apple'
    );
  });

  it('capitalizes known provider button labels', () => {
    const googleProvider = provider('google', 'google', 'google');
    const githubProvider = provider('github', 'github', 'github');

    expect(getSSOProviderButtonTitle(googleProvider, i18next.t, SSOAction.LOGIN)).toBe(
      'Continue with Google'
    );
    expect(getSSOProviderButtonTitle(githubProvider, i18next.t, SSOAction.LOGIN)).toBe(
      'Continue with GitHub'
    );
  });
});
