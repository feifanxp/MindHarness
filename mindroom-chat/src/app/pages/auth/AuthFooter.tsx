import { Trans, useTranslation } from 'react-i18next';
import React from 'react';
import { Box, Text } from 'folds';
import * as css from './styles.css';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MINDROOM_AUTH_BRANDING } from '../../mindroom/auth/authUi';

export function AuthFooter() {
  const { t } = useTranslation();
  const { auth } = useClientConfig();

  const optionalLinks = [
    auth?.supportUrl
      ? { label: t('sharedUi.authFooter.support'), href: auth.supportUrl }
      : undefined,
    auth?.privacyPolicyUrl
      ? { label: t('sharedUi.authFooter.privacy'), href: auth.privacyPolicyUrl }
      : undefined,
    auth?.termsUrl ? { label: t('sharedUi.authFooter.terms'), href: auth.termsUrl } : undefined,
  ].filter((item): item is { label: string; href: string } => Boolean(item));

  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      <Text size="T300">
        <Trans
          t={t}
          shouldUnescape
          tOptions={{ interpolation: { escapeValue: true } }}
          i18nKey="sharedUi.authFooter.poweredBy"
          values={{ appName: MINDROOM_AUTH_BRANDING.appName }}
          components={{
            app: (
              <a href={MINDROOM_AUTH_BRANDING.chatSourceUrl} target="_blank" rel="noreferrer">
                {MINDROOM_AUTH_BRANDING.appName}
              </a>
            ),
            matrix: (
              <a href="https://matrix.org" target="_blank" rel="noreferrer">
                Matrix
              </a>
            ),
            cinny: (
              <a href="https://github.com/ajbura/cinny" target="_blank" rel="noreferrer">
                Cinny
              </a>
            ),
          }}
        />
      </Text>
      {optionalLinks.map((link) => (
        <Text key={link.label} size="T300">
          <a href={link.href} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        </Text>
      ))}
    </Box>
  );
}
