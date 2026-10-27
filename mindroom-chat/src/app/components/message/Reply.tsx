import { Box, Icon, Icons, Text, as, color, toRem } from 'folds';
import React, { MouseEventHandler, ReactNode, useCallback, useMemo } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { EventTimelineSet } from 'matrix-js-sdk/lib/models/event-timeline-set';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { getMemberDisplayName, trimReplyFromBody } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import { LinePlaceholder } from './placeholder';
import { randomNumberBetween } from '../../utils/common';
import * as css from './Reply.css';
import { MessageBadEncryptedContent, MessageDeletedContent, MessageFailedContent } from './content';
import { scaleSystemEmoji } from '../../plugins/react-custom-html-parser';
import colorMXID from '../../../util/colorMXID';
import { getReplyPreviewText } from '../../mindroom/threads/threadMessagePreview';
import { GetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import {
  MindroomReplyThreadIndicator,
  useMindroomReplyEvent,
} from '../../mindroom/messages/replyExtensions';

type ReplyLayoutProps = {
  userColor?: string;
  username?: ReactNode;
};
export const ReplyLayout = as<'div', ReplyLayoutProps>(
  ({ username, userColor, className, children, ...props }, ref) => (
    <Box
      className={classNames(css.Reply, className)}
      alignItems="Center"
      gap="100"
      {...props}
      ref={ref}
    >
      <Box style={{ color: userColor, maxWidth: toRem(200) }} alignItems="Center" shrink="No">
        <Icon size="100" src={Icons.ReplyArrow} />
        {username}
      </Box>
      <Box grow="Yes" className={css.ReplyContent}>
        {children}
      </Box>
    </Box>
  )
);

type ReplyProps = {
  room: Room;
  timelineSet?: EventTimelineSet | undefined;
  replyEventId: string;
  threadRootId?: string | undefined;
  getLocally?: (() => MatrixEvent | undefined) | undefined;
  hideThreadIndicator?: boolean;
  onClick?: MouseEventHandler | undefined;
  getMemberPowerTag?: GetMemberPowerTag;
  accessibleTagColors?: Map<string, string>;
  legacyUsernameColor?: boolean;
};

export const Reply = as<'div', ReplyProps>(
  (
    {
      room,
      timelineSet,
      replyEventId,
      threadRootId,
      getLocally,
      hideThreadIndicator,
      onClick,
      getMemberPowerTag,
      accessibleTagColors,
      legacyUsernameColor,
      ...props
    },
    ref
  ) => {
    const placeholderWidth = useMemo(() => randomNumberBetween(40, 400), []);
    const getFromLocalTimeline = useCallback(
      () =>
        getLocally?.() ??
        timelineSet?.findEventById(replyEventId) ??
        room.findEventById(replyEventId),
      [getLocally, room, timelineSet, replyEventId]
    );
    const replyEvent = useMindroomReplyEvent(
      room,
      replyEventId,
      getFromLocalTimeline,
      threadRootId
    );

    const { t } = useTranslation();
    const replyContent = replyEvent?.getContent();
    const { body } = replyContent ?? {};
    // Not memoized: room members load lazily, and the body analysis is cached.
    const preview = getReplyPreviewText(room, replyContent, t);
    const sender = replyEvent?.getSender();
    const powerTag = sender ? getMemberPowerTag?.(sender) : undefined;
    const tagColor = powerTag?.color ? accessibleTagColors?.get(powerTag.color) : undefined;

    const usernameColor = legacyUsernameColor ? colorMXID(sender ?? replyEventId) : tagColor;

    const fallbackBody = replyEvent?.isRedacted() ? (
      <MessageDeletedContent />
    ) : (
      <MessageFailedContent />
    );

    const badEncryption = replyEvent?.getContent().msgtype === 'm.bad.encrypted';
    const bodyJSX = body ? scaleSystemEmoji(preview ?? trimReplyFromBody(body)) : fallbackBody;

    return (
      <Box direction="Row" gap="200" alignItems="Center" {...props} ref={ref}>
        {/* Hide the thread badge inside thread view to avoid redundant UI. */}
        <MindroomReplyThreadIndicator
          room={room}
          timelineSet={timelineSet}
          threadRootId={threadRootId}
          hide={hideThreadIndicator}
          onClick={onClick}
        />
        <ReplyLayout
          as="button"
          userColor={usernameColor}
          username={
            sender && (
              <Text size="T300" truncate>
                <b>{getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender)}</b>
              </Text>
            )
          }
          data-event-id={replyEventId}
          onClick={onClick}
        >
          {replyEvent !== undefined ? (
            <Text size="T300" truncate>
              {badEncryption ? <MessageBadEncryptedContent /> : bodyJSX}
            </Text>
          ) : (
            <LinePlaceholder
              style={{
                backgroundColor: color.SurfaceVariant.ContainerActive,
                width: toRem(placeholderWidth),
                maxWidth: '100%',
              }}
            />
          )}
        </ReplyLayout>
      </Box>
    );
  }
);
