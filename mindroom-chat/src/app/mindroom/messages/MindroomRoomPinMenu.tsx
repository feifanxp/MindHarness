import { useTranslation } from 'react-i18next';
/* eslint-disable react/destructuring-assignment */
import React, { forwardRef, MouseEventHandler, useCallback, useMemo, useRef } from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import {
  Avatar,
  Box,
  Chip,
  color,
  config,
  Icon,
  IconButton,
  Icons,
  Spinner,
  Text,
  toRem,
} from 'folds';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { HTMLReactParserOptions } from 'html-react-parser';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PageScroll } from '../../components/page';
import { useVirtualListScrollMargin } from '../../hooks/useVirtualListScrollMargin';
import { getEventAttachmentOwner } from './eventAttachments';
import { Menu, Header } from '../../components/glass/GlassPrimitives';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import * as css from './MindroomRoomPinMenu.css';
import { SequenceCard } from '../../components/sequence-card';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  AvatarBase,
  DefaultPlaceholder,
  ImageContent,
  MessageNotDecryptedContent,
  MessageUnsupportedContent,
  ModernLayout,
  MSticker,
  RedactedContent,
  Reply,
  Time,
  Username,
  UsernameBold,
} from '../../components/message';
import { UserAvatar } from '../../components/user-avatar';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { canPinRoomEvents, setRoomEventPinned } from '../threads/threadPinning';
import { getEditedEvent, getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { GetContentCallback, MessageEvent } from '../../../types/matrix/room';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../hooks/useSpoilerClickHandler';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import { RenderMatrixEvent, useMatrixEventRenderer } from '../../hooks/useMatrixEventRenderer';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import {
  getMindroomPinnedMessageRenderers,
  useMindroomPinnedEvent,
  renderMindroomPinnedEncryptedMessageEvent,
} from './pinnedMessageExtensions';
import { useSetting } from '../../state/hooks/settings';
import { shouldShowLinkFavicons } from './linkFaviconPolicy';
import { settingsAtom } from '../../state/settings';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { EncryptedContent } from '../../features/room/message/EncryptedContent';
import { Image } from '../../components/media';
import { ImageViewer } from '../../components/image-viewer';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { VirtualTile } from '../../components/virtualizer';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import { useTheme } from '../../hooks/useTheme';
import { PowerIcon } from '../../components/power';
import colorMXID from '../../../util/colorMXID';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import {
  GetMemberPowerTag,
  getPowerTagIconSrc,
  useAccessiblePowerTagColors,
  useGetMemberPowerTag,
} from '../../hooks/useMemberPowerTag';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';

type PinnedMessageProps = {
  room: Room;
  eventId: string;
  renderContent: RenderMatrixEvent<[MatrixEvent, string, GetContentCallback]>;
  onOpen: (roomId: string, eventId: string) => void;
  canPinEvent: boolean;
  getMemberPowerTag: GetMemberPowerTag;
  accessibleTagColors: Map<string, string>;
  legacyUsernameColor: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};
