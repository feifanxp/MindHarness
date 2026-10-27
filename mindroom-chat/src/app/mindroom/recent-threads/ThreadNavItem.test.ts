import React from 'react';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../cross-room-threads/crossRoomThreadIndex';
import { ThreadNavItem } from './ThreadNavItem';

const {
  buildViewModelMock,
  navigateRoomMock,
  navigateRoomThreadDirectMock,
  roomViewModeState,
  setResolvedMock,
} = vi.hoisted(() => ({
  buildViewModelMock: vi.fn(),
  navigateRoomMock: vi.fn(),
  navigateRoomThreadDirectMock: vi.fn(),
  roomViewModeState: { value: 'compact' },
  setResolvedMock: vi.fn(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
    reactModule.createElement('span', props, children);
  return {
    Avatar: passthrough,
    Box: passthrough,
    Icon: ({ filled, src }: { filled?: boolean; src?: string }) =>
      reactModule.createElement('span', { 'data-icon-filled': filled, 'data-icon-src': src }),
    IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    Icons: { CheckTwice: 'CheckTwice', Pin: 'Pin', Thread: 'Thread' },
    Text: ({
      as: asElement = 'span',
      children,
      ...props
    }: {
      as?: string;
      children?: React.ReactNode;
    }) => reactModule.createElement(asElement, props, children),
    Tooltip: passthrough,
    TooltipProvider: ({
      children,
      tooltip,
      delay,
    }: {
      children: (ref: () => undefined) => React.ReactNode;
      tooltip: React.ReactNode;
      delay?: number;
    }) =>
      reactModule.createElement(
        'div',
        { 'data-tooltip-delay': delay },
        children(() => undefined),
        tooltip
      ),
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('../../components/nav', async () => {
  const reactModule = await import('react');
  return {
    NavButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    NavItem: reactModule.forwardRef<
      HTMLDivElement,
      React.HTMLAttributes<HTMLDivElement> & {
        highlight?: boolean;
        variant?: string;
        radii?: string;
      }
    >(({ children, ...props }, ref) =>
      reactModule.createElement('div', { ...props, ref }, children)
    ),
    NavItemContent: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    NavItemOptions: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

const room = new Room(
  '!room:example.org',
  createClient({ baseUrl: 'https://example.org' }),
  '@me:example.org'
);
const syncPins = (pinned: string[]) =>
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.pinned_events',
      state_key: '',
      room_id: room.roomId,
      content: { pinned },
    }),
  ]);
const mxMock = {
  getRoom: vi.fn(() => room),
  getUserId: vi.fn(() => '@me:example.org'),
};

vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mxMock }));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigateRoomMock,
    navigateRoomThreadDirect: navigateRoomThreadDirectMock,
  }),
}));
vi.mock('../threads/useInitializeShownThread', () => ({
  useInitializeShownThread: () => undefined,
}));
vi.mock('../../hooks/useRelativeTime', () => ({ useRelativeTime: () => '1m ago' }));
vi.mock('../threads/compactThreadCardViewModel', () => ({
  buildCompactThreadCardViewModelFromRecord: buildViewModelMock,
}));
vi.mock('../threads/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: roomViewModeState.value }),
}));
vi.mock('../threads/useRoomThreadTags', () => ({
  useToggleThreadResolution: () => ({
    canToggle: true,
    setResolved: setResolvedMock,
    updating: false,
    error: undefined,
  }),
}));
vi.mock('./threadNav.css', () => ({
  EntryActions: 'EntryActions',
  Entry: 'Entry',
  EntryPinButtonPinned: 'EntryPinButtonPinned',
  EntrySummary: 'EntrySummary',
  EntryTooltip: 'EntryTooltip',
  EntryTooltipDetails: 'EntryTooltipDetails',
  EntryUnreadDot: 'EntryUnreadDot',
}));

const entry = {
  key: '!room:example.org\u0000$thread',
  roomId: '!room:example.org',
  roomName: 'Research',
  threadRootId: '$thread',
  threadRecord: {},
  lastActivityTs: 200,
  isUnread: true,
  summaryText: 'Ship the sidebar',
} as CrossRoomThreadIndexEntry;

