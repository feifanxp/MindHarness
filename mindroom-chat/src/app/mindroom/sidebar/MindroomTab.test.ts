import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { create } from 'react-test-renderer';
import { Icons } from 'folds';
import { MindroomTab } from './MindroomTab';

vi.mock('./MindroomTab.css', () => ({
  LinkIndicator: 'link-indicator',
}));

vi.mock('../../components/sidebar', () => ({
  SidebarItem: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  SidebarItemBadge: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'mindroom-link-badge' }, children),
  SidebarItemTooltip: ({
    children,
  }: {
    children: (triggerRef: () => void) => React.ReactNode;
  }) => React.createElement(React.Fragment, null, children(() => undefined)),
  SidebarAvatar: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: 'button' | 'div' }
  >(({ as: As = 'div', children, ...props }, ref) =>
    React.createElement(As, { ...props, ref }, children)
  ),
}));

vi.mock('../../components/Modal500', () => ({
  Modal500: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../../features/settings', () => ({
  Settings: () => React.createElement('div'),
}));

describe('MindroomTab', () => {
  it('renders a link badge on the local MindRoom shortcut', () => {
    const renderer = create(React.createElement(MindroomTab));

    const linkIcons = renderer.root.findAll((node) => node.props?.src === Icons.Link);
    expect(linkIcons.length).toBeGreaterThan(0);

    const logos = renderer.root.findAll((node) => node.props?.alt === 'MindRoom');
    expect(logos).toHaveLength(1);
  });
});
