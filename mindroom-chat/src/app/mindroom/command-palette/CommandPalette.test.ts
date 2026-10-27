import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { CommandPaletteSource } from './commandPaletteItems';
import { CommandPalette } from './CommandPalette';

const { searchCommandPaletteSectionCalls } = vi.hoisted(() => ({
  searchCommandPaletteSectionCalls: vi.fn(),
}));

vi.mock('../../utils/user-agent', () => ({
  isMacOS: () => false,
  isIOS: () => false,
}));

vi.mock('./commandPaletteSearch', async () => {
  const actual = await vi.importActual<typeof import('./commandPaletteSearch')>(
    './commandPaletteSearch'
  );

  return {
    ...actual,
    searchCommandPaletteSection: vi.fn((options) => {
      searchCommandPaletteSectionCalls(options);
      return actual.searchCommandPaletteSection(options);
    }),
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    toRem: (value: number) => `${value / 16}rem`,
    Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      reactModule.createElement('div', props, children),
    Icon: ({ src, ...props }: React.HTMLAttributes<HTMLSpanElement> & { src?: string }) =>
      reactModule.createElement('span', { ...props, 'data-icon-src': src }),
    IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    Input: ({
      value,
      onChange,
      onKeyDown,
      ...props
    }: React.InputHTMLAttributes<HTMLInputElement>) =>
      reactModule.createElement('input', { value, onChange, onKeyDown, ...props }),
    Scroll: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      reactModule.createElement('div', { 'data-testid': 'scroll', ...props }, children),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    Line: () => reactModule.createElement('hr'),
    Icons: {
      Cross: 'cross',
      Terminal: 'terminal',
      Message: 'message',
      Hash: 'hash',
      Space: 'space',
      User: 'user',
      Search: 'search',
    },
    color: {
      Warning: { Main: 'warning-main' },
      Primary: { Main: 'primary-main' },
      Success: { Main: 'success-main' },
      Secondary: { Main: 'secondary-main' },
      SurfaceVariant: {
        OnContainer: 'surface-variant-on-container',
        ContainerHover: 'surface-variant-container-hover',
      },
    },
    config: {
      space: {
        S400: '16px',
      },
    },
  };
});

vi.mock('./CommandPalette.css', () => ({
  Palette: 'Palette',
  Search: 'Search',
  Input: 'Input',
  Close: 'Close',
  Filters: 'Filters',
  Filter: 'Filter',
  Prefix: 'Prefix',
  Results: 'Results',
  Group: 'Group',
  GroupTitle: 'GroupTitle',
  GroupCount: 'GroupCount',
  Row: 'Row',
  RowIcon: 'RowIcon',
  RowText: 'RowText',
  RowTitle: 'RowTitle',
  RowDescription: 'RowDescription',
  RowEnter: 'RowEnter',
  Key: 'Key',
  Footer: 'Footer',
  KeyboardHints: 'KeyboardHints',
  Hint: 'Hint',
  Empty: 'Empty',
  EmptyTitle: 'EmptyTitle',
  EmptyDescription: 'EmptyDescription',
}));

