import React from 'react';
import { createClient, Room, RoomStateEvent } from 'matrix-js-sdk';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildThreadResolutionFromTagSnapshot,
  mergeCommandPaletteThreadItems,
  resolveCommandPaletteCurrentThreadRootId,
  useMindroomCommandPaletteThreadItems,
} from './commandPaletteThreadItems';
import type { CommandPaletteThreadItem } from '../command-palette/commandPaletteTypes';
import { MINDROOM_THREAD_TAGS_EVENT } from './threadTags';
import { setRoomEventPinned } from './threadPinning';

const { useAtomValueMock } = vi.hoisted(() => ({
  useAtomValueMock: vi.fn(),
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');
  return {
    ...actual,
    useAtomValue: useAtomValueMock,
  };
});

vi.mock('../recent-threads/recentThreads', () => ({
  makeRecentThreadsAtom: () => 'recent-threads-atom',
}));

const makeItem = (overrides: Partial<CommandPaletteThreadItem>): CommandPaletteThreadItem => ({
  id: 'room|thread',
  kind: 'thread',
  roomId: '!room:example.org',
  threadId: '$thread',
  summaryText: 'Thread',
  roomName: 'General',
  sortRank: 0,
  boost: 0,
  ...overrides,
});

const makeStandaloneMessageEvent = (eventId: string) =>
  new MatrixEvent({
    content: { body: 'Standalone message', msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

describe('buildThreadResolutionFromTagSnapshot', () => {
  it('projects tag snapshots into ThreadRecord resolution input', () => {
    expect(
      buildThreadResolutionFromTagSnapshot({
        content: {
          tags: { resolved: { set_by: '@alice:example.org', set_at: '2026-09-21T00:00:00Z' } },
        },
        isResolved: true,
        displayTags: ['done'],
      })
    ).toEqual({
      isResolved: true,
      tags: { done: true },
    });
  });

  it('returns undefined when no tag snapshot exists', () => {
    expect(buildThreadResolutionFromTagSnapshot(undefined)).toBeUndefined();
  });
});

describe('useMindroomCommandPaletteThreadItems', () => {
  beforeEach(() => {
    useAtomValueMock.mockReturnValue([]);
  });

  it.each([true, false])(
    'updates mounted palette entries for pins with selected=%s',
    async (selected) => {
      const userId = '@admin:example.org';
      const mx = createClient({ baseUrl: 'https://example.org', userId });
      const room = new Room('!room:example.org', mx, userId);
      room.on(RoomStateEvent.Events, (event, state, previous) =>
        mx.emit(RoomStateEvent.Events, event, state, previous)
      );
      const root = makeStandaloneMessageEvent('$standalone');
      vi.spyOn(room, 'findEventById').mockReturnValue(root);
      room.currentState.setStateEvents([
        new MatrixEvent({
          type: MINDROOM_THREAD_TAGS_EVENT,
          state_key: '["$standalone","resolved"]',
          room_id: room.roomId,
          content: { set_by: userId, set_at: '2026-09-21T00:00:00Z' },
        }),
        new MatrixEvent({
          type: 'm.room.create',
          state_key: '',
          room_id: room.roomId,
          sender: userId,
          content: { room_version: '11', creator: userId },
        }),
        new MatrixEvent({
          type: 'm.room.power_levels',
          state_key: '',
          room_id: room.roomId,
          content: { users: { [userId]: 100 } },
        }),
      ]);
      const syncPins = (pinned: string[]) =>
        room.currentState.setStateEvents([
          new MatrixEvent({
            type: 'm.room.pinned_events',
            state_key: '',
            event_id: '$synced',
            room_id: room.roomId,
            content: { pinned },
          }),
        ]);
      vi.spyOn(mx, 'getStateEvent').mockResolvedValue({ pinned: [] });
      vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$saved' });
      let snapshot!: ReturnType<typeof useMindroomCommandPaletteThreadItems>;
      const getRoom = () => room;
      const allJoinedRoomIds = [room.roomId];
      const navigateRoomThread = vi.fn();
      useAtomValueMock.mockReturnValue([
        { roomId: room.roomId, threadId: '$standalone', openedAt: 1 },
      ]);
      function Probe() {
        snapshot = useMindroomCommandPaletteThreadItems({
          mx,
          myUserId: userId,
          allJoinedRoomIds,
          getRoom,
          selectedRoom: selected ? room : undefined,
          selectedRoomId: room.roomId,
          currentThreadId: '$standalone',
          navigateRoomThread,
        });
        return null;
      }
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(React.createElement(Probe));
      });
      try {
        expect(snapshot.currentThreadPinned).toBe(false);
        expect(snapshot.threadItems[0].isResolved).toBe(true);
        act(() => syncPins(['$standalone']));
        expect(snapshot.currentThreadPinned).toBe(selected);
        expect(snapshot.threadItems[0].isResolved).toBe(false);
        act(() => syncPins([]));
        expect(snapshot.currentThreadPinned).toBe(false);
        expect(snapshot.threadItems[0].isResolved).toBe(true);
        await act(async () => {
          await setRoomEventPinned(mx, room, '$standalone', true);
        });
        expect(snapshot.currentThreadPinned).toBe(selected);
        expect(snapshot.threadItems[0].isResolved).toBe(false);
      } finally {
        act(() => renderer.unmount());
      }
    }
  );

  it.each([false, true])(
    'guards resolution of a standalone root when pinned=%s',
    async (pinned) => {
      const sendStateEvent = vi.fn().mockResolvedValue(undefined);
      const standaloneRoot = makeStandaloneMessageEvent('$standalone');
      const selectedRoom = {
        roomId: '!room:example.org',
        on: vi.fn(),
        removeListener: vi.fn(),
        name: 'Personal',
        findEventById: (eventId: string) =>
          eventId === '$standalone' ? standaloneRoot : undefined,
        getThread: () => undefined,
        getThreads: () => [],
        getLiveTimeline: () => ({
          getState: () => ({
            getStateEvents: (type: string, key?: string) =>
              key === undefined
                ? []
                : type === 'm.room.pinned_events'
                ? new MatrixEvent({
                    type,
                    state_key: '',
                    content: { pinned: pinned ? ['$standalone'] : [] },
                  })
                : undefined,
          }),
        }),
      };
      let snapshot: ReturnType<typeof useMindroomCommandPaletteThreadItems> | undefined;

      const Harness = () => {
        snapshot = useMindroomCommandPaletteThreadItems({
          mx: { sendStateEvent, on: vi.fn(), removeListener: vi.fn() } as never,
          myUserId: '@alice:example.org',
          allJoinedRoomIds: [],
          getRoom: () => undefined,
          selectedRoom: selectedRoom as never,
          selectedRoomId: '!room:example.org',
          currentThreadId: '$standalone',
          navigateRoomThread: vi.fn(),
        });
        return null;
      };

      const renderer = create(React.createElement(Harness));

      await act(async () => {
        snapshot?.setCurrentThreadResolved(true);
      });

      if (pinned) {
        expect(sendStateEvent).not.toHaveBeenCalled();
      } else
        expect(sendStateEvent).toHaveBeenCalledWith(
          '!room:example.org',
          MINDROOM_THREAD_TAGS_EVENT,
          expect.objectContaining({
            set_by: '@alice:example.org',
            set_at: expect.any(String),
          }),
          '["$standalone","resolved"]'
        );

      renderer.unmount();
    }
  );
});

describe('mergeCommandPaletteThreadItems', () => {
  it('keeps richer thread facts while taking the stronger ranks', () => {
    const merged = mergeCommandPaletteThreadItems(
      makeItem({
        summaryText: 'Existing summary',
        participantNames: ['Alice'],
        tags: ['todo'],
        isResolved: false,
        messageCount: 2,
        sortRank: 5,
        boost: 10,
      }),
      makeItem({
        summaryText: 'Thread',
        participantNames: [],
        tags: [],
        sortRank: 3,
        boost: 20,
      })
    );

    expect(merged.summaryText).toBe('Existing summary');
    expect(merged.participantNames).toEqual(['Alice']);
    expect(merged.tags).toEqual(['todo']);
    expect(merged.isResolved).toBe(false);
    expect(merged.messageCount).toBe(2);
    expect(merged.sortRank).toBe(5);
    expect(merged.boost).toBe(20);
  });
});

describe('resolveCommandPaletteCurrentThreadRootId', () => {
  it('canonicalizes the route thread id through the MindRoom thread owner', () => {
    const room = {
      getThread: () => undefined,
      findEventById: () => ({
        getId: () => '$reply',
        getTxnId: () => undefined,
        getUnsigned: () => ({}),
        isSending: () => false,
        threadRootId: '$root',
      }),
    };

    expect(resolveCommandPaletteCurrentThreadRootId(room as never, '$reply')).toBe('$root');
  });

  it('returns undefined when the command palette is not on a thread route', () => {
    expect(resolveCommandPaletteCurrentThreadRootId(undefined, '$reply')).toBeUndefined();
    expect(resolveCommandPaletteCurrentThreadRootId({} as never, undefined)).toBeUndefined();
  });
});
