import React, { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Text } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { NavButton, NavItem, NavItemContent } from '../../components/nav';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { bumpRecentThread, rekeyRecentThread } from './recentThreads';
import { useRecentThreadViewModel } from '../threads/recentThreadViewModel';
import { useRoomViewMode } from '../threads/useRoomViewMode';
import { useInitializeShownThread } from '../threads/useInitializeShownThread';
import * as css from './threadNav.css';

type RecentThreadEntryProps = {
  room: Room;
  threadId: string;
  openedAt: number;
  summaryText?: string;
};

export const RecentThreadEntry = memo(
  ({ room, threadId, openedAt, summaryText }: RecentThreadEntryProps) => {
    const { t } = useTranslation();
    const viewModel = useRecentThreadViewModel(room, threadId, openedAt, summaryText);
    const shownRef = useInitializeShownThread(room.roomId, viewModel.id.threadRootId);
    const relativeTime = useRelativeTime(openedAt);
    const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
    const { viewMode } = useRoomViewMode(room.roomId);
    const ariaLabel = [
      t('thread.aria.openThread', { title: viewModel.summaryText }),
      viewModel.roomName,
      relativeTime ? t('recentThreads.openedAt', { time: relativeTime }) : undefined,
    ]
      .filter(Boolean)
      .join('. ');

    useEffect(() => {
      if (!viewModel.shouldRekey) return;

      rekeyRecentThread(room.roomId, viewModel.storedThreadId, viewModel.id.threadRootId);
    }, [room.roomId, viewModel.id.threadRootId, viewModel.shouldRekey, viewModel.storedThreadId]);

    useEffect(() => {
      if (!viewModel.persistableSummaryText) return;
      if (viewModel.persistableSummaryText === summaryText) return;

      bumpRecentThread(
        room.roomId,
        viewModel.id.threadRootId,
        openedAt,
        viewModel.persistableSummaryText
      );
    }, [
      openedAt,
      room.roomId,
      summaryText,
      viewModel.id.threadRootId,
      viewModel.persistableSummaryText,
    ]);

    return (
      <NavItem
        className={css.RecentlyOpenedEntry}
        data-scroll-anchor={`${room.roomId}|${threadId}`}
        variant="Background"
        radii="400"
      >
        <NavButton
          type="button"
          onClick={() => {
            if (viewMode === 'classic') {
              navigateRoom(room.roomId, viewModel.id.threadRootId);
              return;
            }
            navigateRoomThreadDirect(room.roomId, viewModel.id.threadRootId);
          }}
          title={`${viewModel.roomName}: ${viewModel.summaryText}`}
          aria-label={ariaLabel}
        >
          <NavItemContent as="span">
            <Box as="span" grow="Yes" direction="Column" style={{ minWidth: 0 }}>
              <Text as="span" size="T300" truncate ref={shownRef}>
                {viewModel.summaryText}
              </Text>
              <Box as="span" alignItems="Center" justifyContent="SpaceBetween" gap="100">
                <Text as="span" size="T200" priority="300" truncate>
                  {viewModel.roomName}
                </Text>
                {relativeTime && (
                  <Text
                    as="span"
                    size="T200"
                    priority="400"
                    style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                  >
                    {relativeTime}
                  </Text>
                )}
              </Box>
            </Box>
          </NavItemContent>
        </NavButton>
      </NavItem>
    );
  }
);

RecentThreadEntry.displayName = 'RecentThreadEntry';