const getInput = (renderer: ReturnType<typeof create>) => renderer.root.findByType('input');
const getOptions = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll((node) => node.props.role === 'option');
const FIXTURE_SOURCE: CommandPaletteSource = {
  actions: [
    {
      id: 'action-settings',
      kind: 'action',
      title: 'Open Settings',
      description: 'Shared settings modal',
      keywords: ['preferences'],
      sortRank: 30,
    },
    {
      id: 'action-home',
      kind: 'action',
      title: 'Go Home',
      description: 'Jump back to the home view',
      keywords: ['home'],
      sortRank: 20,
    },
    {
      id: 'action-theme',
      kind: 'action',
      title: 'Toggle Theme',
      description: 'Switch between light and dark',
      keywords: ['theme', 'appearance'],
      sortRank: 10,
    },
  ],
  rooms: [
    {
      id: '!general:example.org',
      kind: 'room',
      name: 'General',
      topic: 'Team chat',
      parentNames: ['MindRoom'],
      sortRank: 30,
      boost: 30,
    },
    {
      id: '!product:example.org',
      kind: 'room',
      name: 'Product',
      topic: 'Roadmap planning',
      parentNames: ['MindRoom'],
      sortRank: 20,
      boost: 20,
    },
    {
      id: '!space:example.org',
      kind: 'space',
      name: 'Engineering Space',
      topic: 'Nested engineering rooms',
      sortRank: 10,
      boost: 10,
    },
  ],
  getUsers: vi.fn(() => [
    {
      id: '@alice:example.org',
      kind: 'user',
      displayName: 'Alice',
      userId: '@alice:example.org',
      localpart: 'alice',
      dmRoomName: 'Alice DM',
      sortRank: 30,
      boost: 30,
    },
    {
      id: '@bob:example.org',
      kind: 'user',
      displayName: 'Bob',
      userId: '@bob:example.org',
      localpart: 'bob',
      dmRoomName: 'Bob DM',
      sortRank: 20,
      boost: 20,
    },
  ]),
  threads: [
    {
      id: '$thread-incident',
      kind: 'thread',
      roomId: '!general:example.org',
      threadId: '$thread-incident',
      summaryText: 'Investigate login incident',
      roomName: 'General',
      participantNames: ['Alice', 'Bob'],
      tags: ['urgent'],
      sortRank: 30,
      boost: 30,
    },
    {
      id: '$thread-release',
      kind: 'thread',
      roomId: '!product:example.org',
      threadId: '$thread-release',
      summaryText: 'Ship release checklist',
      roomName: 'Product',
      participantNames: ['Carmen'],
      tags: ['release'],
      sortRank: 20,
      boost: 20,
    },
  ],
  getMessages: (query: string) => {
    if (query.length === 0) return [];

    return [
      {
        id: `message-room-${query}`,
        kind: 'message',
        title: `Search "${query}" in current room`,
        description: 'Fixture message search row',
        scope: 'room',
      },
      {
        id: `message-all-${query}`,
        kind: 'message',
        title: `Search "${query}" across all rooms`,
        description: 'Fixture global search row',
        scope: 'all',
      },
    ];
  },
};

const renderPalette = (props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) =>
  create(
    React.createElement(CommandPalette, {
      requestClose: vi.fn(),
      source: FIXTURE_SOURCE,
      ...props,
    })
  );

