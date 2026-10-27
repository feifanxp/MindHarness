import { TFunction } from 'i18next';
import { IIdentityProvider, SSOAction } from 'matrix-js-sdk';

const APPLE_PROVIDER_KEY = 'apple';
const GOOGLE_PROVIDER_KEY = 'google';
const GITHUB_PROVIDER_KEY = 'github';

const normalizeProviderValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
};

const providerContains = (provider: IIdentityProvider, key: string): boolean => {
  const brand = normalizeProviderValue(provider.brand);
  if (brand === key) return true;

  const providerId = normalizeProviderValue(provider.id);
  if (providerId?.includes(key)) return true;

  const providerName = normalizeProviderValue(provider.name);
  if (providerName?.includes(key)) return true;

  return false;
};

export type KnownIdentityProvider = 'apple' | 'google' | 'github' | undefined;

export const getKnownIdentityProvider = (provider: IIdentityProvider): KnownIdentityProvider => {
  if (providerContains(provider, APPLE_PROVIDER_KEY)) return APPLE_PROVIDER_KEY;
  if (providerContains(provider, GOOGLE_PROVIDER_KEY)) return GOOGLE_PROVIDER_KEY;
  if (providerContains(provider, GITHUB_PROVIDER_KEY)) return GITHUB_PROVIDER_KEY;

  return undefined;
};

export const isAppleIdentityProvider = (provider: IIdentityProvider): boolean =>
  getKnownIdentityProvider(provider) === APPLE_PROVIDER_KEY;

export const isGoogleIdentityProvider = (provider: IIdentityProvider): boolean =>
  getKnownIdentityProvider(provider) === GOOGLE_PROVIDER_KEY;

export const isGitHubIdentityProvider = (provider: IIdentityProvider): boolean =>
  getKnownIdentityProvider(provider) === GITHUB_PROVIDER_KEY;

export const hasAppleIdentityProvider = (providers?: IIdentityProvider[]): boolean =>
  Boolean(providers?.some(isAppleIdentityProvider));

export const sortIdentityProviders = (providers?: IIdentityProvider[]): IIdentityProvider[] => {
  if (!providers) return [];

  const appleProviders: IIdentityProvider[] = [];
  const googleProviders: IIdentityProvider[] = [];
  const githubProviders: IIdentityProvider[] = [];
  const otherProviders: IIdentityProvider[] = [];

  providers.forEach((provider) => {
    const knownProvider = getKnownIdentityProvider(provider);

    if (knownProvider === APPLE_PROVIDER_KEY) {
      appleProviders.push(provider);
      return;
    }

    if (knownProvider === GOOGLE_PROVIDER_KEY) {
      googleProviders.push(provider);
      return;
    }

    if (knownProvider === GITHUB_PROVIDER_KEY) {
      githubProviders.push(provider);
      return;
    }

    otherProviders.push(provider);
  });

  return [...appleProviders, ...googleProviders, ...githubProviders, ...otherProviders];
};

export const getSSOProviderButtonTitle = (
  provider: IIdentityProvider,
  t: TFunction,
  action?: SSOAction
): string => {
  if (isAppleIdentityProvider(provider)) {
    return action === SSOAction.REGISTER
      ? t('sharedUi.ssoProviders.signUpApple')
      : t('sharedUi.ssoProviders.signInApple');
  }

  if (isGoogleIdentityProvider(provider)) {
    return t('sharedUi.ssoProviders.continueGoogle');
  }

  if (isGitHubIdentityProvider(provider)) {
    return t('sharedUi.ssoProviders.continueGithub');
  }

  return t('sharedUi.ssoProviders.continueProvider', { provider: provider.name });
};
