import { Trans, useTranslation } from 'react-i18next';
import React from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { useSetAtom } from 'jotai';
import { Page, PageHero, PageHeroSection } from '../../components/page';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  getMindroomWelcomePageContent,
  MINDROOM_CLIENT_BRANDING,
} from '../../mindroom/branding/clientBranding';
import { getLocalMindroomConnections } from '../../mindroom/local-mindroom/api';
import {
  getWelcomeSetupFirstSeenStorageKey,
  isConnectionRevoked,
  resolveMindroomProvisioningRequest,
  shouldShowWelcomeSetupPrompt,
} from '../../mindroom/local-mindroom/mindroom';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from '../../mindroom/local-mindroom/settingsPage';
import { KeyBackupNudge } from '../../mindroom/onboarding/KeyBackupNudge';
import { WelcomeCardStyle } from '../../mindroom/onboarding/welcomeCard';
import { settingsModalAtom } from '../../state/settingsModal';
import { getSafeLocalStorage } from '../../utils/safeLocalStorage';

const safeIcon = (icon?: (filled?: boolean) => JSX.Element) => icon ?? Icons.Info;

const WELCOME_SETUP_COMMANDS = {
  initialize:
    'uvx mindroom config init --provider <anthropic|codex|llama.cpp|ollama|openai|openrouter|vertexai_claude>',
  login: 'codex login',
  run: 'uvx mindroom run',
} as const;

const readFirstSeenAtMs = (storageKey: string): number | undefined => {
  const storage = getSafeLocalStorage();
  if (typeof storage?.getItem !== 'function') return undefined;

  let stored: string | null;
  try {
    stored = storage.getItem(storageKey);
  } catch {
    return undefined;
  }
  if (!stored) return undefined;

  const firstSeenAtMs = Number(stored);
  return Number.isFinite(firstSeenAtMs) ? firstSeenAtMs : undefined;
};

const getOrCreateFirstSeenAtMs = (storageKey: string, nowMs: number): number | undefined => {
  const firstSeenAtMs = readFirstSeenAtMs(storageKey);
  if (firstSeenAtMs !== undefined) return firstSeenAtMs;
  const storage = getSafeLocalStorage();
  if (typeof storage?.setItem !== 'function') return undefined;

  try {
    storage.setItem(storageKey, nowMs.toString());
  } catch {
    return undefined;
  }
  return nowMs;
};

const clearFirstSeenAtMs = (storageKey: string) => {
  const storage = getSafeLocalStorage();
  if (typeof storage?.removeItem !== 'function') return;

  try {
    storage.removeItem(storageKey);
  } catch {
    // Fail closed if localStorage is unavailable or blocked.
  }
};

type WelcomeSetupInstructionsProps = {
  onOpenLocalMindroomSettings: () => void;
};

function WelcomeSetupInstructions({ onOpenLocalMindroomSettings }: WelcomeSetupInstructionsProps) {
  const { t } = useTranslation();
  const steps = [
    t('sharedUi.welcomePage.setupStep1', { command: WELCOME_SETUP_COMMANDS.initialize }),
    t('sharedUi.welcomePage.setupStep2', {
      envFile: '~/.mindroom/.env',
      command: WELCOME_SETUP_COMMANDS.login,
    }),
    t('sharedUi.welcomePage.setupStep3', { command: WELCOME_SETUP_COMMANDS.run }),
  ];
  return (
    <Box direction="Column" gap="200" style={WelcomeCardStyle}>
      <Text as="span" size="L400">
        {t('sharedUi.welcomePage.setUpLocalMindroom')}
      </Text>
      {steps.map((step) => (
        <Text key={step} as="span" size="T200" priority="300" style={{ overflowWrap: 'anywhere' }}>
          {step}
        </Text>
      ))}
      <Button
        aria-label={t('sharedUi.welcomePage.openLocalMindroomSettings')}
        fill="Soft"
        onClick={onOpenLocalMindroomSettings}
        before={<Icon size="200" src={safeIcon(Icons.Link)} />}
        style={{ justifyContent: 'flex-start' }}
        outlined
        radii="300"
      >
        <Text as="span" size="B300" style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
          {t('sharedUi.welcomePage.enterPairCode')}
        </Text>
      </Button>
    </Box>
  );
}

