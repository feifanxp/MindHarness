import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearThreadSummarySharedState } from '../threadSummaryState';

type MockThreadContextBannerProps = {
  onExitThread?: () => void;
  summaryInfo?: { summaryText?: string; generatedTs?: number; messageCount?: number };
};

type MockRoomTimelineProps = {
  threadHeader?: React.ReactNode;
  hasMindroomAgents?: boolean;
  summaryMap: Map<string, { summaryText?: string; generatedTs?: number; messageCount?: number }>;
  onStoreThreadSummary: (
    threadRootId: string,
    info?: { summaryText?: string; generatedTs?: number; messageCount?: number }
  ) => void;
};

const {
  passthrough,
  threadContextBannerState,
  roomTimelineState,
  loadCachedThreadSummariesMock,
  saveCachedThreadSummaryMock,
} = vi.hoisted(() => ({
  passthrough: 'div',
  threadContextBannerState: {
    props: undefined as MockThreadContextBannerProps | undefined,
  },
  roomTimelineState: {
    props: undefined as MockRoomTimelineProps | undefined,
  },
  loadCachedThreadSummariesMock: vi.fn(async () => new Map()),
  saveCachedThreadSummaryMock: vi.fn(async () => undefined),
}));

const storageState = new Map<string, string>();

vi.stubGlobal('localStorage', {
  get length() {
    return storageState.size;
  },
  clear: () => {
    storageState.clear();
  },
  getItem: (key: string) => storageState.get(key) ?? null,
  key: (index: number) => Array.from(storageState.keys())[index] ?? null,
  setItem: (key: string, value: string) => {
    storageState.set(key, value);
  },
  removeItem: (key: string) => {
    storageState.delete(key);
  },
});

vi.stubGlobal('window', {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
  navigator: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
});

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Badge: passthrough,
    Box: passthrough,
    Chip: passthrough,
    Icon: passthrough,
    IconButton: passthrough,
    Spinner: passthrough,
    Text: passthrough,
  };
});

vi.mock('slate-react', () => ({
  ReactEditor: {
    focus: vi.fn(),
  },
}));

vi.mock('is-hotkey', () => ({
  isKeyHotkey: () => false,
}));

vi.mock('../../../hooks/useStateEvent', () => ({
  useStateEvent: () => undefined,
}));

vi.mock('../../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://mindroom.chat',
    getSafeUserId: () => '@alice:example.org',
  }),
}));

vi.mock('../../../components/editor', () => ({
  useEditor: () => ({}),
}));

vi.mock('../../../features/room/RoomInputPlaceholder', () => ({
  RoomInputPlaceholder: passthrough,
}));

vi.mock('../MindroomRoomTimeline', () => ({
  RoomTimeline: (props: MockRoomTimelineProps) => {
    const { threadHeader } = props;
    roomTimelineState.props = props;
    return React.createElement('div', null, threadHeader);
  },
}));

vi.mock('../../../features/room/RoomViewTyping', () => ({
  RoomViewTyping: passthrough,
}));

vi.mock('../../../features/room/RoomTombstone', () => ({
  RoomTombstone: passthrough,
}));

vi.mock('../../room-input/MindroomRoomInput', () => ({
  RoomInput: passthrough,
}));

vi.mock('../../../features/room/RoomViewFollowing', () => ({
  RoomViewFollowing: passthrough,
  RoomViewFollowingPlaceholder: passthrough,
}));

vi.mock('../../../components/page', () => ({
  Page: passthrough,
}));

vi.mock('../../../features/room/RoomViewHeader', () => ({
  RoomViewHeader: passthrough,
}));

vi.mock('../MindroomRoomViewHeader', () => ({
  RoomViewHeader: passthrough,
}));

vi.mock('../ThreadContextBanner', () => ({
  ThreadContextBanner: (props: MockThreadContextBannerProps) => {
    threadContextBannerState.props = props;
    return React.createElement('div');
  },
}));

