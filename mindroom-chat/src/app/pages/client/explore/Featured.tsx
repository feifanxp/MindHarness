import { useTranslation } from 'react-i18next';
import React from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { RoomCard, RoomCardGrid } from '../../../components/room-card';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { RoomSummaryLoader } from '../../../components/RoomSummaryLoader';
import {
  Page,
  PageContent,
  PageContentCenter,
  PageHeader,
  PageScroll,
  PageHero,
  PageHeroSection,
} from '../../../components/page';
import { RoomTopicViewer } from '../../../components/room-topic-viewer';
import * as css from './style.css';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { MindroomBackRouteHandler as BackRouteHandler } from '../../../mindroom/native/MindroomBackRouteHandler';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';

export function FeaturedRooms() {
  const { t } = useTranslation();
  const { featuredCommunities } = useClientConfig();
  const { rooms, spaces } = featuredCommunities ?? {};
  const allRooms = useAtomValue(allRoomsAtom);
  const screenSize = useScreenSizeContext();
  const { navigateSpace, navigateRoom } = useRoomNavigate();

  return (
    <Page>
      <PageScroll
        header={
          screenSize === ScreenSize.Mobile && (
            <PageHeader flat>
              <Box shrink="No">
                <BackRouteHandler>
                  {(onBack) => (
                    <IconButton onClick={onBack}>
                      <Icon data-directional src={Icons.ArrowLeft} />
                    </IconButton>
                  )}
                </BackRouteHandler>
              </Box>
            </PageHeader>
          )
        }
      >
        <PageContent>
          <PageContentCenter>
            <Box direction="Column" gap="200">
              <PageHeroSection>
                <PageHero
                  icon={<Icon size="600" src={Icons.Bulb} />}
                  title={t('sharedUi.featured.featuredByClient')}
                  subTitle={t(
                    'sharedUi.featured.findAndExplorePublicRoomsAndSpacesFeaturedByClientProvider'
                  )}
                />
              </PageHeroSection>
              <Box direction="Column" gap="700">
                {spaces && spaces.length > 0 && (
                  <Box direction="Column" gap="400">
                    <Text size="H4">{t('sharedUi.featured.featuredSpaces')}</Text>
                    <RoomCardGrid>
                      {spaces.map((roomIdOrAlias) => (
                        <RoomSummaryLoader key={roomIdOrAlias} roomIdOrAlias={roomIdOrAlias}>
                          {(summaryState, retrySummary, viaServers, resolvedRoomId) => {
                            const roomSummary =
                              summaryState.status === AsyncStatus.Success
                                ? summaryState.data
                                : undefined;
                            return (
                              <RoomCard
                                roomIdOrAlias={roomIdOrAlias}
                                roomId={roomSummary?.room_id ?? resolvedRoomId}
                                allRooms={allRooms}
                                avatarUrl={roomSummary?.avatar_url}
                                name={roomSummary?.name}
                                topic={roomSummary?.topic}
                                memberCount={roomSummary?.num_joined_members}
                                joinRule={roomSummary?.join_rule}
                                membership={roomSummary?.membership}
                                viaServers={viaServers}
                                accessStatus={summaryState.status}
                                onAccessRetry={retrySummary}
                                onView={navigateSpace}
                                renderTopicViewer={(name, topic, requestClose) => (
                                  <RoomTopicViewer
                                    name={name}
                                    topic={topic}
                                    requestClose={requestClose}
                                  />
                                )}
                              />
                            );
                          }}
                        </RoomSummaryLoader>
                      ))}
                    </RoomCardGrid>
                  </Box>
                )}
                {rooms && rooms.length > 0 && (
                  <Box direction="Column" gap="400">
                    <Text size="H4">{t('sharedUi.featured.featuredRooms')}</Text>
                    <RoomCardGrid>
                      {rooms.map((roomIdOrAlias) => (
                        <RoomSummaryLoader key={roomIdOrAlias} roomIdOrAlias={roomIdOrAlias}>
                          {(summaryState, retrySummary, viaServers, resolvedRoomId) => {
                            const roomSummary =
                              summaryState.status === AsyncStatus.Success
                                ? summaryState.data
                                : undefined;
                            return (
                              <RoomCard
                                roomIdOrAlias={roomIdOrAlias}
                                roomId={roomSummary?.room_id ?? resolvedRoomId}
                                allRooms={allRooms}
                                avatarUrl={roomSummary?.avatar_url}
                                name={roomSummary?.name}
                                topic={roomSummary?.topic}
                                memberCount={roomSummary?.num_joined_members}
                                joinRule={roomSummary?.join_rule}
                                membership={roomSummary?.membership}
                                viaServers={viaServers}
                                accessStatus={summaryState.status}
                                onAccessRetry={retrySummary}
                                onView={navigateRoom}
                                renderTopicViewer={(name, topic, requestClose) => (
                                  <RoomTopicViewer
                                    name={name}
                                    topic={topic}
                                    requestClose={requestClose}
                                  />
                                )}
                              />
                            );
                          }}
                        </RoomSummaryLoader>
                      ))}
                    </RoomCardGrid>
                  </Box>
                )}
                {((spaces && spaces.length === 0 && rooms && rooms.length === 0) ||
                  (!spaces && !rooms)) && (
                  <Box
                    className={css.RoomsInfoCard}
                    direction="Column"
                    justifyContent="Center"
                    alignItems="Center"
                    gap="200"
                  >
                    <Icon size="400" src={Icons.Info} />
                    <Text size="T300" align="Center">
                      {t('sharedUi.featured.noRoomsOrSpacesFeaturedByClientProvider')}
                    </Text>
                  </Box>
                )}
              </Box>
            </Box>
          </PageContentCenter>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
