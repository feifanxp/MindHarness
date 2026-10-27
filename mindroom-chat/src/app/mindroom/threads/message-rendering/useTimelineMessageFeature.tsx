import React, { type RefObject, useCallback, useMemo, useState } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { isKeyHotkey } from 'is-hotkey';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSetting } from '../../../state/hooks/settings';
import { shouldShowLinkFavicons } from '../../messages/linkFaviconPolicy';
import { MessageLayout, type MessageSpacing, settingsAtom } from '../../../state/settings';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useIsDirectRoom } from '../../../hooks/useRoom';
import { usePowerLevelsContext } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomCreatorsTag } from '../../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../../hooks/usePowerLevelTags';
import {
  useAccessiblePowerTagColors,
  useGetMemberPowerTag,
} from '../../../hooks/useMemberPowerTag';
import { useTheme } from '../../../hooks/useTheme';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { canPinRoomEvents } from '../threadPinning';
import { useMentionClickHandler } from '../../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../../hooks/useSpoilerClickHandler';
import { useOpenUserRoomProfile } from '../../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../../hooks/useSpace';
import { useImagePackRooms } from '../../../hooks/useImagePackRooms';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { useMemberEventParser } from '../../../hooks/useMemberEventParser';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { useMatrixEventRenderer, type EventRenderer } from '../../../hooks/useMatrixEventRenderer';
import { editableActiveElement } from '../../../utils/dom';
import { canEditEvent, getLatestEditableEvt } from '../../../utils/room';
import { isEmptyEditor } from '../../../components/editor';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { roomIdToReplyDraftAtomFamily } from '../../../state/room/roomInputDrafts';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../../plugins/react-custom-html-parser';
import { MessageEvent } from '../../../../types/matrix/room';
import { isConfirmedMatrixEventId } from '../threadRouteUtils';
import { getMindroomRoomTimelineMessageRenderers } from '../roomTimelineMessageExtensions';
import {
  createRoomTimelineStateEventRenderers,
  type RoomTimelineEventArgs,
} from '../roomTimelineStateEventRenderers';
import { useRoomTimelineMessageActions } from '../useRoomTimelineMessageActions';
import { TimelineMessageFrame, type TimelineMessageFramePolicy } from './TimelineMessageFrame';
import { TimelineMessageBody, resolveTimelineMessageContent } from './TimelineMessageBody';
import { useTimelineMessageExpansion } from './useTimelineMessageExpansion';
import type { TimelineMessageData, TimelineMessageKind, TimelineMessageRow } from './types';

type TimelineMessageFeatureOptions = {
  room: Room;
  editor: Editor;
  threadId?: string;
  showThreadRepliesInRoom: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  // These settings also drive viewport estimates, dividers, filtering and read receipts.
  messageLayout: MessageLayout;
  messageSpacing: MessageSpacing;
  hideActivity: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  showHiddenEvents: boolean;
};