function PinnedMessage({
  room,
  eventId,
  renderContent,
  onOpen,
  canPinEvent,
  getMemberPowerTag,
  accessibleTagColors,
  legacyUsernameColor,
  hour24Clock,
  dateFormatString,
}: PinnedMessageProps) {
  const { t } = useTranslation();
  const pinnedEvent = useMindroomPinnedEvent(room, eventId);
  const useAuthentication = useMediaAuthentication();
  const mx = useMatrixClient();

  const [unpinState, unpin] = useAsyncCallback(
    useCallback(() => {
      return setRoomEventPinned(mx, room, eventId, false);
    }, [room, eventId, mx])
  );

  const handleOpenClick: MouseEventHandler = (evt) => {
    evt.stopPropagation();
    const evtId = evt.currentTarget.getAttribute('data-event-id');
    if (!evtId) return;
    onOpen(room.roomId, evtId);
  };

  const handleUnpinClick: MouseEventHandler = (evt) => {
    evt.stopPropagation();
    void unpin().catch(() => {});
  };

  const renderOptions = () => (
    <Box shrink="No" gap="200" alignItems="Center">
      {unpinState.status === AsyncStatus.Error && (
        <Text role="alert" size="T200">
          {t('thread.pinFailed')}
        </Text>
      )}
      <Chip data-event-id={eventId} onClick={handleOpenClick} variant="Secondary" radii="Pill">
        <Text size="T200">{t('mindroomUi.messages.mindroomRoomPinMenu.open')}</Text>
      </Chip>
      {canPinEvent && (
        <IconButton
          data-event-id={eventId}
          variant="Secondary"
          size="300"
          radii="Pill"
          onClick={unpinState.status === AsyncStatus.Loading ? undefined : handleUnpinClick}
          aria-disabled={unpinState.status === AsyncStatus.Loading}
        >
          {unpinState.status === AsyncStatus.Loading ? (
            <Spinner size="100" />
          ) : (
            <Icon src={Icons.Cross} size="100" />
          )}
        </IconButton>
      )}
    </Box>
  );

  if (pinnedEvent === undefined) return <DefaultPlaceholder variant="Secondary" />;
  if (pinnedEvent === null)
    return (
      <Box gap="300" justifyContent="SpaceBetween" alignItems="Center">
        <Box>
          <Text style={{ color: color.Critical.Main }}>
            {t('mindroomUi.messages.mindroomRoomPinMenu.failedToLoadMessage')}
          </Text>
        </Box>
        {renderOptions()}
      </Box>
    );

  const sender = pinnedEvent.getSender()!;
  const displayName = getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender) ?? sender;
  const senderAvatarMxc = getMemberAvatarMxc(room, sender);
  const getContent = (() => pinnedEvent.getContent()) as GetContentCallback;

  const memberPowerTag = getMemberPowerTag(sender);
  const tagColor = memberPowerTag?.color
    ? accessibleTagColors?.get(memberPowerTag.color)
    : undefined;
  const tagIconSrc = memberPowerTag?.icon
    ? getPowerTagIconSrc(mx, useAuthentication, memberPowerTag.icon)
    : undefined;

  const usernameColor = legacyUsernameColor ? colorMXID(sender) : tagColor;

  return (
    <ModernLayout
      before={
        <AvatarBase>
          <Avatar size="300">
            <UserAvatar
              userId={sender}
              src={
                senderAvatarMxc
                  ? mxcUrlToHttp(mx, senderAvatarMxc, useAuthentication, 48, 48, 'crop') ??
                    undefined
                  : undefined
              }
              alt={displayName}
              renderFallback={() => <Icon size="200" src={Icons.User} filled />}
            />
          </Avatar>
        </AvatarBase>
      }
    >
      <Box gap="300" justifyContent="SpaceBetween" alignItems="Center" grow="Yes">
        <Box gap="200" alignItems="Baseline">
          <Box alignItems="Center" gap="200">
            <Username style={{ color: usernameColor }}>
              <Text as="span" truncate>
                <UsernameBold>{displayName}</UsernameBold>
              </Text>
            </Username>
            {tagIconSrc && <PowerIcon size="100" iconSrc={tagIconSrc} />}
          </Box>
          <Time
            ts={pinnedEvent.getTs()}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        </Box>
        {renderOptions()}
      </Box>
      {pinnedEvent.replyEventId && (
        <Reply
          room={room}
          replyEventId={pinnedEvent.replyEventId}
          threadRootId={pinnedEvent.threadRootId}
          onClick={handleOpenClick}
          getMemberPowerTag={getMemberPowerTag}
          accessibleTagColors={accessibleTagColors}
          legacyUsernameColor={legacyUsernameColor}
        />
      )}
      {renderContent(pinnedEvent.getType(), false, pinnedEvent, displayName, getContent)}
    </ModernLayout>
  );
}

