import React from 'react';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { EventStatus, RelationType, RoomEvent } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultThreadFilterState } from './roomThreadOverviewModel';
import { useRoomLiveRenderController } from './roomLiveRenderController';

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root';

type RoomListener = (...args: unknown[]) => void;

const makeRoom = () => {
  const listeners = new Map<string, Set<RoomListener>>();
  const room = {
    roomId: ROOM_ID,
    findEventById: () => undefined,
    getThread: () => undefined,
    on: (eventType: string, listener: RoomListener) => {
      const eventListeners = listeners.get(eventType) ?? new Set<RoomListener>();
      eventListeners.add(listener);
      listeners.set(eventType, eventListeners);
    },
    removeListener: (eventType: string, listener: RoomListener) => {
      listeners.get(eventType)?.delete(listener);
    },
  } as unknown as Room;

  return {
    room,
    emitTimelineReply: (event: MatrixEvent, liveEvent: boolean) => {
      listeners.get(RoomEvent.Timeline)?.forEach((listener) => {
        listener(event, room, !liveEvent, false, { liveEvent });
      });
    },
    emitPendingReply: (event: MatrixEvent, oldStatus?: EventStatus) => {
      listeners.get(RoomEvent.LocalEchoUpdated)?.forEach((listener) => {
        listener(event, room, oldStatus === undefined ? undefined : event.getId(), oldStatus);
      });
    },
  };
};

const makePendingReply = (): MatrixEvent =>
  ({
    getAssociatedId: () => THREAD_ID,
    getContent: () => ({ body: 'Pending reply', msgtype: 'm.text' }),
    getId: () => '~pending-reply',
    getRelation: () => ({ event_id: THREAD_ID, rel_type: RelationType.Thread }),
    getSender: () => '@alice:example.org',
    getType: () => 'm.room.message',
    isRedacted: () => false,
    isRedaction: () => false,
    isSending: () => true,
    threadRootId: THREAD_ID,
  } as unknown as MatrixEvent);

const renderController = (scrollTop: number) => {
  const { room, emitPendingReply, emitTimelineReply } = makeRoom();
  const markLiveExpansionCandidate = vi.fn();
  const scrollToBottomRef = { current: { count: 0, smooth: false } };
  const scrollElement = {
    clientHeight: 400,
    scrollHeight: 1000,
    scrollTop,
  } as HTMLDivElement;

  const Harness = () => {
    useRoomLiveRenderController({
      atBottomRef: { current: true },
      atLiveEndRef: { current: true },
      effectiveThreadFilterState: createDefaultThreadFilterState(),
      hideActivity: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      ignoredUsersSet: new Set(),
      markLiveExpansionCandidate,
      mx: { getUserId: () => '@alice:example.org' } as MatrixClient,
      normalThreadRecordMap: new Map(),
      onStoreThreadSummary: vi.fn(),
      room,
      roomThreadFilterActive: false,
      scrollRef: { current: scrollElement },
      scrollToBottomRef,
      setSupplementalThreadEvents: vi.fn(),
      observeLiveTail: vi.fn(),
      notifyThreadEventsChanged: vi.fn(),
      setTimeline: vi.fn(),
      setUnreadInfo: vi.fn(),
      showHiddenEvents: false,
      threadEventIndexMapRef: { current: new Map() },
      threadId: THREAD_ID,
      threadResolutionMap: new Map(),
      timelineAtLiveEnd: true,
      unreadInfo: undefined,
    });

    return null;
  };

  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Harness />);
  });

  return {
    emitPendingReply,
    emitTimelineReply,
    markLiveExpansionCandidate,
    renderer: renderer!,
    scrollToBottomRef,
  };
};

describe('useRoomLiveRenderController pending thread replies', () => {
  it('marks expansion candidates only for live timeline appends', () => {
    const { emitTimelineReply, markLiveExpansionCandidate, renderer } = renderController(600);
    const event = makePendingReply();
    act(() => emitTimelineReply(event, false));
    expect(markLiveExpansionCandidate).not.toHaveBeenCalled();
    act(() => emitTimelineReply(event, true));
    expect(markLiveExpansionCandidate).toHaveBeenCalledTimes(1);
    expect(markLiveExpansionCandidate).toHaveBeenCalledWith('~pending-reply');
    renderer.unmount();
  });

  it('arms smooth bottom-follow when a local echo arrives near the bottom', () => {
    const { emitPendingReply, renderer, scrollToBottomRef } = renderController(600);

    act(() => emitPendingReply(makePendingReply()));

    expect(scrollToBottomRef.current).toEqual({ count: 1, smooth: true });
    renderer.unmount();
  });

  it('preserves the viewport when a local echo arrives after the reader scrolled up', () => {
    const { emitPendingReply, renderer, scrollToBottomRef } = renderController(500);

    act(() => emitPendingReply(makePendingReply()));

    expect(scrollToBottomRef.current).toEqual({ count: 0, smooth: false });
    renderer.unmount();
  });

  it('does not re-arm bottom-follow for later local-echo status updates', () => {
    const { emitPendingReply, renderer, scrollToBottomRef } = renderController(600);
    const pendingReply = makePendingReply();

    act(() => emitPendingReply(pendingReply));
    act(() => emitPendingReply(pendingReply, EventStatus.SENDING));

    expect(scrollToBottomRef.current).toEqual({ count: 1, smooth: true });
    renderer.unmount();
  });
});
