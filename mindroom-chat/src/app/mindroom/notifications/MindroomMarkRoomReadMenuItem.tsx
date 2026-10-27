import { useTranslation } from 'react-i18next';
import React, { useCallback } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Icon, Icons, Text } from 'folds';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { markRoomAndThreadsAsRead } from './readReceipts';

type MindroomMarkRoomReadMenuItemProps = {
  onClose: () => void;
  room: Room;
};

export function MindroomMarkRoomReadMenuItem({ onClose, room }: MindroomMarkRoomReadMenuItemProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');

  const handleMarkAsRead = useCallback(() => {
    void markRoomAndThreadsAsRead(mx, room.roomId, hideActivity);
    onClose();
  }, [hideActivity, mx, onClose, room.roomId]);

  return (
    <MenuItem
      onClick={handleMarkAsRead}
      size="300"
      after={<Icon size="100" src={Icons.CheckTwice} />}
      radii="300"
    >
      <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
        {t('mindroomUi.notifications.mindroomMarkRoomReadMenuItem.markAsRead')}
      </Text>
    </MenuItem>
  );
}
