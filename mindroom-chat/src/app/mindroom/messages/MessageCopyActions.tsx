import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons, Line, Text, Tooltip, TooltipProvider, as } from 'folds';
import React, { useMemo, useState } from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { getEditedEvent, getLatestMessageContent } from '../../utils/room';
import * as css from '../../features/room/message/styles.css';
import * as copyCss from './MessageCopyActions.css';
import { copyToClipboard } from '../../utils/dom';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import {
  getMessageCopyTextSource,
  getMessageCopyTexts,
  scanMindroomToolMarkerLines,
} from './messageCopyText';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const getMenuMessageContent = (room: Room, mEvent: MatrixEvent): Record<string, unknown> => {
  const eventId = mEvent.getId();
  const content = mEvent.getContent();
  if (!isRecord(content)) return {};
  if (!eventId) return content;

  const evtTimeline = room.getTimelineForEvent(eventId);
  const editedEvent = evtTimeline
    ? getEditedEvent(eventId, mEvent, evtTimeline.getTimelineSet())
    : undefined;
  return getLatestMessageContent(mEvent, editedEvent);
};

// Touch screens show no hover tooltip, so they get a labelled row instead of
// the icon-only side action.
const prefersLabelledCopyActions = (): boolean =>
  globalThis.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false;

export const MessageCopyTextItem = as<
  'button',
  {
    /** The rendered message content, already resolved for edits. */
    content: Record<string, unknown>;
    mEvent: MatrixEvent;
    onClose: () => void;
    resolvedLongTextContent?: Record<string, unknown>;
    loading?: boolean;
  }
>(({ content, mEvent, onClose, resolvedLongTextContent, loading, ...props }, ref) => {
  const { t } = useTranslation();
  const [labelledCopyActions] = useState(prefersLabelledCopyActions);
  const source = getMessageCopyTextSource(
    content,
    mEvent.getContent() as Record<string, unknown>,
    resolvedLongTextContent
  );
  // Edited content is a new object on every render, so memoize the HTML scan on
  // its strings; streaming edits still rescan because the body changes.
  const body = source?.body;
  const formattedBody = source?.formattedBody;
  const plainBodyFallback = source?.plainBodyFallback ?? false;
  const markerScan = useMemo(
    () =>
      body === undefined
        ? undefined
        : scanMindroomToolMarkerLines(body, formattedBody, plainBodyFallback),
    [body, formattedBody, plainBodyFallback]
  );
  // Tool markers are display chrome; the plain copy keeps only the reply.
  const copyTexts = source ? getMessageCopyTexts(source, markerScan) : undefined;
  const showCopyWithToolCalls = !loading && copyTexts?.textWithToolCalls !== undefined;

  const handleCopy = () => {
    if (copyTexts?.text) {
      copyToClipboard(copyTexts.text);
    }
    onClose();
  };

  const handleCopyWithToolCalls = () => {
    if (copyTexts?.textWithToolCalls) {
      copyToClipboard(copyTexts.textWithToolCalls);
    }
    onClose();
  };

  const copyWithToolCallsLabel = t('mindroomUi.messages.messageCopyActions.copyTextWithToolCalls');

  const copyTextItem = (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Text} />}
      radii="300"
      aria-disabled={loading}
      disabled={loading}
      onClick={handleCopy}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {loading
          ? t('mindroomUi.messages.messageCopyActions.copyTextLoading')
          : t('mindroomUi.messages.messageCopyActions.copyText')}
      </Text>
    </MenuItem>
  );

  if (labelledCopyActions) {
    return (
      <>
        {copyTextItem}
        {showCopyWithToolCalls && (
          <MenuItem
            size="300"
            after={<Icon size="100" src={Icons.Terminal} />}
            radii="300"
            onClick={handleCopyWithToolCalls}
          >
            <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
              {copyWithToolCallsLabel}
            </Text>
          </MenuItem>
        )}
      </>
    );
  }

  return (
    <Box alignItems="Center" gap="100">
      <Box grow="Yes" direction="Column">
        {copyTextItem}
      </Box>
      {showCopyWithToolCalls && (
        <>
          {/* The divider and accent color set the side action apart from the
              row's own trailing icon, so it reads as a separate button. */}
          <Line
            size="300"
            variant="SurfaceVariant"
            direction="Vertical"
            className={copyCss.CopyActionDivider}
          />
          <TooltipProvider
            position="Right"
            offset={4}
            tooltip={
              <Tooltip>
                <Text size="T300">{copyWithToolCallsLabel}</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                ref={triggerRef}
                size="300"
                radii="300"
                variant="Primary"
                fill="None"
                aria-label={copyWithToolCallsLabel}
                onClick={handleCopyWithToolCalls}
              >
                <Icon size="100" src={Icons.Terminal} />
              </IconButton>
            )}
          </TooltipProvider>
        </>
      )}
    </Box>
  );
});

export const MessageCopyLinkItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const { t } = useTranslation();
  const handleCopy = () => {
    const eventId = mEvent.getId();
    if (!eventId) return;
    copyToClipboard(getMatrixToRoomEvent(room.roomId, eventId, getViaServers(room)));
    onClose?.();
  };

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Link} />}
      radii="300"
      onClick={handleCopy}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {t('mindroomUi.messages.messageCopyActions.copyLink')}
      </Text>
    </MenuItem>
  );
});
