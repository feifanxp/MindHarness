import type { TFunction } from 'i18next';
import type { ClientConfig } from '../../hooks/useClientConfig';
import {
  MINDROOM_APP_NAME,
  MINDROOM_CHAT_SOURCE_URL,
  MINDROOM_DEFAULT_POWERED_BY,
  MINDROOM_DOCS_URL,
  MINDROOM_LOGO_ALT,
  MINDROOM_LOGO_SRC,
} from './branding';

export const MINDROOM_CLIENT_BRANDING = {
  appName: MINDROOM_APP_NAME,
  docsUrl: MINDROOM_DOCS_URL,
  logoAlt: MINDROOM_LOGO_ALT,
  logoSrc: MINDROOM_LOGO_SRC,
  poweredBy: MINDROOM_DEFAULT_POWERED_BY,
  sourceUrl: MINDROOM_CHAT_SOURCE_URL,
  subtitle: 'AI agents that live in your chat rooms.',
} as const;

const configuredCopy = (
  value: string | undefined,
  fallback: string,
  localized: string | undefined
) => (value !== undefined && value !== fallback ? value : localized ?? fallback);

export const getMindroomWelcomePageContent = (
  welcome: ClientConfig['welcome'] | undefined,
  t?: TFunction
) => ({
  docsLabel: configuredCopy(welcome?.docsLabel, 'Docs', t?.('sharedUi.welcomePage.docs')),
  docsUrl: welcome?.docsUrl ?? MINDROOM_CLIENT_BRANDING.docsUrl,
  poweredBy: welcome?.poweredBy ?? MINDROOM_CLIENT_BRANDING.poweredBy,
  sourceLabel: configuredCopy(
    welcome?.sourceLabel,
    'Source Code',
    t?.('sharedUi.welcomePage.sourceCode')
  ),
  sourceUrl: welcome?.sourceUrl ?? MINDROOM_CLIENT_BRANDING.sourceUrl,
  subtitle: configuredCopy(
    welcome?.subtitle,
    MINDROOM_CLIENT_BRANDING.subtitle,
    t?.('sharedUi.welcomePage.subtitle')
  ),
  title: configuredCopy(
    welcome?.title,
    `Welcome to ${MINDROOM_CLIENT_BRANDING.appName}`,
    t?.('sharedUi.welcomePage.title', { appName: MINDROOM_CLIENT_BRANDING.appName })
  ),
});
