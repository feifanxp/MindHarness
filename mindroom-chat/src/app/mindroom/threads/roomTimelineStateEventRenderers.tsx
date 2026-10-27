/* eslint-disable react/destructuring-assignment */
import React from 'react';
import { Trans } from 'react-i18next';
import { Box, Icons, Text } from 'folds';
import { EventTimelineSet, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { SessionMembershipData } from 'matrix-js-sdk/lib/matrixrtc/membershipData';
import type { TFunction } from 'i18next';
import { EventContent, Time } from '../../components/message';
import type { EventRenderer, EventRendererOpts } from '../../hooks/useMatrixEventRenderer';
import type { MemberEventParser } from '../../hooks/useMemberEventParser';
import { MessageLayout, MessageSpacing } from '../../state/settings';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberDisplayName, isMembershipChanged } from '../../utils/room';
import { StateEvent } from '../../../types/matrix/room';
import { Event } from '../messages/MindroomMessage';
import type { RoomTimelineFocusItem } from './roomFocusScrollController';

export type RoomTimelineEventArgs = [
  string,
  MatrixEvent,
  number,
  EventTimelineSet,
  boolean,
  boolean?
];

type RoomTimelineStateEventOptions = {
  room: Room;
  mx: MatrixClient;
  focusItem: RoomTimelineFocusItem | undefined;
  messageSpacing: MessageSpacing;
  messageLayout: MessageLayout;
  hour24Clock: boolean;
  dateFormatString: string;
  canRedact: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  showHiddenEvents: boolean;
  hideActivity: boolean;
  showDeveloperTools: boolean;
  parseMemberEvent: MemberEventParser;
  t: TFunction;
};