const viewModel = {
  id: { roomId: entry.roomId, threadRootId: entry.threadRootId },
  displayTitleText: 'Ship the sidebar',
  messageCountLabel: '4 msgs',
  messageCountText: '4',
  participants: [
    { userId: '@me:example.org', displayName: 'Me' },
    { userId: '@mindroom_research:example.org', displayName: 'Research Agent' },
  ],
  lastActivityTitle: 'July 15, 2026',
};

const getText = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAll(() => true)
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' ');

describe('ThreadNavItem', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => buildViewModelMock.mockReturnValue(viewModel));

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    roomViewModeState.value = 'compact';
    syncPins([]);
    vi.clearAllMocks();
  });

  const renderItem = (pinned = false, onTogglePin = vi.fn()) => {
    act(() => {
      renderer = create(
        React.createElement(ThreadNavItem, {
          entry,
          onTogglePin,
          pinned,
          selected: false,
        })
      );
    });
    return onTogglePin;
  };

  const getOpenButton = () =>
    renderer!.root.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-label'].startsWith('Open thread:')
    );

  it('uses the room-row shape and opens compact threads directly', () => {
    renderItem();
    const row = renderer!.root.findByProps({ variant: 'Background' });
    expect(row.props.radii).toBe('400');

    act(() => getOpenButton().props.onClick());

    expect(navigateRoomThreadDirectMock).toHaveBeenCalledWith(entry.roomId, entry.threadRootId);
  });

  it('keeps the row summary-first without an inline thread icon or activity time', () => {
    renderItem();

    expect(renderer!.root.findAllByProps({ 'data-icon-src': 'Thread' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ className: 'EntryMeta' })).toHaveLength(0);
    expect(renderer!.root.findByProps({ className: 'EntryActions' })).toBeDefined();
  });

  it('uses room navigation in classic mode', () => {
    roomViewModeState.value = 'classic';
    renderItem();

    act(() => getOpenButton().props.onClick());

    expect(navigateRoomMock).toHaveBeenCalledWith(entry.roomId, entry.threadRootId);
  });

  it('opens the hover details without a delay', () => {
    renderItem();

    expect(renderer!.root.findByProps({ 'data-tooltip-delay': 0 })).toBeDefined();
  });

  it('shows room, agent, message count, and activity in the hover details', () => {
    renderItem();
    const text = getText(renderer!);
    expect(text).toContain('Research');
    expect(text).toContain('Research Agent');
    expect(text).toContain('4 msgs');
    expect(text).toContain('1m ago');
  });

  it('pins without opening the thread', () => {
    const onTogglePin = renderItem(true);
    const pinButton = renderer!.root.findByProps({ 'aria-label': 'Unpin thread' });

    act(() => pinButton.props.onClick());

    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(navigateRoomMock).not.toHaveBeenCalled();
    expect(navigateRoomThreadDirectMock).not.toHaveBeenCalled();
  });

  it('hides Resolve for room pins while retaining personal sidebar pin controls', () => {
    renderItem(true);
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Resolve' }).length).toBeGreaterThan(0);
    act(() => syncPins(['$thread']));
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Resolve' })).toHaveLength(0);
    expect(renderer!.root.findByProps({ 'aria-label': 'Unpin thread' })).toBeDefined();
    act(() => syncPins([]));
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Resolve' }).length).toBeGreaterThan(0);
  });

  it('fills the pin while the pin button is hovered', () => {
    renderItem();
    const pinButton = renderer!.root.findByProps({ 'aria-label': 'Pin thread' });

    expect(pinButton.findByProps({ 'data-icon-src': 'Pin' }).props['data-icon-filled']).toBe(false);

    act(() => pinButton.props.onMouseEnter());
    expect(pinButton.findByProps({ 'data-icon-src': 'Pin' }).props['data-icon-filled']).toBe(true);

    act(() => pinButton.props.onMouseLeave());
    expect(pinButton.findByProps({ 'data-icon-src': 'Pin' }).props['data-icon-filled']).toBe(false);
  });

  it('resolves without opening the thread', () => {
    renderItem();

    act(() => renderer!.root.findByProps({ 'aria-label': 'Resolve' }).props.onClick());

    expect(setResolvedMock).toHaveBeenCalledWith(entry.threadRootId, true);
    expect(navigateRoomMock).not.toHaveBeenCalled();
    expect(navigateRoomThreadDirectMock).not.toHaveBeenCalled();
  });
});
