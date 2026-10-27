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
import { CreateRoomForm } from './CreateRoom';
import {
  useCloseCreateRoomModal,
  useCreateRoomModalState,
} from '../../state/hooks/createRoomModal';
import { CreateRoomModalState } from '../../state/createRoomModal';
import { stopPropagation } from '../../utils/keyboard';
import { CreateRoomType } from '../../components/create-room/types';

type CreateRoomModalProps = {
  state: CreateRoomModalState;
};
function CreateRoomModal({ state }: CreateRoomModalProps) {
  const { t } = useTranslation();
  const { spaceId, type } = state;
  const closeDialog = useCloseCreateRoomModal();

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
                      }}
                    >
                      <Box grow="Yes">
                        <Text size="H4">
                          {type === CreateRoomType.VoiceRoom
                            ? t('featureUi.createRoom.newVoiceRoom')
                            : t('featureUi.createRoom.newChatRoom')}
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
                    <CreateRoomForm space={space} onCreate={closeDialog} defaultType={type} />
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

export function CreateRoomModalRenderer() {
  const state = useCreateRoomModalState();

  if (!state) return null;
  return <CreateRoomModal state={state} />;
}
