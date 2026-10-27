import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LobbyHeader } from './LobbyHeader';

const { permissionState, screenSizeState } = vi.hoisted(() => ({
  screenSizeState: { value: 'Desktop' },
  permissionState: {
    canInvite: true,
    canKick: true,
  },
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Avatar: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Badge: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Box: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Icon: ({ src }: { src: string }) => reactModule.createElement('span', { 'data-icon': src }),
    IconButton: reactModule.forwardRef<
      HTMLButtonElement,
      React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }
    >(({ children, ...props }, ref) =>
      reactModule.createElement('button', { ref, type: 'button', ...props }, children)
    ),
    Icons: {
      ArrowGoLeft: 'ArrowGoLeft',
      ArrowLeft: 'ArrowLeft',
      Setting: 'Setting',
      User: 'User',
      UserPlus: 'UserPlus',
      VerticalDots: 'VerticalDots',
    },
    Line: () => reactModule.createElement('hr'),
    Menu: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    MenuItem: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('button', { type: 'button' }, children),
    PopOut: () => null,
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
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
    config: {
      space: {
        S100: '4px',
      },
    },
    toRem: (value: number) => `${value}rem`,
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../components/page', () => ({
  PageHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../mindroom/sidebar/useMembersDrawer', () => ({
  useMembersDrawer: () => [false, vi.fn()],
}));

vi.mock('../../hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'Example Space',
}));

vi.mock('../../hooks/useSpace', () => ({
  useSpace: () => ({ roomId: '!space:example.org' }),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@moderator:example.org',
  }),
}));

vi.mock('../../components/room-avatar', () => ({
  RoomAvatar: () => React.createElement('div'),
}));

vi.mock('../../utils/common', () => ({
  nameInitials: () => 'ES',
}));

vi.mock('../../components/UseStateProvider', () => ({
  UseStateProvider: ({
    children,
  }: {
    children: (state: boolean, setState: (value: boolean) => void) => React.ReactNode;
  }) => React.createElement(React.Fragment, null, children(false, vi.fn())),
}));

vi.mock('../../components/leave-space-prompt', () => ({
  LeaveSpacePrompt: () => React.createElement('div'),
}));

vi.mock('../../utils/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Tablet: 'Tablet',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => screenSizeState.value,
}));

vi.mock('../../mindroom/native/MindroomBackRouteHandler', () => ({
  MindroomBackRouteHandler: ({ children }: { children: (onBack: () => void) => React.ReactNode }) =>
    React.createElement(React.Fragment, null, children(vi.fn())),
}));

vi.mock('../../utils/matrix', () => ({
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../state/hooks/spaceSettings', () => ({
  useOpenSpaceSettings: () => vi.fn(),
}));

vi.mock('../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => new Set<string>(),
}));

vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: (action: string) =>
      action === 'invite' ? permissionState.canInvite : permissionState.canKick,
  }),
}));

vi.mock('../../components/invite-user-prompt', () => ({
  InviteUserPrompt: () => React.createElement('div'),
}));

const renderHeader = (joinRequestCount: number): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<LobbyHeader powerLevels={{}} joinRequestCount={joinRequestCount} />);
  });
  if (!renderer) throw new Error('Lobby header did not render.');
  return renderer;
};

afterEach(() => {
  screenSizeState.value = 'Desktop';
  permissionState.canInvite = true;
  permissionState.canKick = true;
});

describe('LobbyHeader', () => {
  it.each(['Desktop', 'Tablet', 'Mobile'])(
    'shows the member control and authorized join requests on %s',
    (screen) => {
      screenSizeState.value = screen;
      const renderer = renderHeader(2);

      expect(
        renderer.root.findByProps({
          'aria-label': 'Members, 2 pending join requests',
        })
      ).toBeDefined();
      expect(renderer.root.findAllByProps({ children: 2 }).length).toBeGreaterThan(0);

      permissionState.canInvite = false;
      permissionState.canKick = false;
      const unauthorizedRenderer = renderHeader(2);

      expect(
        unauthorizedRenderer.root.findAllByProps({
          'aria-label': 'Members, 2 pending join requests',
        })
      ).toHaveLength(0);
      expect(unauthorizedRenderer.root.findByProps({ 'aria-label': 'Members' })).toBeDefined();
    }
  );
});