vi.mock('../../../hooks/useKeyDown', () => ({
  useKeyDown: vi.fn(),
}));

vi.mock('../../../utils/dom', () => ({
  editableActiveElement: () => false,
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: () => [false],
}));

vi.mock('../../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    event: () => true,
  }),
}));

vi.mock('../../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoomFocusEvent: vi.fn(),
  }),
}));

vi.mock('../../native/useEdgeSwipeBack', () => ({
  useEdgeSwipeBack: vi.fn(),
}));

vi.mock('../useThreadRootEvent', () => ({
  useThreadRootEvent: (_room: unknown, threadId: string | undefined) => threadId,
}));

// CINNY-207 P2.3: summary APIs consumed directly from `../cacheStore`.
vi.mock('../cacheStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cacheStore')>();
  return {
    ...actual,
    loadCachedThreadSummaries: loadCachedThreadSummariesMock,
    saveCachedThreadSummary: saveCachedThreadSummaryMock,
  };
});

const flushAsyncWork = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
};

describe('RoomView thread summary sharing', () => {
  beforeEach(() => {
    clearThreadSummarySharedState();
    storageState.clear();
    threadContextBannerState.props = undefined;
    roomTimelineState.props = undefined;
    loadCachedThreadSummariesMock.mockReset();
    saveCachedThreadSummaryMock.mockReset();
    loadCachedThreadSummariesMock.mockResolvedValue(
      new Map([
        [
          '$thread-root',
          {
            summaryText: 'Cached summary',
            generatedTs: 1,
            messageCount: 10,
          },
        ],
      ])
    );
    saveCachedThreadSummaryMock.mockResolvedValue(undefined);
  });

  it('shows cached summary first and upgrades banner and room state when a newer live summary arrives', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = {
      roomId: '!room:example.org',
      getThread: () => undefined,
      findEventById: () => undefined,
    };
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(RoomView, {
          room: room as never,
          hasMindroomAgents: false,
          threadId: '$thread-root',
        })
      );
      await flushAsyncWork();
    });

    expect(loadCachedThreadSummariesMock).toHaveBeenCalledWith(
      'https%3A%2F%2Fmindroom.chat::%40alice%3Aexample.org',
      '!room:example.org'
    );
    expect(roomTimelineState.props?.hasMindroomAgents).toBe(false);
    expect(threadContextBannerState.props?.summaryInfo?.summaryText).toBe('Cached summary');
    expect(roomTimelineState.props?.summaryMap.get('$thread-root')?.summaryText).toBe(
      'Cached summary'
    );

    await act(async () => {
      roomTimelineState.props?.onStoreThreadSummary('$thread-root', {
        summaryText: 'Live summary',
        generatedTs: 2,
        messageCount: 12,
      });
      await flushAsyncWork();
    });

    expect(threadContextBannerState.props?.summaryInfo?.summaryText).toBe('Live summary');
    expect(roomTimelineState.props?.summaryMap.get('$thread-root')?.summaryText).toBe(
      'Live summary'
    );
    expect(saveCachedThreadSummaryMock).toHaveBeenCalledWith(
      'https%3A%2F%2Fmindroom.chat::%40alice%3Aexample.org',
      '!room:example.org',
      '$thread-root',
      expect.objectContaining({
        summaryText: 'Live summary',
        generatedTs: 2,
        messageCount: 12,
      })
    );

    renderer?.unmount();
  });
});

vi.mock('../../messages/ThreadApprovalControls', () => ({ ThreadApprovalQueue: () => null }));
vi.mock('../../background-jobs/BackgroundJobsBar', () => ({ BackgroundJobsBar: () => null }));
vi.mock('../../messages/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: 'thread-approval-provider',
}));

vi.mock('../../engine/engineContext', () => ({
  useMindroomSyncEngine: () => ({
    noteRoomFocused: () => undefined,
    clearRoomFocus: () => undefined,
  }),
}));