describe('CommandPalette', () => {
  it('keeps a prefix-leading search literal when switching to All', async () => {
    const renderer = renderPalette();
    await act(async () => {
      getInput(renderer).props.onChange({ currentTarget: { value: '@ @alice:example.org' } });
    });
    const allFilter = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'All'
    );
    await act(async () => allFilter.props.onClick());
    expect(getInput(renderer).props.value).toBe('@alice:example.org');
    expect(allFilter.props['aria-pressed']).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Search \\"@alice:example.org\\" across all rooms'
    );
    const usersFilter = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Users'
    );
    await act(async () => usersFilter.props.onClick());
    expect(getInput(renderer).props.value).toBe('@ @alice:example.org');
    expect(usersFilter.props['aria-pressed']).toBe(true);
    expect(allFilter.props['aria-pressed']).toBe(false);
    expect(
      new Set(renderer.root.findAllByProps({ role: 'option' }).map((row) => row.props['data-kind']))
    ).toEqual(new Set(['user']));
    await act(async () => allFilter.props.onClick());
    await act(async () => {
      getInput(renderer).props.onChange({ currentTarget: { value: '@alice' } });
    });
    expect(allFilter.props['aria-pressed']).toBe(true);
    await act(async () => {
      getInput(renderer).props.onChange({ currentTarget: { value: '' } });
    });
    await act(async () => {
      getInput(renderer).props.onChange({ currentTarget: { value: '@alice' } });
    });
    expect(allFilter.props['aria-pressed']).toBe(false);
  });

  it('switches category filters without losing the search text', async () => {
    const renderer = renderPalette();
    await act(async () => {
      getInput(renderer).props.onChange({ currentTarget: { value: 'General' } });
    });
    const roomsFilter = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Rooms'
    );
    await act(async () => roomsFilter.props.onClick());
    expect(getInput(renderer).props.value).toBe('# General');
    expect(roomsFilter.props['aria-pressed']).toBe(true);
    expect(
      renderer.root.findAll(
        (node) => node.props['data-item-id'] && node.props['data-kind'] !== 'room'
      )
    ).toHaveLength(0);

    const allFilter = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'All'
    );
    await act(async () => allFilter.props.onClick());
    expect(getInput(renderer).props.value).toBe('General');
    expect(allFilter.props['aria-pressed']).toBe(true);
  });

  it('exposes the keyboard selection to assistive technology', async () => {
    const renderer = renderPalette();
    await act(async () => {
      await Promise.resolve();
    });
    const input = getInput(renderer);
    expect(input.props.role).toBe('combobox');
    const list = renderer.root.findByProps({ role: 'listbox' });
    expect(input.props['aria-controls']).toBe(list.props.id);
    const selected = () => renderer.root.findByProps({ role: 'option', 'aria-selected': true });
    expect(input.props['aria-activedescendant']).toBe(selected().props.id);
    const firstId = selected().props.id;
    await act(async () => input.props.onKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() }));
    expect(selected().props.id).not.toBe(firstId);
    expect(input.props['aria-activedescendant']).toBe(selected().props.id);
  });

  it('executes the hovered result when Enter is pressed', async () => {
    const onSelect = vi.fn();
    const renderer = renderPalette({
      source: {
        ...FIXTURE_SOURCE,
        actions: [{ id: 'hover-action', kind: 'action', title: 'Hover me', onSelect }],
      },
    });
    await act(async () => {
      await Promise.resolve();
    });
    const row = renderer.root.findByProps({ 'data-item-id': 'hover-action' });
    await act(async () => row.props.onPointerMove({ pointerType: 'mouse' }));
    await act(async () =>
      getInput(renderer).props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() })
    );
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('does not execute a result while confirming composed text', async () => {
    const requestClose = vi.fn();
    const renderer = renderPalette({ requestClose });
    await act(async () =>
      getInput(renderer).props.onKeyDown({
        key: 'Enter',
        nativeEvent: { isComposing: true },
        preventDefault: vi.fn(),
      })
    );
    expect(requestClose).not.toHaveBeenCalled();
  });

  it('clears an empty search back to the starter results', async () => {
    const renderer = renderPalette();
    await act(async () =>
      getInput(renderer).props.onChange({ currentTarget: { value: '> zxqnotfound' } })
    );
    expect(renderer.root.findAllByProps({ role: 'option' })).toHaveLength(0);
    expect(getInput(renderer).props['aria-activedescendant']).toBeUndefined();
    const clear = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Clear search'
    );
    await act(async () => clear.props.onClick());
    expect(getInput(renderer).props.value).toBe('');
    expect(renderer.root.findAllByProps({ role: 'option' }).length).toBeGreaterThan(0);
  });

  it('renders the starter sections for an empty query', () => {
    vi.mocked(FIXTURE_SOURCE.getUsers).mockClear();
    const renderer = renderPalette();
    const text = JSON.stringify(renderer.toJSON());

    expect(text).toContain('Open Settings');
    expect(text).toContain('Investigate login incident');
    expect(text).toContain('General');
    expect(text).toContain('Alice');
    expect(text).not.toContain('Search "" in current room');
    expect(FIXTURE_SOURCE.getUsers).toHaveBeenCalledWith({
      exhaustive: false,
      includeRelatedRooms: false,
    });
  });

  it('lists rooms before every other section for empty and typed searches', async () => {
    const renderer = renderPalette();
    const firstSectionKinds = () => {
      const options = getOptions(renderer);
      return options.slice(0, 2).map((option) => option.props['data-kind']);
    };
    expect(firstSectionKinds()).toEqual(['room', 'room']);
    expect(getOptions(renderer)[0].props['data-selected']).toBe(true);

    await act(async () =>
      getInput(renderer).props.onChange({ currentTarget: { value: 'General' } })
    );
    expect(getOptions(renderer)[0].props['data-kind']).toBe('room');
    expect(getOptions(renderer)[0].props['data-item-id']).toBe('!general:example.org');
  });

  it('keeps spaces out of the starter rooms so Enter switches to a room', async () => {
    const renderer = renderPalette({
      source: {
        ...FIXTURE_SOURCE,
        rooms: FIXTURE_SOURCE.rooms.map((room) =>
          room.kind === 'space' ? { ...room, sortRank: 99 } : room
        ),
      },
    });
    expect(getOptions(renderer)[0].props['data-item-id']).toBe('!general:example.org');
    expect(getOptions(renderer).some((option) => option.props['data-kind'] === 'space')).toBe(
      false
    );

    await act(async () =>
      getInput(renderer).props.onChange({ currentTarget: { value: 'Engineering' } })
    );
    expect(getOptions(renderer)[0].props['data-kind']).toBe('space');
  });

  it('orders the category filters with rooms first', () => {
    const renderer = renderPalette();
    const filterGroup = renderer.root.findByProps({
      role: 'group',
      'aria-label': 'Filter results',
    });
    expect(filterGroup.findAllByType('button').map((button) => button.props['aria-label'])).toEqual(
      ['All', 'Rooms', 'Threads', 'Users', 'Actions', 'Spaces']
    );
  });

  it('only requests related-room users for an explicit user search', async () => {
    vi.mocked(FIXTURE_SOURCE.getUsers).mockClear();
    const renderer = renderPalette();

    await act(async () => {
      getInput(renderer).props.onChange({ currentTarget: { value: '@alice' } });
    });

    expect(FIXTURE_SOURCE.getUsers).toHaveBeenLastCalledWith({
      exhaustive: true,
      includeRelatedRooms: true,
    });
  });

  it('scopes sections based on the parsed prefix', async () => {
    const renderer = renderPalette();

    await act(async () => {
      getInput(renderer).props.onChange({
        currentTarget: {
          value: '@alice',
        },
      });
    });

    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Alice');
    expect(text).toContain('@alice:example.org');
    expect(text).not.toContain('Open Settings');
    expect(text).not.toContain('Investigate login incident');
  });

  it('only evaluates the active section after a single-prefix query narrows the mode', async () => {
    const renderer = renderPalette();

    searchCommandPaletteSectionCalls.mockClear();

    await act(async () => {
      getInput(renderer).props.onChange({
        currentTarget: {
          value: '@alice',
        },
      });
    });

    expect(searchCommandPaletteSectionCalls).toHaveBeenCalledTimes(1);
    expect(
      searchCommandPaletteSectionCalls.mock.calls[0]?.[0]?.items.every(
        (item: { kind: string }) => item.kind === 'user'
      )
    ).toBe(true);
  });

  it('keeps the star alias scoped to spaces', async () => {
    const renderer = renderPalette();

    await act(async () => {
      getInput(renderer).props.onChange({
        currentTarget: {
          value: '*',
        },
      });
    });

    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Engineering Space');
    expect(text).toContain('Nested engineering rooms');
    expect(text).not.toContain('General');
    expect(text).not.toContain('Product');
  });

  it('closes the shell when the selected fixture item is chosen with enter', async () => {
    const requestClose = vi.fn();
    const renderer = renderPalette({ requestClose });

    await act(async () => {
      getInput(renderer).props.onKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
      });
    });

    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it('moves the selected row with arrow keys', async () => {
    const renderer = renderPalette();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getOptions(renderer)[0].props['data-selected']).toBe(true);

    await act(async () => {
      getInput(renderer).props.onKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      });
    });

    const selectedButtons = getOptions(renderer).filter((button) => button.props['data-selected']);

    expect(selectedButtons).toHaveLength(1);
    expect(selectedButtons[0].props['data-item-id']).toBe(
      getOptions(renderer)[1].props['data-item-id']
    );
  });

  it('keeps typed prefixes in sync with the category buttons', async () => {
    const renderer = renderPalette();
    await act(async () =>
      getInput(renderer).props.onChange({ currentTarget: { value: 't: release' } })
    );
    const activeFilter = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-pressed'] === true
    );
    expect(activeFilter.props['aria-label']).toBe('Threads');
    expect(JSON.stringify(renderer.toJSON())).toContain('Ship release checklist');
  });
});
