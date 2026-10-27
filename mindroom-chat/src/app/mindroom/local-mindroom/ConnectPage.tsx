import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import classNames from 'classnames';
import { Box, Button, Scroll, Spinner, Text, color } from 'folds';
import { Header } from '../../components/glass/GlassPrimitives';
import * as css from '../../pages/auth/styles.css';
import {
  ParticleBackgroundSurface,
  usePersistentParticleBackground,
} from '../../components/particle-background';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useActiveSession, useStoredSessions } from '../../hooks/useSessionStore';
import { setAfterLoginRedirectPath } from '../../pages/afterLoginRedirectPath';
import { withAddAccountSearch } from '../../pages/auth/addAccount';
import { getConnectPath, getLoginPath, getRootPath } from '../../pages/pathUtils';
import { getMxIdServer } from '../../utils/matrix';
import { formatRelativeTime } from '../../utils/time';
import { MINDROOM_AUTH_BRANDING } from '../auth/authUi';
import {
  approveLocalMindroomPairCode,
  getLocalMindroomErrorMessage,
  HomeserverSignedOutError,
  inspectLocalMindroomPairCode,
  LocalMindroomApiError,
  type LocalMindroomPairDevice,
} from './api';
import { getPairingAccounts, normalizePairCode, requestAsStoredSession } from './devicePairing';
import { PairCodeForm } from './PairCodeForm';

type PairState =
  | { status: 'loading' }
  | { status: 'ready' | 'approving' | 'approved'; device: LocalMindroomPairDevice }
  | { status: 'error'; error: unknown; device?: LocalMindroomPairDevice };

const isExpiredOrNotFoundError = (error: unknown): boolean =>
  error instanceof LocalMindroomApiError && (error.status === 404 || error.status === 410);

const getPairingErrorMessage = (error: unknown, t: TFunction): string => {
  if (error instanceof HomeserverSignedOutError) {
    return t('mindroomUi.local-mindroom.connect.accountSignedOut');
  }
  if (error instanceof LocalMindroomApiError) {
    if (error.status === 404) return t('mindroomUi.local-mindroom.connect.codeNotFound');
    if (error.status === 409) return t('mindroomUi.local-mindroom.connect.codeAlreadyApproved');
    if (error.status === 410) return t('mindroomUi.local-mindroom.connect.codeExpired');
  }
  return getLocalMindroomErrorMessage(
    error,
    t('mindroomUi.local-mindroom.localMindroom.requestFailed')
  );
};

function ConnectCard({ children }: { children: React.ReactNode }) {
  const hasPersistentParticleBackground = usePersistentParticleBackground();

  return (
    <Scroll variant="Background" visibility="Hover" size="300" hideTrack>
      <Box
        className={classNames(
          css.AuthLayout,
          hasPersistentParticleBackground && css.AuthLayoutPersistentParticle
        )}
        direction="Column"
        alignItems="Center"
        gap="400"
      >
        <ParticleBackgroundSurface />
        <Box direction="Column" className={css.AuthCard}>
          <Header className={css.AuthHeader} size="600" variant="Surface" appearance="plain">
            <Box grow="Yes" direction="Row" gap="300" alignItems="Center">
              <img
                className={css.AuthLogo}
                src={MINDROOM_AUTH_BRANDING.logoSrc}
                alt={MINDROOM_AUTH_BRANDING.logoAlt}
              />
              <Text size="H3">{MINDROOM_AUTH_BRANDING.appName}</Text>
            </Box>
          </Header>
          <Box className={css.AuthCardContent} direction="Column" gap="500">
            {children}
          </Box>
        </Box>
      </Box>
    </Scroll>
  );
}

