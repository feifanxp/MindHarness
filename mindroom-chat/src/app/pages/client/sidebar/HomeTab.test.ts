import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeTab } from './HomeTab';
import { ScreenSize } from '../../../hooks/useScreenSize';

const state = vi.hoisted(() => ({ selected: false, mobile: false }));
vi.mock('../../../hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useScreenSize')>()),
  useScreenSizeContext: () => (state.mobile ? ScreenSize.Mobile : ScreenSize.Desktop),
}));

const { navigate, navToActivePathAtom, mDirectAtomToken, roomToParentsAtomToken } = vi.hoisted(
  () => ({
    navigate: vi.fn(),
    navToActivePathAtom: {},
    mDirectAtomToken: {},
    roomToParentsAtomToken: {},
  })
);

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Box: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Icon: () => reactModule.createElement('i'),
    Icons: {
      Home: 'Home',
      CheckTwice: 'CheckTwice',
    },
    Menu: React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(({ children }, ref) =>
      reactModule.createElement('div', { ref }, children)
    ),
    MenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
      reactModule.createElement('button', { type: 'button', onClick }, children),
    PopOut: ({ content }: { content: React.ReactNode }) =>
      reactModule.createElement('div', null, content),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    config: { space: { S100: '8px' } },
    toRem: () => '10rem',
  };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();

  return {
    ...actual,
    useAtomValue: vi.fn((atom: unknown) => {
      if (atom === navToActivePathAtom) {
        return new Map([
          [
            'home',
            {
              pathname: '/home/%23room%3Amindroom.chat',
              search: '?threadId=%24thread',
              hash: '',
            },
          ],
        ]);
      }
      if (atom === mDirectAtomToken) {
        return new Set();
      }
      if (atom === roomToParentsAtomToken) {
        return new Map();
      }

      return undefined;
    }),
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../../state/hooks/roomList', () => ({
  useOrphanRooms: () => [],
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../../state/mDirectList', () => ({
  mDirectAtom: mDirectAtomToken,
}));

vi.mock('../../../state/room/roomToParents', () => ({
  roomToParentsAtom: roomToParentsAtomToken,
}));

vi.mock('../../../state/room-list/roomList', () => ({
  allRoomsAtom: {},
}));

vi.mock('../../../state/room/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('../../../state/hooks/unread', () => ({
  useRoomsUnread: () => undefined,
}));

vi.mock('../../../components/sidebar', () => ({
  SidebarItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  SidebarItemTooltip: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
    React.createElement(
      'div',
      null,
      children(() => undefined)
    ),
  SidebarItemBadge: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  SidebarAvatar: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children: React.ReactNode;
    }
  >(({ children, ...props }, ref) =>
    React.createElement('button', { ref, type: 'button', ...props }, children)
  ),
}));

vi.mock('../../../hooks/router/useHomeSelected', () => ({
  useHomeSelected: () => state.selected,
}));

vi.mock('../../../components/unread-badge', () => ({
  UnreadBadge: () => React.createElement('div'),
}));

vi.mock('../../../state/hooks/navToActivePath', () => ({
  useNavToActivePathAtom: () => navToActivePathAtom,
}));

vi.mock('../home/useHomeRooms', () => ({
  useHomeRooms: () => [],
}));

vi.mock('../../../mindroom/notifications/readReceipts', () => ({
  markRoomAndThreadsAsRead: vi.fn(),
}));

vi.mock('../../../utils/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: () => [false],
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

describe('HomeTab', () => {
  afterEach(() => {
    navigate.mockReset();
    state.selected = false;
    state.mobile = false;
  });

  it('restores the saved home path when the home tab is clicked', async () => {
    const renderer = create(React.createElement(HomeTab));

    await act(async () => {
      renderer.root.findByType('button').props.onClick();
    });

    expect(navigate).toHaveBeenCalledWith('/home/%23room%3Amindroom.chat?threadId=%24thread');
  });

  it('preserves the current route when the navigation panel handles the click', () => {
    const renderer = create(React.createElement(HomeTab, { onSelect: () => true }));
    act(() => renderer.root.findByType('button').props.onClick());
    expect(navigate).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it.each([false, true])(
    'shows the home list on mobile unless already selected: %s',
    (selected) => {
      state.mobile = true;
      state.selected = selected;
      const renderer = create(React.createElement(HomeTab));
      act(() => renderer.root.findByType('button').props.onClick());
      expect(navigate).toHaveBeenCalledWith(
        selected ? '/home/%23room%3Amindroom.chat?threadId=%24thread' : '/home/'
      );
      act(() => renderer.unmount());
    }
  );
});
