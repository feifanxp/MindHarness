import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasListEntry } from '../../canvas/canvasIndexStore';
import { mindroomAccountSettingsAtom } from '../../settings/useMindroomAccountSettings';

const { encryptionState, navigateSpy, permissionState, screenSizeState, membersState } = vi.hoisted(
  () => ({
    navigateSpy: vi.fn(),
    membersState: { open: false, setOpen: vi.fn() },
    encryptionState: {
      value: undefined as unknown,
    },
    permissionState: {
      canInvite: true,
      canKick: true,
    },
    screenSizeState: {
      value: 'Desktop',
    },
  })
);

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  const reactModule = await import('react');

  return {
    ...actual,
    Avatar: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Badge: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Box: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    config: {
      ...actual.config,
      space: {
        ...actual.config.space,
        S100: '4px',
      },
    },
    Icon: ({ src }: { src: string }) => reactModule.createElement('span', { 'data-icon': src }),
    IconButton: React.forwardRef<
      HTMLButtonElement,
      React.ButtonHTMLAttributes<HTMLButtonElement> & {
        children: React.ReactNode;
      }
    >(({ children, ...props }, ref) =>
      reactModule.createElement('button', { ref, type: 'button', ...props }, children)
    ),
    Icons: {
      ArrowLeft: 'ArrowLeft',
      CheckTwice: 'CheckTwice',
      Monitor: 'Monitor',
      Pin: 'Pin',
      Search: 'Search',
      Terminal: 'Terminal',
      User: 'User',
      VerticalDots: 'VerticalDots',
    },
    Line: () => reactModule.createElement('hr'),
    Menu: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    MenuItem: ({
      children,
      after,
      onClick,
    }: {
      children: React.ReactNode;
      after?: React.ReactNode;
      onClick?: () => void;
    }) => reactModule.createElement('button', { type: 'button', onClick }, children, after),
    Overlay: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    OverlayBackdrop: () => reactModule.createElement('div'),
    OverlayCenter: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
      anchor ? content : null,
    Spinner: () => reactModule.createElement('div'),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    toRem: (value: number) => `${value}rem`,
    Tooltip: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    TooltipProvider: ({
      children,
    }: {
      children: (triggerRef: React.Ref<HTMLButtonElement>) => React.ReactNode;
    }) =>
      reactModule.createElement(
        reactModule.Fragment,
        null,
        children(() => undefined)
      ),
  };
});

vi.mock('focus-trap-react', async () => {
  const reactModule = await import('react');
  return {
    default: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement(reactModule.Fragment, null, children),
  };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateSpy,
}));

vi.mock('../../../components/page', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../../styles/ContainerColor.css', () => ({
  ContainerColor: () => 'ContainerColor',
}));

vi.mock('../../../components/room-avatar', () => ({
  RoomAvatar: () => React.createElement('div'),
  RoomIcon: () => React.createElement('div'),
}));

vi.mock('../../../components/UseStateProvider', () => ({
  UseStateProvider: ({
    children,
  }: {
    children: (state: boolean, setState: (value: boolean) => void) => React.ReactNode;
  }) => React.createElement(React.Fragment, null, children(false, vi.fn())),
}));

vi.mock('../../../components/room-topic-viewer', () => ({
  RoomTopicViewer: () => React.createElement('div'),
}));

vi.mock('../../native/MindroomBackRouteHandler', () => ({
  MindroomBackRouteHandler: ({ children }: { children: (onBack: () => void) => React.ReactNode }) =>
    React.createElement(React.Fragment, null, children(vi.fn())),
}));

vi.mock('../../../components/leave-room-prompt', () => ({
  LeaveRoomPrompt: () => React.createElement('div'),
}));

vi.mock('../../../components/invite-user-prompt', () => ({
  InviteUserPrompt: () => React.createElement('div'),
}));

