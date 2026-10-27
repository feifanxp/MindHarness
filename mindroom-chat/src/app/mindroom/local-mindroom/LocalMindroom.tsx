import { useTranslation } from 'react-i18next';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Icon, IconButton, Icons, Spinner, Text, color } from 'folds';
import { Page, PageContent, PageHeader, PageScroll } from '../../components/page';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { SequenceCardStyle } from '../../features/settings/styles.css';
import { getConnectPath } from '../../pages/pathUtils';
import {
  LocalMindroomConnection,
  getLocalMindroomConnections,
  getLocalMindroomErrorMessage,
  revokeLocalMindroomConnection,
} from './api';
import {
  formatLocalTimestamp,
  getConnectionCreatedAt,
  getConnectionId,
  getConnectionLastSeenAt,
  getConnectionName,
  getMindroomDocsUrl,
  isConnectionRevoked,
  resolveMindroomProvisioningRequest,
} from './mindroom';
import { PairCodeForm } from './PairCodeForm';

const LOCAL_MINDROOM_RUN_COMMAND = 'uvx mindroom run';

type LocalMindroomProps = {
  requestClose: () => void;
  onNavigate: () => void;
};

export function LocalMindroom({ requestClose, onNavigate }: LocalMindroomProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const { sidebar } = useClientConfig();
  const docsUrl = getMindroomDocsUrl(sidebar?.mindRoomUrl);
  const sessionHomeserverUrl = mx.getHomeserverUrl();
  const sessionAccessToken = mx.getAccessToken() ?? undefined;
  // Accounts that may not authenticate to this provisioning origin cannot list
  // their installations; asking anyway would only send an unauthenticated
  // request to another origin.
  const { canAuthenticate, provisioningBaseUrl: provisioningUrl } =
    resolveMindroomProvisioningRequest({
      sessionHomeserverUrl,
      provisioningOverrideUrl: sidebar?.mindRoomProvisioningUrl,
      accessToken: sessionAccessToken,
    });
  const provisioningHost = provisioningUrl ? new URL(provisioningUrl).host : undefined;

  const [connections, setConnections] = useState<LocalMindroomConnection[] | undefined>();
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string>();
  const [confirmRevokeId, setConfirmRevokeId] = useState<string>();
  const [revokingId, setRevokingId] = useState<string>();
  const [revokeError, setRevokeError] = useState<string>();

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    setConnectionsError(undefined);
    try {
      const { access_token: openIdToken } = await mx.getOpenIdToken();
      const result = await getLocalMindroomConnections(openIdToken, provisioningUrl);
      setConnections(result.connections.filter((connection) => !isConnectionRevoked(connection)));
    } catch (error) {
      setConnectionsError(
        getLocalMindroomErrorMessage(
          error,
          t('mindroomUi.local-mindroom.localMindroom.requestFailed')
        )
      );
    } finally {
      setLoadingConnections(false);
    }
  }, [mx, provisioningUrl, t]);

  useEffect(() => {
    if (canAuthenticate) loadConnections();
  }, [canAuthenticate, loadConnections]);

  // The connect page lives outside the client layout, so close settings first
  // to keep the modal from reopening when the user comes back.
  const handlePairCode = (pairCode: string) => {
    onNavigate();
    navigate(getConnectPath(pairCode));
  };

  const handleRevokeConnection = useCallback(
    async (connectionId: string) => {
      setRevokingId(connectionId);
      setRevokeError(undefined);

      try {
        const { access_token: openIdToken } = await mx.getOpenIdToken();
        await revokeLocalMindroomConnection(connectionId, openIdToken, provisioningUrl);
        setConfirmRevokeId(undefined);
        await loadConnections();
      } catch (error) {
        setRevokeError(
          getLocalMindroomErrorMessage(
            error,
            t('mindroomUi.local-mindroom.localMindroom.requestFailed')
          )
        );
      } finally {
        setRevokingId(undefined);
      }
    },
    [loadConnections, mx, provisioningUrl, t]
  );

  const hasConnections = (connections?.length ?? 0) > 0;

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader outlined={false}>
            <Box grow="Yes" gap="200">
              <Box grow="Yes" alignItems="Center" gap="200">
                <Text size="H3" truncate>
                  {t('mindroomUi.local-mindroom.localMindroom.localMindroom')}
                </Text>
              </Box>
              <Box shrink="No">
                <IconButton onClick={requestClose} variant="Surface">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Box>
            </Box>
          </PageHeader>
        }
      >
        <PageContent>
          <Box direction="Column" gap="700">
            <Box direction="Column" gap="100">
              <Text size="L400">
                {t('mindroomUi.local-mindroom.localMindroom.connectLocalMindroom')}
              </Text>
              <SequenceCard
                className={SequenceCardStyle}
                variant="SurfaceVariant"
                direction="Column"
                gap="400"
              >
                <SettingTile
                  title={t(
                    'mindroomUi.local-mindroom.localMindroom.pairThisChatAccountWithYourLocalMindroomProcess'
                  )}
                  description={t('mindroomUi.local-mindroom.localMindroom.enterCodeDescription', {
                    command: LOCAL_MINDROOM_RUN_COMMAND,
                  })}
                />

                <PairCodeForm onSubmit={handlePairCode} />

                <Box gap="200" wrap="Wrap">
                  <Button
                    size="300"
                    variant="Secondary"
                    fill="Soft"
                    outlined
                    radii="300"
                    onClick={() => window.open(docsUrl, '_blank', 'noopener,noreferrer')}
                  >
                    <Text size="B300">
                      {t('mindroomUi.local-mindroom.localMindroom.mindroomDocs')}
                    </Text>
                  </Button>
                </Box>
              </SequenceCard>
            </Box>

            <Box direction="Column" gap="100">
              <Text size="L400">
                {t('mindroomUi.local-mindroom.localMindroom.linkedInstallations')}
              </Text>
              <SequenceCard
                className={SequenceCardStyle}
                variant="SurfaceVariant"
                direction="Column"
                gap="300"
              >
                {canAuthenticate ? (
                  <>
                    {loadingConnections && (
                      <Box alignItems="Center" gap="200">
                        <Spinner variant="Secondary" fill="Soft" size="200" />
                        <Text size="T200" priority="300">
                          {t('mindroomUi.local-mindroom.localMindroom.loadingLinkedInstallations')}
                        </Text>
                      </Box>
                    )}

                    {!loadingConnections && connectionsError && (
                      <Box direction="Column" gap="200">
                        <Text size="T200" style={{ color: color.Critical.Main }}>
                          {connectionsError}
                        </Text>
                        <Button
                          size="300"
                          variant="Secondary"
                          fill="Soft"
                          outlined
                          radii="300"
                          onClick={loadConnections}
                        >
                          <Text size="B300">
                            {t('mindroomUi.local-mindroom.localMindroom.tryAgain')}
                          </Text>
                        </Button>
                      </Box>
                    )}

                    {!loadingConnections && !connectionsError && !hasConnections && (
                      <Text size="T200" priority="300">
                        {t(
                          'mindroomUi.local-mindroom.localMindroom.noLinkedLocalMindroomInstallationsYet'
                        )}
                      </Text>
                    )}

                    {connections?.map((connection, index) => {
                      const connectionId = getConnectionId(connection);
                      const isRevoking = connectionId !== undefined && revokingId === connectionId;
                      const isConfirming =
                        connectionId !== undefined && confirmRevokeId === connectionId;

                      return (
                        <SequenceCard
                          key={connectionId ?? `connection-item-${index}`}
                          variant="Surface"
                          direction="Column"
                          gap="200"
                          style={{ padding: '12px' }}
                        >
                          <SettingTile
                            title={getConnectionName(connection, index)}
                            description={
                              <>
                                <div>
                                  {t('mindroomUi.local-mindroom.localMindroom.createdAt', {
                                    timestamp: formatLocalTimestamp(
                                      getConnectionCreatedAt(connection),
                                      language,
                                      t('mindroomUi.local-mindroom.localMindroom.unknown')
                                    ),
                                  })}
                                </div>
                                <div>
                                  {t('mindroomUi.local-mindroom.localMindroom.lastSeenAt', {
                                    timestamp: formatLocalTimestamp(
                                      getConnectionLastSeenAt(connection),
                                      language,
                                      t('mindroomUi.local-mindroom.localMindroom.unknown')
                                    ),
                                  })}
                                </div>
                              </>
                            }
                          />

                          {connectionId && (
                            <Box gap="200" wrap="Wrap">
                              {!isConfirming && (
                                <Button
                                  size="300"
                                  variant="Critical"
                                  fill="Soft"
                                  outlined
                                  radii="300"
                                  onClick={() => setConfirmRevokeId(connectionId)}
                                >
                                  <Text size="B300">
                                    {t('mindroomUi.local-mindroom.localMindroom.revoke')}
                                  </Text>
                                </Button>
                              )}

                              {isConfirming && (
                                <>
                                  <Button
                                    size="300"
                                    variant="Critical"
                                    radii="300"
                                    onClick={() => {
                                      handleRevokeConnection(connectionId);
                                    }}
                                    disabled={isRevoking}
                                    before={
                                      isRevoking && (
                                        <Spinner variant="Critical" fill="Soft" size="200" />
                                      )
                                    }
                                    outlined
                                    fill="Soft"
                                  >
                                    <Text size="B300">
                                      {t('mindroomUi.local-mindroom.localMindroom.confirmRevoke')}
                                    </Text>
                                  </Button>
                                  <Button
                                    size="300"
                                    variant="Secondary"
                                    fill="Soft"
                                    outlined
                                    radii="300"
                                    onClick={() => setConfirmRevokeId(undefined)}
                                    disabled={isRevoking}
                                  >
                                    <Text size="B300">
                                      {t('mindroomUi.local-mindroom.localMindroom.cancel')}
                                    </Text>
                                  </Button>
                                </>
                              )}
                            </Box>
                          )}
                        </SequenceCard>
                      );
                    })}

                    {revokeError && (
                      <Text size="T200" style={{ color: color.Critical.Main }}>
                        {revokeError}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text size="T200" priority="300">
                    {t('mindroomUi.local-mindroom.localMindroom.linkedInstallationsUnavailable', {
                      server: provisioningHost,
                    })}
                  </Text>
                )}
              </SequenceCard>
            </Box>
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
