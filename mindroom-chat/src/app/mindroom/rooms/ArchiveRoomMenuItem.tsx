import React from 'react';
import { Icon, Icons, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { useRoomArchiveAction } from './useRoomArchiveAction';

export function ArchiveRoomMenuItem({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { archived, busy, failed, toggle } = useRoomArchiveAction(roomId, onClose);

  return (
    <>
      <MenuItem
        onClick={toggle}
        disabled={busy}
        size="300"
        radii="300"
        after={busy ? <Spinner size="100" /> : <Icon size="100" src={Icons.Inbox} />}
      >
        <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
          {t(archived ? 'archivedRooms.restore' : 'archivedRooms.archive')}
        </Text>
      </MenuItem>
      {failed && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {t('archivedRooms.failed')}
        </Text>
      )}
    </>
  );
}
