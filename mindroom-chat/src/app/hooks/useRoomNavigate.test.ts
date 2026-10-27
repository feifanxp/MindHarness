import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavigateOptions } from 'react-router-dom';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpaceRoomPath,
  withSearchParam,
} from '../pages/pathUtils';
import { useRoomNavigate } from './useRoomNavigate';
import { ROOM_THREAD_EXIT_TARGET_STATE_KEY } from '../mindroom/threads/roomNavigateState';

const mocks = vi.hoisted(() => ({
  isNativeIOS: vi.fn(() => false),
  navigate: vi.fn(),
  roomToParentsAtom: Symbol('roomToParentsAtom'),
  mDirectAtom: Symbol('mDirectAtom'),
  settingsAtom: Symbol('settingsAtom'),
  roomToParents: new Map<string, Set<string>>(),
  mDirects: new Set<string>(),
  developerTools: false,
  simpleMode: false,
  selectedSpace: undefined as string | undefined,
  mx: {},
  historyState: { idx: 1, key: 'room-entry' },
  location: { pathname: '/home/!room:example.org', search: '', hash: '' },
}));

vi.stubGlobal('window', {
  history: {
    state: mocks.historyState,
  },
  location: mocks.location,
} as unknown as Window & typeof globalThis);

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();

  return {
    ...actual,
    useAtomValue: (atom: unknown) => {
      if (atom === mocks.roomToParentsAtom) return mocks.roomToParents;
      if (atom === mocks.mDirectAtom) return mocks.mDirects;
      throw new Error('Unexpected atom');
    },
  };
});

vi.mock('./useMatrixClient', () => ({
  useMatrixClient: () => mocks.mx,
}));

vi.mock('./router/useSelectedSpace', () => ({
  useSelectedSpace: () => mocks.selectedSpace,
}));

vi.mock('../state/settings', () => ({
  settingsAtom: mocks.settingsAtom,
}));

vi.mock('../state/hooks/settings', () => ({
  useSetting: () => [mocks.developerTools],
}));

vi.mock('../mindroom/settings/useMindroomAccountSettings', () => ({
  useSimpleMode: () => mocks.simpleMode,
}));

vi.mock('../state/room/roomToParents', () => ({
  roomToParentsAtom: mocks.roomToParentsAtom,
}));

vi.mock('../state/mDirectList', () => ({
  mDirectAtom: mocks.mDirectAtom,
}));

vi.mock('../utils/matrix', () => ({
  getCanonicalAliasOrRoomId: (_mx: unknown, roomId: string) => roomId,
}));

vi.mock('../utils/room', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/room')>()),
  guessPerfectParent: () => undefined,
}));

vi.mock('../mindroom/native/nativeSso', () => ({
  isNativeIOS: mocks.isNativeIOS,
}));

type HarnessProps = {
  onRender: (value: ReturnType<typeof useRoomNavigate>) => void;
};

function Harness({ onRender }: HarnessProps) {
  onRender(useRoomNavigate());
  return null;
}

const renderHookHarness = (): {
  getSnapshot: () => ReturnType<typeof useRoomNavigate>;
  renderer: ReactTestRenderer;
} => {
  let latestValue: ReturnType<typeof useRoomNavigate> | undefined;
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(
      React.createElement(Harness, {
        onRender: (value) => {
          latestValue = value;
        },
      })
    );
  });

  return {
    getSnapshot: () => {
      if (!latestValue) {
        throw new Error('Hook snapshot was not captured');
      }

      return latestValue;
    },
    renderer: renderer as ReactTestRenderer,
  };
};

