import React from 'react';
import { createStore, Provider } from 'jotai';
import { enableMapSet } from 'immer';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archivedRoomsAtom } from '../rooms/archivedRooms';
import { makeClosedNavCategoriesAtom } from '../../state/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../state/hooks/closedNavCategories';
import { clearRecentThreadsStore, makeRecentThreadsAtom } from './recentThreads';
import { RECENTLY_OPENED_NAV_CATEGORY_ID } from './recentlyOpenedCategory';
import {
  DEFAULT_RECENTLY_OPENED_THREAD_LIMIT,
  RecentlyOpenedNavCategory,
} from './RecentlyOpenedNavCategory';
import {
  DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT,
  MAX_RECENTLY_OPENED_PANEL_HEIGHT,
  MIN_RECENTLY_OPENED_PANEL_HEIGHT,
  RECENTLY_OPENED_PANEL_RESERVED_HEIGHT,
  clearRecentlyOpenedPanelHeightStore,
  getRecentlyOpenedPanelHeightStoreKey,
} from './recentlyOpenedPanelHeight';

enableMapSet();

const { rooms } = vi.hoisted(() => ({
  rooms: new Map<string, { getMyMembership: () => string; roomId: string }>(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', () => ({
  Scroll: React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & {
      direction?: string;
      hideTrack?: boolean;
      size?: string;
      variant?: string;
      visibility?: string;
    }
  >(({ children, direction, hideTrack, size, variant, visibility, ...props }, ref) =>
    React.createElement('div', { ...props, ref }, children)
  ),
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
  useMatrixClient: () => ({
    getRoom: (roomId: string) => rooms.get(roomId),
    getSafeUserId: () => '@me:example.org',
  }),
}));
vi.mock('./RecentThreadEntry', () => ({
  RecentThreadEntry: ({ threadId }: { threadId: string }) =>
    React.createElement('div', { 'data-recent-thread-id': threadId }),
}));
vi.mock('./threadNav.css', () => ({
  CategoryState: 'CategoryState',
  RecentlyOpenedCategory: 'RecentlyOpenedCategory',
  RecentlyOpenedList: 'RecentlyOpenedList',
  RecentlyOpenedListViewport: 'RecentlyOpenedListViewport',
  RecentlyOpenedPanel: 'RecentlyOpenedPanel',
  RecentlyOpenedResizeGrip: 'RecentlyOpenedResizeGrip',
  RecentlyOpenedResizeHandle: 'RecentlyOpenedResizeHandle',
}));

const USER_ID = '@me:example.org';
const storage = new Map<string, string>();

describe('RecentlyOpenedNavCategory', () => {
  let renderer: ReactTestRenderer | undefined;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      innerHeight: 900,
      removeEventListener: vi.fn(),
    });
    clearRecentThreadsStore(USER_ID);
    clearRecentlyOpenedPanelHeightStore(USER_ID);
    rooms.clear();
    store = createStore();
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    clearRecentThreadsStore(USER_ID);
    clearRecentlyOpenedPanelHeightStore(USER_ID);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const seedJoinedThreads = (count: number) => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    for (let index = 0; index < count; index += 1) {
      const roomId = `!room-${index}:example.org`;
      rooms.set(roomId, { roomId, getMyMembership: () => 'join' });
      store.set(recentThreadsAtom, {
        type: 'BUMP',
        roomId,
        threadId: `$thread-${index}`,
        openedAt: index + 1,
      });
    }
  };

  const renderCategory = (
    limit?: number,
    createNodeMock?: (element: React.ReactElement) => unknown
  ) => {
    const closedCategoriesAtom = makeClosedNavCategoriesAtom(USER_ID);
    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            ClosedNavCategoriesProvider,
            { value: closedCategoriesAtom },
            React.createElement(RecentlyOpenedNavCategory, { limit })
          )
        ),
        createNodeMock ? { createNodeMock } : undefined
      );
    });
    return closedCategoriesAtom;
  };

  const toggleCategory = () =>
    act(() => {
      renderer!.root
        .findByProps({ 'data-category-id': RECENTLY_OPENED_NAV_CATEGORY_ID })
        .props.onClick({
          currentTarget: { getAttribute: () => RECENTLY_OPENED_NAV_CATEGORY_ID },
        });
    });

  const renderedThreadIds = () =>
    renderer!.root
      .findAll((node) => node.props['data-recent-thread-id'])
      .map((node) => node.props['data-recent-thread-id']);

  const createResizeTarget = (
    panelHeight = DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT,
    containerHeight = 900
  ) => {
    const capturedPointers = new Set<number>();
    const container = {
      getBoundingClientRect: () => ({ height: containerHeight }),
    };
    const panel = {
      getBoundingClientRect: () => ({ height: panelHeight }),
      parentElement: container,
    };
    return {
      hasPointerCapture: (pointerId: number) => capturedPointers.has(pointerId),
      parentElement: panel,
      releasePointerCapture: (pointerId: number) => capturedPointers.delete(pointerId),
      setPointerCapture: (pointerId: number) => capturedPointers.add(pointerId),
    };
  };

  it('renders a bounded bottom panel with the 10 most recently opened threads by default', () => {
    seedJoinedThreads(DEFAULT_RECENTLY_OPENED_THREAD_LIMIT + 2);
    renderCategory();

    expect(
      renderer!.root.findByProps({ 'data-testid': 'recently-opened-nav-panel' }).props.className
    ).toBe('RecentlyOpenedPanel');
    expect(
      renderer!.root.findByProps({ 'data-testid': 'recently-opened-nav-panel' }).props[
        'data-collapsed'
      ]
    ).toBe(false);
    const category = renderer!.root.findByProps({
      'data-testid': 'recently-opened-nav-category',
    });
    expect(category.props.className).toBe('RecentlyOpenedCategory');
    expect(
      renderer!.root.findByProps({ 'data-testid': 'recently-opened-nav-list' }).props.className
    ).toBe('RecentlyOpenedList');
    expect(
      category
        .findByProps({ 'data-category-id': RECENTLY_OPENED_NAV_CATEGORY_ID })
        .findAll(() => true)
        .some((node) => node.children.includes('Recently Opened'))
    ).toBe(true);
    expect(renderedThreadIds()).toEqual(
      Array.from(
        { length: DEFAULT_RECENTLY_OPENED_THREAD_LIMIT },
        (_, index) => `$thread-${DEFAULT_RECENTLY_OPENED_THREAD_LIMIT + 1 - index}`
      )
    );
  });

  it('filters archives before applying the recent limit and keeps history for restore', () => {
    seedJoinedThreads(3);
    renderCategory(2);
    const lastRoomId = [...rooms.keys()][2];
    act(() => store.set(archivedRoomsAtom, new Set([lastRoomId])));
    expect(renderedThreadIds()).toEqual(['$thread-1', '$thread-0']);
    act(() => store.set(archivedRoomsAtom, new Set<string>()));
    expect(renderedThreadIds()).toEqual(['$thread-2', '$thread-1']);
  });

  it('accepts a custom visible entry limit', () => {
    seedJoinedThreads(5);
    renderCategory(3);

    expect(renderedThreadIds()).toEqual(['$thread-4', '$thread-3', '$thread-2']);
  });

  it.each(['mouse', 'touch'] as const)(
    'resizes by %s pointer, persists the result per account, and restores it',
    (pointerType) => {
      seedJoinedThreads(2);
      renderCategory();
      const handle = renderer!.root.findByProps({
        'data-testid': 'recently-opened-resize-handle',
      });
      const resizeTarget = createResizeTarget(100);

      expect(handle.props.role).toBe('separator');
      expect(handle.props['aria-valuemin']).toBe(MIN_RECENTLY_OPENED_PANEL_HEIGHT);
      expect(handle.props['aria-valuemax']).toBe(900 - RECENTLY_OPENED_PANEL_RESERVED_HEIGHT);
      expect(handle.props['aria-valuenow']).toBe(DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT);
      expect(handle.props['aria-controls']).toBe('recently-opened-nav-list');

      act(() => {
        handle.props.onPointerDown({
          clientY: 400,
          currentTarget: resizeTarget,
          pointerId: 7,
          pointerType,
          preventDefault: vi.fn(),
        });
        handle.props.onPointerMove({
          clientY: 300,
          currentTarget: resizeTarget,
          pointerId: 7,
          pointerType,
        });
      });

      expect(
        renderer!.root.findByProps({ 'data-testid': 'recently-opened-nav-panel' }).props.style
      ).toEqual({
        maxHeight: `min(420px, calc(100% - ${RECENTLY_OPENED_PANEL_RESERVED_HEIGHT}px))`,
      });

      act(() => {
        handle.props.onPointerUp({
          currentTarget: resizeTarget,
          pointerId: 7,
          pointerType,
        });
      });
      expect(storage.get(getRecentlyOpenedPanelHeightStoreKey(USER_ID))).toBe('420');

      act(() => renderer?.unmount());
      renderer = undefined;
      renderCategory();
      expect(
        renderer!.root.findByProps({ 'data-testid': 'recently-opened-nav-panel' }).props.style
      ).toEqual({
        maxHeight: `min(420px, calc(100% - ${RECENTLY_OPENED_PANEL_RESERVED_HEIGHT}px))`,
      });
    }
  );

  it('supports keyboard resizing and clamps to the available range', () => {
    seedJoinedThreads(1);
    renderCategory();
    const handle = renderer!.root.findByProps({
      'data-testid': 'recently-opened-resize-handle',
    });
    const resizeTarget = createResizeTarget(100);

    act(() => {
      handle.props.onKeyDown({
        currentTarget: resizeTarget,
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      });
    });
    expect(storage.get(getRecentlyOpenedPanelHeightStoreKey(USER_ID))).toBe('336');

    act(() => {
      handle.props.onKeyDown({
        currentTarget: resizeTarget,
        key: 'End',
        preventDefault: vi.fn(),
      });
    });
    expect(
      renderer!.root.findByProps({ 'data-testid': 'recently-opened-nav-panel' }).props.style
    ).toEqual({
      maxHeight: `min(760px, calc(100% - ${RECENTLY_OPENED_PANEL_RESERVED_HEIGHT}px))`,
    });

    act(() => {
      handle.props.onKeyDown({
        currentTarget: resizeTarget,
        key: 'Home',
        preventDefault: vi.fn(),
      });
    });
    expect(
      renderer!.root.findByProps({ 'data-testid': 'recently-opened-nav-panel' }).props.style
    ).toEqual({
      maxHeight: `min(${MIN_RECENTLY_OPENED_PANEL_HEIGHT}px, calc(100% - ${RECENTLY_OPENED_PANEL_RESERVED_HEIGHT}px))`,
    });
    expect(storage.get(getRecentlyOpenedPanelHeightStoreKey(USER_ID))).toBe(
      `${MIN_RECENTLY_OPENED_PANEL_HEIGHT}`
    );

    act(() => {
      handle.props.onDoubleClick({
        currentTarget: resizeTarget,
      });
    });
    expect(storage.get(getRecentlyOpenedPanelHeightStoreKey(USER_ID))).toBe(
      `${DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT}`
    );

    act(() => {
      handle.props.onKeyDown({
        currentTarget: resizeTarget,
        key: 'End',
        preventDefault: vi.fn(),
      });
    });
    act(() => {
      handle.props.onKeyDown({
        currentTarget: resizeTarget,
        key: 'Enter',
        preventDefault: vi.fn(),
      });
    });
    expect(storage.get(getRecentlyOpenedPanelHeightStoreKey(USER_ID))).toBe(
      `${DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT}`
    );
  });

  it('keeps a tall preference while CSS clamps it for a short viewport', () => {
    storage.set(getRecentlyOpenedPanelHeightStoreKey(USER_ID), '760');
    (window as unknown as { innerHeight: number }).innerHeight = 480;
    seedJoinedThreads(1);
    renderCategory();

    expect(
      renderer!.root.findByProps({ 'data-testid': 'recently-opened-nav-panel' }).props.style
    ).toEqual({
      maxHeight: `min(760px, calc(100% - ${RECENTLY_OPENED_PANEL_RESERVED_HEIGHT}px))`,
    });
    const handle = renderer!.root.findByProps({
      'data-testid': 'recently-opened-resize-handle',
    });
    expect(handle.props['aria-valuemax']).toBe(340);
    expect(handle.props['aria-valuenow']).toBe(340);
  });

  it('uses the persisted height cap as the reachable maximum on tall sidebars', () => {
    (window as unknown as { innerHeight: number }).innerHeight = 2000;
    seedJoinedThreads(1);
    renderCategory();
    const handle = renderer!.root.findByProps({
      'data-testid': 'recently-opened-resize-handle',
    });
    const resizeTarget = createResizeTarget(100, 2000);

    expect(handle.props['aria-valuemax']).toBe(MAX_RECENTLY_OPENED_PANEL_HEIGHT);
    act(() => {
      handle.props.onKeyDown({
        currentTarget: resizeTarget,
        key: 'End',
        preventDefault: vi.fn(),
      });
    });
    expect(storage.get(getRecentlyOpenedPanelHeightStoreKey(USER_ID))).toBe(
      `${MAX_RECENTLY_OPENED_PANEL_HEIGHT}`
    );
  });

  it('skips unavailable and unjoined rooms before applying the limit', () => {
    seedJoinedThreads(3);
    rooms.delete('!room-2:example.org');
    rooms.get('!room-1:example.org')!.getMyMembership = () => 'leave';
    renderCategory(2);

    expect(renderedThreadIds()).toEqual(['$thread-0']);
  });

  it('uses existing per-user sidebar category collapse state', () => {
    seedJoinedThreads(1);
    const closedCategoriesAtom = renderCategory();

    toggleCategory();

    expect(store.get(closedCategoriesAtom)).toContain(RECENTLY_OPENED_NAV_CATEGORY_ID);
    expect(
      renderer!.root.findByProps({ 'data-testid': 'recently-opened-nav-panel' }).props[
        'data-collapsed'
      ]
    ).toBe(true);
    expect(
      renderer!.root.findAllByProps({ 'data-testid': 'recently-opened-nav-list' })
    ).toHaveLength(0);
    expect(
      renderer!.root.findAllByProps({ 'data-testid': 'recently-opened-resize-handle' })
    ).toHaveLength(0);
  });

  it('reopens the list where it was left after a collapse, also when rows render late', () => {
    // Each connected observer's callback, with the elements it watches.
    const observers = new Map<() => void, Set<unknown>>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}

        observe(target: unknown) {
          observers.set(this.callback, (observers.get(this.callback) ?? new Set()).add(target));
        }

        disconnect() {
          observers.delete(this.callback);
        }
      }
    );
    // No rows to measure here, so the list restores its saved offset.
    const createList = (initialMaxScrollTop: number) => {
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
    let list = createList(Number.POSITIVE_INFINITY);
    seedJoinedThreads(3);
    renderCategory(undefined, (element) =>
      element.props['data-testid'] === 'recently-opened-nav-list' ? list : {}
    );

    list.scrollTop = 90;
    toggleCategory();
    // The list reopens too short for the saved offset, then more rows render
    // and grow its content, not its viewport.
    list = createList(40);
    toggleCategory();
    expect(list.scrollTop).toBe(40);

    list.setMaxScrollTop(Number.POSITIVE_INFINITY);
    act(() =>
      observers.forEach((targets, callback) => {
        if ([...targets].some((target) => target !== list)) callback();
      })
    );
    expect(list.scrollTop).toBe(90);
  });
});