export const useTimelineMessageFeature = ({
  room,
  editor,
  threadId,
  showThreadRepliesInRoom,
  scrollRef,
  messageLayout,
  messageSpacing,
  hideActivity,
  hideMembershipEvents,
  hideNickAvatarEvents,
  showHiddenEvents,
}: TimelineMessageFeatureOptions) => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const direct = useIsDirectRoom();
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const [showDeveloperTools] = useSetting(settingsAtom, 'developerTools');
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');
  const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
  const showLinkFavicons = shouldShowLinkFavicons(
    { mediaAutoLoad, urlPreview, encUrlPreview },
    room.hasEncryptionStateEvent()
  );
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);
  const theme = useTheme();
  const accessiblePowerTagColors = useAccessiblePowerTagColors(
    theme.kind,
    creatorsTag,
    powerLevelTags
  );
  const permissions = useRoomPermissions(creators, powerLevels);
  const canRedact = permissions.action('redact', mx.getSafeUserId());
  const canDeleteOwn = permissions.event(MessageEvent.RoomRedaction, mx.getSafeUserId());
  const canSendReaction = permissions.event(MessageEvent.Reaction, mx.getSafeUserId());
  const canPinEvent = canPinRoomEvents(creators, powerLevels, mx.getSafeUserId());
  const [editingEventId, setEditId] = useState<string>();
  const expansion = useTimelineMessageExpansion(room.roomId, threadId, scrollRef);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const imagePackRooms = useImagePackRooms(room.roomId, roomToParents);
  const setReplyDraft = useSetAtom(roomIdToReplyDraftAtomFamily(room.roomId));
  const { navigateRoomThread } = useRoomNavigate();
  const openUserRoomProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();
  const {
    handleUserClick,
    handleUsernameClick,
    handleReplyClick,
    handleReactionToggle,
    handleEdit,
  } = useRoomTimelineMessageActions({
    mx,
    room,
    space,
    editor,
    openUserRoomProfile,
    showThreadRepliesInRoom,
    setReplyDraft,
    navigateRoomThread,
    setEditId,
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
      spoilerClickHandler,
      mentionClickHandler,
      useAuthentication,
      showLinkFavicons,
    ]
  );
  const parseMemberEvent = useMemberEventParser();
  const { t } = useTranslation();

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (
          isKeyHotkey('arrowup', evt) &&
          editableActiveElement() &&
          document.activeElement?.getAttribute('data-editable-name') === 'RoomInput' &&
          isEmptyEditor(editor)
        ) {
          const thread = threadId ? room.getThread(threadId) : undefined;
          const timeline = threadId ? thread?.liveTimeline : room.getLiveTimeline();
          if (!timeline) return;
          const isEditable = (mEvt: MatrixEvent) =>
            isConfirmedMatrixEventId(mEvt.getId()) && canEditEvent(mx, mEvt);
          const editableEvt =
            getLatestEditableEvt(timeline, isEditable) ??
            (thread?.rootEvent && isEditable(thread.rootEvent) ? thread.rootEvent : undefined);
          const editableEvtId = editableEvt?.getId();
          if (!editableEvtId) return;
          setEditId(editableEvtId);
          evt.preventDefault();
        }
      },
      [mx, room, editor, threadId]
    )
  );

  const framePolicy: TimelineMessageFramePolicy = {
    mx,
    room,
    threadId,
    showThreadRepliesInRoom,
    editingEventId,
    canRedact,
    canDeleteOwn,
    canSendReaction,
    canPinEvent,
    getMemberPowerTag,
    imagePackRooms,
    messageLayout,
    messageSpacing,
    onUserClick: handleUserClick,
    onUsernameClick: handleUsernameClick,
    onReplyClick: handleReplyClick,
    onReactionToggle: handleReactionToggle,
    onEditId: handleEdit,
    hideReadReceipts: hideActivity,
    showDeveloperTools,
    accessibleTagColors: accessiblePowerTagColors,
    legacyUsernameColor: legacyUsernameColor || direct,
    hour24Clock,
    dateFormatString,
  };
  const bodyPolicy = {
    room,
    threadId,
    mediaAutoLoad,
    urlPreview: showUrlPreview,
    htmlReactParserOptions,
    linkifyOpts,
    outlineAttachment: messageLayout === MessageLayout.Bubble,
    getExpansion: expansion.getExpansion,
  };
  const renderMessage = (
    kind: TimelineMessageKind,
    row: TimelineMessageRow,
    data: TimelineMessageData
  ) => {
    const messageContent =
      kind === 'sticker' ? undefined : resolveTimelineMessageContent(row, kind);
    return (
      <TimelineMessageFrame
        key={row.event.getId()}
        row={row}
        kind={kind}
        policy={framePolicy}
        data={data}
        resolvedContent={messageContent?.resolvedContent}
      >
        <TimelineMessageBody
          messageContent={messageContent}
          row={row}
          kind={kind}
          policy={bodyPolicy}
          approvalTimeline={data.approvalTimeline}
          threadSummaryTimeline={data.threadSummaryTimeline}
        />
      </TimelineMessageFrame>
    );
  };

  // Preserve state-specific precedence and synchronous null results from the existing registry.
  const { stateEventRenderers, renderStateEvent, renderEvent } =
    createRoomTimelineStateEventRenderers({
      room,
      mx,
      focusItem: undefined,
      messageSpacing,
      messageLayout,
      hour24Clock,
      dateFormatString,
      canRedact,
      hideMembershipEvents,
      hideNickAvatarEvents,
      showHiddenEvents,
      hideActivity,
      showDeveloperTools,
      parseMemberEvent,
      t,
    });
  const renderStateRow =
    (renderer: EventRenderer<RoomTimelineEventArgs>) => (row: TimelineMessageRow) =>
      renderer(row.eventId, row.event, row.index, row.timelineSet, row.collapse, row.highlighted);
  const renderMatrixEvent = useMatrixEventRenderer<[TimelineMessageRow, TimelineMessageData]>(
    {
      [MessageEvent.RoomMessage]: (row, data) => renderMessage('message', row, data),
      ...getMindroomRoomTimelineMessageRenderers<[TimelineMessageRow, TimelineMessageData]>(
        (row, data) => renderMessage('approval', row, data)
      ),
      [MessageEvent.RoomMessageEncrypted]: (row, data) => renderMessage('encrypted', row, data),
      [MessageEvent.Sticker]: (row, data) => renderMessage('sticker', row, data),
      ...Object.fromEntries(
        Object.entries(stateEventRenderers).map(([type, renderer]) => [
          type,
          renderStateRow(renderer),
        ])
      ),
    },
    renderStateRow(renderStateEvent),
    renderStateRow(renderEvent)
  );

  return {
    editingEventId,
    markLiveExpansionCandidate: expansion.markLiveExpansionCandidate,
    wrapExpansion: expansion.wrapExpansion,
    expansionControl: expansion.expansionControl,
    // Domain presentation data arrives after viewport/navigation hooks have initialized.
    renderEvent: (row: TimelineMessageRow, data: TimelineMessageData) =>
      renderMatrixEvent(
        row.event.getType(),
        typeof row.event.getStateKey() === 'string',
        row,
        data
      ),
  };
};
