import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel } from './types';
import { CompactRoomView, type CompactRoomViewProps } from './CompactRoomView';

const state = vi.hoisted(() => ({
  actionRenderProps: vi.fn(),
  canPin: true,
  canToggle: true,
  models: [] as CompactThreadCardViewModel[],
  pinnedEventIds: [] as string[],
  pinUpdating: false,
  setPinned: vi.fn(),
  setResolved: vi.fn(),
  updatingThreadRootIds: new Set<string>(),
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  const react = await import('react');
  // Forwards its ref like folds' IconButton, which the action tooltips attach to.
  const ActionControl = react.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
    (props, ref) => {
      state.actionRenderProps(props);
      return react.createElement('button', { ...props, ref });
    }
  );

  return {
    ...actual,
    Box: 'div',
    Button: ActionControl,
    IconButton: ActionControl,
    Icon: () => null,
    Text: 'span',
  };
});

vi.mock('./useInitializeShownThread', () => ({ useInitializeShownThread: () => undefined }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../components/inset-scrollbar/InsetScrollbar', () => ({
  InsetScrollbar: () => null,
}));

vi.mock('./ThreadActionsMenu', () => ({
  ThreadActionsMenu: () => null,
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

vi.mock('./compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: () => state.models,
}));

vi.mock('./useRoomThreadTags', () => ({
  useToggleThreadResolution: () => ({
    canToggle: state.canToggle,
    setResolved: state.setResolved,
    updatingThreadRootIds: state.updatingThreadRootIds,
    error: undefined,
  }),
}));

vi.mock('./useThreadPinning', () => ({
  useThreadPinning: () => ({
    canPin: state.canPin,
    pinnedEventIds: state.pinnedEventIds,
    setPinned: state.setPinned,
    updating: state.pinUpdating,
    error: undefined,
  }),
}));

vi.mock('./CompactThreadCard', () => ({
  CompactThreadCard: React.memo(({ viewModel }: { viewModel: CompactThreadCardViewModel }) => (
    <button type="button" data-thread-root-id={viewModel.id.threadRootId}>
      {viewModel.titleText}
    </button>
  )),
}));

const makeViewModel = (
  threadRootId: string,
  overrides: Partial<CompactThreadCardViewModel> = {}
): CompactThreadCardViewModel => ({
  id: { roomId: '!room:server', threadRootId },
  titleText: `Thread ${threadRootId}`,
  displayTitleText: `Thread ${threadRootId}`,
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

const makeProps = (): CompactRoomViewProps => ({
  room: { roomId: '!room:server' } as Room,
  threadRootIds: state.models.map((model) => model.id.threadRootId),
  threadRecordMap: new Map(),
  onThreadClick: vi.fn(),
  compactRoomScrollStateRef: { current: new Map() },
});

describe('CompactRoomView row rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.canPin = true;
    state.canToggle = true;
    state.models = ['$first', '$second', '$third'].map((rootId) => makeViewModel(rootId));
    state.pinnedEventIds = [];
    state.pinUpdating = false;
    state.setPinned = vi.fn();
    state.setResolved = vi.fn();
    state.updatingThreadRootIds = new Set();
  });

  it('rerenders action controls only for rows whose action state changed', async () => {
    const props = makeProps();
    const renderer = create(<CompactRoomView {...props} />);
    expect(state.actionRenderProps).toHaveBeenCalledTimes(9);

    act(() => renderer.update(<CompactRoomView {...props} />));
    expect(state.actionRenderProps).toHaveBeenCalledTimes(9);

    state.updatingThreadRootIds = new Set(['$first']);
    act(() => renderer.update(<CompactRoomView {...props} />));
    expect(state.actionRenderProps).toHaveBeenCalledTimes(12);

    const firstMoreButton = renderer.root
      .findAllByType('button')
      .filter((button) => button.props['aria-haspopup'] === 'menu')[0];
    await act(async () => {
      firstMoreButton.props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ x: 10, y: 20, width: 30, height: 40 }),
        },
      });
    });
    expect(state.actionRenderProps).toHaveBeenCalledTimes(15);

    state.pinnedEventIds = ['$second'];
    act(() => renderer.update(<CompactRoomView {...props} />));
    expect(state.actionRenderProps).toHaveBeenCalledTimes(17);

    state.models = [
      state.models[0],
      state.models[1],
      makeViewModel('$third', { isResolved: true }),
    ];
    act(() => renderer.update(<CompactRoomView {...props} />));
    expect(state.actionRenderProps).toHaveBeenCalledTimes(19);

    renderer.unmount();
  });

  it('uses the latest mutation callbacks without rerendering an unchanged row', () => {
    state.models = [makeViewModel('$first')];
    const props = makeProps();
    const firstSetPinned = state.setPinned;
    const firstSetResolved = state.setResolved;
    const renderer = create(<CompactRoomView {...props} />);
    expect(state.actionRenderProps).toHaveBeenCalledTimes(3);

    const latestSetPinned = vi.fn();
    const latestSetResolved = vi.fn();
    state.setPinned = latestSetPinned;
    state.setResolved = latestSetResolved;
    act(() => renderer.update(<CompactRoomView {...props} />));
    expect(state.actionRenderProps).toHaveBeenCalledTimes(3);

    const hostButtons = renderer.root.findAllByType('button');
    act(() => {
      hostButtons.find((button) => button.props['data-compact-thread-resolve'])!.props.onClick();
      hostButtons.find((button) => button.props['data-compact-thread-pin'])!.props.onClick();
    });

    expect(latestSetResolved).toHaveBeenCalledWith('$first', true);
    expect(latestSetPinned).toHaveBeenCalledWith('$first', true);
    expect(firstSetResolved).not.toHaveBeenCalled();
    expect(firstSetPinned).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
