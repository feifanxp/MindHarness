import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  useRoomTimelineNavigationController,
  type RoomTimelineNavigationControllerOptions,
} from './roomTimelineNavigationController';

type Controller = ReturnType<typeof useRoomTimelineNavigationController>;

const renderController = (overrides: Partial<RoomTimelineNavigationControllerOptions>) => {
  const options: RoomTimelineNavigationControllerOptions = {
    handleOpenEvent: vi.fn(),
    hideMembershipEvents: false,
    hideNickAvatarEvents: false,
    ignoredUsersSet: new Set(),
    navigateRoom: vi.fn(),
    navigateRoomThread: vi.fn(),
    room: { roomId: '!room:example.org' } as Room,
    prefetchDepth: 0,
    scrollToBottomRef: { current: { count: 0, smooth: true } },
    setAtBottom: vi.fn(),
    setTimeline: vi.fn(),
    showHiddenEvents: false,
    threadId: '$root',
    ...overrides,
  };
  let controller: Controller | undefined;
  function Harness() {
    controller = useRoomTimelineNavigationController(options);
    return null;
  }
  act(() => {
    create(React.createElement(Harness));
  });
  return { controller: controller as Controller, options };
};

describe('useRoomTimelineNavigationController', () => {
  it('pins a thread to its newest reply synchronously on Jump to Latest', () => {
    const { controller, options } = renderController({});

    const result: unknown = controller.handleJumpToLatest();

    // Nothing is awaited: older-history loading must not gate the jump.
    expect(result).toBeUndefined();
    expect(options.scrollToBottomRef.current).toEqual({ count: 1, smooth: false });
    expect(options.setAtBottom).toHaveBeenCalledWith(true);
    expect(options.navigateRoomThread).not.toHaveBeenCalled();
    expect(options.setTimeline).not.toHaveBeenCalled();
  });

  it('drops a thread permalink before pinning', () => {
    const { controller, options } = renderController({ eventId: '$reply' });

    controller.handleJumpToLatest();

    expect(options.navigateRoomThread).toHaveBeenCalledWith(
      '!room:example.org',
      '$root',
      undefined,
      {
        replace: true,
      }
    );
    expect(options.scrollToBottomRef.current.count).toBe(1);
    expect(options.setAtBottom).toHaveBeenCalledWith(true);
  });
});