describe('useRoomNavigate', () => {
  afterEach(() => {
    mocks.isNativeIOS.mockReset();
    mocks.isNativeIOS.mockReturnValue(false);
    mocks.navigate.mockReset();
    mocks.roomToParents.clear();
    mocks.mDirects.clear();
    mocks.developerTools = false;
    mocks.simpleMode = false;
    mocks.selectedSpace = undefined;
    mocks.historyState = { idx: 1, key: 'room-entry' };
    Object.assign(window.history, { state: mocks.historyState });
    mocks.location.pathname = '/home/!room:example.org';
    mocks.location.search = '';
    mocks.location.hash = '';
  });

  it('marks pushed thread opens for history back without rewriting the current entry', () => {
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    const threadEventRoomPath = getHomeRoomPath(roomId, eventId);

    expect(mocks.navigate).toHaveBeenNthCalledWith(
      1,
      withSearchParam(threadEventRoomPath, { threadId }),
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId,
            threadId,
            useHistoryBack: true,
          },
        },
      }
    );

    renderer.unmount();
  });

  it('skips pre-seeding when thread navigation already replaces the current history entry', () => {
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const opts: NavigateOptions = { replace: true };
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, undefined, opts);
    });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId), { threadId }),
      opts
    );

    renderer.unmount();
  });

  it('preserves existing navigate state when marking a thread exit target', () => {
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const opts: NavigateOptions = {
      state: {
        source: 'test-suite',
      },
    };
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId, opts);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      {
        state: {
          source: 'test-suite',
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId,
            threadId,
            useHistoryBack: true,
          },
        },
      }
    );

    renderer.unmount();
  });

  it('can navigate directly to a thread route without pre-seeding the current history entry', () => {
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThreadDirect(roomId, threadId, eventId);
    });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      undefined
    );

    renderer.unmount();
  });

  it('keeps space rooms on the flattened Home route when simple mode opens a thread from Home', () => {
    const roomId = '!room:example.org';
    const spaceId = '!space:example.org';
    const threadId = '$thread';
    mocks.roomToParents.set(roomId, new Set([spaceId]));
    mocks.simpleMode = true;
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId), { threadId }),
      expect.any(Object)
    );

    renderer.unmount();
  });

  describe.each([true, false])('selected space with simple mode %s', (simpleMode) => {
    it.each(['navigateRoomThreadDirect', 'navigateRoomThread'] as const)(
      'keeps %s inside the selected space',
      (method) => {
        mocks.simpleMode = simpleMode;
        mocks.selectedSpace = '!space:example.org';
        mocks.roomToParents.set('!room:example.org', new Set(['!space:example.org']));
        const { getSnapshot, renderer } = renderHookHarness();

        act(() => {
          getSnapshot()[method]('!room:example.org', '$thread', '$reply');
        });

        expect(mocks.navigate.mock.calls[0][0]).toBe(
          '/!space%3Aexample.org/!room%3Aexample.org/%24reply?threadId=%24thread'
        );
        renderer.unmount();
      }
    );

    it('keeps a nested-space thread inside the selected nested space', () => {
      mocks.simpleMode = simpleMode;
      mocks.selectedSpace = '!nested:example.org';
      mocks.roomToParents.set('!room:example.org', new Set(['!child:example.org']));
      mocks.roomToParents.set('!child:example.org', new Set(['!nested:example.org']));
      mocks.roomToParents.set('!nested:example.org', new Set(['!outer:example.org']));
      const { getSnapshot, renderer } = renderHookHarness();

      act(() => {
        getSnapshot().navigateRoomThreadDirect('!room:example.org', '$thread');
      });

      expect(mocks.navigate.mock.calls[0][0]).toBe(
        '/!nested%3Aexample.org/!room%3Aexample.org?threadId=%24thread'
      );
      renderer.unmount();
    });

    it('keeps room and focused-event navigation inside the selected space', () => {
      mocks.simpleMode = simpleMode;
      mocks.selectedSpace = '!space:example.org';
      mocks.roomToParents.set('!room:example.org', new Set(['!space:example.org']));
      const { getSnapshot, renderer } = renderHookHarness();

      act(() => {
        getSnapshot().navigateRoom('!room:example.org', '$reply', { replace: true });
        getSnapshot().navigateRoomFocusEvent('!room:example.org', '$reply');
      });

      expect(mocks.navigate.mock.calls[0]).toEqual([
        '/!space%3Aexample.org/!room%3Aexample.org/%24reply',
        { replace: true },
      ]);
      expect(mocks.navigate.mock.calls[1][0]).toBe(
        '/!space%3Aexample.org/!room%3Aexample.org/%24reply?focusEvent=1'
      );
      renderer.unmount();
    });
  });

  it('keeps a direct-room thread inside its selected space in simple mode', () => {
    mocks.simpleMode = true;
    mocks.selectedSpace = '!space:example.org';
    mocks.roomToParents.set('!direct:example.org', new Set(['!space:example.org']));
    mocks.mDirects.add('!direct:example.org');
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThreadDirect('!direct:example.org', '$thread');
    });

    expect(mocks.navigate.mock.calls[0][0]).toBe(
      '/!space%3Aexample.org/!direct%3Aexample.org?threadId=%24thread'
    );
    renderer.unmount();
  });

  it('does not route unrelated room threads through the selected space in simple mode', () => {
    mocks.simpleMode = true;
    mocks.selectedSpace = '!selected:example.org';
    mocks.roomToParents.set('!room:example.org', new Set(['!other:example.org']));
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThreadDirect('!room:example.org', '$thread');
    });

    expect(mocks.navigate.mock.calls[0][0]).toBe('/home/!room%3Aexample.org?threadId=%24thread');
    renderer.unmount();
  });

  it('keeps normal mode space-room navigation scoped to the parent space', () => {
    const roomId = '!room:example.org';
    const spaceId = '!space:example.org';
    const threadId = '$thread';
    mocks.roomToParents.set(roomId, new Set([spaceId]));
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThreadDirect(roomId, threadId);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getSpaceRoomPath(spaceId, roomId), { threadId }),
      undefined
    );

    renderer.unmount();
  });

  it('keeps direct rooms on the Direct route in simple mode', () => {
    const roomId = '!direct:example.org';
    const spaceId = '!space:example.org';
    const threadId = '$thread';
    mocks.roomToParents.set(roomId, new Set([spaceId]));
    mocks.mDirects.add(roomId);
    mocks.simpleMode = true;
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThreadDirect(roomId, threadId);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getDirectRoomPath(roomId), { threadId }),
      undefined
    );

    renderer.unmount();
  });

  it('still marks thread-to-thread navigation for history back', () => {
    mocks.location.search = '?threadId=$threadA';
    const roomId = '!room:example.org';
    const threadId = '$threadB';
    const eventId = '$reply';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org?threadId=$threadA',
            roomId,
            threadId,
            useHistoryBack: true,
          },
        },
      }
    );

    renderer.unmount();
  });

  it('marks native iOS thread exits with the exact previous path instead of history back', () => {
    mocks.isNativeIOS.mockReturnValue(true);
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId,
            threadId,
            useHistoryBack: false,
          },
        },
      }
    );

    renderer.unmount();
  });

  it('navigates to a focused room event without reopening the thread', () => {
    const roomId = '!room:example.org';
    const eventId = '$thread';
    const opts: NavigateOptions = { replace: true };
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomFocusEvent(roomId, eventId, opts);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { focusEvent: '1' }),
      opts
    );

    renderer.unmount();
  });
});
