import { useTranslation } from 'react-i18next';
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, color, Icon, Icons, Spinner, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { getRoomSearchParams } from '../../pages/pathSearchParam';
import { useCloseUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import { hasMindroomVoiceCallsPresence, toAgentCallOrigin } from './agentCall';
import { useStartAgentCall } from './useStartAgentCall';
import { localizeVoiceErrorMessage } from '../voice/voiceErrorMessage';

type AgentCallButtonProps = {
  roomId: string;
  userId: string;
  displayName?: string;
  presenceStatus?: string;
};

export function AgentCallButton({
  roomId,
  userId,
  displayName,
  presenceStatus,
}: AgentCallButtonProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const closeUserRoomProfile = useCloseUserRoomProfile();
  const selectedRoomId = useSelectedRoom();
  const [searchParams] = useSearchParams();
  const { threadId } = getRoomSearchParams(searchParams);
  const { startAgentCall, loading, error, unavailableReason } = useStartAgentCall();

  if (
    !isMindroomAgentUserIdForViewer(userId, mx.getUserId() ?? undefined) ||
    !hasMindroomVoiceCallsPresence(presenceStatus)
  ) {
    return null;
  }

  const handleCall = async () => {
    const origin = toAgentCallOrigin(roomId, selectedRoomId === roomId ? threadId : undefined);
    if (await startAgentCall({ userId, displayName }, origin)) closeUserRoomProfile();
  };

  return (
    <Box direction="Column" gap="100" shrink="No">
      <Button
        size="300"
        variant="Primary"
        fill="Soft"
        radii="300"
        before={
          loading ? (
            <Spinner variant="Primary" fill="Soft" size="100" />
          ) : (
            <Icon size="50" src={Icons.Phone} filled />
          )
        }
        onClick={handleCall}
        disabled={loading || !!unavailableReason}
        title={unavailableReason}
        outlined
      >
        <Text size="B300">{t('mindroomUi.calls.agentCallButton.call')}</Text>
      </Button>
      {error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {localizeVoiceErrorMessage(t, error, t('mindroomUi.calls.agentCallButton.failedToStart'))}
        </Text>
      )}
    </Box>
  );
}