export const createRoomTimelineStateEventRenderers = ({
  room,
  mx,
  focusItem,
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
}: RoomTimelineStateEventOptions) => {
  const stateEventRenderers: EventRendererOpts<RoomTimelineEventArgs> = {
    [StateEvent.RoomMember]: (
      mEventId,
      mEvent,
      item,
      _timelineSet,
      _collapse,
      highlightOverride
    ) => {
      const membershipChanged = isMembershipChanged(mEvent);
      if (membershipChanged && hideMembershipEvents) return null;
      if (!membershipChanged && hideNickAvatarEvents) return null;

      const highlighted = highlightOverride ?? (focusItem?.index === item && focusItem.highlight);
      const parsed = parseMemberEvent(mEvent);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={parsed.icon}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  {parsed.body}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
    [StateEvent.RoomName]: (mEventId, mEvent, item, _timelineSet, _collapse, highlightOverride) => {
      const highlighted = highlightOverride ?? (focusItem?.index === item && focusItem.highlight);
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Hash}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <Trans
                    t={t}
                    shouldUnescape
                    tOptions={{ interpolation: { escapeValue: true } }}
                    i18nKey="mindroomUi.threads.roomTimelineStateEventRenderers.changedRoomName"
                    values={{ sender: senderName }}
                    components={{ sender: <b /> }}
                  />
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
    [StateEvent.RoomTopic]: (
      mEventId,
      mEvent,
      item,
      _timelineSet,
      _collapse,
      highlightOverride
    ) => {
      const highlighted = highlightOverride ?? (focusItem?.index === item && focusItem.highlight);
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Hash}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <Trans
                    t={t}
                    shouldUnescape
                    tOptions={{ interpolation: { escapeValue: true } }}
                    i18nKey="mindroomUi.threads.roomTimelineStateEventRenderers.changedRoomTopic"
                    values={{ sender: senderName }}
                    components={{ sender: <b /> }}
                  />
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
    [StateEvent.RoomAvatar]: (
      mEventId,
      mEvent,
      item,
      _timelineSet,
      _collapse,
      highlightOverride
    ) => {
      const highlighted = highlightOverride ?? (focusItem?.index === item && focusItem.highlight);
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Hash}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <Trans
                    t={t}
                    shouldUnescape
                    tOptions={{ interpolation: { escapeValue: true } }}
                    i18nKey="mindroomUi.threads.roomTimelineStateEventRenderers.changedRoomAvatar"
                    values={{ sender: senderName }}
                    components={{ sender: <b /> }}
                  />
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
    [StateEvent.GroupCallMemberPrefix]: (
      mEventId,
      mEvent,
      item,
      _timelineSet,
      _collapse,
      highlightOverride
    ) => {
      const highlighted = highlightOverride ?? (focusItem?.index === item && focusItem.highlight);
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const content = mEvent.getContent<SessionMembershipData>();
      const prevContent = mEvent.getPrevContent();

      const callJoined = content.application;
      if (callJoined && 'application' in prevContent) {
        return null;
      }

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={callJoined ? Icons.Phone : Icons.PhoneDown}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <Trans
                    t={t}
                    shouldUnescape
                    tOptions={{ interpolation: { escapeValue: true } }}
                    i18nKey={
                      callJoined
                        ? 'mindroomUi.threads.roomTimelineStateEventRenderers.joinedCall'
                        : 'mindroomUi.threads.roomTimelineStateEventRenderers.endedCall'
                    }
                    values={{ sender: senderName }}
                    components={{ sender: <b /> }}
                  />
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
  };
  const renderStateEvent: EventRenderer<RoomTimelineEventArgs> = (
    mEventId,
    mEvent,
    item,
    _timelineSet,
    _collapse,
    highlightOverride
  ) => {
    if (!showHiddenEvents) return null;
    const highlighted = highlightOverride ?? (focusItem?.index === item && focusItem.highlight);
    const senderId = mEvent.getSender() ?? '';
    const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

    const timeJSX = (
      <Time
        ts={mEvent.getTs()}
        compact={messageLayout === MessageLayout.Compact}
        hour24Clock={hour24Clock}
        dateFormatString={dateFormatString}
      />
    );

    return (
      <Event
        key={mEvent.getId()}
        data-message-item={item}
        data-message-id={mEventId}
        room={room}
        mEvent={mEvent}
        highlight={highlighted}
        messageSpacing={messageSpacing}
        canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
        hideReadReceipts={hideActivity}
        showDeveloperTools={showDeveloperTools}
      >
        <EventContent
          messageLayout={messageLayout}
          time={timeJSX}
          iconSrc={Icons.Code}
          content={
            <Box grow="Yes" direction="Column">
              <Text size="T300" priority="300">
                <Trans
                  t={t}
                  shouldUnescape
                  tOptions={{ interpolation: { escapeValue: true } }}
                  i18nKey="mindroomUi.threads.roomTimelineStateEventRenderers.sentStateEvent"
                  values={{ sender: senderName, eventType: mEvent.getType() }}
                  components={{ sender: <b />, eventType: <code className={customHtmlCss.Code} /> }}
                />
              </Text>
            </Box>
          }
        />
      </Event>
    );
  };
  const renderEvent: EventRenderer<RoomTimelineEventArgs> = (
    mEventId,
    mEvent,
    item,
    _timelineSet,
    _collapse,
    highlightOverride
  ) => {
    if (!showHiddenEvents) return null;
    if (Object.keys(mEvent.getContent()).length === 0) return null;
    if (mEvent.getRelation()) return null;
    if (mEvent.isRedaction()) return null;

    const highlighted = highlightOverride ?? (focusItem?.index === item && focusItem.highlight);
    const senderId = mEvent.getSender() ?? '';
    const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

    const timeJSX = (
      <Time
        ts={mEvent.getTs()}
        compact={messageLayout === MessageLayout.Compact}
        hour24Clock={hour24Clock}
        dateFormatString={dateFormatString}
      />
    );

    return (
      <Event
        key={mEvent.getId()}
        data-message-item={item}
        data-message-id={mEventId}
        room={room}
        mEvent={mEvent}
        highlight={highlighted}
        messageSpacing={messageSpacing}
        canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
        hideReadReceipts={hideActivity}
        showDeveloperTools={showDeveloperTools}
      >
        <EventContent
          messageLayout={messageLayout}
          time={timeJSX}
          iconSrc={Icons.Code}
          content={
            <Box grow="Yes" direction="Column">
              <Text size="T300" priority="300">
                <Trans
                  t={t}
                  shouldUnescape
                  tOptions={{ interpolation: { escapeValue: true } }}
                  i18nKey="mindroomUi.threads.roomTimelineStateEventRenderers.sentEvent"
                  values={{ sender: senderName, eventType: mEvent.getType() }}
                  components={{ sender: <b />, eventType: <code className={customHtmlCss.Code} /> }}
                />
              </Text>
            </Box>
          }
        />
      </Event>
    );
  };

  return { stateEventRenderers, renderStateEvent, renderEvent };
};
