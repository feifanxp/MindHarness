import React from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadActionsMenu } from './ThreadActionsMenu';
import type { ThreadActionsMenuProps } from './ThreadActionsMenu';

vi.mock('./ThreadContextBanner.css', () => ({
  TagPickerInput: 'input',
  TagPickerInputContainer: 'container',
}));
vi.mock('../../styles/Motion.css', () => ({
  motion: { duration: { Normal: '0ms', Fast: '0ms' }, easing: { Standard: 'linear' } },
}));

const state = vi.hoisted(() => ({
  tags: { displayTags: ['triage'], availableTags: ['urgent'], canEdit: true, isResolved: false },
  mutations: {
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setResolved: vi.fn(),
    updating: false,
    error: null,
  },
  pinning: {
    pinnedEventIds: [] as string[],
    canPin: true,
    setPinned: vi.fn(),
    updating: false,
    error: null,
  },
  save: vi.fn(),
  regenerate: vi.fn(),
  copy: vi.fn(),
  canSend: true,
  rootLoaded: true,
}));
vi.mock('./useThreadTags', () => ({ useThreadTags: () => state.tags }));
vi.mock('./useMutateThreadTags', () => ({ useMutateThreadTags: () => state.mutations }));
vi.mock('./useThreadPinning', () => ({ useThreadPinning: () => state.pinning }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:test' }),
}));
vi.mock('../../hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../hooks/useRoomMembers', () => ({
  useRoomMembers: () => [
    { userId: '@mindroom_helper:test', name: 'Helper', membership: 'join' },
    { userId: '@mindroom_left:test', name: 'Left', membership: 'leave' },
  ],
}));
vi.mock('./threadSummaryActions', async (original) => ({
  ...(await original<typeof import('./threadSummaryActions')>()),
  saveThreadSummary: state.save,
  requestThreadSummary: state.regenerate,
}));
vi.mock('../../utils/dom', () => ({ copyToClipboard: state.copy }));
vi.mock('../../plugins/via-servers', () => ({ getViaServers: () => ['test'] }));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content }: { content: React.ReactNode }) => content,
  Overlay: ({ children }: { children: React.ReactNode }) => children,
  OverlayCenter: 'div',
  OverlayBackdrop: 'div',
  Box: 'div',
  Text: 'span',
  Button: 'button',
}));
vi.mock('../../components/glass/GlassPrimitives', () => ({
  Menu: 'div',
  MenuItem: 'button',
  Dialog: 'div',
}));

const rootEvent = new MatrixEvent({
  event_id: '$root',
  room_id: '!room:test',
  type: 'm.room.message',
  sender: '@me:test',
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body: 'Thread root' },
});
const render = (overrides: Partial<ThreadActionsMenuProps> = {}) =>
  create(
    <ThreadActionsMenu
      room={
        {
          roomId: '!room:test',
          getMyMembership: () => 'join',
          getThread: () => undefined,
          findEventById: (id: string) =>
            state.rootLoaded && id === '$root' ? rootEvent : undefined,
          currentState: { maySendEvent: () => state.canSend },
        } as never
      }
      rootId="$root"
      summaryText="Old summary"
      anchor={{ x: 10, y: 20, width: 0, height: 0 }}
      onClose={vi.fn()}
      onOpenThread={vi.fn()}
      {...overrides}
    />
  );
const click = (renderer: ReturnType<typeof create>, label: string) =>
  act(() => {
    renderer.root
      .findAllByType('button')
      .find((node) => node.props['data-thread-action'] === label)!
      .props.onClick();
  });

