import { useTranslation } from 'react-i18next';
import React, { useCallback } from 'react';
import { Chip, Icon, Icons, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { markRoomAndThreadsAsRead } from './readReceipts';

type MindroomMarkRoomReadChipProps = {
  roomId: string;
};

export function MindroomMarkRoomReadChip({ roomId }: MindroomMarkRoomReadChipProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');

  const handleMarkAsRead = useCallback(() => {
    void markRoomAndThreadsAsRead(mx, roomId, hideActivity);
  }, [hideActivity, mx, roomId]);

  return (
    <Chip
      variant="Primary"
      radii="Pill"
      onClick={handleMarkAsRead}
      before={<Icon size="100" src={Icons.CheckTwice} />}
    >
      <Text size="T200">{t('mindroomUi.notifications.mindroomMarkRoomReadChip.markAsRead')}</Text>
    </Chip>
  );
}
