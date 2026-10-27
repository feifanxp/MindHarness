import { useTranslation } from 'react-i18next';
import { MatrixClient, SyncState } from 'matrix-js-sdk';
import React from 'react';
import { Box, config, Line, Text } from 'folds';
import {
  isInitialClientCatchupInProgress,
  useClientSyncStateData,
} from '../../hooks/useInitialClientCatchup';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { useHomeserverUnreachable } from '../../mindroom/matrix/homeserverReachability';

type SyncStatusProps = {
  mx: MatrixClient;
};
export function SyncStatus({ mx }: SyncStatusProps) {
  const { t } = useTranslation();
  const stateData = useClientSyncStateData(mx);
  const unreachable = useHomeserverUnreachable(mx);

  if (!unreachable && stateData.current != null && isInitialClientCatchupInProgress(stateData)) {
    return (
      <Box data-testid="client-sync-status" direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'SurfaceVariant' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
        >
          <Text size="L400">{t('sharedUi.syncStatus.catchingUp')}</Text>
        </Box>
        <Line variant="Success" size="300" />
      </Box>
    );
  }

  if (stateData.current === SyncState.Reconnecting) {
    return (
      <Box data-testid="client-sync-status" direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'Warning' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
        >
          <Text size="L400">{t('sharedUi.syncStatus.connectionLostReconnecting')}</Text>
        </Box>
        <Line variant="Warning" size="300" />
      </Box>
    );
  }

  if (stateData.current === SyncState.Error || unreachable) {
    return (
      <Box data-testid="client-sync-status" direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'Critical' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
        >
          <Text size="L400">{t('sharedUi.syncStatus.connectionLost')}</Text>
        </Box>
        <Line variant="Critical" size="300" />
      </Box>
    );
  }

  return null;
}
