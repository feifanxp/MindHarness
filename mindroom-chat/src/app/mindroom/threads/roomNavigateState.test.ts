import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRoomThreadExitTargetFromHistoryState,
  ROOM_THREAD_EXIT_TARGET_STATE_KEY,
  setRoomThreadExitTargetForHistoryState,
  withRoomThreadExitTargetState,
} from './roomNavigateState';

const makeSessionStorage = () => {
  const store = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };
};

describe('roomNavigateState', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      sessionStorage: makeSessionStorage(),
    } as unknown as Window & typeof globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('embeds thread exit target metadata into router state', () => {
    expect(
      withRoomThreadExitTargetState(
        {
          source: 'timeline',
        },
        {
          exitPath: '/home/!room',
          roomId: '!room',
          threadId: '$thread',
          useHistoryBack: true,
        }
      )
    ).toEqual({
      source: 'timeline',
      [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
        exitPath: '/home/!room',
        roomId: '!room',
        threadId: '$thread',
        useHistoryBack: true,
      },
    });
  });

  it('reads explicit router state before falling back to keyed session storage', () => {
    expect(
      getRoomThreadExitTargetFromHistoryState({
        key: 'entry-explicit',
        usr: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room',
            roomId: '!room',
            threadId: '$thread',
            useHistoryBack: false,
          },
        },
      })
    ).toEqual({
      exitPath: '/home/!room',
      roomId: '!room',
      threadId: '$thread',
      useHistoryBack: false,
    });
  });

  it('stores and restores thread exit targets by history entry key', () => {
    expect(
      setRoomThreadExitTargetForHistoryState(
        {
          key: 'entry-session',
        },
        {
          exitPath: '/home/!room',
          roomId: '!room',
          threadId: '$thread',
          useHistoryBack: true,
        }
      )
    ).toBe(true);

    expect(
      getRoomThreadExitTargetFromHistoryState({
        key: 'entry-session',
      })
    ).toEqual({
      exitPath: '/home/!room',
      roomId: '!room',
      threadId: '$thread',
      useHistoryBack: true,
    });
  });

  it('does not store targets when the history entry has no key', () => {
    expect(
      setRoomThreadExitTargetForHistoryState(
        {},
        {
          roomId: '!room',
          threadId: '$thread',
        }
      )
    ).toBe(false);
    expect(getRoomThreadExitTargetFromHistoryState({})).toBeUndefined();
  });
});