vi.mock('../../../hooks/useStateEvent', () => ({
  useStateEvent: () => encryptionState.value,
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://example.org',
    getSafeUserId: () => '@user:example.org',
  }),
}));

vi.mock('../../../hooks/useRoom', () => ({
  useRoom: () => ({
    roomId: '!room:example.org',
    getJoinRule: () => undefined,
    isSpaceRoom: () => false,
  }),
  useIsDirectRoom: () => false,
}));

vi.mock('../../sidebar/useMembersDrawer', () => ({
  useMembersDrawer: () => [membersState.open, membersState.setOpen],
}));

vi.mock('../../../hooks/useSpace', () => ({
  useSpaceOptionally: () => undefined,
}));

vi.mock('../../../utils/matrix', () => ({
  getCanonicalAliasOrRoomId: () => '!room:example.org',
  isRoomAlias: () => false,
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../../features/room/RoomViewHeader.css', () => ({
  HeaderTopic: 'HeaderTopic',
}));

vi.mock('../../threads/MindroomRoomViewHeader.css', () => ({
  Header: 'Header',
  Topic: 'Topic',
}));

vi.mock('../../schedules/roomSchedules.css', () => ({
  Trigger: 'Trigger',
  Count: 'Count',
}));

// The schedules browser tests exercise the dialog and its mention/profile UI.
vi.mock('../../schedules/RoomSchedulesDialog', () => ({
  RoomSchedulesDialog: () => null,
}));

vi.mock('../../threads/useStateEvents', () => ({
  useStateEvents: () => [],
}));

// AgentCallHeaderButton.test.tsx covers the button; this file checks where the header places it.
vi.mock('../../calls/AgentCallHeaderButton', () => ({
  AgentCallHeaderButton: ({ threadId }: { threadId?: string }) =>
    React.createElement('agent-call-button', { 'data-thread-id': threadId }),
}));

vi.mock('../../notifications/MindroomMarkRoomReadMenuItem', () => ({
  MindroomMarkRoomReadMenuItem: () => null,
}));

vi.mock('../../rooms/ArchiveRoomMenuItem', () => ({
  ArchiveRoomMenuItem: () => null,
}));

vi.mock('../../canvas/CanvasHeaderButton', () => ({
  CanvasHeaderButton: (props: Record<string, unknown>) =>
    React.createElement('mock-canvas-header-button', props),
}));

vi.mock('../../threads/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ availableViewModes: [], setViewMode: vi.fn(), viewMode: 'threaded' }),
}));

vi.mock('../../../state/hooks/unread', () => ({
  useRoomUnread: () => false,
}));

vi.mock('../../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../notifications/readReceipts', () => ({
  markRoomAndThreadsAsRead: vi.fn(),
}));

vi.mock('../../../state/room/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('../../../utils/dom', () => ({
  copyToClipboard: vi.fn(),
}));

vi.mock('../../../hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'General',
  useRoomTopic: () => undefined,
}));

vi.mock('../../../hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Tablet: 'Tablet',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => screenSizeState.value,
}));

vi.mock('../../../utils/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

vi.mock('../../../plugins/matrix-to', () => ({
  getMatrixToRoom: () => 'matrix.to/#/!room:example.org',
}));

vi.mock('../../../plugins/via-servers', () => ({
  getViaServers: () => [],
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../hooks/useRoomPinnedEvents', () => ({
  useRoomPinnedEvents: () => [],
}));

vi.mock('../../../features/room/room-pin-menu', () => ({
  RoomPinMenu: () => React.createElement('div'),
}));

vi.mock('../../messages/MindroomRoomPinMenu', () => ({
  RoomPinMenu: () => React.createElement('div'),
}));

vi.mock('../../../state/hooks/roomSettings', () => ({
  useOpenRoomSettings: () => vi.fn(),
}));

vi.mock('../../../components/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: ({
    children,
  }: {
    children: (handleOpen: () => void, opened: boolean, changing: boolean) => React.ReactNode;
  }) => React.createElement(React.Fragment, null, children(vi.fn(), false, false)),
}));