describe('ThreadActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tags.canEdit = true;
    state.tags.isResolved = false;
    state.pinning.pinnedEventIds = [];
    state.pinning.canPin = true;
    state.canSend = true;
    state.rootLoaded = true;
    state.save.mockResolvedValue(undefined);
    state.copy.mockResolvedValue(true);
  });

  it('omits navigation for the active thread while retaining summary actions', () => {
    const renderer = render({ onOpenThread: undefined });
    const actions = renderer.root
      .findAllByType('button')
      .map((node) => node.props['data-thread-action']);
    expect(actions).not.toContain('open');
    expect(actions).toContain('editSummary');
    expect(actions).toContain('regenerate');
    renderer.unmount();
  });

  it('offers Hide thread details only from the banner, and closes after hiding', () => {
    let renderer = render();
    expect(renderer.root.findAllByProps({ 'data-thread-action': 'hideDetails' })).toHaveLength(0);
    renderer.unmount();
    const onHideDetails = vi.fn();
    const onClose = vi.fn();
    renderer = render({ onHideDetails, onClose });
    const actions = renderer.root
      .findAllByType('button')
      .map((node) => node.props['data-thread-action']);
    expect(actions.at(-1)).toBe('hideDetails');
    click(renderer, 'hideDetails');
    expect(onHideDetails).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('hides tag and summary mutations until a confirmed thread root is loaded', () => {
    state.rootLoaded = false;
    state.pinning.canPin = false;
    const renderer = render();

    expect(
      renderer.root.findAllByType('button').map((node) => node.props['data-thread-action'])
    ).toEqual(['open', 'tags', 'copy']);
    renderer.unmount();
  });

  it('resolves or reopens the selected thread and suppresses resolve while pinned', () => {
    let renderer = render();
    click(renderer, 'resolve');
    expect(state.mutations.setResolved).toHaveBeenCalledWith('$root', true);
    renderer.unmount();
    state.tags.isResolved = true;
    renderer = render();
    click(renderer, 'resolve');
    expect(state.mutations.setResolved).toHaveBeenLastCalledWith('$root', false);
    renderer.unmount();
    state.pinning.pinnedEventIds = ['$root'];
    renderer = render();
    expect(renderer.root.findAllByProps({ 'data-thread-action': 'resolve' })).toHaveLength(0);
    renderer.unmount();
  });

  it('hides mutations without permissions but leaves navigation and link copying', () => {
    state.tags.canEdit = false;
    state.pinning.canPin = false;
    state.canSend = false;
    const renderer = render();
    const actions = renderer.root
      .findAllByType('button')
      .map((node) => node.props['data-thread-action']);
    expect(actions).toEqual(['open', 'tags', 'copy']);
    renderer.unmount();
  });

  it('lists tags read-only for readers and omits the item when there are none', () => {
    state.tags.canEdit = false;
    let renderer = render();
    const item = renderer.root.findByProps({ 'data-thread-action': 'tags' });
    expect(item.findAll((node) => node.children.includes('Edit tags'))).toHaveLength(0);
    expect(item.findAll((node) => node.children.includes('Tags')).length).toBeGreaterThan(0);
    click(renderer, 'tags');
    expect(renderer.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('Tags');
    expect(renderer.root.findAllByProps({ name: 'triage' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ availableTags: ['urgent'] })).toHaveLength(0);
    renderer.unmount();
    const { displayTags } = state.tags;
    state.tags.displayTags = [];
    renderer = render();
    expect(renderer.root.findAllByProps({ 'data-thread-action': 'tags' })).toHaveLength(0);
    renderer.unmount();
    state.tags.displayTags = displayTags;
  });

  it('keeps a failed summary draft open and saves successfully on retry', async () => {
    state.save.mockRejectedValueOnce(new Error('Offline'));
    const renderer = render();
    click(renderer, 'editSummary');
    const input = renderer.root.findByType('textarea');
    expect(input.props.value).toBe('Old summary');
    act(() => input.props.onChange({ target: { value: 'My new summary' } }));
    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    expect(state.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '$root',
      'My new summary'
    );
    expect(renderer.root.findByType('textarea').props.value).toBe('My new summary');
    expect(renderer.root.findAllByProps({ role: 'alert' }).length).toBeGreaterThan(0);
    renderer.unmount();
  });

  it('lets the user choose a joined agent before sending a regeneration request', async () => {
    const renderer = render();
    click(renderer, 'regenerate');
    expect(state.regenerate).not.toHaveBeenCalled();
    const options = renderer.root.findAllByType('option').map((node) => node.props.value);
    expect(options).toContain('@mindroom_helper:test');
    expect(options).not.toContain('@mindroom_left:test');
    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    expect(state.regenerate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '$root',
      '@mindroom_helper:test'
    );
    renderer.unmount();
  });
});
