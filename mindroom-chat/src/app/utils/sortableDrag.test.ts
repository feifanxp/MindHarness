// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { AnimateLayoutChanges } from '@dnd-kit/sortable';
import {
  animateSortableLayoutDuringDrag,
  suppressNextClickDefaultAfterPointerDrag,
} from './sortableDrag';

const layoutArgs = (
  args: Partial<Parameters<AnimateLayoutChanges>[0]>
): Parameters<AnimateLayoutChanges>[0] => ({
  active: null,
  containerId: 'container',
  id: 'item-a',
  index: 0,
  isDragging: false,
  isSorting: false,
  items: ['item-a', 'item-b'],
  newIndex: 1,
  previousContainerId: 'container',
  previousItems: ['item-a', 'item-b'],
  transition: {
    duration: 200,
    easing: 'ease',
  },
  wasDragging: true,
  ...args,
});

describe('animateSortableLayoutDuringDrag', () => {
  it('keeps in-drag layout animation enabled', () => {
    expect(
      animateSortableLayoutDuringDrag(
        layoutArgs({
          active: { id: 'item-a', data: { current: undefined }, rect: { current: {} } },
          isSorting: true,
        })
      )
    ).toBe(true);
  });

  it('disables the post-drop layout animation that returns the drag source to its old slot', () => {
    expect(animateSortableLayoutDuringDrag(layoutArgs({ isSorting: false }))).toBe(false);
  });
});

describe('suppressNextClickDefaultAfterPointerDrag', () => {
  it('suppresses the next native click after a pointer drag ends', () => {
    const button = document.createElement('button');
    document.body.append(button);

    button.addEventListener('mousedown', suppressNextClickDefaultAfterPointerDrag);
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    button.remove();
  });

  it('does not suppress clicks after keyboard drag activators', () => {
    suppressNextClickDefaultAfterPointerDrag(new KeyboardEvent('keydown', { key: ' ' }));

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
  });
});