vi.mock('../../../hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => 'all_messages',
  getRoomNotificationModeIcon: () => 'Notification',
  useRoomsNotificationPreferencesContext: () => ({}),
}));

vi.mock('../../../features/room/jump-to-time', () => ({
  JumpToTime: () => React.createElement('div'),
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: vi.fn(),
    navigateRoomThread: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => new Set<string>(),
}));

vi.mock('../../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: (action: string) =>
      action === 'invite' ? permissionState.canInvite : permissionState.canKick,
  }),
}));

const renderHeader = async (
  joinRequestCount = 0,
  headerProps: {
    hasMindroomAgents?: boolean;
    callView?: boolean;
    computerAvailable?: boolean;
    computerOpen?: boolean;
    computerShown?: boolean;
    onComputerToggle?: () => void;
    canvasOpen?: boolean;
    canvases?: CanvasListEntry[];
    openCanvasId?: string;
    onCanvasOpen?: (canvasId: string) => void;
    onCanvasClose?: () => void;
    threadId?: string;
  } = {},
  simpleMode = false
) => {
  const store = createStore();
  store.set(mindroomAccountSettingsAtom, {
    simpleMode,
  });
  const { RoomViewHeader } = await import('../../../features/room/RoomViewHeader');
  const renderer = create(
    React.createElement(
      Provider,
      { store },
      React.createElement(RoomViewHeader, {
        hasMindroomAgents: true,
        joinRequestCount,
        ...headerProps,
      })
    )
  );

  return { renderer, store };
};

afterEach(() => {
  membersState.open = false;
  membersState.setOpen.mockClear();
  encryptionState.value = undefined;
  screenSizeState.value = 'Desktop';
  permissionState.canInvite = true;
  permissionState.canKick = true;
});