export type RoomPinMenuProps = {
  room: Room;
  requestClose: () => void;
};
export const RoomPinMenu = forwardRef<HTMLDivElement, RoomPinMenuProps>(
  ({ room, requestClose }, ref) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const userId = mx.getUserId()!;
    const powerLevels = usePowerLevelsContext();
    const creators = useRoomCreators(room);

    const canPinEvent = canPinRoomEvents(creators, powerLevels, userId);

    const creatorsTag = useRoomCreatorsTag();
    const powerLevelTags = usePowerLevelTags(room, powerLevels);
    const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);

    const theme = useTheme();
    const accessibleTagColors = useAccessiblePowerTagColors(
      theme.kind,
      creatorsTag,
      powerLevelTags
    );

    const pinnedEvents = useRoomPinnedEvents(room);
    const sortedPinnedEvent = useMemo(() => Array.from(pinnedEvents).reverse(), [pinnedEvents]);
    const useAuthentication = useMediaAuthentication();
    const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
    const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
    const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
    const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
    const showLinkFavicons = shouldShowLinkFavicons(
      { mediaAutoLoad, urlPreview, encUrlPreview },
      room.hasEncryptionStateEvent()
    );

    const direct = useIsDirectRoom();
    const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');

    const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
    const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

    const { navigateRoom } = useRoomNavigate();
    const scrollRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const scrollMargin = useVirtualListScrollMargin(scrollRef, listRef);

    const virtualizer = useVirtualizer({
      count: sortedPinnedEvent.length,
      getScrollElement: () => scrollRef.current,
      scrollMargin,
      estimateSize: () => 75,
      overscan: 4,
    });

    const mentionClickHandler = useMentionClickHandler(room.roomId);
    const spoilerClickHandler = useSpoilerClickHandler();

    const linkifyOpts = useMemo<LinkifyOpts>(
      () => ({
        ...LINKIFY_OPTS,
        render: factoryRenderLinkifyWithMention(
          (href) =>
            renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler)),
          showLinkFavicons
        ),
      }),
      [mx, room, mentionClickHandler, showLinkFavicons]
    );
    const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
      () =>
        getReactCustomHtmlParser(mx, room.roomId, {
          linkifyOpts,
          showLinkFavicons,
          useAuthentication,
          handleSpoilerClick: spoilerClickHandler,
          handleMentionClick: mentionClickHandler,
        }),
      [
        mx,
        room,
        linkifyOpts,
        mentionClickHandler,
        spoilerClickHandler,
        useAuthentication,
        showLinkFavicons,
      ]
    );
    const mindroomPinnedMessageRenderers = useMemo(
      () =>
        getMindroomPinnedMessageRenderers({
          roomId: room.roomId,
          mediaAutoLoad,
          urlPreview: showUrlPreview,
          htmlReactParserOptions,
          linkifyOpts,
          outlineAttachment: true,
        }),
      [room.roomId, mediaAutoLoad, showUrlPreview, htmlReactParserOptions, linkifyOpts]
    );

    const renderMatrixEvent = useMatrixEventRenderer<[MatrixEvent, string, GetContentCallback]>(
      {
        [MessageEvent.RoomMessage]: (event, displayName, getContent) => {
          if (event.isRedacted()) {
            return (
              <RedactedContent reason={event.getUnsigned().redacted_because?.content.reason} />
            );
          }

          return (
            <RenderMessageContent
              mEvent={event}
              displayName={displayName}
              msgType={event.getContent().msgtype ?? ''}
              ts={event.getTs()}
              getContent={getContent}
              edited={!!event.replacingEvent()}
              mediaAutoLoad={mediaAutoLoad}
              urlPreview={showUrlPreview}
              htmlReactParserOptions={htmlReactParserOptions}
              linkifyOpts={linkifyOpts}
              outlineAttachment
            />
          );
        },
        ...mindroomPinnedMessageRenderers,
        [MessageEvent.RoomMessageEncrypted]: (event, displayName) => {
          const eventId = event.getId()!;
          const evtTimeline = room.getTimelineForEvent(eventId);

          const mEvent = evtTimeline?.getEvents().find((e) => e.getId() === eventId);

          if (!mEvent || !evtTimeline) {
            return (
              <Box grow="Yes" direction="Column">
                <Text size="T400" priority="300">
                  <code className={customHtmlCss.Code}>{event.getType()}</code>
                  {t('mindroomUi.messages.mindroomRoomPinMenu.event')}
                </Text>
              </Box>
            );
          }

          return (
            <EncryptedContent mEvent={mEvent}>
              {() => {
                if (mEvent.isRedacted()) return <RedactedContent />;
                if (mEvent.getType() === MessageEvent.Sticker)
                  return (
                    <MSticker
                      content={mEvent.getContent()}
                      renderImageContent={(props) => (
                        <ImageContent
                          owner={getEventAttachmentOwner(mEvent)}
                          {...props}
                          autoPlay={mediaAutoLoad}
                          renderImage={(p) => <Image {...p} loading="lazy" />}
                          renderViewer={(p) => <ImageViewer {...p} />}
                        />
                      )}
                    />
                  );
                const mindroomPinnedMessage = renderMindroomPinnedEncryptedMessageEvent(mEvent, {
                  displayName,
                  roomId: room.roomId,
                  eventId,
                  resolveEditedEvent: (candidate) =>
                    getEditedEvent(eventId, candidate, evtTimeline.getTimelineSet()),
                  mediaAutoLoad,
                  urlPreview: showUrlPreview,
                  htmlReactParserOptions,
                  linkifyOpts,
                });
                if (mindroomPinnedMessage) {
                  return mindroomPinnedMessage;
                }
                if (mEvent.getType() === MessageEvent.RoomMessage) {
                  const editedEvent = getEditedEvent(eventId, mEvent, evtTimeline.getTimelineSet());
                  const getContent = (() =>
                    editedEvent?.getContent()['m.new_content'] ??
                    mEvent.getContent()) as GetContentCallback;

                  return (
                    <RenderMessageContent
                      mEvent={mEvent}
                      displayName={displayName}
                      msgType={mEvent.getContent().msgtype ?? ''}
                      ts={mEvent.getTs()}
                      edited={!!editedEvent || !!mEvent.replacingEvent()}
                      getContent={getContent}
                      mediaAutoLoad={mediaAutoLoad}
                      urlPreview={showUrlPreview}
                      htmlReactParserOptions={htmlReactParserOptions}
                      linkifyOpts={linkifyOpts}
                    />
                  );
                }
                if (mEvent.getType() === MessageEvent.RoomMessageEncrypted)
                  return (
                    <Text>
                      <MessageNotDecryptedContent />
                    </Text>
                  );
                return (
                  <Text>
                    <MessageUnsupportedContent />
                  </Text>
                );
              }}
            </EncryptedContent>
          );
        },
        [MessageEvent.Sticker]: (event, displayName, getContent) => {
          if (event.isRedacted()) {
            return (
              <RedactedContent reason={event.getUnsigned().redacted_because?.content.reason} />
            );
          }
          return (
            <MSticker
              content={getContent()}
              renderImageContent={(props) => (
                <ImageContent
                  owner={getEventAttachmentOwner(event)}
                  {...props}
                  autoPlay={mediaAutoLoad}
                  renderImage={(p) => <Image {...p} loading="lazy" />}
                  renderViewer={(p) => <ImageViewer {...p} />}
                />
              )}
            />
          );
        },
      },
      undefined,
      (event) => {
        if (event.isRedacted()) {
          return <RedactedContent reason={event.getUnsigned().redacted_because?.content.reason} />;
        }
        return (
          <Box grow="Yes" direction="Column">
            <Text size="T400" priority="300">
              <code className={customHtmlCss.Code}>{event.getType()}</code>
              {t('mindroomUi.messages.mindroomRoomPinMenu.event')}
            </Text>
          </Box>
        );
      }
    );

    const handleOpen = (roomId: string, eventId: string) => {
      navigateRoom(roomId, eventId);
      requestClose();
    };

    return (
      <Menu ref={ref} className={css.PinMenu}>
        <Box grow="Yes" direction="Column">
          <PageScroll
            scrollRef={scrollRef}
            header={
              <Header className={css.PinMenuHeader} size="500">
                <Box grow="Yes">
                  <Text size="H5">
                    {t('mindroomUi.messages.mindroomRoomPinMenu.pinnedMessages')}
                  </Text>
                </Box>
                <Box shrink="No">
                  <IconButton size="300" onClick={requestClose} radii="300">
                    <Icon src={Icons.Cross} size="400" />
                  </IconButton>
                </Box>
              </Header>
            }
          >
            <Box className={css.PinMenuContent} direction="Column" gap="100">
              {sortedPinnedEvent.length > 0 ? (
                <div
                  ref={listRef}
                  style={{
                    position: 'relative',
                    height: virtualizer.getTotalSize(),
                  }}
                >
                  {virtualizer.getVirtualItems().map((vItem) => {
                    const eventId = sortedPinnedEvent[vItem.index];
                    if (!eventId) return null;

                    return (
                      <VirtualTile
                        virtualItem={vItem}
                        style={{
                          top: vItem.start - scrollMargin,
                          paddingBottom: config.space.S200,
                        }}
                        ref={virtualizer.measureElement}
                        key={vItem.index}
                      >
                        <SequenceCard
                          style={{ padding: config.space.S400, borderRadius: config.radii.R300 }}
                          variant="SurfaceVariant"
                          direction="Column"
                        >
                          <PinnedMessage
                            room={room}
                            eventId={eventId}
                            renderContent={renderMatrixEvent}
                            onOpen={handleOpen}
                            canPinEvent={canPinEvent}
                            getMemberPowerTag={getMemberPowerTag}
                            accessibleTagColors={accessibleTagColors}
                            legacyUsernameColor={legacyUsernameColor || direct}
                            hour24Clock={hour24Clock}
                            dateFormatString={dateFormatString}
                          />
                        </SequenceCard>
                      </VirtualTile>
                    );
                  })}
                </div>
              ) : (
                <Box
                  className={ContainerColor({ variant: 'SurfaceVariant' })}
                  style={{
                    marginBottom: config.space.S200,
                    padding: `${config.space.S700} ${config.space.S400} ${toRem(60)}`,
                    borderRadius: config.radii.R300,
                  }}
                  grow="Yes"
                  direction="Column"
                  gap="400"
                  justifyContent="Center"
                  alignItems="Center"
                >
                  <Icon src={Icons.Pin} size="600" />
                  <Box
                    style={{ maxWidth: toRem(300) }}
                    direction="Column"
                    gap="200"
                    alignItems="Center"
                  >
                    <Text size="H4" align="Center">
                      {t('mindroomUi.messages.mindroomRoomPinMenu.noPinnedMessages')}
                    </Text>
                    <Text size="T400" align="Center">
                      {t(
                        'mindroomUi.messages.mindroomRoomPinMenu.usersWithSufficientPowerLevelCanPinAMessagesFrom'
                      )}
                    </Text>
                  </Box>
                </Box>
              )}
            </Box>
          </PageScroll>
        </Box>
      </Menu>
    );
  }
);
