import React, { useCallback, useState, useSyncExternalStore } from 'react';
import FocusTrap from 'focus-trap-react';
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
import { useTranslation } from 'react-i18next';
import { Dialog, Header } from '../../../components/glass/GlassPrimitives';
import { useMindroomSyncEngine } from '../../../mindroom/engine/engineContext';
import type { OfflineRoomSnapshot } from '../../../mindroom/engine/roomOffline';
import { bytesToSize } from '../../../utils/common';
import { stopPropagation } from '../../../utils/keyboard';

type OfflineRoomSettingsProps = {
  roomId: string;
};

const useOfflineRoomSnapshot = (roomId: string): OfflineRoomSnapshot => {
  const { offline } = useMindroomSyncEngine();
  const subscribe = useCallback(
    (listener: () => void) => offline.subscribe(roomId, listener),
    [offline, roomId]
  );
  const getSnapshot = useCallback(() => offline.getSnapshot(roomId), [offline, roomId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

type OfflineStatusKey =
  | 'checking'
  | 'unavailable'
  | 'notSaved'
  | 'downloading'
  | 'offlinePause'
  | 'backgroundPause'
  | 'spacePause'
  | 'readOnlyPause'
  | 'connectionPause'
  | 'errorPause';

const statusKey = (snapshot: OfflineRoomSnapshot): OfflineStatusKey | undefined => {
  if (!snapshot.loaded) return 'checking';
  if (!snapshot.storageAvailable) return 'unavailable';
  if (!snapshot.opened) return 'notSaved';
  switch (snapshot.status) {
    case 'offline':
      return 'offlinePause';
    case 'hidden':
      return 'backgroundPause';
    case 'space':
      return 'spacePause';
    case 'read-only':
      return 'readOnlyPause';
    case 'limited':
      return 'connectionPause';
    case 'error':
      return 'errorPause';
    case 'unavailable':
      return 'unavailable';
    default:
      return snapshot.downloading ? 'downloading' : undefined;
  }
};

type ClearContentPromptProps = {
  roomId: string;
  onCancel: () => void;
};

function ClearContentPrompt({ roomId, onCancel }: ClearContentPromptProps) {
  const { t } = useTranslation();
  const { offline } = useMindroomSyncEngine();
  const [clearing, setClearing] = useState(false);
  const [failed, setFailed] = useState(false);

  const clear = async () => {
    if (clearing) return;
    setClearing(true);
    setFailed(false);
    try {
      await offline.clear(roomId);
      onCancel();
    } catch {
      setFailed(true);
    } finally {
      setClearing(false);
    }
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: onCancel,
            clickOutsideDeactivates: !clearing,
            escapeDeactivates: clearing ? false : stopPropagation,
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
                <Text size="H4">{t('featureUi.roomSettings.general.offline.clearTitle')}</Text>
              </Box>
              <IconButton
                size="300"
                radii="300"
                onClick={onCancel}
                aria-label={t('featureUi.roomSettings.general.offline.cancel')}
                disabled={clearing}
              >
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              <Box direction="Column" gap="200">
                <Text priority="400">
                  {t('featureUi.roomSettings.general.offline.clearDescription')}
                </Text>
                {failed && (
                  <Text style={{ color: color.Critical.Main }} size="T300">
                    {t('featureUi.roomSettings.general.offline.clearFailed')}
                  </Text>
                )}
              </Box>
              <Box gap="200" justifyContent="End">
                <Button onClick={onCancel} disabled={clearing} fill="Soft" outlined radii="300">
                  <Text size="B400">{t('featureUi.roomSettings.general.offline.cancel')}</Text>
                </Button>
                <Button
                  variant="Critical"
                  onClick={() => void clear()}
                  disabled={clearing}
                  fill="Soft"
                  outlined
                  radii="300"
                >
                  {clearing && <Spinner fill="Soft" variant="Critical" size="200" />}
                  <Text size="B400">
                    {t('featureUi.roomSettings.general.offline.clearConfirm')}
                  </Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function OfflineRoomSettings({ roomId }: OfflineRoomSettingsProps) {
  const { t } = useTranslation();
  const { offline } = useMindroomSyncEngine();
  const snapshot = useOfflineRoomSnapshot(roomId);
  const [includeAllMedia, setIncludeAllMedia] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  const [pinFailed, setPinFailed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const currentStatusKey = statusKey(snapshot);

  const setPinned = async (pinned: boolean) => {
    if (pinPending) return;
    setPinPending(true);
    setPinFailed(false);
    try {
      await offline.setPinned(roomId, pinned);
    } catch {
      setPinFailed(true);
    } finally {
      setPinPending(false);
    }
  };

  const canDownload = snapshot.loaded && snapshot.storageAvailable && !snapshot.downloading;

  return (
    <Box direction="Column" gap="200">
      <Text size="T300" priority="400">
        {t('featureUi.roomSettings.general.offline.title')}
      </Text>
      <Box direction="Column" gap="100">
        {currentStatusKey && (
          <Text priority="400">
            {t(`featureUi.roomSettings.general.offline.${currentStatusKey}`)}
          </Text>
        )}
        {snapshot.loaded && snapshot.storageAvailable && snapshot.opened && (
          <>
            {!snapshot.historyExhausted && (
              <Text>{t('featureUi.roomSettings.general.offline.partialHistory')}</Text>
            )}
            {snapshot.hasGap && (
              <Text>{t('featureUi.roomSettings.general.offline.inaccessibleHistory')}</Text>
            )}
            {snapshot.undecryptedEvents > 0 && (
              <Text>
                {t('featureUi.roomSettings.general.offline.waitingForKeys', {
                  count: snapshot.undecryptedEvents,
                })}
              </Text>
            )}
            {snapshot.unresolvedRelations > 0 && (
              <Text>
                {t('featureUi.roomSettings.general.offline.unresolvedRelations', {
                  count: snapshot.unresolvedRelations,
                })}
              </Text>
            )}
            {snapshot.missingEssential > 0 && (
              <Text>
                {t('featureUi.roomSettings.general.offline.missingEssential', {
                  count: snapshot.missingEssential,
                })}
              </Text>
            )}
            <Text>
              {t('featureUi.roomSettings.general.offline.historyEntries', {
                count: snapshot.savedEvents,
              })}
            </Text>
            <Text>
              {t('featureUi.roomSettings.general.offline.attachments', {
                saved: snapshot.saved,
                missing: snapshot.missing,
              })}
            </Text>
            <Text>
              {t('featureUi.roomSettings.general.offline.storageUsed', {
                size: bytesToSize(snapshot.bytes),
              })}
            </Text>
          </>
        )}
        {pinFailed && (
          <Text style={{ color: color.Critical.Main }}>
            {t('featureUi.roomSettings.general.offline.pinFailed')}
          </Text>
        )}
      </Box>
      <Box alignItems="Center" gap="200">
        <Switch
          variant="Primary"
          value={includeAllMedia}
          onChange={setIncludeAllMedia}
          disabled={!canDownload}
          aria-label={t('featureUi.roomSettings.general.offline.includeAllMedia')}
        />
        <Text>{t('featureUi.roomSettings.general.offline.includeAllMedia')}</Text>
      </Box>
      <Box alignItems="Center" gap="200">
        <Switch
          variant="Primary"
          value={snapshot.pinned}
          onChange={(pinned) => void setPinned(pinned)}
          disabled={!snapshot.loaded || !snapshot.storageAvailable || pinPending}
          aria-label={t('featureUi.roomSettings.general.offline.keepOffline')}
        />
        <Box direction="Column">
          <Text>{t('featureUi.roomSettings.general.offline.keepOffline')}</Text>
          <Text size="T200" priority="300">
            {t('featureUi.roomSettings.general.offline.keepOfflineDescription')}
          </Text>
        </Box>
      </Box>
      <Box gap="100" wrap="Wrap">
        {snapshot.downloading ? (
          <Button
            size="300"
            radii="300"
            variant="Secondary"
            onClick={() => offline.cancel(roomId)}
            fill="Soft"
            outlined
          >
            <Text size="B300">{t('featureUi.roomSettings.general.offline.cancelDownload')}</Text>
          </Button>
        ) : (
          <Button
            size="300"
            radii="300"
            variant="Primary"
            onClick={() => offline.download(roomId, { includeAllMedia })}
            disabled={!canDownload}
            fill="Soft"
            outlined
          >
            <Text size="B300">
              {t('featureUi.roomSettings.general.offline.downloadEntireRoom')}
            </Text>
          </Button>
        )}
        <Button
          size="300"
          radii="300"
          variant="Critical"
          fill="Soft"
          onClick={() => setConfirmClear(true)}
          disabled={!snapshot.loaded}
          outlined
        >
          <Text size="B300">
            {t('featureUi.roomSettings.general.offline.clearDownloadedContent')}
          </Text>
        </Button>
      </Box>
      {confirmClear && (
        <ClearContentPrompt roomId={roomId} onCancel={() => setConfirmClear(false)} />
      )}
    </Box>
  );
}
