import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomThreadOverview } from './RoomThreadOverview';
import type { ThreadFilterState } from './RoomThreadOverview';
import { normalizeThreadSearchText } from './roomThreadOverviewModel';
import { applyParsedThreadFilterQuery, parseThreadFilterQuery } from './threadFilterDsl';

const { passthrough, simpleModeState } = vi.hoisted(() => ({
  passthrough: 'div',
  simpleModeState: { enabled: false },
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Box: passthrough,
    Chip: passthrough,
    Icon: passthrough,
    Text: passthrough,
    Tooltip: passthrough,
    TooltipProvider: ({ children }: { children: (ref: null) => React.ReactNode }) => children(null),
  };
});

vi.mock('./RoomThreadOverview.css', () => ({
  Overview: 'Overview',
  ToolbarHeader: 'ToolbarHeader',
  ToggleGroup: 'ToggleGroup',
  ToggleButton: 'ToggleButton',
  ToggleInclude: 'ToggleInclude',
  ToggleIncludeOr: 'ToggleIncludeOr',
  ToggleExclude: 'ToggleExclude',
  SectionSeparator: 'SectionSeparator',
  CompactCount: 'CompactCount',
  SortButton: 'SortButton',
  SortButtonActive: 'SortButtonActive',
  PauseButtonActive: 'PauseButtonActive',
  EmptyState: 'EmptyState',
  ResetLink: 'ResetLink',
  TagRow: 'TagRow',
  TagList: 'TagList',
  TagPill: 'TagPill',
  TagPillInclude: 'TagPillInclude',
  TagPillExclude: 'TagPillExclude',
  TagPillLabel: 'TagPillLabel',
  TagPillRemove: 'TagPillRemove',
  AddTagContainer: 'AddTagContainer',
  AddTagButton: 'AddTagButton',
  AddTagDropdown: 'AddTagDropdown',
  AddTagOption: 'AddTagOption',
  PresetContainer: 'PresetContainer',
  PresetButton: 'PresetButton',
  PresetDropdown: 'PresetDropdown',
  PresetOption: 'PresetOption',
  InfoContainer: 'InfoContainer',
  InfoButton: 'InfoButton',
  InfoPopover: 'InfoPopover',
  InfoStatRow: 'InfoStatRow',
  InfoSectionDivider: 'InfoSectionDivider',
  SearchContainer: 'SearchContainer',
  SearchInput: 'SearchInput',
}));

vi.mock('./ThreadIndicator.css', () => ({
  ThreadStreamingDot: 'ThreadStreamingDot',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
}));

vi.mock('@tabler/icons-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tabler/icons-react')>();

  return {
    ...actual,
    IconCalendarEvent: 'icon-calendar-event',
    IconChevronDown: 'icon-chevron-down',
    IconInfoCircle: 'icon-info-circle',
    IconLayoutList: 'icon-layout-list',
    IconLayoutRows: 'icon-layout-rows',
    IconLock: 'icon-lock',
    IconLockOpen: 'icon-lock-open',
    IconMessages: 'icon-messages',
    IconSortAscending: 'icon-sort-ascending',
    IconSortDescending: 'icon-sort-descending',
    IconZzz: 'icon-zzz',
  };
});