// Approves a local MindRoom's device pairing code with any stored account on
// the provisioning homeserver, without switching the app's active account.
export function ConnectPage() {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawCode = searchParams.get('code') ?? undefined;
  const pairCode = normalizePairCode(rawCode);
  const { sidebar } = useClientConfig();
  const sessions = useStoredSessions();
  const activeSession = useActiveSession();
  const accounts = useMemo(
    () => getPairingAccounts(sessions, sidebar?.mindRoomProvisioningUrl),
    [sessions, sidebar?.mindRoomProvisioningUrl]
  );
  const [chosenSessionId, setChosenSessionId] = useState<string>();
  const account =
    accounts.find(({ session }) => session.sessionId === chosenSessionId) ??
    accounts.find(({ session }) => session.sessionId === activeSession?.sessionId) ??
    accounts[0];
  const sessionId = account?.session.sessionId;
  const provisioningBaseUrl = account?.provisioningBaseUrl;
  const [pairState, setPairState] = useState<PairState>({ status: 'loading' });
  const pairingRevision = useRef(0);
  const inFrame = window.top !== window.self;

  useEffect(() => {
    pairingRevision.current += 1;
  }, [sessionId, pairCode, provisioningBaseUrl]);

  useEffect(() => {
    if (inFrame || !pairCode || !sessionId || !provisioningBaseUrl) return undefined;

    let cancelled = false;
    setPairState({ status: 'loading' });
    requestAsStoredSession(sessionId, (openIdToken) =>
      inspectLocalMindroomPairCode(pairCode, openIdToken, provisioningBaseUrl)
    )
      .then((device) => {
        if (!cancelled) setPairState({ status: 'ready', device });
      })
      .catch((error: unknown) => {
        if (!cancelled) setPairState({ status: 'error', error });
      });

    return () => {
      cancelled = true;
    };
  }, [inFrame, pairCode, sessionId, provisioningBaseUrl]);

  const handleApprove = useCallback(async () => {
    if (pairState.status !== 'ready' || !pairCode || !sessionId || !provisioningBaseUrl) return;

    const { device } = pairState;
    const approvalRevision = pairingRevision.current;
    setPairState({ status: 'approving', device });
    let nextState: PairState;
    try {
      await requestAsStoredSession(sessionId, (openIdToken) =>
        approveLocalMindroomPairCode(pairCode, openIdToken, provisioningBaseUrl)
      );
      nextState = { status: 'approved', device };
    } catch (error) {
      nextState = { status: 'error', error, device };
    }
    // A warm link or account change can replace this pairing while approval is pending.
    if (pairingRevision.current === approvalRevision) setPairState(nextState);
  }, [pairCode, pairState, provisioningBaseUrl, sessionId]);

  const handleSignIn = (server?: string) => {
    setAfterLoginRedirectPath(getConnectPath(pairCode));
    const loginPath = getLoginPath(server);
    navigate(activeSession ? withAddAccountSearch(loginPath) : loginPath);
  };

  const device = 'device' in pairState ? pairState.device : undefined;
  const approved = pairState.status === 'approved';
  const alreadyApproved = pairState.status === 'ready' && pairState.device.status === 'approved';
  const pairError = pairState.status === 'error' ? pairState.error : undefined;
  const canApprove = pairState.status === 'ready' && !alreadyApproved;

  let content: React.ReactNode;
  if (inFrame) {
    content = (
      <>
        <Text size="T300" style={{ color: color.Warning.Main }}>
          {t('mindroomUi.local-mindroom.connect.frameWarning')}
        </Text>
        <Button
          variant="Primary"
          size="400"
          radii="300"
          onClick={() => window.open(window.location.href, '_blank', 'noopener,noreferrer')}
          fill="Soft"
          outlined
        >
          <Text size="B400">{t('mindroomUi.local-mindroom.connect.openInNewTab')}</Text>
        </Button>
      </>
    );
  } else if (!pairCode) {
    content = (
      <>
        <Text size="T300">{t('mindroomUi.local-mindroom.connect.enterCode')}</Text>
        <PairCodeForm
          defaultValue={rawCode}
          onSubmit={(code) => navigate(getConnectPath(code), { replace: true })}
        />
      </>
    );
  } else if (!account) {
    content = (
      <>
        <Text size="T300">{t('mindroomUi.local-mindroom.connect.noAccount')}</Text>
        <Text size="T300" priority="300">
          {t('mindroomUi.local-mindroom.connect.noAccountAppGuidance', { code: pairCode })}
        </Text>
        <Button
          variant="Primary"
          size="400"
          radii="300"
          onClick={() => handleSignIn()}
          fill="Soft"
          outlined
        >
          <Text size="B400">{t('mindroomUi.local-mindroom.connect.signIn')}</Text>
        </Button>
      </>
    );
  } else {
    content = (
      <>
        <Text size="T300" priority="300">
          {t('mindroomUi.local-mindroom.connect.code', { code: pairCode })}
        </Text>

        {accounts.length > 1 && !approved && (
          <Box direction="Column" gap="200">
            <Text size="L400">{t('mindroomUi.local-mindroom.connect.chooseAccount')}</Text>
            {accounts.map(({ session }) => {
              const selected = session.sessionId === sessionId;
              return (
                <Button
                  key={session.sessionId}
                  variant={selected ? 'Primary' : 'Secondary'}
                  fill={selected ? 'Soft' : 'None'}
                  size="400"
                  radii="300"
                  aria-pressed={selected}
                  disabled={pairState.status === 'approving'}
                  onClick={() => setChosenSessionId(session.sessionId)}
                  style={{ justifyContent: 'flex-start' }}
                  outlined={selected}
                >
                  <Text size="B400" truncate>
                    {session.lastKnownDisplayName
                      ? `${session.lastKnownDisplayName} (${session.userId})`
                      : session.userId}
                  </Text>
                </Button>
              );
            })}
          </Box>
        )}

        {pairState.status === 'loading' && (
          <Box alignItems="Center" gap="200">
            <Spinner variant="Secondary" size="200" />
            <Text size="T300">{t('mindroomUi.local-mindroom.connect.checkingCode')}</Text>
          </Box>
        )}

        {device && (
          <Box direction="Column" gap="100">
            <Text size="H4">
              {t('mindroomUi.local-mindroom.connect.deviceQuestion', {
                clientName: device.client_name,
              })}
            </Text>
            <Text size="T300" priority="300">
              {t('mindroomUi.local-mindroom.connect.deviceStarted', {
                age: formatRelativeTime(Date.parse(device.created_at), language, 'long'),
              })}
            </Text>
            <Text size="T300" priority="300">
              {device.client_ip
                ? t('mindroomUi.local-mindroom.connect.requestedFrom', { ip: device.client_ip })
                : t('mindroomUi.local-mindroom.connect.requestedFromUnknown')}
            </Text>
          </Box>
        )}

        {approved ? (
          <Text size="T300" style={{ color: color.Success.Main }}>
            {t('mindroomUi.local-mindroom.connect.approved')}
          </Text>
        ) : (
          <>
            <Text size="T300" style={{ color: color.Warning.Main }}>
              {t('mindroomUi.local-mindroom.connect.warning')}
            </Text>
            {alreadyApproved && (
              <Text size="T300" style={{ color: color.Critical.Main }}>
                {t('mindroomUi.local-mindroom.connect.codeAlreadyApproved')}
              </Text>
            )}
            {pairError !== undefined && (
              <>
                <Text size="T300" style={{ color: color.Critical.Main }}>
                  {getPairingErrorMessage(pairError, t)}
                </Text>
                {isExpiredOrNotFoundError(pairError) && (
                  <>
                    <Box as="label" htmlFor="new-pair-code">
                      <Text size="T300">{t('mindroomUi.local-mindroom.connect.enterNewCode')}</Text>
                    </Box>
                    <PairCodeForm
                      inputId="new-pair-code"
                      defaultValue=""
                      onSubmit={(code) => navigate(getConnectPath(code), { replace: true })}
                    />
                  </>
                )}
              </>
            )}
            {pairError instanceof HomeserverSignedOutError ? (
              <Button
                variant="Primary"
                size="400"
                radii="300"
                onClick={() => handleSignIn(getMxIdServer(account.session.userId))}
                fill="Soft"
                outlined
              >
                <Text size="B400">{t('mindroomUi.local-mindroom.connect.signIn')}</Text>
              </Button>
            ) : (
              <Button
                variant="Primary"
                size="400"
                radii="300"
                disabled={!canApprove}
                onClick={handleApprove}
                before={
                  pairState.status === 'approving' && (
                    <Spinner variant="Primary" fill="Soft" size="200" />
                  )
                }
                outlined
                fill="Soft"
              >
                <Text size="B400">
                  {t('mindroomUi.local-mindroom.connect.approveAs', {
                    userId: account.session.userId,
                  })}
                </Text>
              </Button>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <ConnectCard>
      <Text size="H2">{t('mindroomUi.local-mindroom.localMindroom.connectLocalMindroom')}</Text>
      {content}
      {activeSession && (
        <Button
          variant="Secondary"
          fill="Soft"
          size="400"
          radii="300"
          onClick={() => navigate(getRootPath())}
          outlined
        >
          <Text size="B400">{t('mindroomUi.local-mindroom.connect.backToChat')}</Text>
        </Button>
      )}
    </ConnectCard>
  );
}
