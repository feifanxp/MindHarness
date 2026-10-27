import { describe, expect, it } from 'vitest';
import {
  deriveTimelineMinimapItems,
  resolveTimelineMinimapHeightStyle,
  resolveTimelineMinimapIndexFromPointer,
  resolveTimelineMinimapTopPercent,
  TimelineMinimapEvent,
} from './timelineMinimapViewModel';
import { hasMindroomAgentMessageMetadata, isMindroomAgentUserId } from '../matrix/agentIdentity';

const makeEvent = (input: {
  id?: string;
  type?: string;
  sender?: string;
  content?: Record<string, unknown>;
  redacted?: boolean;
}): TimelineMinimapEvent => ({
  getId: () => input.id,
  getType: () => input.type ?? 'm.room.message',
  getSender: () => input.sender,
  getContent: () => input.content ?? {},
  isRedacted: () => input.redacted ?? false,
});

const userMessage = (id: string, body: string): TimelineMinimapEvent =>
  makeEvent({ id, sender: '@bas:server', content: { msgtype: 'm.text', body } });

const agentMessage = (id: string, body: string): TimelineMinimapEvent =>
  makeEvent({ id, sender: '@mindroom_assistant:server', content: { msgtype: 'm.text', body } });

describe('minimap geometry', () => {
  it('caps rail height at the max height css', () => {
    expect(resolveTimelineMinimapHeightStyle(5)).toBe('min(32px, calc(100vh - 18rem))');
    expect(resolveTimelineMinimapHeightStyle(1)).toBe('min(1px, calc(100vh - 18rem))');
  });

  it('spreads stripes evenly across the rail', () => {
    expect(resolveTimelineMinimapTopPercent(0, 5)).toBe(0);
    expect(resolveTimelineMinimapTopPercent(2, 5)).toBe(50);
    expect(resolveTimelineMinimapTopPercent(4, 5)).toBe(100);
    expect(resolveTimelineMinimapTopPercent(9, 5)).toBe(100);
    expect(resolveTimelineMinimapTopPercent(0, 1)).toBe(0);
  });

  it('resolves the nearest stripe from a pointer position', () => {
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 5,
        railTop: 100,
        railHeight: 100,
        pointerY: 100,
      })
    ).toBe(0);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 5,
        railTop: 100,
        railHeight: 100,
        pointerY: 200,
      })
    ).toBe(4);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 5,
        railTop: 100,
        railHeight: 100,
        pointerY: 155,
      })
    ).toBe(2);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 5,
        railTop: 100,
        railHeight: 100,
        pointerY: 0,
      })
    ).toBe(0);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 1,
        railTop: 100,
        railHeight: 100,
        pointerY: 150,
      })
    ).toBe(0);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 0,
        railTop: 100,
        railHeight: 100,
        pointerY: 150,
      })
    ).toBeNull();
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 5,
        railTop: 100,
        railHeight: 0,
        pointerY: 150,
      })
    ).toBeNull();
  });
});

describe('agent identity', () => {
  it('detects agent senders by the platform username prefix', () => {
    expect(isMindroomAgentUserId('@mindroom_researcher:server')).toBe(true);
    expect(isMindroomAgentUserId('@MindRoom_researcher_ns:server')).toBe(true);
    expect(isMindroomAgentUserId('@bas:server')).toBe(false);
    expect(isMindroomAgentUserId('@mindroomy:server')).toBe(false);
    expect(isMindroomAgentUserId(undefined)).toBe(false);
  });

  it('detects agent messages by io.mindroom content metadata', () => {
    expect(hasMindroomAgentMessageMetadata({ 'io.mindroom.ai_run': { version: 1 } })).toBe(true);
    expect(hasMindroomAgentMessageMetadata({ 'io.mindroom.stream_status': 'active' })).toBe(true);
    expect(
      hasMindroomAgentMessageMetadata({
        'm.new_content': { 'io.mindroom.tool_trace': { steps: [] } },
      })
    ).toBe(true);
    expect(hasMindroomAgentMessageMetadata({ msgtype: 'm.text', body: 'hi' })).toBe(false);
    expect(hasMindroomAgentMessageMetadata(undefined)).toBe(false);
  });
});

describe('deriveTimelineMinimapItems', () => {
  it('creates one stripe per non-agent message with the final agent reply preview', () => {
    const items = deriveTimelineMinimapItems([
      userMessage('$u1', 'first question'),
      agentMessage('$a1', 'thinking...'),
      agentMessage('$a2', 'final answer one'),
      userMessage('$u2', 'second   question\nwith newline'),
      agentMessage('$a3', 'final answer two'),
    ]);

    expect(items).toEqual([
      { id: '$u1', userText: 'first question', agentText: 'final answer one' },
      { id: '$u2', userText: 'second question with newline', agentText: 'final answer two' },
    ]);
  });

  it('skips agent messages detected by content metadata even from human-looking senders', () => {
    const items = deriveTimelineMinimapItems([
      userMessage('$u1', 'question'),
      makeEvent({
        id: '$a1',
        sender: '@bridge:server',
        content: { msgtype: 'm.text', body: 'answer', 'io.mindroom.ai_run': { version: 1 } },
      }),
    ]);

    expect(items).toEqual([{ id: '$u1', userText: 'question', agentText: 'answer' }]);
  });

  it('keeps the last non-empty agent preview when trailing agent events have no text', () => {
    const items = deriveTimelineMinimapItems([
      userMessage('$u1', 'question'),
      agentMessage('$a1', 'the answer'),
      agentMessage('$a2', ''),
    ]);

    expect(items).toEqual([{ id: '$u1', userText: 'question', agentText: 'the answer' }]);
  });

  it('does not pair an agent reply across a redacted question', () => {
    const items = deriveTimelineMinimapItems([
      userMessage('$u1', 'first question'),
      agentMessage('$a1', 'answer one'),
      makeEvent({
        id: '$u2',
        sender: '@bas:server',
        content: {},
        redacted: true,
      }),
      agentMessage('$a2', 'answer two'),
    ]);

    expect(items).toEqual([{ id: '$u1', userText: 'first question', agentText: 'answer one' }]);
  });

  it('still pairs across redacted agent messages', () => {
    const items = deriveTimelineMinimapItems([
      userMessage('$u1', 'question'),
      makeEvent({
        id: '$a1',
        sender: '@mindroom_assistant:server',
        content: {},
        redacted: true,
      }),
      agentMessage('$a2', 'the answer'),
    ]);

    expect(items).toEqual([{ id: '$u1', userText: 'question', agentText: 'the answer' }]);
  });

  it('ignores non-message events, redacted messages, and events without ids', () => {
    const items = deriveTimelineMinimapItems([
      makeEvent({ id: '$m1', type: 'm.room.member', sender: '@bas:server' }),
      userMessage('$u1', 'question'),
      makeEvent({
        id: '$r1',
        sender: '@bas:server',
        content: { msgtype: 'm.text', body: 'redacted' },
        redacted: true,
      }),
      makeEvent({ sender: '@bas:server', content: { msgtype: 'm.text', body: 'no id' } }),
      makeEvent({
        id: '$img',
        sender: '@bas:server',
        content: { msgtype: 'm.image', body: 'photo.png' },
      }),
    ]);

    expect(items).toEqual([
      { id: '$u1', userText: 'question', agentText: null },
      { id: '$img', userText: 'photo.png', agentText: null },
    ]);
  });
});
