// @vitest-environment jsdom

import React from 'react';
import { createStore, Provider } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Threads } from '../Threads';
import { clearCrossRoomThreadFiltersStore } from '../../../../mindroom/cross-room-threads/crossRoomThreadFilters';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexSnapshot,
} from '../../../../mindroom/cross-room-threads/crossRoomThreadIndex';

const { matrixClientMock, activeSessionMock } = vi.hoisted(() => ({
  matrixClientMock: vi.fn(),
  activeSessionMock: vi.fn(),
}));

vi.mock('../../../../hooks/useMatrixClient', () => ({
  useMatrixClient: matrixClientMock,
}));

vi.mock('../../../../hooks/useSessionStore', () => ({
  useActiveSession: activeSessionMock,
}));

vi.mock('../../../../hooks/useNavToActivePathMapper', () => ({
  useNavToActivePathMapper: () => undefined,
}));

vi.mock('../../../../components/page', () => ({
  Page: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('div', props, children),
  PageHeader: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
    React.createElement('header', props, children),
}));

vi.mock('../../../../components/virtualizer', () => ({
  VirtualTile: React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(
    ({ children }, ref) => React.createElement('div', { ref }, children)
  ),
}));

vi.mock('../ThreadsViewRow', () => ({
  ThreadsViewRow: () => React.createElement('div', null, 'thread row'),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 132,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 132,
        size: 132,
      })),
    measureElement: vi.fn(),
  }),
}));

vi.mock('folds', () => ({
  Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('div', props, children),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', { type: 'button', ...props }, children),
  Header: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
    React.createElement('header', props, children),
  Icon: () => React.createElement('span', null),
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', { type: 'button', ...props }, children),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement('input', props),
  Modal: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('div', props, children),
  Overlay: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  OverlayBackdrop: () => React.createElement('div', null),
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) =>
    React.createElement('span', props, children),
  Icons: {
    Cross: 'Cross',
    Filter: 'Filter',
    Thread: 'Thread',
  },
  config: {
    radii: {
      R400: '0.75rem',
    },
  },
}));

vi.mock('react-aria', () => ({
  FocusScope: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  mergeProps: (...props: Array<Record<string, unknown>>) => Object.assign({}, ...props),
  useDialog: () => ({ dialogProps: { 'aria-label': 'Thread filters' } }),
  useOverlay: () => ({ overlayProps: {} }),
  usePreventScroll: () => undefined,
}));

vi.mock('../FilterBar.css', () => ({
  Bar: 'bar',
  Search: 'search',
  Group: 'group',
  CompactInput: 'compact-input',
  DesktopControls: 'desktop-controls',
  MobileControls: 'mobile-controls',
}));

vi.mock('../FilterBarMobileSheet.css', () => ({
  SheetBody: 'sheet-body',
  SheetContainer: 'sheet-container',
}));

vi.mock('../ThreadsView.css', () => ({
  View: 'view',
  Scroll: 'scroll',
  Count: 'count',
  List: 'list',
  Empty: 'empty',
}));

// Resolve t() keys against the real en.json so the label/aria selectors
// below keep matching user-visible English copy.
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

const userId = '@threads-clear-query:example.org';

const makeSnapshot = (): CrossRoomThreadIndexSnapshot =>
  ({
    version: 1,
    bootstrapped: true,
    eventIdToThreadRoots: new Map(),
    entries: new Map([
      [
        '!room:example.org\u0000$root',
        {
          key: '!room:example.org\u0000$root',
          roomId: '!room:example.org',
          roomName: 'Room',
          parentSpaceIds: [],
          threadRootId: '$root',
          threadRecord: {
            status: { hasPendingSend: false, replyCount: 1 },
          },
          lastActivityTs: Date.now(),
          isUnread: false,
          isResolved: false,
          hasAttention: false,
          isInvolved: true,
          summaryText: 'summary',
          rootPreviewText: 'root',
          searchableText: 'root summary',
          tags: [],
          generation: 0,
        },
      ],
    ]),
  } as CrossRoomThreadIndexSnapshot);

const hasText = (renderer: ReturnType<typeof create>, text: string): boolean =>
  renderer.root
    .findAll((node) =>
      node.children
        .filter((child): child is string => typeof child === 'string')
        .join('')
        .includes(text)
    )
    .some(Boolean);

describe('Threads', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    matrixClientMock.mockReturnValue({ getUserId: () => userId });
    activeSessionMock.mockReturnValue({ userId });
    store = createStore();
    store.set(crossRoomThreadIndexAtom, makeSnapshot());
  });

  afterEach(() => {
    vi.useRealTimers();
    clearCrossRoomThreadFiltersStore(userId);
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('clears a search-filtered list and resets the search input', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(Threads)));
    });

    const getSearchInput = () =>
      renderer.root
        .findAllByType('input')
        .find((input) => input.props['aria-label'] === 'Search threads');

    await act(async () => {
      getSearchInput()?.props.onChange({ target: { value: 'foo' } });
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(hasText(renderer, 'No threads match your filters')).toBe(true);

    const clearButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAllByProps({ children: 'Clear filters' }).length > 0);
    await act(async () => {
      clearButton?.props.onClick();
      await Promise.resolve();
    });

    expect(getSearchInput()?.props.value).toBe('');
    expect(hasText(renderer, '1 thread')).toBe(true);
  });
});