describe('RoomViewHeader', () => {
  it.each([false, true])('hides schedules without agents when callView is %s', async (callView) => {
    const { renderer, store } = await renderHeader(0, { hasMindroomAgents: false, callView });
    expect(renderer.root.findAllByProps({ 'aria-label': 'Scheduled tasks (0)' })).toHaveLength(0);
    act(() => {
      store.set(mindroomAccountSettingsAtom, {
        simpleMode: true,
      });
    });
    expect(renderer.root.findAllByProps({ 'aria-label': 'Scheduled tasks (0)' })).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('offers agent calls before Members only with agents outside a call view', async () => {
    const { renderer } = await renderHeader(0, { threadId: '$root' });
    const findCallButtons = (r: typeof renderer) =>
      r.root.findAllByType('agent-call-button' as never);
    expect(findCallButtons(renderer).map((node) => node.props['data-thread-id'])).toEqual([
      '$root',
    ]);
    const buttons = renderer.root.findAll(
      (node) =>
        node.type === 'agent-call-button' ||
        (node.type === 'button' && node.props['aria-label'] === 'Show Members')
    );
    expect(buttons.map((node) => node.type)).toEqual(['agent-call-button', 'button']);

    const { renderer: callView } = await renderHeader(0, { callView: true });
    const { renderer: noAgents } = await renderHeader(0, { hasMindroomAgents: false });
    expect(findCallButtons(callView)).toHaveLength(0);
    expect(findCallButtons(noAgents)).toHaveLength(0);
    act(() => [renderer, callView, noAgents].forEach((r) => r.unmount()));
  });

  it('keeps schedules accessible in simple mode on phones', async () => {
    screenSizeState.value = 'Mobile';
    const { renderer, store } = await renderHeader();
    act(() => {
      store.set(mindroomAccountSettingsAtom, {
        simpleMode: true,
      });
    });
    expect(renderer.root.findByProps({ 'aria-label': 'Scheduled tasks (0)' })).toBeDefined();
    act(() => renderer.unmount());
  });

  it.each(
    ['Desktop', 'Tablet', 'Mobile'].flatMap((screen) =>
      [false, true].map((storedOpen) => ({ screen, storedOpen }))
    )
  )(
    'opens Members over Computer on $screen with stored visibility $storedOpen',
    async ({ screen, storedOpen }) => {
      screenSizeState.value = screen;
      membersState.open = storedOpen;
      const onComputerToggle = vi.fn();
      const { renderer } = await renderHeader(0, {
        computerAvailable: true,
        computerOpen: true,
        onComputerToggle,
      });
      const button = renderer.root.findByProps({ 'aria-label': 'Show Members' });
      await act(async () => button.props.onClick());
      expect(onComputerToggle).toHaveBeenCalledTimes(1);
      expect(membersState.setOpen).toHaveBeenCalledWith(true);
      act(() => renderer.unmount());
    }
  );

  it.each(
    ['Desktop', 'Tablet'].flatMap((screen) =>
      [false, true].map((storedOpen) => ({ screen, storedOpen }))
    )
  )(
    'replaces an open canvas with Members in one click on $screen with stored visibility $storedOpen',
    async ({ screen, storedOpen }) => {
      screenSizeState.value = screen;
      membersState.open = storedOpen;
      const onCanvasClose = vi.fn();
      const { renderer } = await renderHeader(0, { canvasOpen: true, onCanvasClose });
      const button = renderer.root.findByProps({ 'aria-label': 'Show Members' });
      await act(async () => button.props.onClick());
      expect(onCanvasClose).toHaveBeenCalledTimes(1);
      expect(membersState.setOpen).toHaveBeenCalledWith(true);
      act(() => renderer.unmount());
    }
  );

  it.each(['Desktop', 'Tablet', 'Mobile'])(
    'leaves the command palette to the sidebar and shortcut on %s',
    async (screen) => {
      screenSizeState.value = screen;
      const { renderer } = await renderHeader();

      expect(renderer.root.findAllByProps({ 'aria-label': 'Open command palette' })).toHaveLength(
        0
      );
      expect(
        renderer.root.findAll((node) => node.props?.['data-icon'] === 'Terminal')
      ).toHaveLength(0);
      act(() => renderer.unmount());
    }
  );

  it.each([
    { label: 'an unencrypted room', encrypted: false, simpleMode: false, offered: true },
    { label: 'an encrypted room', encrypted: true, simpleMode: false, offered: false },
    { label: 'Simple Mode', encrypted: false, simpleMode: true, offered: false },
  ])(
    'offers message search in the room menu, not the top bar, for $label',
    async ({ encrypted, simpleMode, offered }) => {
      if (encrypted) encryptionState.value = {};
      const { renderer } = await renderHeader(0, {}, simpleMode);
      const findIcons = (icon: string) =>
        renderer.root.findAll((node) => node.props?.['data-icon'] === icon);
      const textOf = (node: ReactTestInstance): string =>
        node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
      const findMessageSearch = () =>
        renderer.root.findAll(
          (node) => node.type === 'button' && textOf(node).includes('Message Search')
        );

      expect(findIcons('Search')).toHaveLength(0);
      const moreOptions = renderer.root.findByProps({ 'aria-label': 'More Options' });
      await act(async () =>
        moreOptions.props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } })
      );

      expect(
        renderer.root.findAll((node) => node.type === 'button' && textOf(node) === 'Leave Room')
      ).toHaveLength(1);
      expect(findMessageSearch()).toHaveLength(offered ? 1 : 0);
      if (offered) {
        navigateSpy.mockClear();
        await act(async () => findMessageSearch()[0].props.onClick());
        expect(navigateSpy).toHaveBeenCalledWith(
          `/home/search/?${new URLSearchParams({ rooms: '!room:example.org' })}`
        );
      }
      act(() => renderer.unmount());
    }
  );

  it.each(['Desktop', 'Tablet', 'Mobile'])(
    'shows pending join requests on the %s Members button only to moderators',
    async (screenSize) => {
      screenSizeState.value = screenSize;
      const { renderer } = await renderHeader(2);

      expect(
        renderer.root.findByProps({
          'aria-label': 'Show Members, 2 pending join requests',
        })
      ).toBeDefined();
      expect(renderer.root.findAllByProps({ children: 2 }).length).toBeGreaterThan(0);

      permissionState.canInvite = false;
      permissionState.canKick = false;
      const { renderer: unauthorizedRenderer } = await renderHeader(2);

      expect(
        unauthorizedRenderer.root.findAllByProps({
          'aria-label': 'Show Members, 2 pending join requests',
        })
      ).toHaveLength(0);
      expect(
        unauthorizedRenderer.root.findByProps({
          'aria-label': 'Show Members',
        })
      ).toBeDefined();
    }
  );

  describe('canvas entry point', () => {
    const listed: CanvasListEntry[] = [
      {
        canvasId: '$canvas',
        roomId: '!room:example.org',
        threadId: '$thread',
        agentUserId: '@mindroom_helper:example.org',
        title: 'Plans',
        createdTs: 1,
        revisionId: '$canvas',
        updatedTs: 1,
        shared: false,
      },
    ];
    const findCanvasButtons = (renderer: ReturnType<typeof create>) =>
      renderer.root.findAllByType('mock-canvas-header-button' as never);

    it('renders the Canvas button with the conversation’s canvases and its handlers', async () => {
      const onCanvasOpen = vi.fn();
      const onCanvasClose = vi.fn();
      const { renderer } = await renderHeader(0, {
        canvases: listed,
        openCanvasId: '$canvas',
        onCanvasOpen,
        onCanvasClose,
      });

      const buttons = findCanvasButtons(renderer);
      expect(buttons).toHaveLength(1);
      expect(buttons[0].props).toEqual({
        canvases: listed,
        openCanvasId: '$canvas',
        onOpen: onCanvasOpen,
        onClose: onCanvasClose,
      });
      act(() => renderer.unmount());
    });

    it.each([
      { name: 'there are no canvases', canvases: undefined, open: vi.fn(), close: vi.fn() },
      { name: 'it cannot open one', canvases: listed, open: undefined, close: vi.fn() },
      { name: 'it cannot close one', canvases: listed, open: vi.fn(), close: undefined },
    ])('renders no Canvas button when $name', async ({ canvases, open, close }) => {
      const { renderer } = await renderHeader(0, {
        canvases,
        onCanvasOpen: open,
        onCanvasClose: close,
      });

      expect(findCanvasButtons(renderer)).toHaveLength(0);
      act(() => renderer.unmount());
    });
  });

  describe('computer entry points', () => {
    const textOf = (node: ReactTestInstance): string =>
      node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
    const findButton = (renderer: ReturnType<typeof create>, label: string) =>
      renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label);
    const findMenuItem = (renderer: ReturnType<typeof create>) =>
      renderer.root.findAll(
        (node) =>
          node.type === 'button' && !node.props['aria-label'] && textOf(node) === 'Show Computer'
      );
    const openMoreMenu = (renderer: ReturnType<typeof create>) =>
      act(async () =>
        renderer.root
          .findByProps({ 'aria-label': 'More Options' })
          .props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } })
      );

    const base = { available: true, open: false, shown: false, toggle: true };
    it.each([
      { name: 'was never shown', ...base, entry: 'menu' },
      { name: 'was shown', ...base, shown: true, entry: 'button' },
      { name: 'is open', ...base, open: true, entry: 'button' },
      { name: 'is open and was shown', ...base, open: true, shown: true, entry: 'button' },
      { name: 'is unavailable', ...base, available: false, entry: 'none' },
      {
        name: 'is unavailable but was shown',
        ...base,
        available: false,
        shown: true,
        entry: 'none',
      },
      { name: 'cannot be toggled', ...base, shown: true, toggle: false, entry: 'none' },
    ])(
      'offers the computer through the $entry when it $name',
      async ({ available, open, shown, toggle, entry }) => {
        const { renderer } = await renderHeader(0, {
          computerAvailable: available,
          computerOpen: open,
          computerShown: shown,
          onComputerToggle: toggle ? vi.fn() : undefined,
        });
        await openMoreMenu(renderer);

        const button = [
          ...findButton(renderer, 'Show Computer'),
          ...findButton(renderer, 'Hide Computer'),
        ];
        expect(button).toHaveLength(entry === 'button' ? 1 : 0);
        expect(findMenuItem(renderer)).toHaveLength(entry === 'menu' ? 1 : 0);
        act(() => renderer.unmount());
      }
    );

    it.each([
      { screen: 'Desktop', shown: true, open: false },
      { screen: 'Tablet', shown: true, open: false },
      { screen: 'Tablet', shown: false, open: true },
    ])(
      'keeps the header button on $screen (shown $shown, open $open)',
      async ({ screen, shown, open }) => {
        screenSizeState.value = screen;
        const { renderer } = await renderHeader(0, {
          computerAvailable: true,
          computerShown: shown,
          computerOpen: open,
          onComputerToggle: vi.fn(),
        });

        expect([
          ...findButton(renderer, 'Show Computer'),
          ...findButton(renderer, 'Hide Computer'),
        ]).toHaveLength(1);
        act(() => renderer.unmount());
      }
    );

    // A phone's header already holds Schedules, Canvas, Pinned, Call, Members and More.
    it.each([
      { name: 'was shown', shown: true, open: false },
      { name: 'is open', shown: false, open: true },
      { name: 'was never shown', shown: false, open: false },
    ])('offers the computer only through the room menu on phones when it $name', async (state) => {
      screenSizeState.value = 'Mobile';
      const { renderer } = await renderHeader(0, {
        computerAvailable: true,
        computerShown: state.shown,
        computerOpen: state.open,
        onComputerToggle: vi.fn(),
      });
      await openMoreMenu(renderer);

      expect(findButton(renderer, 'Show Computer')).toHaveLength(0);
      expect(findButton(renderer, 'Hide Computer')).toHaveLength(0);
      expect(findMenuItem(renderer)).toHaveLength(1);
      act(() => renderer.unmount());
    });

    it('does not offer the computer on phones when it is unavailable', async () => {
      screenSizeState.value = 'Mobile';
      const { renderer } = await renderHeader(0, {
        computerAvailable: false,
        computerShown: true,
        onComputerToggle: vi.fn(),
      });
      await openMoreMenu(renderer);

      expect(findButton(renderer, 'Show Computer')).toHaveLength(0);
      expect(findMenuItem(renderer)).toHaveLength(0);
      act(() => renderer.unmount());
    });

    it('opens the computer from the room menu and closes the menu', async () => {
      const onComputerToggle = vi.fn();
      const { renderer } = await renderHeader(0, {
        computerAvailable: true,
        onComputerToggle,
      });
      await openMoreMenu(renderer);
      const leaveRoom = () =>
        renderer.root.findAll((node) => node.type === 'button' && textOf(node) === 'Leave Room');
      expect(leaveRoom()).toHaveLength(1);

      await act(async () => findMenuItem(renderer)[0].props.onClick());

      expect(onComputerToggle).toHaveBeenCalledOnce();
      expect(leaveRoom()).toHaveLength(0);
      act(() => renderer.unmount());
    });

    it('keeps the room menu entry in Simple Mode', async () => {
      const { renderer } = await renderHeader(
        0,
        { computerAvailable: true, onComputerToggle: vi.fn() },
        true
      );
      await openMoreMenu(renderer);
      expect(findMenuItem(renderer)).toHaveLength(1);
      act(() => renderer.unmount());
    });
  });
});
