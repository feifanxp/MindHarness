import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Box, Button, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useComputerApiUrls } from '../computer/useComputerApiUrl';
import { openConnectionsPortal } from '../connections/openConnections';
import { requestAudienceOpenIdToken } from '../matrix/openidAudience';

export function MindroomConnectionsSettings({ className }: { className?: string }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { urls: backendUrls, discovered } = useComputerApiUrls();
  const [blocked, setBlocked] = useState(false);

  // The native shells have no pop-up window to hand a token to.
  if (Capacitor.isNativePlatform()) return null;

  // The window must open inside the click itself, so nothing here awaits before the call.
  const open = (backendUrl: string) => {
    const result = openConnectionsPortal({
      backendUrl,
      getOpenIdToken: async (audience) => {
        // An account switch stops this client but not the portal session, so a stopped client never answers.
        if (!mx.clientRunning) throw new Error('Matrix client stopped');
        const token = await requestAudienceOpenIdToken(mx, audience, {
          requireBinding: discovered,
        });
        if (!mx.clientRunning) throw new Error('Matrix client stopped');
        return token;
      },
    });
    setBlocked(result === 'blocked');
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('settings.general.connections.sectionTitle')}</Text>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column" gap="400">
        <SettingTile
          title={t('settings.general.connections.title')}
          description={t('settings.general.connections.description')}
        >
          <Box direction="Column" gap="200">
            {/* A found server is named, so the user sees where the portal opens before signing in there. */}
            {(backendUrls.length > 0 ? backendUrls : [undefined]).map((backendUrl) => (
              <Box key={backendUrl ?? 'none'} gap="200" wrap="Wrap" alignItems="Center">
                <Button
                  size="300"
                  variant="Primary"
                  fill="Soft"
                  outlined
                  radii="300"
                  disabled={!backendUrl}
                  aria-label={
                    backendUrl && discovered
                      ? `${t('settings.general.connections.open')} ${backendUrl}`
                      : undefined
                  }
                  onClick={() => backendUrl && open(backendUrl)}
                >
                  <Text size="B300">{t('settings.general.connections.open')}</Text>
                </Button>
                {backendUrl && discovered && <Text size="T200">{backendUrl}</Text>}
              </Box>
            ))}
            {backendUrls.length === 0 && (
              <Text size="T200" role="note">
                {t('settings.general.connections.noBackend')}
              </Text>
            )}
            {blocked && (
              <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                {t('settings.general.connections.blocked')}
              </Text>
            )}
          </Box>
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
