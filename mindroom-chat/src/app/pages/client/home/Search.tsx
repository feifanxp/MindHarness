import { useTranslation } from 'react-i18next';
import React, { useRef } from 'react';
import { Box, Icon, Icons, Text, Scroll, IconButton } from 'folds';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../../components/page';
import { MindroomMessageSearch } from '../../../mindroom/message-search/MindroomMessageSearch';
import { useHomeSearchRooms } from './useHomeRooms';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { MindroomBackRouteHandler as BackRouteHandler } from '../../../mindroom/native/MindroomBackRouteHandler';

export function HomeSearch() {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rooms = useHomeSearchRooms();
  const screenSize = useScreenSizeContext();

  return (
    <Page>
      <PageHeader balance>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Box grow="Yes" basis="No">
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
          <Box justifyContent="Center" alignItems="Center" gap="200">
            {screenSize !== ScreenSize.Mobile && <Icon size="400" src={Icons.Search} />}
            <Text size="H3" truncate>
              {t('sharedUi.search.messageSearch')}
            </Text>
          </Box>
          <Box grow="Yes" basis="No" />
        </Box>
      </PageHeader>
      <Box style={{ position: 'relative' }} grow="Yes">
        <Scroll ref={scrollRef} hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              <MindroomMessageSearch
                defaultRoomsFilterName="Home"
                allowGlobal
                rooms={rooms}
                scrollRef={scrollRef}
              />
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
