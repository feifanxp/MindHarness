import type { ReactElement, ReactNode } from 'react';
import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { MINDROOM_TOOL_APPROVAL_EVENT } from '../../messages/toolApproval';
import { MessageEvent } from '../../../../types/matrix/room';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
} from '../test-utils/RoomTimeline.test.shared';

const findElementInNode = (
  node: ReactNode,
  predicate: (element: ReactElement) => boolean
): ReactElement | undefined => {
  if (!React.isValidElement(node)) return undefined;
  if (predicate(node)) return node;

  return React.Children.toArray(node.props.children)
    .map((child) => findElementInNode(child, predicate))
    .find((child): child is ReactElement => child !== undefined);
};

describe('RoomTimeline approval rendering', () => {
  it('renders thread summary and thread metadata for approval events', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const approvalEvent = makeEvent('$approval', {
      type: 'io.mindroom.tool_approval',
      content: {
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: { query: 'release date' },
        agent_name: 'research',
        status: 'pending',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
      },
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 1,
          },
        },
      },
    });
    const approvalReply = makeEvent('$approval-reply', {
      sender: '@bob:example.org',
      threadRootId: '$approval',
      relation: { rel_type: 'm.thread', event_id: '$approval' },
    });
    const room = makeRoom({
      liveEvents: [approvalEvent, approvalReply],
      threads: [
        {
          id: '$approval',
          rootEvent: approvalEvent,
          events: [approvalReply],
          timeline: [approvalReply],
          length: 1,
        },
      ] as never[],
    });
    const summaryMap = new Map([
      [
        '$approval',
        {
          summaryText: 'Cached approval summary',
          generatedTs: 10,
          messageCount: 1,
        },
      ],
    ]);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          summaryMap,
        })
      );
      await flushAsyncWork(1);
    });

    const approvalMessage = renderer?.root.findByProps({ 'data-message-id': '$approval' });
    const reactions = approvalMessage?.props.reactions;
    const { ThreadBadgeRenderer } = await import('../ThreadBadgeRenderer');
    const threadBadge = findElementInNode(
      reactions,
      (element) => element.type === ThreadBadgeRenderer
    );

    expect(threadBadge).toBeDefined();
    expect(threadBadge?.props.model.summaryInfo?.summaryText).toBe('Cached approval summary');
    expect(threadBadge?.props.model.id.threadRootId).toBe('$approval');
    expect(threadBadge?.props.model.replyCount).toBe(1);
    expect(threadBadge?.props.model.participantIds).toEqual(['@bob:example.org']);
    expect(threadBadge?.props.includeRecentSummaryData).toBe(true);
  });

  it('renders a zero-reply thread badge for approval roots with empty thread metadata', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const approvalEvent = makeEvent('$approval', {
      type: 'io.mindroom.tool_approval',
      content: {
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: { query: 'release date' },
        agent_name: 'research',
        status: 'pending',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
      },
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 0,
          },
        },
      },
    });
    const room = makeRoom({
      liveEvents: [approvalEvent],
      threads: [
        {
          id: '$approval',
          rootEvent: approvalEvent,
          events: [],
          timeline: [],
          length: 0,
        },
      ] as never[],
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    const approvalMessage = renderer?.root.findByProps({ 'data-message-id': '$approval' });
    const { ThreadBadgeRenderer } = await import('../ThreadBadgeRenderer');
    const threadBadge = findElementInNode(
      approvalMessage?.props.reactions,
      (element) => element.type === ThreadBadgeRenderer
    );

    expect(threadBadge).toBeDefined();
    expect(threadBadge?.props.model.id.threadRootId).toBe('$approval');
    expect(threadBadge?.props.model.replyCount).toBe(0);
  });

  it('routes decrypted encrypted approval events through the approval renderer', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const encryptedApprovalEvent = makeEvent('$encrypted-approval', {
      type: MessageEvent.RoomMessageEncrypted,
      renderInsideEncryptedContentAs: MINDROOM_TOOL_APPROVAL_EVENT,
      content: {
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: { query: 'release date' },
        agent_name: 'research',
        status: 'pending',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
      },
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 1,
          },
        },
      },
    });
    const encryptedApprovalReply = makeEvent('$encrypted-approval-reply', {
      sender: '@bob:example.org',
      threadRootId: '$encrypted-approval',
      relation: { rel_type: 'm.thread', event_id: '$encrypted-approval' },
    });
    const room = makeRoom({
      liveEvents: [encryptedApprovalEvent, encryptedApprovalReply],
      threads: [
        {
          id: '$encrypted-approval',
          rootEvent: encryptedApprovalEvent,
          events: [encryptedApprovalReply],
          timeline: [encryptedApprovalReply],
          length: 1,
        },
      ] as never[],
    });
    const summaryMap = new Map([
      [
        '$encrypted-approval',
        {
          summaryText: 'Encrypted approval summary',
          generatedTs: 10,
          messageCount: 1,
        },
      ],
    ]);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          summaryMap,
        })
      );
      await flushAsyncWork(1);
    });

    const approvalMessage = renderer?.root.findByProps({ 'data-message-id': '$encrypted-approval' });
    const renderedApprovalContent = approvalMessage?.findAll(
      (node) => node.props.eventType === MINDROOM_TOOL_APPROVAL_EVENT
    )[0];

    expect(renderedApprovalContent).toBeDefined();
    expect(renderedApprovalContent?.props.getContent()).toMatchObject({
      approval_id: 'approval-1',
      tool_name: 'web_search',
      status: 'pending',
    });
    const { ThreadBadgeRenderer } = await import('../ThreadBadgeRenderer');
    const threadBadge = findElementInNode(
      approvalMessage?.props.reactions,
      (element) => element.type === ThreadBadgeRenderer
    );
    expect(threadBadge?.props.model.summaryInfo?.summaryText).toBe(
      'Encrypted approval summary'
    );
    expect(threadBadge?.props.includeRecentSummaryData).toBe(true);
  });
});
