import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../messages/toolApproval';
import {
  getMindroomRoomTimelineApprovalContent,
  getMindroomRoomTimelineThreadBadgeModel,
  MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT,
  renderMindroomRoomTimelineThreadBadge,
} from './roomTimelineMessageExtensions';
import type { ThreadRecord } from './types';

vi.mock('./ThreadBadgeRenderer', () => ({
  ThreadBadgeRenderer: () => null,
}));

const makeEvent = (content: Record<string, unknown>, threadRootId?: string) =>
  ({
    getContent: () => content,
    getOriginalContent: () => content,
    threadRootId,
  } as any);

const makeRecord = (threadRootId = '$root'): ThreadRecord => ({
  roomId: '!room:example.org',
  threadRootId,
  rootEventId: threadRootId,
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: 'Root body',
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 2,
    participantIds: [],
    replyParticipantIds: ['@alice:example.org'],
    primarySummaryText: 'Root body',
    recentThreadSummaryText: 'Root body',
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 2,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    tags: [],
  },
  cache: {
    eventCount: 1,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  absoluteIndex: 0,
});

describe('roomTimelineMessageExtensions', () => {
  it('exposes the room-timeline approval event type from the MindRoom message owner', () => {
    expect(MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT).toBe(MINDROOM_TOOL_APPROVAL_EVENT);
  });

  it('builds approval render content with edited new_content preserved', () => {
    const event = makeEvent({ approval_id: 'approval-1', status: 'pending' });
    const edit = makeEvent({
      'm.new_content': { approval_id: 'approval-1', status: 'approved' },
    });

    expect(getMindroomRoomTimelineApprovalContent(event, edit)).toEqual({
      approval_id: 'approval-1',
      status: 'pending',
      'm.new_content': { approval_id: 'approval-1', status: 'approved' },
    });
  });

  it('derives timeline thread badges from ThreadRecord data only', () => {
    const record = makeRecord();
    const model = getMindroomRoomTimelineThreadBadgeModel({
      eventId: '$root',
      event: makeEvent({}, undefined),
      threadRecordMap: new Map([['$root', record]]),
    });

    expect(model).toEqual({
      id: { roomId: '!room:example.org', threadRootId: '$root' },
      summaryInfo: undefined,
      recentThreadSummaryText: 'Root body',
      replyCount: 2,
      participantIds: ['@alice:example.org'],
      isResolved: false,
    });
  });

  it('hides timeline thread badges inside an active thread', () => {
    expect(
      getMindroomRoomTimelineThreadBadgeModel({
        eventId: '$root',
        event: makeEvent({}, undefined),
        threadRecordMap: new Map([['$root', makeRecord()]]),
        activeThreadId: '$root',
      })
    ).toBeUndefined();
  });

  it('renders the timeline thread badge seam with the derived model', () => {
    const badge = renderMindroomRoomTimelineThreadBadge({
      eventId: '$root',
      event: makeEvent({}, undefined),
      threadRecordMap: new Map([['$root', makeRecord()]]),
      room: {} as never,
      onClick: vi.fn(),
      includeRecentSummaryData: true,
    });

    expect(React.isValidElement(badge)).toBe(true);
    expect((badge as React.ReactElement).props.model).toEqual({
      id: { roomId: '!room:example.org', threadRootId: '$root' },
      summaryInfo: undefined,
      recentThreadSummaryText: 'Root body',
      replyCount: 2,
      participantIds: ['@alice:example.org'],
      isResolved: false,
    });
    expect((badge as React.ReactElement).props.includeRecentSummaryData).toBe(true);
  });

  it('does not render a timeline thread badge without a record', () => {
    expect(
      renderMindroomRoomTimelineThreadBadge({
        eventId: '$missing',
        event: makeEvent({}, undefined),
        threadRecordMap: new Map([['$root', makeRecord()]]),
        room: {} as never,
        onClick: vi.fn(),
      })
    ).toBeNull();
  });
});
