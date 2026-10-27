import React from 'react';
import {
  Box,
  config,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { PageScroll } from '../../components/page';
import { Modal, Header } from '../../components/glass/GlassPrimitives';
import { useAllJoinedRoomsSet, useGetRoom } from '../../hooks/useGetRoom';
import { SpaceProvider } from '../../hooks/useSpace';
import { CreateSpaceForm } from './CreateSpace';
import {
  useCloseCreateSpaceModal,
  useCreateSpaceModalState,
} from '../../state/hooks/createSpaceModal';
import { CreateSpaceModalState } from '../../state/createSpaceModal';
import { stopPropagation } from '../../utils/keyboard';

type CreateSpaceModalProps = {
  state: CreateSpaceModalState;
};
function CreateSpaceModal({ state }: CreateSpaceModalProps) {
  const { t } = useTranslation();
  const { spaceId } = state;
  const closeDialog = useCloseCreateSpaceModal();

  const allJoinedRooms = useAllJoinedRoomsSet();
  const getRoom = useGetRoom(allJoinedRooms);
  const space = spaceId ? getRoom(spaceId) : undefined;

  return (
    <SpaceProvider value={space ?? null}>
      <Overlay open backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              clickOutsideDeactivates: true,
              onDeactivate: closeDialog,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Modal size="300" flexHeight>
              <Box direction="Column">
                <PageScroll
                  header={
                    <Header
                      size="500"
                      style={{
                        padding: config.space.S200,
                        paddingInlineStart: config.space.S400,
                        borderBottomWidth: config.borderWidth.B300,
                      }}
                    >
                      <Box grow="Yes">
                        <Text size="H4">
                          {t('featureUi.createSpace.createSpaceModal.newSpace')}
                        </Text>
                      </Box>
                      <Box shrink="No">
                        <IconButton size="300" radii="300" onClick={closeDialog}>
                          <Icon src={Icons.Cross} />
                        </IconButton>
                      </Box>
                    </Header>
                  }
                >
                  <Box
                    style={{
                      padding: config.space.S400,
                      paddingInlineEnd: config.space.S200,
                    }}
                    direction="Column"
                    gap="500"
                  >
                    <CreateSpaceForm space={space} onCreate={closeDialog} />
                  </Box>
                </PageScroll>
              </Box>
            </Modal>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
    </SpaceProvider>
  );
}

export function CreateSpaceModalRenderer() {
  const state = useCreateSpaceModalState();

  if (!state) return null;
  return <CreateSpaceModal state={state} />;
}
