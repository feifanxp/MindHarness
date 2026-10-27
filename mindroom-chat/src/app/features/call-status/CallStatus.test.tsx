import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallEmbed } from '../../plugins/call/CallEmbed';
import { CallStatus } from './CallStatus';

const CALL_ROOM = { roomId: '!call:mindroom.test' };
const FAILURE = {
  eventId: '$failure',
  message: 'Voice call error: the speech provider rejected the configured credential.',
};

const state = vi.hoisted(() => ({
  selectedRoom: undefined as string | undefined,
  failure: undefined as { eventId: string; message: string } | undefined,
  failureArgs: [] as unknown[],
}));

vi.mock('./styles.css', () => ({ CallStatus: 'call-status', ControlDivider: 'divider' }));
vi.mock('../../styles/ContainerColor.css', () => ({ ContainerColor: () => 'container' }));
vi.mock('./LiveChip', () => ({ LiveChip: () => null }));
vi.mock('./CallRoomName', () => ({ CallRoomName: () => null }));
vi.mock('./CallControl', () => ({ CallControl: () => null }));
vi.mock('./MemberGlance', () => ({ MemberGlance: () => null }));
vi.mock('./MemberSpeaking', () => ({ MemberSpeaking: () => null }));
vi.mock('../../hooks/useCall', () => ({
  useCallSession: () => undefined,
  useCallMembers: () => [],
}));
vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: { Desktop: 'Desktop', Tablet: 'Tablet', Mobile: 'Mobile' },
  useScreenSize: () => 'Desktop',
}));
vi.mock('../../hooks/useCallEmbed', () => ({ useCallJoined: () => true }));
vi.mock('../../hooks/useCallSpeakers', () => ({ useCallSpeakers: () => new Set() }));
vi.mock('../../hooks/router/useSelectedRoom', () => ({
  useSelectedRoom: () => state.selectedRoom,
}));
vi.mock('../../mindroom/calls/useCallFailureNotice', () => ({
  useCallFailureNotice: (...args: unknown[]) => {
    state.failureArgs = args;
    return state.failure;
  },
}));

const render = () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <CallStatus callEmbed={{ room: CALL_ROOM, startedAfterTs: 1 } as unknown as CallEmbed} />
    );
  });
  return renderer;
};

const nodeText = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : nodeText(child))).join('');

const alerts = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => typeof node.type === 'string' && node.props.role === 'alert');

describe('CallStatus', () => {
  beforeEach(() => {
    state.selectedRoom = '!thread-room:mindroom.test';
    state.failure = FAILURE;
    state.failureArgs = [];
  });

  it('shows an agent call failure in the bar until dismissed while the user is elsewhere', () => {
    const renderer = render();

    expect(state.failureArgs).toEqual([CALL_ROOM, true, 1]);
    expect(alerts(renderer).map(nodeText)).toEqual([FAILURE.message]);

    act(() =>
      renderer.root
        .findAll(
          (node) =>
            node.type === 'button' && node.props['aria-label'] === 'Dismiss voice call error'
        )[0]
        .props.onClick()
    );
    expect(alerts(renderer)).toHaveLength(0);
  });

  it('leaves the failure to the call view while the call room is open', () => {
    state.selectedRoom = CALL_ROOM.roomId;

    expect(alerts(render())).toHaveLength(0);
  });
});
