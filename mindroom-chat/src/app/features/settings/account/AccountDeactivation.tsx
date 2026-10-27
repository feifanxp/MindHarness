import React, { useCallback, useState } from 'react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Switch,
  Text,
  color,
  config,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { AuthDict, MatrixError } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { Dialog, Header } from '../../../components/glass/GlassPrimitives';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useAuthMetadata } from '../../../hooks/useAuthMetadata';
import {
  getAccountManagementUrl,
  useAccountManagementActions,
} from '../../../hooks/useAccountManagement';
import { stopPropagation } from '../../../utils/keyboard';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncState, AsyncStatus, useAsync } from '../../../hooks/useAsyncCallback';
import { useUIAMatrixError } from '../../../hooks/useUIAFlows';
import { ActionUIA, ActionUIAFlowsLoader } from '../../../components/ActionUIA';
import { logoutClient } from '../../../../client/initMatrix';

export function AccountDeactivation() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const authMetadata = useAuthMetadata();
  const accountManagementActions = useAccountManagementActions();

  const [open, setOpen] = useState(false);
  const [eraseData, setEraseData] = useState(false);
  const [deactivateState, setDeactivateState] = useState<AsyncState<unknown, MatrixError>>({
    status: AsyncStatus.Idle,
  });

  const openProviderDeactivation = useCallback(() => {
    const url = getAccountManagementUrl(authMetadata, {
      action: accountManagementActions.accountDeactivate,
    });
    if (!url) return;

    window.open(url, '_blank');
  }, [authMetadata, accountManagementActions]);

  const deactivateAccount = useAsync(
    useCallback(
      async (authDict?: AuthDict) => {
        await mx.deactivateAccount(authDict, eraseData);
      },
      [mx, eraseData]
    ),
    useCallback(
      (state: AsyncState<unknown, MatrixError>) => {
        setDeactivateState(state);
        if (state.status === AsyncStatus.Success) {
          void logoutClient(mx).catch(() => window.location.reload());
        }
      },
      [mx]
    )
  );

  const [authData, deactivateError] = useUIAMatrixError(
    deactivateState.status === AsyncStatus.Error ? deactivateState.error : undefined
  );

  const busy =
    deactivateState.status === AsyncStatus.Loading ||
    deactivateState.status === AsyncStatus.Success ||
    authData !== undefined;
  const hasProviderPortal = Boolean(authMetadata?.account_management_uri ?? authMetadata?.issuer);

  const handleClose = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setDeactivateState({ status: AsyncStatus.Idle });
  }, [busy]);

  return (
    <>
      <Box direction="Column" gap="100">
        <Text size="L400">
          {t('featureUi.settings.account.accountDeactivation.accountManagement')}
        </Text>
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          <SettingTile
            title={t('featureUi.settings.account.accountDeactivation.deleteDeactivateAccount')}
            description={
              hasProviderPortal
                ? t('featureUi.settings.account.accountDeactivation.descriptionWithProvider')
                : t('featureUi.settings.account.accountDeactivation.descriptionWithoutProvider')
            }
          >
            <Box gap="200" wrap="Wrap">
              <Button
                size="300"
                variant="Critical"
                radii="300"
                onClick={() => setOpen(true)}
                disabled={busy}
                fill="Soft"
                outlined
              >
                <Text size="B300">
                  {t('featureUi.settings.account.accountDeactivation.deleteDeactivate')}
                </Text>
              </Button>
              {hasProviderPortal && (
                <Button
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  outlined
                  radii="300"
                  onClick={openProviderDeactivation}
                  disabled={busy}
                >
                  <Text size="B300">
                    {t('featureUi.settings.account.accountDeactivation.openProviderPortal')}
                  </Text>
                </Button>
              )}
            </Box>
          </SettingTile>
        </SequenceCard>
      </Box>

      <Overlay open={open} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: handleClose,
              clickOutsideDeactivates: !busy,
              escapeDeactivates: busy ? false : stopPropagation,
            }}
          >
            <Dialog variant="Surface">
              <Header
                style={{
                  padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                  borderBottomWidth: config.borderWidth.B300,
                }}
                variant="Surface"
                size="500"
              >
                <Box grow="Yes">
                  <Text size="H4">
                    {t('featureUi.settings.account.accountDeactivation.deleteDeactivateAccount')}
                  </Text>
                </Box>
                <IconButton size="300" onClick={handleClose} radii="300" disabled={busy}>
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Header>
              <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                <Text priority="400">
                  {t(
                    'featureUi.settings.account.accountDeactivation.thisWillRequestAccountDeactivationOnYour'
                  )}
                </Text>
                <SettingTile
                  title={t(
                    'featureUi.settings.account.accountDeactivation.eraseAccountDataIfSupported'
                  )}
                  description={t(
                    'featureUi.settings.account.accountDeactivation.ifEnabledTheHomeserverMayPermanentlyErase'
                  )}
                  after={<Switch variant="Primary" value={eraseData} onChange={setEraseData} />}
                />

                {deactivateError && (
                  <Text style={{ color: color.Critical.Main }} size="T300">
                    {t('featureUi.settings.account.accountDeactivation.deactivationFailed', {
                      error: deactivateError.message,
                    })}
                  </Text>
                )}

                {authData && (
                  <Box direction="Column" gap="100">
                    <Text size="T200" priority="300">
                      {t(
                        'featureUi.settings.account.accountDeactivation.additionalAuthenticationIsRequiredToCompleteAccount'
                      )}
                    </Text>
                    <ActionUIAFlowsLoader
                      authData={authData}
                      unsupported={() => (
                        <Box direction="Column" gap="100">
                          <Text size="T200" style={{ color: color.Critical.Main }}>
                            {t(
                              'featureUi.settings.account.accountDeactivation.thisClientDoesNotSupportTheRequired'
                            )}
                          </Text>
                          {hasProviderPortal && (
                            <Button
                              size="300"
                              variant="Secondary"
                              fill="Soft"
                              outlined
                              radii="300"
                              onClick={openProviderDeactivation}
                            >
                              <Text size="B300">
                                {t(
                                  'featureUi.settings.account.accountDeactivation.continueInProviderPortal'
                                )}
                              </Text>
                            </Button>
                          )}
                        </Box>
                      )}
                    >
                      {(ongoingFlow) => (
                        <ActionUIA
                          authData={authData}
                          ongoingFlow={ongoingFlow}
                          action={deactivateAccount}
                          onCancel={() => setDeactivateState({ status: AsyncStatus.Idle })}
                        />
                      )}
                    </ActionUIAFlowsLoader>
                  </Box>
                )}

                <Box direction="Column" gap="200">
                  <Button
                    variant="Critical"
                    onClick={() => deactivateAccount()}
                    disabled={busy}
                    before={busy && <Spinner variant="Critical" fill="Soft" size="200" />}
                    outlined
                    radii="300"
                    fill="Soft"
                  >
                    <Text size="B400">
                      {t('featureUi.settings.account.accountDeactivation.deleteDeactivate')}
                    </Text>
                  </Button>
                  {hasProviderPortal && (
                    <Button
                      variant="Secondary"
                      fill="Soft"
                      outlined
                      onClick={openProviderDeactivation}
                      disabled={busy}
                      radii="300"
                    >
                      <Text size="B400">
                        {t('featureUi.settings.account.accountDeactivation.openProviderPortal')}
                      </Text>
                    </Button>
                  )}
                  <Button
                    variant="Secondary"
                    fill="Soft"
                    onClick={handleClose}
                    disabled={busy}
                    outlined
                    radii="300"
                  >
                    <Text size="B400">
                      {t('featureUi.settings.account.accountDeactivation.cancel')}
                    </Text>
                  </Button>
                </Box>
              </Box>
            </Dialog>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
    </>
  );
}
