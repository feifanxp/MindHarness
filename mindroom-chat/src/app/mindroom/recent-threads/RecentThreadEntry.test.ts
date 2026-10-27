import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  bumpRecentThreadMock,
  navigateRoomMock,
  navigateRoomThreadMock,
  navigateRoomThreadDirectMock,
  rekeyRecentThreadMock,
  roomViewModeState,
  summaryTextState,
} = vi.hoisted(() => ({
  bumpRecentThreadMock: vi.fn(),
  navigateRoomMock: vi.fn(),
  navigateRoomThreadMock: vi.fn(),
  navigateRoomThreadDirectMock: vi.fn(),
  rekeyRecentThreadMock: vi.fn(),
  roomViewModeState: { value: 'compact' },
  summaryTextState: { value: 'Thread summary' },
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('folds', () => ({
  Box: ({
    children,
    direction,
    gap,
    justifyContent,
  }: {
    children?: React.ReactNode;
    direction?: string;
    gap?: string;
    justifyContent?: string;
  }) =>
    React.createElement(
      'span',
      {
        'data-folds': 'Box',
        'data-direction': direction,
        'data-gap': gap,
        'data-justify-content': justifyContent,
      },
      children
    ),
  Text: ({
    children,
    priority,
    size,
    truncate,
  }: {
    children?: React.ReactNode;
    priority?: string;
    size?: string;
    truncate?: boolean;
  }) =>
    React.createElement(
      'span',
      {
        'data-folds': 'Text',
        'data-priority': priority,
        'data-size': size,
        'data-truncate': truncate === true,
      },
      children
    ),
}));

vi.mock('../../components/nav', () => ({
  NavButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', props, children),
  NavItem: ({
    children,
    className,
    'data-scroll-anchor': scrollAnchor,
  }: {
    children?: React.ReactNode;
    className?: string;
    'data-scroll-anchor'?: string;
  }) => React.createElement('div', { className, 'data-scroll-anchor': scrollAnchor }, children),
  NavItemContent: ({
    as: asElement = 'div',
    children,
  }: {
    as?: string;
    children?: React.ReactNode;
  }) => React.createElement(asElement, null, children),
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigateRoomMock,
    navigateRoomThread: navigateRoomThreadMock,
    navigateRoomThreadDirect: navigateRoomThreadDirectMock,
  }),
}));

vi.mock('../threads/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: roomViewModeState.value }),
}));

vi.mock('../threads/useInitializeShownThread', () => ({
  useInitializeShownThread: () => undefined,
}));
vi.mock('../../hooks/useRelativeTime', () => ({
  useRelativeTime: () => '1m ago',
}));

vi.mock('../../hooks/useRoomMeta', () => ({
  useRoomName: () => 'Room Name',
}));

vi.mock('./recentThreads', () => ({
  bumpRecentThread: bumpRecentThreadMock,
  rekeyRecentThread: rekeyRecentThreadMock,
}));

vi.mock('../threads/recentThreadViewModel', () => ({
  useRecentThreadViewModel: () => ({
    id: {
      roomId: '!room:example.org',
      threadRootId: '$resolved',
    },
    storedThreadId: '$thread',
    openedAt: 123,
    roomName: 'Room Name',
    summaryText: summaryTextState.value,
    persistableSummaryText: 'Thread summary',
    shouldRekey: true,
  }),
}));

vi.mock('./threadNav.css', () => ({
  RecentlyOpenedEntry: 'RecentlyOpenedEntry',
}));

import { RecentThreadEntry } from './RecentThreadEntry';

