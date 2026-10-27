import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, color, Icon, IconButton, Icons, Spinner, Text } from 'folds';
import classNames from 'classnames';
import { LiveChip } from './LiveChip';
import * as css from './styles.css';
import { CallRoomName } from './CallRoomName';
import { CallControl } from './CallControl';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { useCallMembers, useCallSession } from '../../hooks/useCall';
import { ScreenSize, useScreenSize } from '../../hooks/useScreenSize';
import { MemberGlance } from './MemberGlance';
import { StatusDivider } from './components';
import { CallEmbed } from '../../plugins/call/CallEmbed';
import { useCallJoined } from '../../hooks/useCallEmbed';
import { useCallSpeakers } from '../../hooks/useCallSpeakers';
import { MemberSpeaking } from './MemberSpeaking';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useCallFailureNotice } from '../../mindroom/calls/useCallFailureNotice';
import { useCallFailureDismissal } from '../../mindroom/calls/useCallFailureDismissal';

type CallStatusProps = {
  callEmbed: CallEmbed;
};
export function CallStatus({ callEmbed }: CallStatusProps) {
  const { t } = useTranslation();
  const { room } = callEmbed;
  const selectedRoom = useSelectedRoom();

  const callSession = useCallSession(room);
  const callMembers = useCallMembers(callSession);
  const screenSize = useScreenSize();
  const callJoined = useCallJoined(callEmbed);
  const speakers = useCallSpeakers(callEmbed);
  const callFailure = useCallFailureNotice(room, callJoined, callEmbed.startedAfterTs);
  const { visibleFailure, dismissFailure } = useCallFailureDismissal(callJoined, callFailure);

  const compact = screenSize === ScreenSize.Mobile;

  const memberVisible = callJoined && callMembers.length > 0;

  const statusBar = (
    <Box
      className={classNames(css.CallStatus, ContainerColor({ variant: 'Background' }))}
      shrink="No"
      gap="400"
      alignItems={compact ? undefined : 'Center'}
      direction={compact ? 'Column' : 'Row'}
    >
      <Box grow="Yes" alignItems="Center" gap="200">
        {memberVisible ? (
          <Box shrink="No">
            <LiveChip count={callMembers.length} room={room} members={callMembers} />
          </Box>
        ) : (
          <Spinner variant="Secondary" size="200" />
        )}
        <Box grow="Yes" alignItems="Center" gap="Inherit">
          {!compact && (
            <>
              <CallRoomName room={room} />
              {speakers.size > 0 && (
                <>
                  <StatusDivider />
                  <span data-spacing-node />
                  <MemberSpeaking room={room} speakers={speakers} />
                </>
              )}
            </>
          )}
        </Box>
        {memberVisible && (
          <Box shrink="No">
            <MemberGlance room={room} members={callMembers} speakers={speakers} />
          </Box>
        )}
      </Box>
      {memberVisible && !compact && <StatusDivider />}
      <Box shrink="No" alignItems="Center" gap="Inherit">
        {compact && (
          <Box grow="Yes">
            <CallRoomName room={room} />
          </Box>
        )}
        <CallControl callJoined={callJoined} compact={compact} callEmbed={callEmbed} />
      </Box>
    </Box>
  );
  // The call view shows the agent's failure notices; the bar shows them while the user is elsewhere.
  if (!visibleFailure || selectedRoom === room.roomId) return statusBar;

  return (
    <>
      <Box
        className={css.CallStatus}
        style={{ backgroundColor: color.Critical.Container, color: color.Critical.OnContainer }}
        role="alert"
        shrink="No"
        alignItems="Center"
        gap="200"
      >
        <Text size="T300" style={{ flexGrow: 1 }}>
          {visibleFailure.message}
        </Text>
        <IconButton
          aria-label={t('featureUi.call.callView.dismissVoiceCallError')}
          size="300"
          radii="300"
          onClick={dismissFailure}
        >
          <Icon src={Icons.Cross} size="100" />
        </IconButton>
      </Box>
      {statusBar}
    </>
  );
}