export function WelcomePage() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const { sidebar, welcome } = useClientConfig();
  const userId = mx.getSafeUserId();
  const sessionHomeserverUrl = mx.getHomeserverUrl();
  const sessionAccessToken = mx.getAccessToken() ?? undefined;
  const provisioningRequest = React.useMemo(
    () =>
      resolveMindroomProvisioningRequest({
        sessionHomeserverUrl,
        provisioningOverrideUrl: sidebar?.mindRoomProvisioningUrl,
        accessToken: sessionAccessToken,
      }),
    [sessionAccessToken, sessionHomeserverUrl, sidebar?.mindRoomProvisioningUrl]
  );
  const [showSetupInstructions, setShowSetupInstructions] = React.useState(false);
  const { docsLabel, docsUrl, poweredBy, sourceLabel, sourceUrl, subtitle, title } =
    getMindroomWelcomePageContent(welcome, t);
  const openLocalMindroomSettings = React.useCallback(() => {
    setSettingsModal({ initialPage: LOCAL_MINDROOM_SETTINGS_PAGE });
  }, [setSettingsModal]);

  const { canAuthenticate, provisioningBaseUrl } = provisioningRequest;

  React.useEffect(() => {
    // Accounts that may not authenticate to this provisioning origin cannot pair here.
    if (!canAuthenticate) {
      setShowSetupInstructions(false);
      return undefined;
    }

    let cancelled = false;
    const nowMs = Date.now();
    const storageKey = getWelcomeSetupFirstSeenStorageKey(userId);

    mx.getOpenIdToken()
      .then(({ access_token: openIdToken }) =>
        getLocalMindroomConnections(openIdToken, provisioningBaseUrl)
      )
      .then((result) => {
        if (cancelled) return;
        const activeConnectionCount = result.connections.filter(
          (connection) => !isConnectionRevoked(connection)
        ).length;
        if (activeConnectionCount > 0) {
          clearFirstSeenAtMs(storageKey);
          setShowSetupInstructions(false);
          return;
        }

        const firstSeenAtMs = getOrCreateFirstSeenAtMs(storageKey, nowMs);
        setShowSetupInstructions(
          shouldShowWelcomeSetupPrompt({
            activeConnectionCount,
            firstSeenAtMs,
            nowMs,
          })
        );
      })
      .catch(() => {
        if (!cancelled) setShowSetupInstructions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canAuthenticate, mx, provisioningBaseUrl, userId]);

  return (
    <Page>
      <Box
        grow="Yes"
        style={{ padding: config.space.S400, paddingBottom: config.space.S700 }}
        alignItems="Center"
        justifyContent="Center"
      >
        <PageHeroSection>
          <PageHero
            icon={
              <img
                width="70"
                height="70"
                src={MINDROOM_CLIENT_BRANDING.logoSrc}
                alt={MINDROOM_CLIENT_BRANDING.logoAlt}
              />
            }
            title={title}
            subTitle={<span>{subtitle}</span>}
          >
            <Box justifyContent="Center">
              <Box grow="Yes" style={{ maxWidth: toRem(360) }} direction="Column" gap="300">
                {sourceUrl && (
                  <Button
                    as="a"
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    before={<Icon size="200" src={safeIcon(Icons.Code)} />}
                    fill="Soft"
                    outlined
                    radii="300"
                  >
                    <Text as="span" size="B400" truncate>
                      {sourceLabel}
                    </Text>
                  </Button>
                )}
                {docsUrl && (
                  <Button
                    as="a"
                    href={docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    fill="Soft"
                    before={<Icon size="200" src={safeIcon(Icons.Info)} />}
                    outlined
                    radii="300"
                  >
                    <Text as="span" size="B400" truncate>
                      {docsLabel}
                    </Text>
                  </Button>
                )}
                {showSetupInstructions && (
                  <WelcomeSetupInstructions
                    onOpenLocalMindroomSettings={openLocalMindroomSettings}
                  />
                )}
                <KeyBackupNudge />
                {poweredBy.length > 0 && (
                  <Text size="T300" align="Center">
                    <Trans
                      t={t}
                      shouldUnescape
                      tOptions={{ interpolation: { escapeValue: true } }}
                      i18nKey="sharedUi.welcomePage.poweredBy"
                      components={{
                        links: (
                          <span>
                            {' '}
                            {poweredBy.map((item, index) => (
                              <React.Fragment key={item.url}>
                                <a href={item.url} target="_blank" rel="noreferrer noopener">
                                  {item.label}
                                </a>
                                {index < poweredBy.length - 1 && ' \u2022 '}
                              </React.Fragment>
                            ))}
                          </span>
                        ),
                      }}
                    />
                  </Text>
                )}
              </Box>
            </Box>
          </PageHero>
        </PageHeroSection>
      </Box>
    </Page>
  );
}
