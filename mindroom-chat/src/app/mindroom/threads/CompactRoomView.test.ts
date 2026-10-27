import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel, ThreadRecord } from './types';
import { CompactRoomView } from './CompactRoomView';
import { CompactCardSwipe } from './CompactCardSwipe';

vi.mock('../../components/inset-scrollbar/InsetScrollbar', () => ({
  InsetScrollbar: () => null,
}));
const menuProps = vi.hoisted(() => vi.fn());
vi.mock('./ThreadActionsMenu', () => ({
  ThreadActionsMenu: (props: unknown) => {
    menuProps(props);
    return null;
  },
}));

const pinningMocks = vi.hoisted(() => ({
  pinnedEventIds: [] as string[],
  canPin: false,
  setPinned: vi.fn(),
  updating: false,
  error: undefined,
}));
vi.mock('./useInitializeShownThread', () => ({ useInitializeShownThread: () => undefined }));
vi.mock('./useThreadPinning', () => ({ useThreadPinning: () => pinningMocks }));

const {
  passthrough,
  renderedCardProps,
  setResolvedMock,
  useCompactThreadCardViewModelsMock,
  useToggleThreadResolutionMock,
} = vi.hoisted(() => ({
  passthrough: 'div',
  renderedCardProps: vi.fn(),
  setResolvedMock: vi.fn(),
  useCompactThreadCardViewModelsMock: vi.fn(),
  useToggleThreadResolutionMock: vi.fn(),
}));

const makeViewModel = (
  threadRootId: string,
  overrides: Partial<CompactThreadCardViewModel> = {}
): CompactThreadCardViewModel => ({
  id: {
    roomId: '!room:server',
    threadRootId,
  },
  titleText: 'Thread title',
  displayTitleText: 'Thread title',
  previewText: 'Latest reply',
  primarySummaryText: 'Primary summary',
  recentThreadSummaryText: 'Recent summary',
  messageCount: 2,
  messageCountLabel: '2 msgs',
  messageCountText: '2',
  attentionState: 'idle',
  attentionStatusText: 'Idle',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  ...overrides,
});

const makeThreadRecord = (
  threadRootId: string,
  overrides: Partial<ThreadRecord> = {}
): ThreadRecord => ({
  roomId: '!room:server',
  threadRootId,
  rootEventId: threadRootId,
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: undefined,
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    replyParticipantIds: [],
    primarySummaryText: undefined,
    recentThreadSummaryText: undefined,
    messageCount: 0,
    participantIds: [],
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 0,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    tags: [],
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  absoluteIndex: 0,
  ...overrides,
});

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Box: passthrough,
    Button: 'button',
    IconButton: 'button',
    Text: passthrough,
    // Icon buttons name themselves in tooltips; render only the trigger.
    Tooltip: () => null,
    TooltipProvider: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
      children(() => undefined),
  };
});

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('./compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: useCompactThreadCardViewModelsMock,
}));

vi.mock('./useRoomThreadTags', () => ({
  useToggleThreadResolution: useToggleThreadResolutionMock,
}));

vi.mock('./CompactThreadCard', () => ({
  CompactThreadCard: ({
    viewModel,
    onClick,
  }: {
    viewModel: CompactThreadCardViewModel;
    onClick: (threadRootId: string, summaryText?: string) => void;
  }) => {
    renderedCardProps({ viewModel });

    return React.createElement(
      'button',
      {
        type: 'button',
        'data-thread-root-id': viewModel.id.threadRootId,
        onClick: () => onClick(viewModel.id.threadRootId, viewModel.primarySummaryText),
      },
      viewModel.titleText
    );
  },
}));

vi.mock('./CompactRoomView.css', () => ({
  View: 'View',
  EmptyState: 'EmptyState',
  CardAction: 'CardAction',
  CardQuickAction: 'CardQuickAction',
  CardMenuButton: 'CardMenuButton',
  CardShell: 'CardShell',
  PinnedSection: 'PinnedSection',
}));

vi.mock('./CompactCardSwipe.css', () => ({
  SwipeAction: 'SwipeAction',
  SwipeTrack: 'SwipeTrack',
  SwipeTrackEnabled: 'SwipeTrackEnabled',
  SwipeTrackSettling: 'SwipeTrackSettling',
}));

const makeRoom = () =>
  ({
    roomId: '!room:server',
  } as Room);

