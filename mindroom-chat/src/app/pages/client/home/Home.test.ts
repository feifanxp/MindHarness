import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home } from './Home';

const { homeRoomsState, navigate } = vi.hoisted(() => ({
  homeRoomsState: { roomIds: ['!room:example.org'] },
  navigate: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  const button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    reactModule.createElement('button', props, children);

  return {
    Avatar: passthrough,
    Box: passthrough,
    Button: button,
    Icon: passthrough,
    IconButton: button,
    Icons: {
      Hash: 'Hash',
      Link: 'Link',
      Plus: 'Plus',
      Search: 'Search',
      VerticalDots: 'VerticalDots',
    },
    Menu: React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(({ children }, ref) =>
      reactModule.createElement('div', { ref }, children)
    ),
    PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
      anchor ? reactModule.createElement('div', null, content) : null,
    Text: passthrough,
    config: { space: { S100: '8px' } },
    toRem: () => '10rem',
  };
});

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
    scrollOffset: 0,
    takeSnapshot: () => [],
  }),
}));

vi.mock('../../../mindroom/rooms/archivedRooms', () => ({
  useVisibleRooms: (rooms: string[]) => rooms,
}));

vi.mock('jotai', () => ({
  useAtom: () => [new Set<string>(), vi.fn()],
  useAtomValue: () => new Map<string, unknown>(),
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../../utils/sort', () => ({
  factoryRoomIdByActivity: () => () => 0,
  factoryRoomIdByAtoZ: () => () => 0,
}));

vi.mock('../../../components/nav', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  return {
    NavButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    NavCategory: passthrough,
    NavCategoryHeader: passthrough,
    NavEmptyCenter: passthrough,
    NavEmptyLayout: ({ options }: { options?: React.ReactNode }) =>
      reactModule.createElement('div', null, options),
    NavItem: passthrough,
    NavItemContent: passthrough,
    NavLink: passthrough,
  };
});

vi.mock('../../pathUtils', () => ({
  encodeSearchParamValueArray: vi.fn(),
  getExplorePath: () => '/explore',
  getHomeCreatePath: () => '/home/create',
  getHomeRoomPath: (roomId: string) => `/home/${roomId}`,
  getHomeSearchPath: () => '/home/search',
  withSearchParam: (path: string) => path,
}));

vi.mock('../../../utils/matrix', () => ({
  getCanonicalAliasOrRoomId: (_mx: unknown, roomId: string) => roomId,
}));
vi.mock('../../../hooks/router/useSelectedRoom', () => ({ useSelectedRoom: () => undefined }));
vi.mock('../../../hooks/router/useHomeSelected', () => ({
  useHomeCreateSelected: () => false,
  useHomeSearchSelected: () => false,
}));
vi.mock('./useHomeRooms', () => ({ useHomeRooms: () => homeRoomsState.roomIds }));
vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getRoom: () => null, getSafeUserId: () => '@alice:example.org' }),
}));
vi.mock('../../../components/virtualizer', () => ({ VirtualTile: 'div' }));
vi.mock('../../../features/room-nav', () => ({
  RoomNavCategoryButton: 'button',
  RoomNavItem: 'div',
}));
vi.mock('../../../state/closedNavCategories', () => ({
  makeNavCategoryId: () => 'home-room',
}));
vi.mock('../../../hooks/useCategoryHandler', () => ({ useCategoryHandler: () => vi.fn() }));
vi.mock('../../../hooks/useNavToActivePathMapper', () => ({
  useNavToActivePathMapper: vi.fn(),
}));
vi.mock('../../../components/page', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  const pageNavContent = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', { 'data-page-nav-content': true }, children);
  return { PageNav: passthrough, PageNavContent: pageNavContent, PageNavHeader: passthrough };
});
vi.mock('../../../state/hooks/closedNavCategories', () => ({
  useClosedNavCategoriesAtom: () => ({}),
}));
vi.mock('../../../utils/keyboard', () => ({ stopPropagation: vi.fn() }));
vi.mock('../../../hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: vi.fn(),
  useRoomsNotificationPreferencesContext: () => new Map(),
}));
vi.mock('../../../components/join-address-prompt', async () => {
  const reactModule = await import('react');
  return {
    JoinAddressPrompt: ({
      onOpen,
    }: {
      onOpen: (roomIdOrAlias: string, viaServers?: string[], eventId?: string) => void;
    }) =>
      reactModule.createElement('div', {
        'data-join-address-prompt': 'true',
        onOpen,
      }),
  };
});
vi.mock('../../../mindroom/recent-threads/ThreadNavCategory', () => {
  return { ThreadNavCategory: () => React.createElement('div', { 'data-thread-nav': true }) };
});
vi.mock('../../../mindroom/recent-threads/RecentlyOpenedNavCategory', () => ({
  RecentlyOpenedNavCategory: () => React.createElement('div', { 'data-recently-opened-nav': true }),
}));
vi.mock('../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem', () => ({
  MindroomMarkRoomsReadMenuItem: 'div',
}));

const expectRoomActionsWork = (renderer: ReactTestRenderer) => {
  const createButton = renderer.root.find(
    (node) => node.type === 'button' && node.props['data-home-room-action'] === 'create'
  );
  const joinButton = renderer.root.find(
    (node) => node.type === 'button' && node.props['data-home-room-action'] === 'join'
  );

  act(() => {
    createButton.props.onClick();
  });
  expect(navigate).toHaveBeenCalledWith('/home/create');
  navigate.mockReset();

  act(() => {
    joinButton.props.onClick();
  });
  const joinPrompt = renderer.root.find(
    (node) => node.type === 'div' && node.props['data-join-address-prompt'] === 'true'
  );
  act(() => {
    joinPrompt.props.onOpen('!joined:example.org');
  });
  expect(navigate).toHaveBeenCalledWith('/home/!joined:example.org');
};

describe('Home', () => {
  afterEach(() => {
    homeRoomsState.roomIds = ['!room:example.org'];
    navigate.mockReset();
  });

  it('keeps create and join actions available when rooms exist', () => {
    const renderer = create(React.createElement(Home));

    expectRoomActionsWork(renderer);
    expect(renderer.root.findAllByProps({ 'data-thread-nav': true })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-recently-opened-nav': true })).toHaveLength(1);
    expect(
      renderer.root
        .findByProps({ 'data-page-nav-content': true })
        .findAllByProps({ 'data-recently-opened-nav': true })
    ).toHaveLength(0);

    renderer.unmount();
  });

  it('keeps create and join actions available in the empty state', () => {
    homeRoomsState.roomIds = [];
    const renderer = create(React.createElement(Home));

    expectRoomActionsWork(renderer);
    expect(renderer.root.findAllByProps({ 'data-recently-opened-nav': true })).toHaveLength(1);

    renderer.unmount();
  });
});
