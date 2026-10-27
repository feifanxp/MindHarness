import React, { useMemo } from 'react';
import { Avatar, Box, Icon, Icons, Text, as, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { IconCalendarEvent } from '@tabler/icons-react';
import type { EventTimelineSet } from 'matrix-js-sdk/lib/models/event-timeline-set';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { UserAvatar } from '../../components/user-avatar';
import { useThreadResolution } from './useRoomThreadTags';
import { useThreadLastActivityTs } from './useThreadLastActivityTs';
import { useThreadScheduledTasks } from './useThreadScheduledTasks';
import { useThreadStreamingState } from './useThreadStreamingState';
import { getThreadUnread } from './roomThreadList';
import { getThreadRootReplyCount } from './threadIndicatorViewModel';
import * as css from './ThreadIndicator.css';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { ThreadStreamingDot } from './ThreadStreamingDot';
import { useInitializeShownThread } from './useInitializeShownThread';

type ThreadIndicatorViewProps = {
  className?: string;
  threadReplyCount?: number;
  threadParticipantIds?: string[];
  room: Room;
  isResolved?: boolean;
  threadRootId?: string;
  scheduledCount?: number;
  timelineSet?: EventTimelineSet | undefined;
};

type ThreadIndicatorProps = ThreadIndicatorViewProps;

const ThreadIndicatorView = as<'div', ThreadIndicatorViewProps>(
  (
    {
      className,
      threadReplyCount,
      threadParticipantIds,
      room,
      isResolved,
      threadRootId,
      scheduledCount,
      timelineSet,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const language = useAppLanguageCode();
    const mx = useMatrixClient();
    const shownRef = useInitializeShownThread(room.roomId, threadRootId);
    const useAuthentication = useMediaAuthentication();
    const lastActivityTs = useThreadLastActivityTs(room, threadRootId);
    const relativeTime = useRelativeTime(lastActivityTs);
    const isStreaming = useThreadStreamingState(room, threadRootId);
    const threadRootEvent = useMemo(() => {
      if (!threadRootId) return undefined;
      return timelineSet?.findEventById(threadRootId) ?? room.findEventById(threadRootId);
    }, [timelineSet, room, threadRootId]);
    const resolvedThreadReplyCount = threadReplyCount ?? getThreadRootReplyCount(threadRootEvent);
    const isUnread = useMemo(() => {
      if (!threadRootId) return false;
      const thread = room.getThread(threadRootId);
      if (!thread) return false;
      const userId = mx.getUserId();
      if (!userId) return false;
      return getThreadUnread(thread, userId);
    }, [room, threadRootId, mx]);
    const pendingScheduledCount = useThreadScheduledTasks(room, threadRootId);
    const resolvedScheduledCount = scheduledCount ?? pendingScheduledCount;
    const lastActivityTitle = useMemo(
      () =>
        lastActivityTs !== undefined
          ? new Date(lastActivityTs).toLocaleString(language)
          : undefined,
      [language, lastActivityTs]
    );
    const scheduledTaskLabel = useMemo(() => {
      if (resolvedScheduledCount <= 0) return undefined;
      return t('mindroomUi.threads.threadIndicator.pendingScheduledTasks', {
        count: resolvedScheduledCount,
      });
    }, [resolvedScheduledCount, t]);

    const threadParticipants = useMemo(() => {
      if (!room || !threadParticipantIds?.length) return [];
      return threadParticipantIds.slice(0, 3).map((userId) => {
        const displayName =
          getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
        const avatarMxc = getMemberAvatarMxc(room, userId);
        return {
          userId,
          displayName,
          avatarUrl: avatarMxc
            ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 32, 32, 'crop') ?? undefined
            : undefined,
        };
      });
    }, [mx, room, threadParticipantIds, useAuthentication]);

    return (
      <Box
        shrink="No"
        className={classNames(
          css.ThreadIndicator,
          isResolved && css.ThreadIndicatorResolved,
          className
        )}
        alignItems="Center"
        gap="100"
        data-thread-resolved={isResolved || undefined}
        {...props}
        ref={ref}
      >
        {threadParticipants.length > 0 && (
          <Box className={css.ThreadParticipants} alignItems="Center">
            {threadParticipants.map((participant, index) => (
              <Avatar
                key={participant.userId}
                className={css.ThreadParticipant}
                size="200"
                radii="400"
                style={
                  index === 0
                    ? { zIndex: threadParticipants.length - index }
                    : {
                        marginInlineStart: toRem(-6),
                        zIndex: threadParticipants.length - index,
                      }
                }
              >
                <UserAvatar
                  userId={participant.userId}
                  src={participant.avatarUrl}
                  alt={participant.displayName}
                  renderFallback={() => <Icon size="100" src={Icons.User} filled />}
                />
              </Avatar>
            ))}
          </Box>
        )}
        {isResolved && <Icon size="100" src={Icons.CheckTwice} />}
        <Icon size="100" src={Icons.Thread} />
        <Text size="T200" ref={shownRef}>
          {t('thread.chip')}
        </Text>
        {isResolved && <Text size="T200">{t('thread.resolved')}</Text>}
        {isUnread && (
          <span
            className={css.ThreadUnreadDot}
            role="img"
            aria-label={t('thread.aria.unreadMessages')}
          />
        )}
        {typeof resolvedThreadReplyCount === 'number' && (
          <Text size="T200">{t('thread.replyCount', { count: resolvedThreadReplyCount })}</Text>
        )}
        {(relativeTime || isStreaming || resolvedScheduledCount > 0) && (
          <Box as="span" className={css.ThreadActivity} alignItems="Center" gap="100">
            <Text as="span" size="T200" className={css.ThreadSeparator} aria-hidden="true">
              |
            </Text>
            {relativeTime && (
              <Text
                as="span"
                size="T200"
                className={css.ThreadTimestamp}
                aria-label={
                  lastActivityTitle
                    ? t('thread.aria.lastActivity', { time: lastActivityTitle })
                    : undefined
                }
                title={lastActivityTitle}
              >
                {relativeTime}
              </Text>
            )}
            {isStreaming && (
              <ThreadStreamingDot role="img" aria-label={t('thread.aria.agentStreaming')} />
            )}
            {resolvedScheduledCount > 0 && scheduledTaskLabel && (
              <Box
                as="span"
                className={css.ThreadScheduledIndicator}
                alignItems="Center"
                gap="100"
                role="img"
                aria-label={scheduledTaskLabel}
                title={scheduledTaskLabel}
              >
                <IconCalendarEvent
                  size={12}
                  stroke={1.8}
                  className={css.ThreadScheduledIcon}
                  aria-hidden="true"
                />
                <Text as="span" size="T200" aria-hidden="true">
                  {resolvedScheduledCount}
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    );
  }
);

const ResolvedThreadIndicator = as<'div', ThreadIndicatorProps>((props, ref) => {
  const { isResolved } = useThreadResolution(props.room, props.threadRootId);
  return <ThreadIndicatorView {...props} isResolved={isResolved} ref={ref} />;
});

export const ThreadIndicator = as<'div', ThreadIndicatorProps>((props, ref) => {
  if (props.isResolved !== undefined || !props.threadRootId) {
    return <ThreadIndicatorView {...props} ref={ref} />;
  }

  return <ResolvedThreadIndicator {...props} ref={ref} />;
});
