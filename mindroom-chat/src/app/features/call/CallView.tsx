import React, { RefObject, useRef } from 'react';
import { Badge, Box, color, Icon, IconButton, Icons, Scroll, Text, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/glass/GlassPrimitives';
import { useCallEmbed, useCallJoined, useCallEmbedPlacementSync } from '../../hooks/useCallEmbed';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { PrescreenControls } from './PrescreenControls';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { StateEvent } from '../../../types/matrix/room';
import { useCallMembers, useCallSession } from '../../hooks/useCall';
import { CallMemberRenderer } from './CallMemberCard';
import * as css from './styles.css';
import { CallControls } from './CallControls';
import { useLivekitSupport } from '../../hooks/useLivekitSupport';
import { webRTCSupported } from '../../utils/rtc';
import { useCallFailureNotice } from '../../mindroom/calls/useCallFailureNotice';
import { useCallFailureDismissal } from '../../mindroom/calls/useCallFailureDismissal';

function LivekitServerMissingMessage() {
  const { t } = useTranslation();
  return (
    <Text style={{ margin: 'auto', color: color.Critical.Main }} size="L400" align="Center">
      {t('featureUi.call.callView.yourHomeserverDoesNotSupportCalling')}
    </Text>
  );
}

function WebRTCMissingError() {
  const { t } = useTranslation();
  return (
    <Text style={{ margin: 'auto', color: color.Critical.Main }} size="L400" align="Center">
      {t('featureUi.call.callView.yourBrowserDoesNotSupportWebrtcWhich')}
    </Text>
  );
}

function JoinMessage({
  hasParticipant,
  livekitSupported,
  rtcSupported,
}: {
  hasParticipant?: boolean;
  livekitSupported?: boolean;
  rtcSupported?: boolean;
}) {
  const { t } = useTranslation();
  if (rtcSupported === false) {
    return <WebRTCMissingError />;
  }

  if (livekitSupported === false) {
    return <LivekitServerMissingMessage />;
  }

  if (hasParticipant) return null;

  return (
    <Text style={{ margin: 'auto' }} size="L400" align="Center">
      {t('featureUi.call.callView.voiceChatSEmptyBeTheFirst')}
    </Text>
  );
}

function NoPermissionMessage() {
  const { t } = useTranslation();
  return (
    <Text style={{ margin: 'auto' }} size="L400" align="Center">
      {t('featureUi.call.callView.youDonTHavePermissionToJoin')}
    </Text>
  );
}

function AlreadyInCallMessage() {
  const { t } = useTranslation();
  return (
    <Text style={{ margin: 'auto', color: color.Warning.Main }} size="L400" align="Center">
      {t('featureUi.call.callView.alreadyInAnotherCallEndTheCurrent')}
    </Text>
  );
}

function CallPrescreen() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const room = useRoom();
  const livekitSupported = useLivekitSupport();
  const rtcSupported = webRTCSupported();

  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const hasPermission = permissions.stateEvent(
    StateEvent.GroupCallMemberPrefix,
    mx.getSafeUserId()
  );

  const callSession = useCallSession(room);
  const callMembers = useCallMembers(callSession);
  const hasParticipant = callMembers.length > 0;

  const callEmbed = useCallEmbed();
  const inOtherCall = callEmbed && callEmbed.roomId !== room.roomId;

  const canJoin = hasPermission && livekitSupported && rtcSupported;

  return (
    <Scroll variant="Surface" hideTrack>
      <Box className={css.CallViewContent} alignItems="Center" justifyContent="Center">
        <Box style={{ maxWidth: toRem(382), width: '100%' }} direction="Column" gap="100">
          {hasParticipant && (
            <Header size="300" appearance="plain">
              <Box grow="Yes" alignItems="Center">
                <Text size="L400">{t('featureUi.call.callView.participant')}</Text>
              </Box>
              <Badge variant="Critical" fill="Solid" size="400">
                <Text as="span" size="L400" truncate>
                  {t('featureUi.call.liveCount', { count: callMembers.length })}
                </Text>
              </Badge>
            </Header>
          )}
          <CallMemberRenderer members={callMembers} />
          <PrescreenControls canJoin={canJoin} />
          <Box className={css.PrescreenMessage} alignItems="Center">
            {!inOtherCall &&
              (hasPermission ? (
                <JoinMessage
                  hasParticipant={hasParticipant}
                  livekitSupported={livekitSupported}
                  rtcSupported={rtcSupported}
                />
              ) : (
                <NoPermissionMessage />
              ))}
            {inOtherCall && <AlreadyInCallMessage />}
          </Box>
        </Box>
      </Box>
    </Scroll>
  );
}

type CallJoinedProps = {
  containerRef: RefObject<HTMLDivElement>;
  joined: boolean;
};
function CallJoined({ joined, containerRef }: CallJoinedProps) {
  const { t } = useTranslation();
  const callEmbed = useCallEmbed();
  const callFailure = useCallFailureNotice(useRoom(), joined, callEmbed?.startedAfterTs);
  const { visibleFailure, dismissFailure } = useCallFailureDismissal(joined, callFailure);

  return (
    <Box className={css.CallJoined} grow="Yes" direction="Column">
      {visibleFailure && (
        <Box
          className={css.CallFailureBanner}
          style={{
            backgroundColor: color.Critical.Container,
            color: color.Critical.OnContainer,
          }}
          role="alert"
          alignItems="Start"
          gap="300"
        >
          <Box grow="Yes" direction="Column" gap="100">
            <Text size="B400">{t('featureUi.call.callView.voiceCallError')}</Text>
            <Text size="T300">{visibleFailure.message}</Text>
          </Box>
          <IconButton
            aria-label={t('featureUi.call.callView.dismissVoiceCallError')}
            size="300"
            radii="300"
            onClick={dismissFailure}
          >
            <Icon src={Icons.Cross} size="100" />
          </IconButton>
        </Box>
      )}
      <Box grow="Yes" ref={containerRef} />
      {callEmbed && joined && <CallControls callEmbed={callEmbed} />}
    </Box>
  );
}

export function CallView() {
  const room = useRoom();
  const callContainerRef = useRef<HTMLDivElement>(null);
  useCallEmbedPlacementSync(callContainerRef);

  const callEmbed = useCallEmbed();
  const callJoined = useCallJoined(callEmbed);

  const currentJoined = callEmbed?.roomId === room.roomId && callJoined;

  return (
    <Box
      className={ContainerColor({ variant: 'Surface' })}
      style={{ minWidth: toRem(280) }}
      grow="Yes"
    >
      {!currentJoined && <CallPrescreen />}
      <CallJoined joined={currentJoined} containerRef={callContainerRef} />
    </Box>
  );
}
