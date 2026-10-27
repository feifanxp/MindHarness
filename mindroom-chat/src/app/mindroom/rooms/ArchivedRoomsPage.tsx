import React from 'react';
import { useAtomValue } from 'jotai';
import { Room } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, Scroll, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader } from '../../components/page';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomName } from '../../hooks/useRoomMeta';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { joinedArchivedRoomsAtom } from './archivedRooms';
import { useRoomArchiveAction } from './useRoomArchiveAction';

export const ARCHIVED_ROOMS_SETTINGS_PAGE = 'archived-rooms';

function ArchivedRoom({ room, onOpen }: { room: Room; onOpen: (roomId: string) => void }) {
  const { t } = useTranslation();
  const name = useRoomName(room);
  const { busy, failed, toggle } = useRoomArchiveAction(room.roomId);

  return (
    <Box as="li" direction="Column" gap="100">
      <Box gap="200" alignItems="Center">
        <Box grow="Yes" style={{ minWidth: 0 }}>
          <Button
            style={{ width: '100%', justifyContent: 'flex-start', minWidth: 0 }}
            onClick={() => onOpen(room.roomId)}
            fill="None"
            variant="Secondary"
            radii="300"
          >
            <Text truncate title={name}>
              {name}
            </Text>
          </Button>
        </Box>
        <Button
          onClick={toggle}
          disabled={busy}
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          aria-label={t('archivedRooms.restoreNamed', { room: name })}
          outlined
        >
          {busy && <Spinner size="100" />}
          <Text size="B300">{t('archivedRooms.restore')}</Text>
        </Button>
      </Box>
      {failed && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {t('archivedRooms.failed')}
        </Text>
      )}
    </Box>
  );
}

export function ArchivedRooms({
  requestClose,
  onNavigate,
}: {
  requestClose: () => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const roomIds = useAtomValue(joinedArchivedRoomsAtom);
  const { navigateRoom } = useRoomNavigate();
  const rooms = roomIds.flatMap((id) => {
    const room = mx.getRoom(id);
    return room && !room.isSpaceRoom() ? [room] : [];
  });
  rooms.sort((a, b) => a.name.localeCompare(b.name));

  const openRoom = (roomId: string) => {
    navigateRoom(roomId);
    onNavigate();
  };

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Box grow="Yes">
            <Text size="H3" truncate>
              {t('archivedRooms.title')}
            </Text>
          </Box>
          <IconButton
            onClick={requestClose}
            variant="Surface"
            aria-label={t('archivedRooms.close')}
          >
            <Icon src={Icons.Cross} />
          </IconButton>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="400">
              <Text>{t('archivedRooms.description')}</Text>
              {rooms.length === 0 ? (
                <Text>{t('archivedRooms.empty')}</Text>
              ) : (
                <Box
                  as="ul"
                  direction="Column"
                  gap="200"
                  style={{ listStyle: 'none', padding: 0, margin: 0 }}
                >
                  {rooms.map((room) => (
                    <ArchivedRoom key={room.roomId} room={room} onOpen={openRoom} />
                  ))}
                </Box>
              )}
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
