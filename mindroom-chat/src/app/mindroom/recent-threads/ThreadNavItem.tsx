import React, { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons, Text, Tooltip, TooltipProvider, toRem } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { NavButton, NavItem, NavItemContent, NavItemOptions } from '../../components/nav';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import type { CrossRoomThreadIndexEntry } from '../cross-room-threads/crossRoomThreadIndex';
import { isMindroomAgentUserId } from '../matrix/agentIdentity';
import { buildCompactThreadCardViewModelFromRecord } from '../threads/compactThreadCardViewModel';
import { useToggleThreadResolution } from '../threads/useRoomThreadTags';
import { usePinnedEventIds } from '../threads/useThreadPinning';
import { useRoomViewMode } from '../threads/useRoomViewMode';
import { useInitializeShownThread } from '../threads/useInitializeShownThread';
import * as css from './threadNav.css';
import { IconTooltip } from '../tooltip/IconTooltip';

type ThreadNavItemProps = {
  entry: CrossRoomThreadIndexEntry;
  onTogglePin: () => void;
  pinned: boolean;
  selected: boolean;
};

type ThreadNavActionsProps = {
  entry: CrossRoomThreadIndexEntry;
  onTogglePin: () => void;
  pinned: boolean;
  room: Room;
};

function ThreadNavActions({ entry, onTogglePin, pinned, room }: ThreadNavActionsProps) {
  const { t } = useTranslation();
  const { canToggle, setResolved, updating, error } = useToggleThreadResolution(room);
  const roomPinned = usePinnedEventIds(room).includes(entry.threadRootId);
  const [pinHovered, setPinHovered] = useState(false);

  useEffect(() => {
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[ThreadNavItem] Resolve failed:', error);
    }
  }, [error]);

  return (
    <NavItemOptions className={css.EntryActions} gap="100">
      {!roomPinned && (
        <IconTooltip label={t('thread.resolve')} position="Top">
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              type="button"
              variant="Background"
              fill="None"
              size="300"
              radii="300"
              aria-label={t('thread.resolve')}
              disabled={!canToggle || updating}
              onClick={() => setResolved(entry.threadRootId, true)}
            >
              <Icon src={Icons.CheckTwice} size="50" aria-hidden="true" />
            </IconButton>
          )}
        </IconTooltip>
      )}
      <IconTooltip label={pinned ? t('threadNav.unpin') : t('threadNav.pin')} position="Top">
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            className={pinned ? css.EntryPinButtonPinned : undefined}
            type="button"
            variant="Background"
            fill="None"
            size="300"
            radii="300"
            aria-label={pinned ? t('threadNav.unpin') : t('threadNav.pin')}
            aria-pressed={pinned}
            onMouseEnter={() => setPinHovered(true)}
            onMouseLeave={() => setPinHovered(false)}
            onFocus={() => setPinHovered(true)}
            onBlur={() => setPinHovered(false)}
            onClick={onTogglePin}
          >
            <Icon src={Icons.Pin} size="50" filled={pinned || pinHovered} aria-hidden="true" />
          </IconButton>
        )}
      </IconTooltip>
    </NavItemOptions>
  );
}

export const ThreadNavItem = memo(
  ({ entry, onTogglePin, pinned, selected }: ThreadNavItemProps) => {
    const { t } = useTranslation();
    const language = useAppLanguageCode();
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const shownRef = useInitializeShownThread(entry.roomId, entry.threadRootId);
    const room = mx.getRoom(entry.roomId);
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
    const relativeTime = useRelativeTime(entry.lastActivityTs);
    const { navigateRoom, navigateRoomThreadDirect } = useRoomNavigate();
    const { viewMode } = useRoomViewMode(entry.roomId);
    const agentNames = useMemo(() => {
      return Array.from(
        new Set(
          (viewModel?.participants ?? [])
            .filter((participant) => isMindroomAgentUserId(participant.userId))
            .map((participant) => participant.displayName)
        )
      );
    }, [viewModel?.participants]);
    const summaryText = viewModel?.displayTitleText ?? entry.summaryText;
    const ariaLabel = [
      t('thread.aria.openThread', { title: summaryText }),
      entry.roomName,
      relativeTime ? t('thread.aria.lastActivity', { time: relativeTime }) : undefined,
      pinned ? t('threadNav.pinned') : undefined,
    ]
      .filter(Boolean)
      .join('. ');

    if (!room || !viewModel) return null;

    return (
      <TooltipProvider
        position="Right"
        align="Center"
        delay={0}
        tooltip={
          <Tooltip className={css.EntryTooltip} style={{ maxWidth: toRem(300) }}>
            <Box direction="Column" gap="200">
              <Text size="H5">{summaryText}</Text>
              <div className={css.EntryTooltipDetails}>
                <Text size="T200" priority="400">
                  {t('threadNav.room')}
                </Text>
                <Text size="T200">{entry.roomName}</Text>
                <Text size="T200" priority="400">
                  {t('threadNav.agents')}
                </Text>
                <Text size="T200">
                  {agentNames.length > 0 ? agentNames.join(', ') : t('threadNav.agentsUnknown')}
                </Text>
                <Text size="T200" priority="400">
                  {t('threadNav.messages')}
                </Text>
                <Text size="T200">{viewModel.messageCountLabel}</Text>
                <Text size="T200" priority="400">
                  {t('threadNav.lastActivity')}
                </Text>
                <Text size="T200">
                  {relativeTime ?? viewModel.lastActivityTitle ?? t('threadNav.unknownActivity')}
                </Text>
              </div>
            </Box>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <div ref={triggerRef} data-sidebar-thread-root-id={entry.threadRootId}>
            <NavItem
              className={css.Entry}
              variant="Background"
              radii="400"
              highlight={entry.isUnread}
              aria-selected={selected}
            >
              <NavButton
                onClick={() => {
                  if (viewMode === 'classic') {
                    navigateRoom(room.roomId, viewModel.id.threadRootId);
                    return;
                  }
                  navigateRoomThreadDirect(room.roomId, viewModel.id.threadRootId);
                }}
                aria-label={ariaLabel}
              >
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Text
                      ref={shownRef}
                      className={css.EntrySummary}
                      priority={entry.isUnread ? '500' : '300'}
                      as="span"
                      size="Inherit"
                      truncate
                    >
                      {summaryText}
                    </Text>
                    {entry.isUnread && <span className={css.EntryUnreadDot} aria-hidden="true" />}
                  </Box>
                </NavItemContent>
              </NavButton>
              <ThreadNavActions
                entry={entry}
                onTogglePin={onTogglePin}
                pinned={pinned}
                room={room}
              />
            </NavItem>
          </div>
        )}
      </TooltipProvider>
    );
  }
);

ThreadNavItem.displayName = 'ThreadNavItem';
