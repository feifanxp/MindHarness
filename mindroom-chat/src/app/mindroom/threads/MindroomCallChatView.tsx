import { useTranslation } from 'react-i18next';
import React from 'react';
import { Room } from 'matrix-js-sdk';
import { useSetAtom } from 'jotai';
import { Box, Text, TooltipProvider, Tooltip, Icon, Icons, IconButton, toRem } from 'folds';
import { Page, PageHeader } from '../../components/page';
import { callChatAtom } from '../../state/callEmbed';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { RoomView } from './MindroomRoomView';

type MindroomCallChatViewProps = {
  room: Room;
  hasMindroomAgents?: boolean;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  onThreadLoadError?: (threadId: string) => void;
};

export function MindroomCallChatView({
  room,
  hasMindroomAgents = true,
  eventId,
  focusEventInRoom,
  threadId,
  onThreadLoadError,
}: MindroomCallChatViewProps) {
  const { t } = useTranslation();
  const setChat = useSetAtom(callChatAtom);
  const screenSize = useScreenSizeContext();

  const handleClose = () => setChat(false);

  return (
    <Page
      style={{
        width: screenSize === ScreenSize.Desktop ? toRem(456) : '100%',
        flexShrink: 0,
        flexGrow: 0,
      }}
    >
      <PageHeader>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Box grow="Yes">
            <Text size="H5" truncate>
              {t('mindroomUi.threads.mindroomCallChatView.chat')}
            </Text>
          </Box>
          <Box shrink="No" alignItems="Center">
            <TooltipProvider
              position="Bottom"
              align="End"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{t('mindroomUi.threads.mindroomCallChatView.close')}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton ref={triggerRef} variant="Surface" onClick={handleClose}>
                  <Icon src={Icons.Cross} />
                </IconButton>
              )}
            </TooltipProvider>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes" direction="Column">
        <RoomView
          room={room}
          hasMindroomAgents={hasMindroomAgents}
          eventId={eventId}
          focusEventInRoom={focusEventInRoom}
          threadId={threadId}
          onThreadLoadError={onThreadLoadError}
        />
      </Box>
    </Page>
  );
}
