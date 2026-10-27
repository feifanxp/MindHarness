import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { SidebarContent } from './SidebarContent';

vi.mock('folds', () => ({
  Box: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => React.createElement('div', props, children),
}));

describe('SidebarContent', () => {
  it('pads the sticky footer stack into the bottom safe area', () => {
    const renderer = create(
      React.createElement(SidebarContent, {
        scrollable: React.createElement('span', null, 'scrollable'),
        sticky: React.createElement('span', null, 'sticky'),
      })
    );

    const boxes = renderer.root.findAllByType('div');

    expect(boxes[1]?.props.style).toEqual({
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    });
  });
});
