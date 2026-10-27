import React from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoom } from '../../../hooks/useRoom';
import {
  RoomProfile,
  RoomJoinRules,
  RoomLocalAddresses,
  RoomPublishedAddresses,
  RoomPublish,
  RoomUpgrade,
} from '../../common-settings/general';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';

type GeneralProps = {
  requestClose: () => void;
};
export function General({ requestClose }: GeneralProps) {
  const { t } = useTranslation();
  const room = useRoom();
  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader outlined={false}>
            <Box grow="Yes" gap="200">
              <Box grow="Yes" alignItems="Center" gap="200">
                <Text size="H3" truncate>
                  {t('featureUi.spaceSettings.general.general')}
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
            <RoomProfile permissions={permissions} />
            <Box direction="Column" gap="100">
              <Text size="L400">{t('featureUi.spaceSettings.general.options')}</Text>
              <RoomJoinRules permissions={permissions} />
              <RoomPublish permissions={permissions} />
            </Box>
            <Box direction="Column" gap="100">
              <Text size="L400">{t('featureUi.spaceSettings.general.addresses')}</Text>
              <RoomPublishedAddresses permissions={permissions} />
              <RoomLocalAddresses permissions={permissions} />
            </Box>
            <Box direction="Column" gap="100">
              <Text size="L400">{t('featureUi.spaceSettings.general.advancedOptions')}</Text>
              <RoomUpgrade permissions={permissions} requestClose={requestClose} />
            </Box>
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
