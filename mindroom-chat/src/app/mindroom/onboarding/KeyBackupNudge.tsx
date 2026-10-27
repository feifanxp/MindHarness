import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { Box, Button, Icon, IconButton, Icons, Text, color } from 'folds';
import { useSetAtom } from 'jotai';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { settingsModalAtom } from '../../state/settingsModal';
import { SettingsPages } from '../../features/settings/settingsPages';
import { dismissKeyBackupNudge, readKeyBackupNudgeDismissed } from './keyBackupNudgeDismissal';
import { useKeyBackupPresence } from './useKeyBackupPresence';
import { WelcomeCardStyle } from './welcomeCard';

function KeyBackupNudgeCard() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const [dismissed, setDismissed] = useState(() => readKeyBackupNudgeDismissed(userId));
  const presence = useKeyBackupPresence();

  // Only nudge once the server has definitively answered that there is no
  // backup. `unknown` (initial state or transient failure) keeps the nudge
  // hidden — otherwise a network hiccup at mount would nag a user who already
  // has backup, and their dismissal would permanently suppress it.
  if (dismissed || presence !== 'absent') return null;

  const openSecuritySettings = () => setSettingsModal({ initialPage: SettingsPages.DevicesPage });
  const onDismiss = () => {
    dismissKeyBackupNudge(userId);
    setDismissed(true);
  };

  return (
    <Box direction="Column" gap="200" style={WelcomeCardStyle}>
      <Box alignItems="Center" gap="200">
        <Icon size="100" src={Icons.ShieldLock} style={{ color: color.Success.Main }} />
        <Text as="span" size="L400">
          {t('mindroomUi.onboarding.keyBackupNudge.backUpYourEncryptedHistory')}
        </Text>
        <Box grow="Yes" />
        <IconButton
          size="300"
          variant="Background"
          aria-label={t('mindroomUi.onboarding.keyBackupNudge.dismissBackupReminder')}
          onClick={onDismiss}
        >
          <Icon size="100" src={Icons.Cross} />
        </IconButton>
      </Box>
      <Text as="span" size="T200" priority="300">
        {t('mindroomUi.onboarding.keyBackupNudge.setUpSecureBackupSoYouCanStillReadYour')}
      </Text>
      <Button
        aria-label={t('mindroomUi.onboarding.keyBackupNudge.setUpSecureKeyBackup')}
        fill="Soft"
        onClick={openSecuritySettings}
        before={<Icon size="200" src={Icons.ShieldLock} />}
        style={{ justifyContent: 'flex-start' }}
        outlined
        radii="300"
      >
        <Text as="span" size="B300">
          {t('mindroomUi.onboarding.keyBackupNudge.setUpBackup')}
        </Text>
      </Button>
    </Box>
  );
}

/**
 * First-run onboarding nudge that steers a user into secure key backup so a new
 * device login can still read their encrypted agent history. Renders nothing
 * when room encryption is disabled by policy, without crypto, until the server
 * confirms no backup exists, when a backup already exists, or after the user
 * dismisses it.
 */
export function KeyBackupNudge() {
  const mx = useMatrixClient();
  const { createRoom } = useClientConfig();
  const crypto = mx.getCrypto();
  const encryptionDisabled =
    createRoom?.showEncryptionOption === false && createRoom?.defaultEncryption === false;

  if (encryptionDisabled || !crypto) return null;

  // Key by user id so the per-account dismissal state (read once on mount) is
  // re-evaluated if the active session changes without a full unmount.
  return <KeyBackupNudgeCard key={mx.getSafeUserId()} />;
}
