import React from 'react';
import { Box, Icon, IconButton, Icons, Scroll, Text, toRem } from 'folds';
import { useAtomValue } from 'jotai';
import { RoomCard } from '../../components/room-card';
import { RoomTopicViewer } from '../../components/room-topic-viewer';
import { Page, PageHeader } from '../../components/page';
import { RoomSummaryLoader } from '../../components/RoomSummaryLoader';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { MindroomBackRouteHandler as BackRouteHandler } from '../../mindroom/native/MindroomBackRouteHandler';
import { AsyncStatus } from '../../hooks/useAsyncCallback';

type JoinBeforeNavigateProps = { roomIdOrAlias: string; eventId?: string; viaServers?: string[] };
export function JoinBeforeNavigate({
  roomIdOrAlias,
  eventId,
  viaServers,
}: JoinBeforeNavigateProps) {
  const mx = useMatrixClient();
  const allRooms = useAtomValue(allRoomsAtom);
  const { navigateRoom, navigateSpace } = useRoomNavigate();
  const screenSize = useScreenSizeContext();

  const handleView = (roomId: string) => {
    if (mx.getRoom(roomId)?.isSpaceRoom()) {
      navigateSpace(roomId);
      return;
    }
    navigateRoom(roomId, eventId);
  };

  return (
    <Page>
      <PageHeader balance>
        <Box grow="Yes" gap="200">
          <Box shrink="No">
            {screenSize === ScreenSize.Mobile && (
              <BackRouteHandler>
                {(onBack) => (
                  <IconButton onClick={onBack}>
                    <Icon data-directional src={Icons.ArrowLeft} />
                  </IconButton>
                )}
              </BackRouteHandler>
            )}
          </Box>
          <Box grow="Yes" justifyContent="Center" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              {roomIdOrAlias}
            </Text>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover" size="0">
          <Box style={{ height: '100%' }} grow="Yes" alignItems="Center" justifyContent="Center">
            <RoomSummaryLoader roomIdOrAlias={roomIdOrAlias} viaServers={viaServers}>
              {(summaryState, retrySummary, resolvedViaServers, resolvedRoomId) => {
                const summary =
                  summaryState.status === AsyncStatus.Success ? summaryState.data : undefined;
                return (
                  <RoomCard
                    style={{ maxWidth: toRem(364), width: '100%' }}
                    roomIdOrAlias={roomIdOrAlias}
                    roomId={summary?.room_id ?? resolvedRoomId}
                    allRooms={allRooms}
                    avatarUrl={summary?.avatar_url}
                    name={summary?.name}
                    topic={summary?.topic}
                    memberCount={summary?.num_joined_members}
                    roomType={summary?.room_type}
                    joinRule={summary?.join_rule}
                    membership={summary?.membership}
                    accessStatus={summaryState.status}
                    onAccessRetry={retrySummary}
                    viaServers={resolvedViaServers ?? viaServers}
                    renderTopicViewer={(name, topic, requestClose) => (
                      <RoomTopicViewer name={name} topic={topic} requestClose={requestClose} />
                    )}
                    onView={handleView}
                  />
                );
              }}
            </RoomSummaryLoader>
          </Box>
        </Scroll>
      </Box>
    </Page>
  );
}
