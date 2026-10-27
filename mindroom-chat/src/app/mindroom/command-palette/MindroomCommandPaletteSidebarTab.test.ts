import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { commandPaletteOpenAtom } from './commandPaletteState';
import { MindroomCommandPaletteSidebarTab } from './MindroomCommandPaletteSidebarTab';
import { mindroomAccountSettingsAtom } from '../settings/useMindroomAccountSettings';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

const { userAgentState } = vi.hoisted(() => ({
  userAgentState: { os: 'Linux' },
}));

vi.mock('../../utils/user-agent', () => ({
  isMacOS: () => userAgentState.os === 'Mac OS',
  isIOS: () => userAgentState.os === 'iOS',
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const passthrough =
    (tag: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement(tag, null, children);
  return {
    Badge: ({ as, children }: { as?: string; children?: React.ReactNode }) =>
      reactModule.createElement(as ?? 'span', null, children),
    Box: passthrough('span'),
    Icon: ({ src }: { src: string }) => reactModule.createElement('i', { 'data-icon': src }),
    Icons: {
      Search: 'Search',
    },
    Text: passthrough('span'),
  };
});

vi.mock('../../components/sidebar', () => ({
  SidebarItem: ({ active, children }: { active?: boolean; children: React.ReactNode }) =>
    React.createElement('div', { 'data-active': active }, children),
  SidebarItemTooltip: ({
    tooltip,
    children,
  }: {
    tooltip: React.ReactNode;
    children: (triggerRef: () => void) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      null,
      React.createElement('div', { 'data-tooltip': true }, tooltip),
      children(() => undefined)
    ),
  SidebarAvatar: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children: React.ReactNode;
    }
  >(({ children, ...props }, ref) =>
    React.createElement('button', { ref, type: 'button', ...props }, children)
  ),
}));

const renderSearchTab = (open = false) => {
  const store = createStore();
  store.set(commandPaletteOpenAtom, open);
  store.set(mindroomAccountSettingsAtom, {
    simpleMode: false,
  });

  const renderer = create(
    React.createElement(Provider, { store }, React.createElement(MindroomCommandPaletteSidebarTab))
  );

  return { renderer, store };
};

describe('MindroomCommandPaletteSidebarTab', () => {
  it('opens the shared command palette atom from the sidebar trigger', async () => {
    const { renderer, store } = renderSearchTab(false);
    const button = renderer.root.findByType('button');

    await act(async () => {
      button.props.onClick();
    });

    expect(store.get(commandPaletteOpenAtom)).toBe(true);
  });

  it('uses a search icon, the active state, and a tooltip that teaches the shortcut', () => {
    const { renderer } = renderSearchTab(true);
    const tooltip = renderer.root.findByProps({ 'data-tooltip': true });
    const tooltipText = (node: typeof tooltip): string =>
      node.children
        .map((child) => (typeof child === 'string' ? child : tooltipText(child)))
        .join('');

    expect(tooltipText(tooltip)).toBe('Open command paletteCtrl + K');
    expect(tooltip.findByType('kbd' as never)).toBeDefined();
    expect(renderer.root.findByProps({ 'data-active': true })).toBeDefined();
    expect(renderer.root.findByProps({ 'data-icon': 'Search' })).toBeDefined();
    expect(renderer.root.findByType('button').props['aria-label']).toBe('Open command palette');
    expect(renderer.root.findByType('button').props['aria-keyshortcuts']).toBe('Control+K');
  });

  it.each(['Mac OS', 'iOS'])('names the Command key on %s, where mod+k means Command', (os) => {
    userAgentState.os = os;
    try {
      const { renderer } = renderSearchTab();
      expect(JSON.stringify(renderer.toJSON())).toContain('⌘ K');
      expect(renderer.root.findByType('button').props['aria-keyshortcuts']).toBe('Meta+K');
    } finally {
      userAgentState.os = 'Linux';
    }
  });
});
