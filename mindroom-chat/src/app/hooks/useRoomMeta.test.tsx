import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, Room, RoomState, RoomStateEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { StateEvent } from '../../types/matrix/room';
import { StateEventCallback } from './useStateEventCallback';
import { useRoomAvatar } from './useRoomMeta';

const ROOM_ID = '!room:example.org';

const avatarEvent = (url?: string): MatrixEvent =>
  ({
    getContent: () => (url ? { url } : {}),
    getRoomId: () => ROOM_ID,
    getStateKey: () => '',
    getType: () => StateEvent.RoomAvatar,
  } as unknown as MatrixEvent);

function AvatarHarness({ room, dm }: { room: Room; dm?: boolean }) {
  return <span>{useRoomAvatar(room, dm) ?? 'none'}</span>;
}

describe('useRoomAvatar', () => {
  it('tracks room avatar add, change, and removal state events', () => {
    let currentAvatarEvent: MatrixEvent | undefined;
    let stateEventCallback: StateEventCallback | undefined;
    const client = {
      on: vi.fn((_event, callback: StateEventCallback) => {
        stateEventCallback = callback;
      }),
      removeListener: vi.fn(),
    };
    const room = {
      client,
      roomId: ROOM_ID,
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: () => currentAvatarEvent,
        }),
      }),
    } as unknown as Room;

    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<AvatarHarness room={room} />);
    });

    const renderedAvatar = () => renderer.root.findByType('span').children.join('');
    const emitAvatarState = (event: MatrixEvent) => {
      currentAvatarEvent = event;
      act(() => {
        stateEventCallback?.(event, {} as RoomState, null);
      });
    };

    expect(client.on).toHaveBeenCalledWith(RoomStateEvent.Events, expect.any(Function));
    expect(renderedAvatar()).toBe('none');

    emitAvatarState(avatarEvent('mxc://example.org/first'));
    expect(renderedAvatar()).toBe('mxc://example.org/first');

    emitAvatarState(avatarEvent('mxc://example.org/second'));
    expect(renderedAvatar()).toBe('mxc://example.org/second');

    emitAvatarState(avatarEvent());
    expect(renderedAvatar()).toBe('none');

    act(() => {
      renderer.unmount();
    });
    expect(client.removeListener).toHaveBeenCalledWith(RoomStateEvent.Events, expect.any(Function));
  });

  it('returns the direct member avatar while keeping the state-event subscription', () => {
    const client = {
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const room = {
      client,
      roomId: ROOM_ID,
      getAvatarFallbackMember: () => ({
        getMxcAvatarUrl: () => 'mxc://example.org/direct-member',
      }),
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: () => avatarEvent('mxc://example.org/room'),
        }),
      }),
    } as unknown as Room;

    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<AvatarHarness room={room} dm />);
    });

    expect(renderer.root.findByType('span').children.join('')).toBe(
      'mxc://example.org/direct-member'
    );
    expect(client.on).toHaveBeenCalledWith(RoomStateEvent.Events, expect.any(Function));

    act(() => {
      renderer.unmount();
    });
    expect(client.removeListener).toHaveBeenCalledWith(RoomStateEvent.Events, expect.any(Function));
  });
});
