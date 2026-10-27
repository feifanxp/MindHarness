import React from 'react';
import { createStore, Provider } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { enableMapSet } from 'immer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archivedRoomsAtom } from '../rooms/archivedRooms';
import { makeClosedNavCategoriesAtom } from '../../state/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../state/hooks/closedNavCategories';
import { mDirectAtom } from '../../state/mDirectList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../cross-room-threads/crossRoomThreadIndex';
import { THREAD_NAV_CATEGORY_ID, ThreadNavCategory } from './ThreadNavCategory';
import { clearThreadSidebarPreferencesStore } from './threadSidebarPreferences';

enableMapSet();

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', () => ({
  Text: ({
    as: asElement = 'span',
    children,
    ...props
  }: {
    as?: string;
    children?: React.ReactNode;
  }) => React.createElement(asElement, props, children),
}));
vi.mock('../../components/nav', () => ({
  NavCategory: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('section', props, children),
  NavCategoryHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('header', null, children),
}));
vi.mock('../../features/room-nav', () => ({
  RoomNavCategoryButton: ({
    children,
    closed,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { closed?: boolean }) =>
    React.createElement('button', { ...props, 'aria-expanded': !closed }, children),
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org' }),
}));
vi.mock('../../hooks/router/useSelectedRoom', () => ({ useSelectedRoom: () => undefined }));
vi.mock('./ThreadNavItem', () => ({
  ThreadNavItem: ({
    entry,
    pinned,
    onTogglePin,
  }: {
    entry: CrossRoomThreadIndexEntry;
    pinned: boolean;
    onTogglePin: () => void;
  }) =>
    React.createElement(
      'div',
      { 'data-thread-key': entry.key, 'data-pinned': pinned },
      entry.summaryText,
      React.createElement('button', { 'aria-label': `pin-${entry.key}`, onClick: onTogglePin })
    ),
}));
vi.mock('./threadNav.css', () => ({ CategoryState: 'CategoryState' }));

const USER_ID = '@me:example.org';
const makeEntry = (roomId: string, threadRootId: string, lastActivityTs: number) =>
  ({
    key: getCrossRoomThreadIndexKey(roomId, threadRootId),
    roomId,
    roomName: roomId,
    threadRootId,
    lastActivityTs,
    isInvolved: true,
    isUnread: false,
    summaryText: threadRootId,
  } as CrossRoomThreadIndexEntry);

const older = makeEntry('!room:example.org', '$older', 10);
const newer = makeEntry('!newer-room:example.org', '$newer', 20);

describe('ThreadNavCategory', () => {
  let renderer: ReactTestRenderer | undefined;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    clearThreadSidebarPreferencesStore(USER_ID);
    store = createStore();
    store.set(crossRoomThreadIndexAtom, {
      version: 1,
      bootstrapped: true,
      eventIdToThreadRoots: new Map(),
      entries: new Map([
        [older.key, older],
        [newer.key, newer],
      ]),
    });
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    clearThreadSidebarPreferencesStore(USER_ID);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const renderCategory = ({ spaceId }: { spaceId?: string } = {}) => {
    const closedCategoriesAtom = makeClosedNavCategoriesAtom(USER_ID);
    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            ClosedNavCategoriesProvider,
            { value: closedCategoriesAtom },
            React.createElement(
              MemoryRouter,
              { initialEntries: ['/'] },
              React.createElement(ThreadNavCategory, { spaceId })
            )
          )
        )
      );
    });
    return closedCategoriesAtom;
  };

  it('renders as a peer collapsible nav category in activity order', () => {
    renderCategory();
    const category = renderer!.root.findByProps({ 'data-testid': 'thread-nav-category' });
    expect(
      category
        .findByProps({ 'data-category-id': THREAD_NAV_CATEGORY_ID })
        .findAll(() => true)
        .some((node) => node.children.includes('Threads'))
    ).toBe(true);
    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([newer.key, older.key]);
  });

  it('collapses exactly like the room category', () => {
    const closedCategoriesAtom = renderCategory();

    act(() => {
      renderer!.root.findByProps({ 'data-category-id': THREAD_NAV_CATEGORY_ID }).props.onClick({
        currentTarget: { getAttribute: () => THREAD_NAV_CATEGORY_ID },
      });
    });

    expect(store.get(closedCategoriesAtom)).toContain(THREAD_NAV_CATEGORY_ID);
    expect(renderer!.root.findAllByProps({ 'data-testid': 'thread-nav-list' })).toHaveLength(0);
  });

  it('moves a pinned thread above newer activity', () => {
    renderCategory();

    act(() => renderer!.root.findByProps({ 'aria-label': `pin-${older.key}` }).props.onClick());

    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([older.key, newer.key]);
  });

  it('hides archived threads and restores their pin preference', () => {
    renderCategory();
    act(() => renderer!.root.findByProps({ 'aria-label': `pin-${older.key}` }).props.onClick());
    act(() => store.set(archivedRoomsAtom, new Set([older.roomId])));
    const visibleKeys = () =>
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key']);
    expect(visibleKeys()).toEqual([newer.key]);
    act(() => store.set(archivedRoomsAtom, new Set<string>()));
    expect(visibleKeys()).toEqual([older.key, newer.key]);
  });

  it('does not render threads from direct-message rooms', () => {
    store.set(mDirectAtom, { type: 'UPDATE', rooms: new Set([newer.roomId]) });

    renderCategory();

    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([older.key]);
  });

  it('shows only threads from the active Space, including nested rooms', () => {
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        [older.roomId, new Set(['!nested-space:example.org'])],
        ['!nested-space:example.org', new Set(['!space:example.org'])],
      ]),
    });

    renderCategory({ spaceId: '!space:example.org' });

    expect(
      renderer!.root
        .findAll((node) => node.props['data-thread-key'])
        .map((node) => node.props['data-thread-key'])
    ).toEqual([older.key]);
  });
});
