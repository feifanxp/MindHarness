import { useTranslation } from 'react-i18next';
import React, { forwardRef, useCallback } from 'react';
import { config, Box, Text, Button, Spinner, color } from 'folds';
import { Dialog, Header } from './glass/GlassPrimitives';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { logoutClient } from '../../client/initMatrix';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useCrossSigningActive } from '../hooks/useCrossSigning';
import { InfoCard } from './info-card';
import {
  useDeviceVerificationStatus,
  VerificationStatus,
} from '../hooks/useDeviceVerificationStatus';

type LogoutDialogProps = {
  handleClose: () => void;
};
export const LogoutDialog = forwardRef<HTMLDivElement, LogoutDialogProps>(
  ({ handleClose }, ref) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const hasEncryptedRoom = !!mx.getRooms().find((room) => room.hasEncryptionStateEvent());
    const crossSigningActive = useCrossSigningActive();
    const verificationStatus = useDeviceVerificationStatus(
      mx.getCrypto(),
      mx.getSafeUserId(),
      mx.getDeviceId() ?? undefined
    );

    const [logoutState, logout] = useAsyncCallback<void, Error, []>(
      useCallback(async () => {
        await logoutClient(mx);
      }, [mx])
    );

    const ongoingLogout = logoutState.status === AsyncStatus.Loading;

    return (
      <Dialog variant="Surface" ref={ref}>
        <Header
          style={{
            padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
            borderBottomWidth: config.borderWidth.B300,
          }}
          variant="Surface"
          size="500"
        >
          <Box grow="Yes">
            <Text size="H4">{t('sharedUi.logoutDialog.logout')}</Text>
          </Box>
        </Header>
        <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
          {hasEncryptedRoom &&
            (crossSigningActive ? (
              verificationStatus === VerificationStatus.Unverified && (
                <InfoCard
                  variant="Critical"
                  title={t('sharedUi.logoutDialog.unverifiedDevice')}
                  description={t(
                    'sharedUi.logoutDialog.verifyYourDeviceBeforeLoggingOutToSaveYourEncryptedMessages'
                  )}
                />
              )
            ) : (
              <InfoCard
                variant="Critical"
                title={t('sharedUi.logoutDialog.alert')}
                description={t(
                  'sharedUi.logoutDialog.enableDeviceVerificationOrExportYourEncryptedDataFromSettingsToAvoid'
                )}
              />
            ))}
          <Text priority="400">{t('sharedUi.logoutDialog.youReAboutToLogOutAreYouSure')}</Text>
          {logoutState.status === AsyncStatus.Error && (
            <Text style={{ color: color.Critical.Main }} size="T300">
              {t('sharedUi.logoutDialog.logoutFailed', { error: logoutState.error.message })}
            </Text>
          )}
          <Box direction="Column" gap="200">
            <Button
              variant="Critical"
              onClick={logout}
              disabled={ongoingLogout}
              before={ongoingLogout && <Spinner variant="Critical" fill="Soft" size="200" />}
              outlined
              radii="300"
              fill="Soft"
            >
              <Text size="B400">{t('sharedUi.logoutDialog.logout')}</Text>
            </Button>
            <Button
              variant="Secondary"
              fill="Soft"
              onClick={handleClose}
              disabled={ongoingLogout}
              outlined
              radii="300"
            >
              <Text size="B400">{t('sharedUi.logoutDialog.cancel')}</Text>
            </Button>
          </Box>
        </Box>
      </Dialog>
    );
  }
);
