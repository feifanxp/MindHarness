import React, { useState } from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { ImagePack } from '../../../plugins/custom-emoji';
import { ImagePackView } from '../../../components/image-pack-view';
import { RoomPacks } from './RoomPacks';

type EmojisStickersProps = {
  requestClose: () => void;
};
export function EmojisStickers({ requestClose }: EmojisStickersProps) {
  const { t } = useTranslation();
  const [imagePack, setImagePack] = useState<ImagePack>();

  const handleImagePackViewClose = () => {
    setImagePack(undefined);
  };

  if (imagePack) {
    return <ImagePackView address={imagePack.address} requestClose={handleImagePackViewClose} />;
  }

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader outlined={false}>
            <Box grow="Yes" gap="200">
              <Box grow="Yes" alignItems="Center" gap="200">
                <Text size="H3" truncate>
                  {t('featureUi.commonSettings.emojisStickers.emojisStickers')}
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
            <RoomPacks onViewPack={setImagePack} />
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