vi.mock('classnames', () => ({
  default: (...args: (string | boolean | undefined | null)[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../settings/useMindroomAccountSettings', () => ({
  useSimpleMode: () => simpleModeState.enabled,
}));

// Resolve t() keys against the real en.json so the aria/tooltip assertions
// below keep checking user-visible English copy.
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

const makeDefaultState = (overrides?: Partial<ThreadFilterState>): ThreadFilterState => ({
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'natural',
  sortDirection: 'desc',
  tags: new Map(),
  freeText: '',
  unsupportedQuery: '',
  statusMode: 'and',
  ...overrides,
});

const defaultProps = {
  hasMindroomAgents: true,
  threadCount: 5,
  totalThreadCount: 5,
  state: makeDefaultState(),
  availableTags: [] as string[],
  isThreadSortFrozen: false,
  onToggle: vi.fn(),
  onSortDirectionChange: vi.fn(),
  onToggleThreadSortFreeze: vi.fn(),
  onReset: vi.fn(),
  onCycleTag: vi.fn(),
  onAddTag: vi.fn(),
  onRemoveTag: vi.fn(),
  onApplyPreset: vi.fn(),
  onSearchQueryChange: vi.fn(),
  viewMode: 'threaded' as const,
  onViewModeChange: vi.fn(),
};

describe('RoomThreadOverview', () => {
  afterEach(() => {
    simpleModeState.enabled = false;
  });

  it('keeps only search, view, and sort controls in agentless rooms', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        hasMindroomAgents: false,
        availableTags: ['priority'],
        isThreadSortFrozen: true,
        state: makeDefaultState({
          resolved: 'include',
          sortBy: 'lastReply',
          tags: new Map([['priority', 'include']]),
        }),
        viewMode: 'compact',
      })
    );

    expect(renderer.root.findAll((node) => node.props['data-search-bar'] === 'true')).toHaveLength(
      1
    );
    expect(
      renderer.root.findAll((node) => node.props['data-view-mode-toggle'] === 'true')
    ).toHaveLength(3);
    expect(renderer.root.findAll((node) => node.props['data-sort-by'] !== undefined)).toHaveLength(
      1
    );

    expect(
      renderer.root.findAll((node) => node.props['data-thread-count'] === 'true')
    ).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props['data-filter-key'])).toHaveLength(0);
    expect(
      renderer.root.findAll((node) => node.props['data-preset-button'] === 'true')
    ).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props['data-info-button'] === 'true')).toHaveLength(
      0
    );
    expect(
      renderer.root.findAll((node) => node.props['data-thread-sort-freeze'] === 'true')
    ).toHaveLength(0);
    expect(
      renderer.root.findAll((node) => node.props['data-tag-filter-row'] === 'true')
    ).toHaveLength(0);

    renderer.unmount();
  });

  it('keeps compact, threaded, and sort controls in an agentless simple-mode room', () => {
    simpleModeState.enabled = true;
    const onSortDirectionChange = vi.fn();
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        hasMindroomAgents: false,
        onSortDirectionChange,
        state: makeDefaultState({ sortBy: 'natural' }),
        viewMode: 'compact',
      })
    );

    const viewToggles = renderer.root.findAll(
      (node) => node.props['data-view-mode-toggle'] === 'true'
    );
    expect(viewToggles.map((button) => button.props['data-view-mode'])).toEqual([
      'compact',
      'threaded',
    ]);
    expect(renderer.root.findAll((node) => node.props['data-filter-key'])).toHaveLength(0);
    expect(
      renderer.root.findAll((node) => node.props['data-simple-unresolved-toggle'] === 'true')
    ).toHaveLength(0);
    const sortButton = renderer.root.find((node) => node.props['data-sort-by'] !== undefined);
    expect(sortButton.props['data-sort-by']).toBe('natural');

    act(() => {
      sortButton.props.onClick();
    });

    expect(onSortDirectionChange).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('keeps compact, threaded, unresolved, and sort controls in a simple-mode agent room', () => {
    simpleModeState.enabled = true;
    const onViewModeChange = vi.fn();
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onViewModeChange,
        state: makeDefaultState({ resolved: 'exclude' }),
      })
    );

    const viewToggles = renderer.root.findAll(
      (node) => node.props['data-view-mode-toggle'] === 'true'
    );
    expect(viewToggles.map((button) => button.props['data-view-mode'])).toEqual([
      'compact',
      'threaded',
    ]);
    expect(viewToggles.map((button) => button.props['aria-pressed'])).toEqual([false, true]);
    expect(
      renderer.root.findAll((node) => node.props['data-simple-unresolved-toggle'] === 'true')
    ).toHaveLength(1);
    const sortButton = renderer.root.find((node) => node.props['data-sort-by'] !== undefined);
    expect(sortButton.props.className).not.toContain('SortButtonActive');
    expect(
      renderer.root.findAll((node) => node.props['data-thread-sort-freeze'] === 'true')
    ).toHaveLength(0);

    act(() => {
      viewToggles[0].props.onClick();
    });

    expect(onViewModeChange).toHaveBeenCalledWith('compact');

    renderer.unmount();
  });

  it('keeps the simple-mode sort control neutral for last-reply sorting', () => {
    simpleModeState.enabled = true;
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ resolved: 'exclude', sortBy: 'lastReply' }),
      })
    );

    const sortButton = renderer.root.find((node) => node.props['data-sort-by'] !== undefined);
    expect(sortButton.props.className).not.toContain('SortButtonActive');

    renderer.unmount();
  });

  it('renders five icon toggles', () => {
    const renderer = create(React.createElement(RoomThreadOverview, defaultProps));

    const buttons = renderer.root.findAll(
      (node) => node.type === 'button' && node.props['data-filter-key']
    );
    expect(buttons).toHaveLength(5);

    const keys = buttons.map((b) => b.props['data-filter-key']);
    expect(keys).toEqual(['resolved', 'streaming', 'scheduled', 'unread', 'idle']);

    renderer.unmount();
  });

  it('reflects controlled visual state via data-filter-state', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ resolved: 'include', streaming: 'exclude' }),
      })
    );

    const resolvedBtn = renderer.root.find((node) => node.props['data-filter-key'] === 'resolved');
    expect(resolvedBtn.props['data-filter-state']).toBe('include');
    expect(resolvedBtn.props.className).toContain('ToggleInclude');

    const streamingBtn = renderer.root.find(
      (node) => node.props['data-filter-key'] === 'streaming'
    );
    expect(streamingBtn.props['data-filter-state']).toBe('exclude');
    expect(streamingBtn.props.className).toContain('ToggleExclude');

    renderer.unmount();
  });

  it('uses the OR warning class for included chips in OR mode', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({
          streaming: 'include',
          scheduled: 'include',
          statusMode: 'or',
        }),
      })
    );

    const streamingBtn = renderer.root.find(
      (node) => node.props['data-filter-key'] === 'streaming'
    );
    const scheduledBtn = renderer.root.find(
      (node) => node.props['data-filter-key'] === 'scheduled'
    );

    expect(streamingBtn.props.className).toContain('ToggleIncludeOr');
    expect(scheduledBtn.props.className).toContain('ToggleIncludeOr');

    renderer.unmount();
  });

  it('keeps the default include class outside OR mode', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ streaming: 'include', statusMode: 'and' }),
      })
    );

    const streamingBtn = renderer.root.find(
      (node) => node.props['data-filter-key'] === 'streaming'
    );

    expect(streamingBtn.props.className).toContain('ToggleInclude');
    expect(streamingBtn.props.className).not.toContain('ToggleIncludeOr');

    renderer.unmount();
  });

  it('cycles state on click: any -> include -> exclude -> any', () => {
    const onToggle = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onToggle,
      })
    );

    const resolvedBtn = renderer.root.find((node) => node.props['data-filter-key'] === 'resolved');

    act(() => {
      resolvedBtn.props.onClick();
    });

    expect(onToggle).toHaveBeenCalledWith('resolved');

    renderer.unmount();
  });

  it('shows aria-valuetext matching state', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ resolved: 'include' }),
      })
    );

    const resolvedBtn = renderer.root.find((node) => node.props['data-filter-key'] === 'resolved');
    expect(resolvedBtn.props['aria-valuetext']).toBe('show only');

    renderer.unmount();
  });

  it('sort button shows Natural by default', () => {
    const renderer = create(React.createElement(RoomThreadOverview, defaultProps));

    const sortBtn = renderer.root.find((node) => node.props['data-sort-by'] !== undefined);
    expect(sortBtn.props['data-sort-by']).toBe('natural');

    renderer.unmount();
  });

  it('sort button shows Last Reply when sortBy is lastReply', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }),
      })
    );

    const sortBtn = renderer.root.find((node) => node.props['data-sort-by'] !== undefined);
    expect(sortBtn.props['data-sort-by']).toBe('lastReply');
    expect(sortBtn.props['data-sort-direction']).toBe('desc');

    renderer.unmount();
  });

  it('sort button calls onSortDirectionChange on click', () => {
    const onSortDirectionChange = vi.fn();
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onSortDirectionChange,
      })
    );

    const sortBtn = renderer.root.find((node) => node.props['data-sort-by'] !== undefined);

    act(() => {
      sortBtn.props.onClick();
    });

    expect(onSortDirectionChange).toHaveBeenCalled();

    renderer.unmount();
  });

  it('hides the freeze button when sort is natural', () => {
    const renderer = create(React.createElement(RoomThreadOverview, defaultProps));

    expect(
      renderer.root.findAll((node) => node.props['data-thread-sort-freeze'] === 'true')
    ).toHaveLength(0);

    renderer.unmount();
  });

  it('shows an inactive freeze button for non-natural sorting', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }),
      })
    );

    const freezeButton = renderer.root.find(
      (node) => node.props['data-thread-sort-freeze'] === 'true'
    );
    expect(freezeButton.props['aria-pressed']).toBe(false);
    expect(freezeButton.props['aria-label']).toBe('Lock sort order (currently Last Reply)');
    expect(freezeButton.findAllByType('icon-lock')).toHaveLength(1);

    renderer.unmount();
  });

  it('shows the active freeze button state when sorting is paused', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        isThreadSortFrozen: true,
        state: makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }),
      })
    );

    const freezeButton = renderer.root.find(
      (node) => node.props['data-thread-sort-freeze'] === 'true'
    );
    expect(freezeButton.props.className).toContain('PauseButtonActive');
    expect(freezeButton.props['aria-pressed']).toBe(true);
    expect(freezeButton.props['aria-label']).toBe('Unlock sort order (currently Last Reply)');
    expect(freezeButton.findAllByType('icon-lock-open')).toHaveLength(1);

    renderer.unmount();
  });

  it('freeze button calls onToggleThreadSortFreeze on click', () => {
    const onToggleThreadSortFreeze = vi.fn();
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ sortBy: 'lastReply', sortDirection: 'desc' }),
        onToggleThreadSortFreeze,
      })
    );

    const freezeButton = renderer.root.find(
      (node) => node.props['data-thread-sort-freeze'] === 'true'
    );

    act(() => {
      freezeButton.props.onClick();
    });

    expect(onToggleThreadSortFreeze).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('sort button uses active style when filters are active', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ resolved: 'include' }),
      })
    );

    const sortBtn = renderer.root.find((node) => node.props['data-sort-by'] !== undefined);
    expect(sortBtn.props.className).toContain('SortButtonActive');

    renderer.unmount();
  });

  it('renders three room view mode buttons with threaded mode active', () => {
    const renderer = create(React.createElement(RoomThreadOverview, defaultProps));

    const viewToggles = renderer.root.findAll(
      (node) => node.props['data-view-mode-toggle'] === 'true'
    );
    expect(viewToggles.map((button) => button.props['data-view-mode'])).toEqual([
      'compact',
      'threaded',
      'classic',
    ]);
    expect(viewToggles.map((button) => button.props['aria-pressed'])).toEqual([false, true, false]);
    expect(viewToggles[1].props.className).toContain('SortButtonActive');

    renderer.unmount();
  });

  it('selects compact mode from the view mode buttons', () => {
    const onViewModeChange = vi.fn();
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onViewModeChange,
      })
    );

    const compactToggle = renderer.root.find(
      (node) =>
        node.props['data-view-mode-toggle'] === 'true' && node.props['data-view-mode'] === 'compact'
    );

    act(() => {
      compactToggle.props.onClick();
    });

    expect(onViewModeChange).toHaveBeenCalledWith('compact');

    renderer.unmount();
  });

  it('renders compact thread count instead of Threads (N)', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        threadCount: 42,
      })
    );

    // Should NOT render old format
    const oldFormat = renderer.root.findAll(
      (node) => typeof node.children[0] === 'string' && node.children[0] === 'Threads (42)'
    );
    expect(oldFormat).toHaveLength(0);

    // Should render compact count with data attribute
    const countElement = renderer.root.find((node) => node.props['data-thread-count'] === 'true');
    expect(countElement).toBeTruthy();

    renderer.unmount();
  });

  it('shows zero-results empty state with reset link', () => {
    const onReset = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        threadCount: 0,
        state: makeDefaultState({ resolved: 'include' }),
        onReset,
      })
    );

    const resetBtn = renderer.root.find(
      (node) => node.props['aria-label'] === 'Reset all thread filters'
    );
    expect(resetBtn).toBeTruthy();

    act(() => {
      resetBtn.props.onClick();
    });

    expect(onReset).toHaveBeenCalled();

    renderer.unmount();
  });

  it('does NOT show empty state when threadCount > 0', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        threadCount: 3,
        state: makeDefaultState({ resolved: 'include' }),
      })
    );

    const resetBtns = renderer.root.findAll(
      (node) => node.props['aria-label'] === 'Reset all thread filters'
    );
    expect(resetBtns).toHaveLength(0);

    renderer.unmount();
  });

  it('does NOT show empty state when no filters active', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        threadCount: 0,
      })
    );

    const resetBtns = renderer.root.findAll(
      (node) => node.props['aria-label'] === 'Reset all thread filters'
    );
    expect(resetBtns).toHaveLength(0);

    renderer.unmount();
  });

  // ═══ No count badges ═══════════════════════════════════════════════════

  it('does NOT render per-icon count badges', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        statusCounts: { resolved: 42, streaming: 3, scheduled: 5, unread: 12, idle: 28 },
      })
    );

    const countNodes = renderer.root.findAll(
      (node) => node.props['data-status-count'] !== undefined
    );
    expect(countNodes).toHaveLength(0);

    renderer.unmount();
  });

  // ═══ Preset dropdown ══════════════════════════════════════════════════

  it('renders preset button', () => {
    const renderer = create(React.createElement(RoomThreadOverview, defaultProps));

    const presetBtn = renderer.root.findAll((node) => node.props['data-preset-button'] === 'true');
    expect(presetBtn).toHaveLength(1);

    renderer.unmount();
  });

  it('opens preset dropdown on click', () => {
    const renderer = create(React.createElement(RoomThreadOverview, defaultProps));

    const presetBtn = renderer.root.find((node) => node.props['data-preset-button'] === 'true');

    act(() => {
      presetBtn.props.onClick();
    });

    const dropdown = renderer.root.findAll((node) => node.props['data-preset-dropdown'] === 'true');
    expect(dropdown).toHaveLength(1);

    // Should have 5 preset options
    const options = renderer.root.findAll((node) => node.props['data-preset-option'] !== undefined);
    expect(options).toHaveLength(5);

    renderer.unmount();
  });

  it('calls onApplyPreset when preset option is selected', () => {
    const onApplyPreset = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onApplyPreset,
      })
    );

    // Open dropdown
    const presetBtn = renderer.root.find((node) => node.props['data-preset-button'] === 'true');
    act(() => {
      presetBtn.props.onClick();
    });

    // Select "Needs attention"
    const option = renderer.root.find(
      (node) => node.props['data-preset-option'] === 'needs-attention'
    );
    act(() => {
      option.props.onMouseDown({ preventDefault: vi.fn() });
    });

    expect(onApplyPreset).toHaveBeenCalledTimes(1);
    expect(onApplyPreset.mock.calls[0][0].id).toBe('needs-attention');

    renderer.unmount();
  });

  // ═══ Info popover ═════════════════════════════════════════════════════

  it('renders info button', () => {
    const renderer = create(React.createElement(RoomThreadOverview, defaultProps));

    const infoBtn = renderer.root.findAll((node) => node.props['data-info-button'] === 'true');
    expect(infoBtn).toHaveLength(1);

    renderer.unmount();
  });

  it('opens info popover on click', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        statusCounts: { resolved: 10, streaming: 2, scheduled: 1, unread: 3, idle: 5 },
        tagCounts: { bug: 3, feature: 2 },
      })
    );

    const infoBtn = renderer.root.find((node) => node.props['data-info-button'] === 'true');

    act(() => {
      infoBtn.props.onClick();
    });

    const popover = renderer.root.findAll((node) => node.props['data-info-popover'] === 'true');
    expect(popover).toHaveLength(1);

    renderer.unmount();
  });

  // ═══ Search bar ═══════════════════════════════════════════════════════

  it('renders search toggle button', () => {
    const renderer = create(React.createElement(RoomThreadOverview, defaultProps));

    const searchBtn = renderer.root.findAll((node) => node.props['data-search-toggle'] === 'true');
    expect(searchBtn).toHaveLength(1);

    renderer.unmount();
  });

  it('expands search input on click', () => {
    const renderer = create(React.createElement(RoomThreadOverview, defaultProps));

    // Initially no input
    let inputs = renderer.root.findAll((node) => node.props['data-search-input'] === 'true');
    expect(inputs).toHaveLength(0);

    // Click search toggle
    const searchBtn = renderer.root.find((node) => node.props['data-search-toggle'] === 'true');
    act(() => {
      searchBtn.props.onClick();
    });

    // Now input should be visible
    inputs = renderer.root.findAll((node) => node.props['data-search-input'] === 'true');
    expect(inputs).toHaveLength(1);

    renderer.unmount();
  });

  it('calls onSearchQueryChange when search input changes', () => {
    const onSearchQueryChange = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onSearchQueryChange,
        state: makeDefaultState({ freeText: '' }),
      })
    );

    // Expand search
    const searchBtn = renderer.root.find((node) => node.props['data-search-toggle'] === 'true');
    act(() => {
      searchBtn.props.onClick();
    });

    // Type in input
    const input = renderer.root.find((node) => node.props['data-search-input'] === 'true');
    act(() => {
      input.props.onChange({ target: { value: 'test query' } });
    });

    expect(onSearchQueryChange).toHaveBeenCalledWith('test query');

    renderer.unmount();
  });

  it('preserves spaces across controlled sequential search keystrokes', () => {
    function Harness() {
      const [state, setState] = React.useState(makeDefaultState());
      return React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state,
        onSearchQueryChange: (query: string) =>
          setState((current) =>
            applyParsedThreadFilterQuery(current, parseThreadFilterQuery(query))
          ),
        onToggle: (key: keyof ThreadFilterState) =>
          setState((current) => ({ ...current, [key]: 'include' })),
      });
    }

    const renderer = create(React.createElement(Harness));
    act(() => {
      renderer.root.find((node) => node.props['data-search-toggle'] === 'true').props.onClick();
    });

    for (const value of ['hello', 'hello ', 'hello w', 'hello world']) {
      act(() => {
        renderer.root
          .find((node) => node.props['data-search-input'] === 'true')
          .props.onChange({ target: { value } });
      });
      expect(
        renderer.root.find((node) => node.props['data-search-input'] === 'true').props.value
      ).toBe(value);
    }

    act(() => {
      renderer.root.find((node) => node.props['data-filter-key'] === 'resolved').props.onClick();
    });
    expect(
      renderer.root.find((node) => node.props['data-search-input'] === 'true').props.value
    ).toBe('is:resolved hello world');

    renderer.unmount();
  });

  it('preserves an agentless plain-text search draft while canonical state updates', () => {
    function Harness() {
      const [state, setState] = React.useState(makeDefaultState());
      return React.createElement(RoomThreadOverview, {
        ...defaultProps,
        hasMindroomAgents: false,
        state,
        onSearchQueryChange: (query: string) =>
          setState((current) => ({
            ...current,
            freeText: normalizeThreadSearchText(query),
            unsupportedQuery: '',
          })),
      });
    }

    const renderer = create(React.createElement(Harness));
    act(() => {
      renderer.root.find((node) => node.props['data-search-toggle'] === 'true').props.onClick();
    });

    act(() => {
      renderer.root
        .find((node) => node.props['data-search-input'] === 'true')
        .props.onChange({ target: { value: 'hello is:streaming ' } });
    });

    expect(
      renderer.root.find((node) => node.props['data-search-input'] === 'true').props.value
    ).toBe('hello is:streaming ');

    renderer.unmount();
  });

  it('renders the search placeholder as visible text instead of a raw unicode escape', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        state: makeDefaultState({ freeText: '' }),
      })
    );

    const searchBtn = renderer.root.find((node) => node.props['data-search-toggle'] === 'true');
    act(() => {
      searchBtn.props.onClick();
    });

    const input = renderer.root.find((node) => node.props['data-search-input'] === 'true');
    expect(input.props.placeholder).toBe('Search threads...');
    expect(input.props.placeholder).not.toContain('\\u2026');

    renderer.unmount();
  });

  // ═══ Tag pills ═════════════════════════════════════════════════════════

  it('renders tag pills with correct state', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved', 'blocked', 'priority'],
        state: makeDefaultState({
          tags: new Map([
            ['resolved', 'include'],
            ['blocked', 'exclude'],
          ]),
        }),
      })
    );

    const resolvedPill = renderer.root.find((node) => node.props['data-tag-name'] === 'resolved');
    expect(resolvedPill.props['data-tag-state']).toBe('include');
    expect(resolvedPill.props.className).toContain('TagPillInclude');

    const blockedPill = renderer.root.find((node) => node.props['data-tag-name'] === 'blocked');
    expect(blockedPill.props['data-tag-state']).toBe('exclude');
    expect(blockedPill.props.className).toContain('TagPillExclude');

    renderer.unmount();
  });

  it('calls onCycleTag when tag pill label is clicked', () => {
    const onCycleTag = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onCycleTag,
        availableTags: ['resolved'],
        state: makeDefaultState({
          tags: new Map([['resolved', 'include']]),
        }),
      })
    );

    const labelBtn = renderer.root.find(
      (node) => node.type === 'button' && node.props.className === 'TagPillLabel'
    );

    act(() => {
      labelBtn.props.onClick();
    });

    expect(onCycleTag).toHaveBeenCalledWith('resolved');

    renderer.unmount();
  });

  it('calls onRemoveTag when tag pill remove button is clicked', () => {
    const onRemoveTag = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onRemoveTag,
        availableTags: ['resolved'],
        state: makeDefaultState({
          tags: new Map([['resolved', 'include']]),
        }),
      })
    );

    const removeBtn = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Remove resolved filter'
    );

    act(() => {
      removeBtn.props.onClick();
    });

    expect(onRemoveTag).toHaveBeenCalledWith('resolved');

    renderer.unmount();
  });

  // ═══ AddTagDropdown ════════════════════════════════════════════════════

  it('shows add-tag button when unselected tags are available', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved', 'blocked'],
      })
    );

    const addBtn = renderer.root.findAll((node) => node.props['data-add-tag-button'] === 'true');
    expect(addBtn).toHaveLength(1);

    renderer.unmount();
  });

  it('hides add-tag button when all tags are already selected', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved'],
        state: makeDefaultState({
          tags: new Map([['resolved', 'include']]),
        }),
      })
    );

    const addBtns = renderer.root.findAll((node) => node.props['data-add-tag-button'] === 'true');
    expect(addBtns).toHaveLength(0);

    renderer.unmount();
  });

  it('opens dropdown on click and shows unselected tags', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved', 'blocked', 'priority'],
        state: makeDefaultState({
          tags: new Map([['resolved', 'include']]),
        }),
      })
    );

    // Dropdown should not be visible initially
    let options = renderer.root.findAll((node) => node.props['data-tag-option'] !== undefined);
    expect(options).toHaveLength(0);

    // Click the add-tag button
    const addBtn = renderer.root.find((node) => node.props['data-add-tag-button'] === 'true');
    act(() => {
      addBtn.props.onClick();
    });

    // Now dropdown should show unselected tags
    options = renderer.root.findAll((node) => node.props['data-tag-option'] !== undefined);
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.props['data-tag-option'])).toEqual(['blocked', 'priority']);

    renderer.unmount();
  });

  it('calls onAddTag via onMouseDown (pointer path) exactly once', () => {
    const onAddTag = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onAddTag,
        availableTags: ['resolved', 'blocked'],
      })
    );

    // Open dropdown
    const addBtn = renderer.root.find((node) => node.props['data-add-tag-button'] === 'true');
    act(() => {
      addBtn.props.onClick();
    });

    // Verify no onClick handler exists on the option (check before selecting,
    // since selection closes the dropdown and unmounts the node)
    const blockedOption = renderer.root.find((node) => node.props['data-tag-option'] === 'blocked');
    expect(blockedOption.props.onClick).toBeUndefined();

    // Select via onMouseDown (the only pointer handler)
    act(() => {
      blockedOption.props.onMouseDown({ preventDefault: vi.fn() });
    });

    expect(onAddTag).toHaveBeenCalledTimes(1);
    expect(onAddTag).toHaveBeenCalledWith('blocked');

    renderer.unmount();
  });

  it('supports arrow key navigation in dropdown', () => {
    const onAddTag = vi.fn();

    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        onAddTag,
        availableTags: ['alpha', 'beta', 'gamma'],
      })
    );

    // Open dropdown
    const addBtn = renderer.root.find((node) => node.props['data-add-tag-button'] === 'true');
    act(() => {
      addBtn.props.onClick();
    });

    // Find the container that has onKeyDown
    const container = renderer.root.find((node) => node.props.className === 'AddTagContainer');

    // Press ArrowDown to move to second option
    act(() => {
      container.props.onKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      });
    });

    // Press Enter to select
    act(() => {
      container.props.onKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
      });
    });

    expect(onAddTag).toHaveBeenCalledWith('beta');

    renderer.unmount();
  });

  it('renders tag filter row when tags are available', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: ['resolved', 'blocked'],
      })
    );

    const tagRow = renderer.root.findAll((node) => node.props['data-tag-filter-row'] === 'true');
    expect(tagRow).toHaveLength(1);

    renderer.unmount();
  });

  it('hides tag filter row when no tags available and none active', () => {
    const renderer = create(
      React.createElement(RoomThreadOverview, {
        ...defaultProps,
        availableTags: [],
      })
    );

    const tagRows = renderer.root.findAll((node) => node.props['data-tag-filter-row'] === 'true');
    expect(tagRows).toHaveLength(0);

    renderer.unmount();
  });
});