describe('RecentThreadEntry', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    roomViewModeState.value = 'compact';
    summaryTextState.value = 'Thread summary';
    vi.clearAllMocks();
  });

  it('navigates recent-thread clicks directly to the target thread route', () => {
    act(() => {
      renderer = create(
        React.createElement(RecentThreadEntry, {
          room: { roomId: '!room:example.org', hasEncryptionStateEvent: () => false } as never,
          threadId: '$thread',
          openedAt: Date.now(),
        })
      );
    });

    const button = renderer!.root.findByType('button');

    act(() => {
      button.props.onClick();
    });

    expect(navigateRoomThreadDirectMock).toHaveBeenCalledWith('!room:example.org', '$resolved');
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
  });

  it('marks its row as a scroll anchor with the same key as its list entry', () => {
    act(() => {
      renderer = create(
        React.createElement(RecentThreadEntry, {
          room: { roomId: '!room:example.org', hasEncryptionStateEvent: () => false } as never,
          threadId: '$thread',
          openedAt: Date.now(),
        })
      );
    });

    expect(renderer!.root.findByType('div').props['data-scroll-anchor']).toBe(
      '!room:example.org|$thread'
    );
  });

  it('uses room navigation when the effective view policy resolves classic mode', () => {
    roomViewModeState.value = 'classic';
    act(() => {
      renderer = create(
        React.createElement(RecentThreadEntry, {
          room: { roomId: '!room:example.org', hasEncryptionStateEvent: () => false } as never,
          threadId: '$thread',
          openedAt: Date.now(),
        })
      );
    });

    act(() => {
      renderer!.root.findByType('button').props.onClick();
    });

    expect(navigateRoomMock).toHaveBeenCalledWith('!room:example.org', '$resolved');
    expect(navigateRoomThreadDirectMock).not.toHaveBeenCalled();
  });

  it('persists a resolved summary snapshot without waiting for room view state', () => {
    act(() => {
      renderer = create(
        React.createElement(RecentThreadEntry, {
          room: { roomId: '!room:example.org', hasEncryptionStateEvent: () => false } as never,
          threadId: '$thread',
          openedAt: Date.now(),
        })
      );
    });

    expect(bumpRecentThreadMock).toHaveBeenCalledWith(
      '!room:example.org',
      '$resolved',
      expect.any(Number),
      'Thread summary'
    );
  });

  it('renders the title before metadata without losing content or accessibility context', () => {
    summaryTextState.value = '🧵 Thread summary';
    act(() => {
      renderer = create(
        React.createElement(RecentThreadEntry, {
          room: { roomId: '!room:example.org', hasEncryptionStateEvent: () => false } as never,
          threadId: '$thread',
          openedAt: Date.now(),
        })
      );
    });

    const textNodes = renderer!.root.findAll((node) => node.props['data-folds'] === 'Text');
    const boxNodes = renderer!.root.findAll((node) => node.props['data-folds'] === 'Box');
    const outerColumn = boxNodes.find((node) => node.props['data-direction'] === 'Column');
    const metadataRow = boxNodes.find(
      (node) => node.props['data-justify-content'] === 'SpaceBetween'
    );
    const title = textNodes.find((node) => node.children.join('') === '🧵 Thread summary')!;
    const roomName = textNodes.find((node) => node.children.join('') === 'Room Name')!;
    const timestamp = textNodes.find((node) => node.children.join('') === '1m ago')!;
    const button = renderer!.root.findByType('button');
    const navItem = renderer!.root.findByType('div');

    expect
      .soft(textNodes.map((node) => node.children.join('')))
      .toEqual(['🧵 Thread summary', 'Room Name', '1m ago']);
    expect.soft(outerColumn?.props['data-gap']).toBeUndefined();
    expect(metadataRow?.props['data-gap']).toBe('100');
    expect(metadataRow?.props['data-justify-content']).toBe('SpaceBetween');
    expect(title.props).toMatchObject({
      'data-size': 'T300',
      'data-truncate': true,
    });
    expect(roomName.props).toMatchObject({
      'data-priority': '300',
      'data-size': 'T200',
      'data-truncate': true,
    });
    expect(timestamp.props).toMatchObject({
      'data-priority': '400',
      'data-size': 'T200',
      'data-truncate': false,
    });
    expect.soft(navItem.props.className).toBe('RecentlyOpenedEntry');
    expect(renderer!.root.findAllByType('span').map((node) => node.children.join(''))).toEqual(
      expect.arrayContaining(['🧵 Thread summary', 'Room Name', '1m ago'])
    );
    expect(button.props['aria-label']).toBe(
      'Open thread: 🧵 Thread summary. Room Name. Opened 1m ago'
    );
  });

  it('exposes a stable accessible label for browser navigation tests and assistive tech', () => {
    act(() => {
      renderer = create(
        React.createElement(RecentThreadEntry, {
          room: { roomId: '!room:example.org', hasEncryptionStateEvent: () => false } as never,
          threadId: '$thread',
          openedAt: Date.now(),
        })
      );
    });

    const button = renderer!.root.findByType('button');

    expect(button.props['aria-label']).toBe(
      'Open thread: Thread summary. Room Name. Opened 1m ago'
    );
    expect(button.findAllByType('div')).toHaveLength(0);
  });
});
