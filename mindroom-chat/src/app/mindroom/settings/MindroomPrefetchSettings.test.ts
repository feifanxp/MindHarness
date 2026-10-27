import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// CINNY-207 P6.1 / D4: mocks folds, sequence-card, setting-tile, and
// useSetting so we can assert the tile shape + input semantics without
// booting the settings tree. The scope selector uses a folds PopOut +
// FocusTrap; both are mocked so the selector click simply drives the
// setter through the MenuItem children.

const state = vi.hoisted(() => ({
  prefetchScope: 'my-server' as 'my-server' | 'all-rooms' | 'current-room-only',
  setPrefetchScope: vi.fn(),
  prefetchDepth: 10000,
  setPrefetchDepth: vi.fn(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children, ...rest }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', rest, children),
    Button: ({
      children,
      onClick,
      ...rest
    }: {
      children?: React.ReactNode;
      onClick?: (evt: React.MouseEvent<HTMLButtonElement>) => void;
    }) => reactModule.createElement('button', { onClick, ...rest }, children),
    Icon: () => reactModule.createElement('span'),
    Icons: { ChevronBottom: 'ChevronBottom' },
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      reactModule.createElement('input', props),
    Menu: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    MenuItem: ({
      children,
      onClick,
      ...rest
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
    }) => reactModule.createElement('button', { onClick, ...rest }, children),
    PopOut: ({ content }: { content?: React.ReactNode }) =>
      reactModule.createElement('div', { 'data-testid': 'popout' }, content),
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    config: { space: { S100: 4 } },
    toRem: (value: number) => `${value}px`,
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement('section', { className }, children),
}));

vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({
    title,
    description,
    after,
  }: {
    title: string;
    description?: string;
    after?: React.ReactNode;
  }) =>
    React.createElement(
      'label',
      {
        'data-title': title,
        'data-description': description,
      },
      after
    ),
}));

vi.mock('../../state/hooks/settings', () => ({
  useSetting: (_atom: unknown, key: 'prefetchScope' | 'prefetchDepth') => {
    if (key === 'prefetchScope') return [state.prefetchScope, state.setPrefetchScope];
    return [state.prefetchDepth, state.setPrefetchDepth];
  },
}));

vi.mock('../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('./mindroomSettings', () => ({
  mindroomSettingsAtom: {},
}));

vi.mock('../../utils/keyboard', () => ({
  stopPropagation: () => true,
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

afterEach(() => {
  state.prefetchScope = 'my-server';
  state.setPrefetchScope.mockReset();
  state.prefetchDepth = 10000;
  state.setPrefetchDepth.mockReset();
});

describe('MindroomPrefetchSettings (CINNY-207 P6.1 / D4)', () => {
  it('renders scope opt-in without obsolete depth control', async () => {
    const { MindroomPrefetchSettings } = await import('./MindroomPrefetchSettings');

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        React.createElement(MindroomPrefetchSettings, { className: 'settings-card' })
      );
    });

    // Two SequenceCards render as `<section className="settings-card">`.
    const sections = renderer!.root.findAllByType('section');
    expect(sections).toHaveLength(1);
    expect(sections.every((el) => el.props.className === 'settings-card')).toBe(true);
    expect(renderer!.root.findByProps({ 'data-title': 'Prefetch scope' })).toBeDefined();
    expect(renderer!.root.findAllByType('input')).toHaveLength(0);
  });

  it('commits a scope selection via the MenuItem literal', async () => {
    const { SelectPrefetchScope } = await import('./MindroomPrefetchSettings');
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(SelectPrefetchScope));
    });

    // The first button is the trigger; MenuItems are also rendered as
    // buttons inside the PopOut. Grab the "All rooms" item and click it.
    const spans = renderer!.root.findAllByType('span');
    const allRoomsSpan = spans.find((el) => {
      const children = el.children;
      return children.length === 1 && children[0] === 'All rooms';
    });
    expect(allRoomsSpan).toBeDefined();

    // Walk back up to the MenuItem button that wraps this label.
    const allRoomsButton = renderer!.root
      .findAllByType('button')
      .find((btn) => btn.findAll((node) => node === allRoomsSpan).length > 0);
    expect(allRoomsButton).toBeDefined();

    act(() => {
      allRoomsButton!.props.onClick();
    });

    expect(state.setPrefetchScope).toHaveBeenCalledWith('all-rooms');
  });
});
