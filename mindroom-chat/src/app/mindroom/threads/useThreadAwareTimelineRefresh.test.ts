import React from 'react';
import { type Room, RoomEvent, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';

type HarnessProps = {
  room: Room;
  threadId?: string;
  refreshLatestThreadSlice: (threadId: string) => Promise<boolean>;
  onRoomRefresh: () => void;
};

const Harness = ({ room, threadId, refreshLatestThreadSlice, onRoomRefresh }: HarnessProps) => {
  useThreadAwareTimelineRefresh({
    room,
    threadId,
    liveTimelineLinked: true,
    refreshLatestThreadSlice,
    onRoomRefresh,
  });
  return null;
};

describe('useThreadAwareTimelineRefresh', () => {
  it('ignores timeline refreshes while the thread root still has a local event id', async () => {
    let refreshHandler: RoomEventHandlerMap[RoomEvent.TimelineRefresh] | undefined;
    const room = {
      roomId: '!room:example.org',
      on: vi.fn((event, handler) => {
        if (event === RoomEvent.TimelineRefresh) {
          refreshHandler = handler;
        }
      }),
      removeListener: vi.fn(),
    } as unknown as Room;
    const refreshLatestThreadSlice = vi.fn(async () => true);
    const onRoomRefresh = vi.fn();
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(Harness, {
          room,
          threadId: `~${room.roomId}:txn-root`,
          refreshLatestThreadSlice,
          onRoomRefresh,
        })
      );
    });

    await act(async () => {
      refreshHandler?.(room);
    });

    expect(refreshLatestThreadSlice).not.toHaveBeenCalled();
    expect(onRoomRefresh).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });
});
