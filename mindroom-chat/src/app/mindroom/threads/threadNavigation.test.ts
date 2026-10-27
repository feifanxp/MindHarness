import { describe, expect, it, vi } from 'vitest';
import type { NavigateOptions } from 'react-router-dom';
import {
  getRoomThreadExitTargetFromHistoryState,
  ROOM_THREAD_EXIT_TARGET_STATE_KEY,
} from './roomNavigateState';
import { navigateMindroomRoomThread } from './threadNavigation';

describe('navigateMindroomRoomThread', () => {
  it('seeds pushed thread opens with an exit target and persists it after navigation', () => {
    const navigateRoomThreadDirect = vi.fn();
    const scheduled: (() => void)[] = [];
    const historyState = { key: 'thread-navigation-test-pushed' };

    navigateMindroomRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      eventId: '$reply',
      navigateRoomThreadDirect,
      getLocation: () => ({
        pathname: '/home/!room:example.org',
        search: '?filter=open',
        hash: '#reply',
      }),
      getHistoryState: () => historyState,
      schedule: (callback) => {
        scheduled.push(callback);
      },
      isNativeIOSDevice: () => false,
    });

    expect(navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!room:example.org',
      '$thread',
      '$reply',
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org?filter=open#reply',
            roomId: '!room:example.org',
            threadId: '$thread',
            useHistoryBack: true,
          },
        },
      }
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toBeTypeOf('function');

    scheduled[0]();
    expect(getRoomThreadExitTargetFromHistoryState(historyState)).toEqual({
      exitPath: '/home/!room:example.org?filter=open#reply',
      roomId: '!room:example.org',
      threadId: '$thread',
      useHistoryBack: true,
    });
  });

  it('preserves existing navigate state when adding the exit target', () => {
    const navigateRoomThreadDirect = vi.fn();
    const opts: NavigateOptions = { state: { source: 'test-suite' } };

    navigateMindroomRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      opts,
      navigateRoomThreadDirect,
      getLocation: () => ({ pathname: '/home/!room:example.org', search: '', hash: '' }),
      schedule: () => undefined,
      isNativeIOSDevice: () => false,
    });

    expect(navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!room:example.org',
      '$thread',
      undefined,
      {
        state: {
          source: 'test-suite',
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId: '!room:example.org',
            threadId: '$thread',
            useHistoryBack: true,
          },
        },
      }
    );
  });

  it('marks native iOS thread opens to use the exact exit path instead of history back', () => {
    const navigateRoomThreadDirect = vi.fn();

    navigateMindroomRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      navigateRoomThreadDirect,
      getLocation: () => ({ pathname: '/home/!room:example.org', search: '', hash: '' }),
      schedule: () => undefined,
      isNativeIOSDevice: () => true,
    });

    expect(navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!room:example.org',
      '$thread',
      undefined,
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId: '!room:example.org',
            threadId: '$thread',
            useHistoryBack: false,
          },
        },
      }
    );
  });

  it('does not seed replace navigations', () => {
    const navigateRoomThreadDirect = vi.fn();
    const schedule = vi.fn();
    const opts: NavigateOptions = { replace: true };

    navigateMindroomRoomThread({
      roomId: '!room:example.org',
      threadId: '$thread',
      opts,
      navigateRoomThreadDirect,
      schedule,
    });

    expect(navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!room:example.org',
      '$thread',
      undefined,
      opts
    );
    expect(schedule).not.toHaveBeenCalled();
  });
});
