// @vitest-environment jsdom

import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterBar } from '../FilterBar';
import {
  DEFAULT_CROSS_ROOM_THREAD_FILTERS,
  type CrossRoomThreadFilters,
  type CrossRoomThreadFiltersUpdate,
} from '../../../../mindroom/cross-room-threads/crossRoomThreadFilters';

vi.mock('../../../../components/page', () => ({
  PageScroll: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, header, children),
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
  },
  config: {
    radii: {
      R400: 'var(--test-radii-400)',
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

// Resolve t() keys against the real en.json so the label/aria selectors
// below keep matching user-visible English copy.
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

const resolveFilterUpdate = (
  update: CrossRoomThreadFiltersUpdate,
  current: CrossRoomThreadFilters = DEFAULT_CROSS_ROOM_THREAD_FILTERS
): CrossRoomThreadFilters => (typeof update === 'function' ? update(current) : update);

const getLastFilterUpdate = (setFilters: ReturnType<typeof vi.fn>): CrossRoomThreadFiltersUpdate =>
  setFilters.mock.calls.at(-1)?.[0] as CrossRoomThreadFiltersUpdate;

describe('FilterBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces search updates', async () => {
    const setFilters = vi.fn();
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(FilterBar, {
          filters: DEFAULT_CROSS_ROOM_THREAD_FILTERS,
          setFilters,
        })
      );
    });
    const searchInput = renderer.root
      .findAllByType('input')
      .find((input) => input.props['aria-label'] === 'Search threads');

    await act(async () => {
      searchInput?.props.onChange({ target: { value: 'agent' } });
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(setFilters).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(resolveFilterUpdate(getLastFilterUpdate(setFilters))).toEqual({
      ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
      query: 'agent',
    });
  });

  it('updates structured filters immediately and clears them', () => {
    const setFilters = vi.fn();
    const filters = {
      ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
      scope: 'all' as const,
    };
    const renderer = create(React.createElement(FilterBar, { filters, setFilters }));
    const unreadToggle = renderer.root
      .findAllByType('input')
      .find((input) => input.props.type === 'checkbox');

    act(() => {
      unreadToggle?.props.onChange({ target: { checked: true } });
    });
    expect(resolveFilterUpdate(getLastFilterUpdate(setFilters), filters)).toEqual({
      ...filters,
      unreadOnly: true,
    });

    const clearButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAllByProps({ children: 'Clear' }).length > 0);
    act(() => {
      clearButton?.props.onClick();
    });
    expect(setFilters).toHaveBeenCalledWith(DEFAULT_CROSS_ROOM_THREAD_FILTERS);
  });

  it('keeps CSV text stable while debouncing parsed filter commits', async () => {
    const setFilters = vi.fn();
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(FilterBar, {
          filters: DEFAULT_CROSS_ROOM_THREAD_FILTERS,
          setFilters,
        })
      );
    });
    const getRoomIdInput = () =>
      renderer.root
        .findAllByType('input')
        .find((input) => input.props['aria-label'] === 'Room id filters');

    await act(async () => {
      getRoomIdInput()?.props.onChange({ target: { value: '!a:foo, ' } });
      await Promise.resolve();
    });

    expect(getRoomIdInput()?.props.value).toBe('!a:foo, ');

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(getRoomIdInput()?.props.value).toBe('!a:foo, ');
    expect(setFilters).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(resolveFilterUpdate(getLastFilterUpdate(setFilters))).toEqual({
      ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
      roomIds: ['!a:foo'],
    });

    const committedFilters = resolveFilterUpdate(getLastFilterUpdate(setFilters));
    await act(async () => {
      renderer.update(
        React.createElement(FilterBar, {
          filters: committedFilters,
          setFilters,
        })
      );
      await Promise.resolve();
    });
    expect(getRoomIdInput()?.props.value).toBe('!a:foo, ');
  });

  it('commits included and excluded tag CSV debounces against the latest filters', async () => {
    let filters = DEFAULT_CROSS_ROOM_THREAD_FILTERS;
    let renderer!: ReturnType<typeof create>;
    const setFilters = vi.fn((update: CrossRoomThreadFiltersUpdate) => {
      filters = resolveFilterUpdate(update, filters);
      renderer.update(React.createElement(FilterBar, { filters, setFilters }));
    });

    await act(async () => {
      renderer = create(React.createElement(FilterBar, { filters, setFilters }));
    });
    const getInput = (ariaLabel: string) =>
      renderer.root.findAllByType('input').find((input) => input.props['aria-label'] === ariaLabel);

    await act(async () => {
      getInput('Included tag filters')?.props.onChange({ target: { value: 'urgent' } });
      getInput('Excluded tag filters')?.props.onChange({ target: { value: 'done' } });
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(filters.tag.include).toEqual(['urgent']);
    expect(filters.tag.exclude).toEqual(['done']);
  });

  it('preserves immediate checkbox changes when a pending search debounce commits', async () => {
    let filters = DEFAULT_CROSS_ROOM_THREAD_FILTERS;
    let renderer!: ReturnType<typeof create>;
    const setFilters = vi.fn((update: CrossRoomThreadFiltersUpdate) => {
      filters = resolveFilterUpdate(update, filters);
      renderer.update(React.createElement(FilterBar, { filters, setFilters }));
    });

    await act(async () => {
      renderer = create(React.createElement(FilterBar, { filters, setFilters }));
    });
    const searchInput = renderer.root
      .findAllByType('input')
      .find((input) => input.props['aria-label'] === 'Search threads');
    const unreadToggle = renderer.root
      .findAllByType('input')
      .find((input) => input.props.type === 'checkbox');

    await act(async () => {
      searchInput?.props.onChange({ target: { value: 'agent' } });
      unreadToggle?.props.onChange({ target: { checked: true } });
      await Promise.resolve();
    });
    expect(filters.unreadOnly).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(filters.query).toBe('agent');
    expect(filters.unreadOnly).toBe(true);
  });

  it('clears the local search query when clearing filters', async () => {
    const setFilters = vi.fn();
    let filters = DEFAULT_CROSS_ROOM_THREAD_FILTERS;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(FilterBar, { filters, setFilters }));
    });

    const getSearchInput = () =>
      renderer.root
        .findAllByType('input')
        .find((input) => input.props['aria-label'] === 'Search threads');

    await act(async () => {
      getSearchInput()?.props.onChange({ target: { value: 'foo' } });
      await Promise.resolve();
    });
    expect(getSearchInput()?.props.value).toBe('foo');

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    filters = resolveFilterUpdate(getLastFilterUpdate(setFilters));
    await act(async () => {
      renderer.update(React.createElement(FilterBar, { filters, setFilters }));
    });
    expect(filters).toEqual({ ...DEFAULT_CROSS_ROOM_THREAD_FILTERS, query: 'foo' });

    const clearButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAllByProps({ children: 'Clear' }).length > 0);
    await act(async () => {
      clearButton?.props.onClick();
      renderer.update(
        React.createElement(FilterBar, {
          filters: DEFAULT_CROSS_ROOM_THREAD_FILTERS,
          setFilters,
        })
      );
      await Promise.resolve();
    });

    expect(setFilters).toHaveBeenLastCalledWith(DEFAULT_CROSS_ROOM_THREAD_FILTERS);
    expect(getSearchInput()?.props.value).toBe('');
  });

  it('opens the mobile bottom sheet with themed top corners', () => {
    const renderer = create(
      React.createElement(FilterBar, {
        filters: DEFAULT_CROSS_ROOM_THREAD_FILTERS,
        setFilters: vi.fn(),
      })
    );
    const filterButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAllByProps({ children: 'Filters' }).length > 0);

    act(() => {
      filterButton?.props.onClick();
    });

    expect(renderer.root.findAllByProps({ 'aria-label': 'Thread filters' }).length).toBe(1);
    const modal = renderer.root.find(
      (node) => node.type === 'div' && node.props.style?.height === 'min(85svh, 700px)'
    );
    expect(modal.props.style?.borderRadius).toBe('var(--test-radii-400) var(--test-radii-400) 0 0');
  });
});
