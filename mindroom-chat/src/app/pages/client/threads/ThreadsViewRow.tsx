import { useTranslation } from 'react-i18next';
import React, { useMemo } from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import type { CrossRoomThreadIndexEntry } from '../../../mindroom/cross-room-threads/crossRoomThreadIndex';
import { useAppLanguageCode } from '../../../hooks/useAppLanguageCode';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { CompactThreadCard } from '../../../mindroom/threads/CompactThreadCard';
import { buildCompactThreadCardViewModelFromRecord } from '../../../mindroom/threads/compactThreadCardViewModel';
import { useInitializeShownThread } from '../../../mindroom/threads/useInitializeShownThread';
import * as css from './ThreadsView.css';

type ThreadsViewRowProps = {
  entry: CrossRoomThreadIndexEntry;
};

export function ThreadsViewRow({ entry }: ThreadsViewRowProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { navigateRoomThread } = useRoomNavigate();
  const room = mx.getRoom(entry.roomId);
  const shownRef = useInitializeShownThread(entry.roomId, entry.threadRootId);
  const viewModel = useMemo(() => {
    if (!room) return undefined;

    return buildCompactThreadCardViewModelFromRecord({
      record: entry.threadRecord,
      room,
      currentUserId: mx.getUserId() ?? undefined,
      mx,
      useAuthentication,
      t,
      locale: language,
    });
  }, [entry.threadRecord, language, mx, room, t, useAuthentication]);

  if (!room || !viewModel) return null;

  return (
    <Box className={css.Row} ref={shownRef}>
      <Box className={css.RowChrome}>
        <Avatar size="200" radii="400">
          <Icon size="100" src={room.isSpaceRoom?.() ? Icons.Space : Icons.Hash} />
        </Avatar>
        <Box className={css.Chip}>
          <Text size="T200" truncate title={entry.roomName}>
            {entry.roomName}
          </Text>
        </Box>
        {entry.parentSpaceIds.slice(0, 1).map((spaceId) => {
          const space = mx.getRoom(spaceId);
          const spaceName = space?.name ?? spaceId;

          return (
            <Box key={spaceId} className={css.Chip}>
              <Text size="T200" truncate title={spaceName}>
                {spaceName}
              </Text>
            </Box>
          );
        })}
      </Box>
      <CompactThreadCard
        viewModel={viewModel}
        onClick={() => navigateRoomThread(entry.roomId, entry.threadRootId)}
      />
    </Box>
  );
}
