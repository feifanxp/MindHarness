import React, { type MouseEventHandler } from 'react';
import type { EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
import type { EventRenderer, EventRendererOpts } from '../../hooks/useMatrixEventRenderer';
import {
  getToolApprovalRenderContent,
  MINDROOM_TOOL_APPROVAL_EVENT,
} from '../messages/toolApproval';
import { ThreadBadgeRenderer } from './ThreadBadgeRenderer';
import { buildThreadBadgeViewModelFromRecord } from './threadBadgeViewModel';
import type { ThreadBadgeViewModel, ThreadRecord } from './types';

export const MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT = MINDROOM_TOOL_APPROVAL_EVENT;

type RoomTimelineEventRendererArgs = [string, MatrixEvent, number, EventTimelineSet, boolean];

export const getMindroomRoomTimelineMessageRenderers = <
  T extends unknown[] = RoomTimelineEventRendererArgs
>(
  renderApprovalEvent: EventRenderer<T>
): EventRendererOpts<T> => ({
  [MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT]: renderApprovalEvent,
});

export const getMindroomRoomTimelineApprovalContent = (
  event: MatrixEvent,
  editedEvent?: MatrixEvent
): Record<string, unknown> =>
  getToolApprovalRenderContent(
    event.getOriginalContent() as Record<string, unknown>,
    editedEvent?.getContent() as Record<string, unknown> | undefined
  );

export const getMindroomRoomTimelineApprovalContentIfSupported = (
  event: MatrixEvent,
  editedEvent?: MatrixEvent
): Record<string, unknown> | undefined => {
  if (event.getType() !== MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT) return undefined;

  return getMindroomRoomTimelineApprovalContent(event, editedEvent);
};

export const getMindroomRoomTimelineThreadBadgeModel = ({
  eventId,
  event,
  threadRecordMap,
  activeThreadId,
}: {
  eventId: string;
  event: Pick<MatrixEvent, 'threadRootId'>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  activeThreadId?: string;
}): ThreadBadgeViewModel | undefined => {
  const record = threadRecordMap.get(eventId);
  if (!record) return undefined;

  return buildThreadBadgeViewModelFromRecord({
    record,
    activeThreadId,
    eventThreadRootId: event.threadRootId,
  });
};

export type RenderMindroomRoomTimelineThreadBadgeOptions = {
  eventId: string;
  event: Pick<MatrixEvent, 'threadRootId'>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  activeThreadId?: string;
  room: Room;
  onClick: MouseEventHandler;
  includeRecentSummaryData?: boolean;
};

export const renderMindroomRoomTimelineThreadBadge = ({
  eventId,
  event,
  threadRecordMap,
  activeThreadId,
  room,
  onClick,
  includeRecentSummaryData,
}: RenderMindroomRoomTimelineThreadBadgeOptions) => {
  const model = getMindroomRoomTimelineThreadBadgeModel({
    eventId,
    event,
    threadRecordMap,
    activeThreadId,
  });
  if (!model) return null;

  return (
    <ThreadBadgeRenderer
      model={model}
      room={room}
      onClick={onClick}
      includeRecentSummaryData={includeRecentSummaryData}
    />
  );
};