describe('CompactRoomView', () => {
  it('opens thread actions on right click and navigates only after Open thread is chosen', async () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$context')]);
    const onThreadClick = vi.fn();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$context'],
        threadRecordMap: new Map(),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const shell = renderer.root.findByProps({ className: 'CardShell' });
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 123,
      clientY: 234,
      currentTarget: { querySelector: () => null },
    };
    await act(async () => {
      shell.props.onContextMenu(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(onThreadClick).not.toHaveBeenCalled();
    const selectedMenu = menuProps.mock.calls.at(-1)![0];
    expect(selectedMenu.rootId).toBe('$context');
    expect(selectedMenu.anchor).toEqual({ x: 123, y: 234, width: 0, height: 0 });
    act(() => selectedMenu.onOpenThread());
    expect(onThreadClick).toHaveBeenCalledWith('$context', 'Recent summary');
    renderer.unmount();
  });

  it('offers a keyboard and touch accessible menu button for resolved cards', () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$context', { isResolved: true }),
    ]);
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$context'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    expect(renderer.root.findAllByProps({ 'aria-haspopup': 'menu' })).toHaveLength(1);
    renderer.unmount();
  });

  it('ignores stale callbacks after another thread menu opens', async () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$first'),
      makeViewModel('$second'),
    ]);
    const firstTrigger = { focus: vi.fn(), isConnected: true };
    const secondTrigger = { focus: vi.fn(), isConnected: true };
    const onThreadClick = vi.fn();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$first', '$second'],
        threadRecordMap: new Map(),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const [firstShell, secondShell] = renderer.root.findAllByProps({ className: 'CardShell' });

    await act(async () => {
      firstShell.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 10,
        clientY: 20,
        currentTarget: { querySelector: () => firstTrigger },
      });
    });
    const firstMenu = menuProps.mock.calls.at(-1)![0];

    act(() => {
      secondShell.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 30,
        clientY: 40,
        currentTarget: { querySelector: () => secondTrigger },
      });
    });
    const secondMenu = menuProps.mock.calls.at(-1)![0];

    act(() => firstMenu.onClose());
    expect(firstTrigger.focus).not.toHaveBeenCalled();
    expect(menuProps.mock.calls.at(-1)![0].rootId).toBe('$second');

    act(() => firstMenu.onOpenThread());
    expect(onThreadClick).not.toHaveBeenCalled();
    expect(menuProps.mock.calls.at(-1)![0].rootId).toBe('$second');

    act(() => secondMenu.onClose());
    expect(secondTrigger.focus).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  // Each connected observer's callback, with the elements it watches.
  const resizeCallbacks = new Map<() => void, Set<unknown>>();
  afterEach(() => {
    vi.unstubAllGlobals();
    resizeCallbacks.clear();
  });
  beforeEach(() => {
    pinningMocks.pinnedEventIds = [];
    pinningMocks.canPin = false;
    pinningMocks.setPinned.mockReset();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}

        observe(target: unknown) {
          resizeCallbacks.set(
            this.callback,
            (resizeCallbacks.get(this.callback) ?? new Set()).add(target)
          );
        }

        disconnect() {
          resizeCallbacks.delete(this.callback);
        }
      }
    );
    vi.clearAllMocks();
    useCompactThreadCardViewModelsMock.mockReturnValue([]);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: true,
      setResolved: setResolvedMock,
      updating: false,
      updatingThreadRootIds: new Set(),
      error: undefined,
    });
  });

  it('lets admins pin a card without opening the thread', () => {
    pinningMocks.canPin = true;
    useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$announcement')]);
    const onThreadClick = vi.fn();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$announcement'],
        threadRecordMap: new Map(),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const button = renderer.root.findByProps({ 'data-compact-thread-pin': 'true' });
    act(() => button.props.onClick());
    expect(pinningMocks.setPinned).toHaveBeenCalledWith('$announcement', true);
    expect(onThreadClick).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('groups pins above ordinary cards and omits their Resolve action for every role', () => {
    pinningMocks.pinnedEventIds = ['$announcement'];
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$announcement'),
      makeViewModel('$ordinary'),
    ]);
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$announcement', '$ordinary'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const section = renderer.root.findByProps({ 'data-pinned-threads': 'true' });
    expect(section.findAllByProps({ 'data-thread-root-id': '$announcement' })).toHaveLength(1);
    expect(section.findAllByProps({ 'data-compact-thread-resolve': 'true' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-compact-thread-pin': 'true' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-compact-thread-resolve': 'true' })).toHaveLength(1);
    renderer.unmount();
  });

  it('renders an empty state when there are no thread roots', () => {
    const room = makeRoom();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: [],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    expect(useCompactThreadCardViewModelsMock).toHaveBeenCalledWith({
      room,
      threadRootIds: [],
      threadRecordMap: new Map(),
    });
    expect(renderer.root.findAll((node) => node.children.includes('No threads'))).toHaveLength(1);
    expect(renderedCardProps).not.toHaveBeenCalled();
  });

  it('builds compact card view models through the shared MindRoom selector', () => {
    const room = makeRoom();
    const threadRecordMap = new Map([['$thread-1', makeThreadRecord('$thread-1')]]);
    const viewModel = makeViewModel('$thread-1', { titleText: 'AI summary' });
    useCompactThreadCardViewModelsMock.mockReturnValue([viewModel]);

    create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: ['$thread-1'],
        threadRecordMap,
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    expect(useCompactThreadCardViewModelsMock).toHaveBeenCalledWith({
      room,
      threadRootIds: ['$thread-1'],
      threadRecordMap,
    });
    expect(renderedCardProps).toHaveBeenCalledWith({ viewModel });
  });

  it('resolves an editable thread without opening its compact card', () => {
    const onThreadClick = vi.fn();
    const viewModel = makeViewModel('$thread-resolve');
    useCompactThreadCardViewModelsMock.mockReturnValue([viewModel]);

    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-resolve'],
        threadRecordMap: new Map([['$thread-resolve', makeThreadRecord('$thread-resolve')]]),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const resolveButton = renderer.root.findByProps({
      'data-compact-thread-resolve': 'true',
    });

    act(() => {
      resolveButton.props.onClick();
    });

    expect(resolveButton.props['aria-label']).toBe('Resolve');
    expect(setResolvedMock).toHaveBeenCalledWith('$thread-resolve', true);
    expect(onThreadClick).not.toHaveBeenCalled();
  });

  it('omits the resolve action for resolved threads and users without permission', () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$thread-read-only')]);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: false,
      setResolved: setResolvedMock,
      updating: false,
      updatingThreadRootIds: new Set(),
      error: undefined,
    });
    const readOnly = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-read-only'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    expect(readOnly.root.findAllByProps({ 'data-compact-thread-resolve': 'true' })).toHaveLength(0);

    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$thread-resolved', { isResolved: true }),
    ]);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: true,
      setResolved: setResolvedMock,
      updating: false,
      updatingThreadRootIds: new Set(),
      error: undefined,
    });
    const resolved = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-resolved'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    expect(resolved.root.findAllByProps({ 'data-compact-thread-resolve': 'true' })).toHaveLength(0);
  });

  it('disables only the resolve action whose thread update is pending', () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$thread-pending'),
      makeViewModel('$thread-idle'),
    ]);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: true,
      setResolved: setResolvedMock,
      updating: true,
      updatingThreadRootIds: new Set(['$thread-pending']),
      error: undefined,
    });
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-pending', '$thread-idle'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    const actions = renderer.root.findAllByProps({ 'data-compact-thread-resolve': 'true' });
    expect(actions.map((action) => action.props.disabled)).toEqual([true, false]);
  });

  it('resolves a card swiped on a touch screen and reopens a resolved one', () => {
    const onThreadClick = vi.fn();
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$open'),
      makeViewModel('$done', { isResolved: true }),
    ]);
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$open', '$done'],
        threadRecordMap: new Map(),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const [open, done] = renderer.root.findAllByType(CompactCardSwipe);

    expect(open.props).toMatchObject({ enabled: true, resolved: false, label: 'Resolve' });
    expect(done.props).toMatchObject({ enabled: true, resolved: true, label: 'Reopen thread' });
    act(() => open.props.onSwipe(false));
    act(() => done.props.onSwipe(true));
    // The swipe acts on the state it started from, even if the thread changed since.
    act(() => done.props.onSwipe(false));

    expect(setResolvedMock.mock.calls).toEqual([
      ['$open', true],
      ['$done', false],
      ['$done', true],
    ]);
    expect(onThreadClick).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('turns the swipe off for pins, unsent roots, readers, and a pending update', () => {
    pinningMocks.pinnedEventIds = ['$pinned'];
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$pinned'),
      makeViewModel('~local-echo'),
      makeViewModel('$pending'),
      makeViewModel('$idle'),
    ]);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: true,
      setResolved: setResolvedMock,
      updating: true,
      updatingThreadRootIds: new Set(['$pending']),
      error: undefined,
    });
    const props = {
      room: makeRoom(),
      threadRootIds: ['$pinned', '~local-echo', '$pending', '$idle'],
      threadRecordMap: new Map(),
      onThreadClick: vi.fn(),
      compactRoomScrollStateRef: { current: new Map() },
    };
    const editor = create(React.createElement(CompactRoomView, props));
    const swipeEnabled = (renderer: ReturnType<typeof create>) =>
      renderer.root.findAllByType(CompactCardSwipe).map((swipe) => swipe.props.enabled);

    expect(swipeEnabled(editor)).toEqual([false, false, false, true]);
    editor.unmount();

    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: false,
      setResolved: setResolvedMock,
      updating: false,
      updatingThreadRootIds: new Set(),
      error: undefined,
    });
    const reader = create(React.createElement(CompactRoomView, props));
    expect(swipeEnabled(reader)).toEqual([false, false, false, false]);
    reader.unmount();
  });

  it('reports a failed thread resolution mutation', () => {
    const error = new Error('state event rejected');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: true,
      setResolved: setResolvedMock,
      updating: false,
      error,
    });

    act(() => {
      create(
        React.createElement(CompactRoomView, {
          room: makeRoom(),
          threadRootIds: [],
          threadRecordMap: new Map(),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef: { current: new Map() },
        })
      );
    });

    expect(consoleError).toHaveBeenCalledWith('[CompactRoomView] Resolve failed:', error);
    consoleError.mockRestore();
  });

  it('forwards card clicks using the recent-thread summary from the view model', () => {
    const onThreadClick = vi.fn();
    const viewModel = makeViewModel('$thread-3', {
      primarySummaryText: 'Card title',
      recentThreadSummaryText: 'Recent sidebar summary',
    });
    useCompactThreadCardViewModelsMock.mockReturnValue([viewModel]);
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-3'],
        threadRecordMap: new Map([['$thread-3', makeThreadRecord('$thread-3')]]),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    const button = renderer.root.findByProps({ 'data-thread-root-id': '$thread-3' });

    act(() => {
      button.props.onClick();
    });

    expect(onThreadClick).toHaveBeenCalledWith('$thread-3', 'Recent sidebar summary');
  });

  // The scroll memory's own rules live in scrollAnchorMemory.test.ts; these
  // pin how the overview feeds it. With no rows to measure, it restores the
  // saved offset.
  const createScrollElement = (initialMaxScrollTop = Number.POSITIVE_INFINITY) => {
    let maxScrollTop = initialMaxScrollTop;
    let scrollTop = 0;
    return {
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = Math.min(value, maxScrollTop);
      },
      setMaxScrollTop: (value: number) => {
        maxScrollTop = value;
      },
      getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  };
  const savedAt = (scrollTop: number) => ({ scrollTop, anchors: [] });
  const resize = () => act(() => resizeCallbacks.forEach((_targets, callback) => callback()));
  // Cards loading grow the overview's content, not its viewport.
  const resizeCards = (view: unknown) =>
    act(() =>
      resizeCallbacks.forEach((targets, callback) => {
        if ([...targets].some((target) => target !== view)) callback();
      })
    );
  const renderOverview = (
    room: Room,
    rootIds: string[],
    compactRoomScrollStateRef: React.ComponentProps<
      typeof CompactRoomView
    >['compactRoomScrollStateRef']
  ) => {
    useCompactThreadCardViewModelsMock.mockReturnValue(rootIds.map((id) => makeViewModel(id)));
    return React.createElement(CompactRoomView, {
      room,
      threadRootIds: rootIds,
      threadRecordMap: new Map(rootIds.map((id) => [id, makeThreadRecord(id)])),
      onThreadClick: vi.fn(),
      compactRoomScrollStateRef,
    });
  };
  const nodeMockFor =
    (scrollElement: ReturnType<typeof createScrollElement>) => (element: React.ReactElement) =>
      element.props['data-compact-room-view'] === 'true'
        ? scrollElement
        : // The card swipe track listens for touchmove.
          { addEventListener: () => undefined, removeEventListener: () => undefined };

  it('marks each card as a scroll anchor by its thread root', () => {
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        renderOverview(makeRoom(), ['$thread-1', '$thread-2'], { current: new Map() })
      );
    });

    expect(
      renderer?.root
        .findAll((node) => typeof node.type === 'string' && 'data-scroll-anchor' in node.props)
        .map((node) => node.props['data-scroll-anchor'])
    ).toEqual(['$thread-1', '$thread-2']);
    act(() => renderer?.unmount());
  });

  it.each([false, true])(
    'retries a restore after inset resizing only before the reader moves (moved=%s)',
    (moved) => {
      const room = makeRoom();
      const scrollElement = createScrollElement(100);
      let renderer: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          renderOverview(room, ['$thread-1'], { current: new Map([[room.roomId, savedAt(418)]]) }),
          { createNodeMock: nodeMockFor(scrollElement) }
        );
      });
      expect(scrollElement.scrollTop).toBe(100);
      if (moved) scrollElement.scrollTop = 50;
      scrollElement.setMaxScrollTop(500);
      resize();
      expect(scrollElement.scrollTop).toBe(moved ? 50 : 418);
      act(() => renderer.unmount());
      expect(resizeCallbacks.size).toBe(0);
    }
  );

  it('restores the room scroll position after the compact view remounts', () => {
    const room = makeRoom();
    const compactRoomScrollStateRef = { current: new Map() };
    let scrollElement = createScrollElement();
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(renderOverview(room, ['$thread-1'], compactRoomScrollStateRef), {
        createNodeMock: nodeMockFor(scrollElement),
      });
    });

    scrollElement.scrollTop = 418;
    act(() => {
      renderer?.unmount();
    });

    expect(compactRoomScrollStateRef.current.get(room.roomId)).toEqual(savedAt(418));

    scrollElement = createScrollElement();
    act(() => {
      renderer = create(renderOverview(room, ['$thread-1'], compactRoomScrollStateRef), {
        createNodeMock: nodeMockFor(scrollElement),
      });
    });

    expect(scrollElement.scrollTop).toBe(418);

    act(() => {
      renderer?.unmount();
    });
  });

  it('waits for thread cards and retries a clamped restore as more cards load', () => {
    const room = makeRoom();
    const compactRoomScrollStateRef = { current: new Map([[room.roomId, savedAt(418)]]) };
    const scrollElement = createScrollElement(0);
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(renderOverview(room, [], compactRoomScrollStateRef), {
        createNodeMock: nodeMockFor(scrollElement),
      });
    });

    expect(scrollElement.scrollTop).toBe(0);
    expect(compactRoomScrollStateRef.current.get(room.roomId)).toEqual(savedAt(418));

    scrollElement.setMaxScrollTop(100);
    act(() => {
      renderer?.update(renderOverview(room, ['$thread-1'], compactRoomScrollStateRef));
    });

    expect(scrollElement.scrollTop).toBe(100);

    scrollElement.setMaxScrollTop(500);
    act(() => {
      renderer?.update(renderOverview(room, ['$thread-1', '$thread-2'], compactRoomScrollStateRef));
    });
    resizeCards(scrollElement);

    expect(scrollElement.scrollTop).toBe(418);

    scrollElement.scrollTop = 315;
    act(() => {
      renderer?.update(
        renderOverview(room, ['$thread-1', '$thread-2', '$thread-3'], compactRoomScrollStateRef)
      );
    });
    resizeCards(scrollElement);

    expect(scrollElement.scrollTop).toBe(315);

    act(() => {
      renderer?.unmount();
    });

    expect(compactRoomScrollStateRef.current.get(room.roomId)).toEqual(savedAt(315));
  });

  it('keeps the saved position when the empty overview unmounts before cards load', () => {
    const room = makeRoom();
    const compactRoomScrollStateRef = { current: new Map([[room.roomId, savedAt(418)]]) };
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(renderOverview(room, [], compactRoomScrollStateRef), {
        createNodeMock: nodeMockFor(createScrollElement()),
      });
    });

    act(() => {
      renderer?.unmount();
    });

    expect(compactRoomScrollStateRef.current.get(room.roomId)).toEqual(savedAt(418));
  });
});
