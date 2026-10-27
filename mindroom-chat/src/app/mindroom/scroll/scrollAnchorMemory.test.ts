// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ScrollAnchorMemory, useScrollAnchorMemory } from './scrollAnchorMemory';

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 200;

const rowKeys = (count: number) => Array.from({ length: count }, (_, index) => `row-${index}`);

const toRect = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top } as DOMRect);

// jsdom has no layout, so rows stack in DOM order and the viewport clamps
// scrollTop to the content like a browser.
const createLayout = (keys: string[], viewportHeight = VIEWPORT_HEIGHT) => {
  const view = document.createElement('div');
  const content = document.createElement('div');
  view.append(content);
  let scrollTop = 0;
  const rowTop = (row: Element) => Array.from(content.children).indexOf(row) * ROW_HEIGHT;
  const maxScrollTop = () => Math.max(0, content.children.length * ROW_HEIGHT - viewportHeight);
  Object.defineProperty(view, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.min(Math.max(0, value), maxScrollTop());
    },
  });
  view.getBoundingClientRect = () => toRect(0, viewportHeight);
  const setRows = (nextKeys: string[]) => {
    content.replaceChildren(
      ...nextKeys.map((key) => {
        const row = document.createElement('div');
        row.setAttribute('data-scroll-anchor', key);
        row.getBoundingClientRect = () => toRect(rowTop(row) - scrollTop, ROW_HEIGHT);
        return row;
      })
    );
  };
  setRows(keys);
  const offsetOf = (key: string) =>
    view.querySelector(`[data-scroll-anchor="${key}"]`)!.getBoundingClientRect().top;
  return { view, content, setRows, offsetOf };
};

type Layout = ReturnType<typeof createLayout>;

function AnchoredList({
  memory,
  memoryKey,
  layout,
  ready,
}: {
  memory: ScrollAnchorMemory;
  memoryKey: string;
  layout: { scrollRef: { current: HTMLElement }; contentRef: { current: HTMLElement } };
  ready: boolean;
}) {
  useScrollAnchorMemory({
    memory,
    memoryKey,
    scrollRef: layout.scrollRef,
    contentRef: layout.contentRef,
    ready,
  });
  return null;
}

describe('useScrollAnchorMemory', () => {
  let renderer: ReactTestRenderer | undefined;
  // Each connected observer's callback, with the elements it watches.
  const observers = new Map<() => void, Set<Element>>();

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}

        observe(target: Element) {
          observers.set(this.callback, (observers.get(this.callback) ?? new Set()).add(target));
        }

        disconnect() {
          observers.delete(this.callback);
        }
      }
    );
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    observers.clear();
    vi.unstubAllGlobals();
  });

  const refsOf = (layout: Layout) => ({
    scrollRef: { current: layout.view },
    contentRef: { current: layout.content },
  });

  const mount = (memory: ScrollAnchorMemory, layout: Layout, ready = true, memoryKey = 'list') => {
    const refs = refsOf(layout);
    const render = (nextReady: boolean) =>
      React.createElement(AnchoredList, { memory, memoryKey, layout: refs, ready: nextReady });
    act(() => {
      renderer = create(render(ready));
    });
    return { setReady: (nextReady: boolean) => act(() => renderer?.update(render(nextReady))) };
  };

  const unmount = () => {
    act(() => renderer?.unmount());
    renderer = undefined;
  };

  /** Resizes `target`, or every observed element. */
  const resize = (target?: Element) =>
    act(() =>
      observers.forEach((targets, callback) => {
        if (!target || targets.has(target)) callback();
      })
    );

  const scrollReaderTo = (layout: Layout, scrollTop: number) => {
    layout.view.scrollTop = scrollTop;
    layout.view.dispatchEvent(new Event('scroll'));
  };

  const leaveAt = (memory: ScrollAnchorMemory, keys: string[], scrollTop: number) => {
    const layout = createLayout(keys);
    mount(memory, layout);
    layout.view.scrollTop = scrollTop;
    const offsets = new Map(keys.map((key) => [key, layout.offsetOf(key)]));
    unmount();
    return offsets;
  };

  it('reopens at the same rows after a remount', () => {
    const memory: ScrollAnchorMemory = new Map();
    leaveAt(memory, rowKeys(20), 300);

    const layout = createLayout(rowKeys(20));
    mount(memory, layout);

    expect(layout.view.scrollTop).toBe(300);
  });

  it('keeps the rows in place when the opened row moved to the top', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    const before = leaveAt(memory, keys, 300);

    // row-9 was opened and now sorts first.
    const layout = createLayout(['row-9', ...keys.filter((key) => key !== 'row-9')]);
    mount(memory, layout);

    expect(layout.offsetOf('row-10')).toBe(before.get('row-10'));
    expect(layout.offsetOf('row-11')).toBe(before.get('row-11'));
    expect(layout.offsetOf('row-12')).toBe(before.get('row-12'));
  });

  it('does not follow the opened row when it was the first row in view', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    const before = leaveAt(memory, keys, 280);
    expect(before.get('row-7')).toBe(0);

    const layout = createLayout(['row-7', ...keys.filter((key) => key !== 'row-7')]);
    mount(memory, layout);

    expect(layout.offsetOf('row-8')).toBe(before.get('row-8'));
    expect(layout.view.scrollTop).toBe(280);
  });

  it('takes the position most rows agree on over the nearest one', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    const before = leaveAt(memory, keys, 300);

    // row-11 sat low in view; the rows above it, most of the view, moved down
    // a row when it sorted first, and only row-12 below it stayed.
    const layout = createLayout(['row-11', ...keys.filter((key) => key !== 'row-11')]);
    mount(memory, layout);

    expect(layout.offsetOf('row-8')).toBe(before.get('row-8'));
    expect(layout.offsetOf('row-9')).toBe(before.get('row-9'));
  });

  it('takes the nearer position when a moved row and an unmoved row disagree', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    const first = createLayout(keys, 2 * ROW_HEIGHT);
    mount(memory, first);
    first.view.scrollTop = 280;
    unmount();

    const layout = createLayout(
      ['row-8', ...keys.filter((key) => key !== 'row-8')],
      2 * ROW_HEIGHT
    );
    mount(memory, layout);

    expect(layout.offsetOf('row-7')).toBe(0);
  });

  it('keeps following the rows it placed when the tie would now go the other way', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    const first = createLayout(keys, 2 * ROW_HEIGHT);
    mount(memory, first);
    first.view.scrollTop = 280;
    unmount();

    const reordered = ['row-8', ...keys.filter((key) => key !== 'row-8')];
    const layout = createLayout(reordered, 2 * ROW_HEIGHT);
    mount(memory, layout);
    expect(layout.offsetOf('row-7')).toBe(0);

    // Rows loading above move both tied rows past the saved offset.
    layout.setRows(['new-row-1', 'new-row-2', 'new-row-3', 'new-row-4', ...reordered]);
    resize();

    expect(layout.offsetOf('row-7')).toBe(0);
  });

  it('stays at the top when the reader was at the top', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    leaveAt(memory, keys, 0);

    const layout = createLayout(['row-3', ...keys.filter((key) => key !== 'row-3')]);
    mount(memory, layout);

    expect(layout.view.scrollTop).toBe(0);
  });

  it('falls back to the saved offset when none of its rows are rendered', () => {
    const memory: ScrollAnchorMemory = new Map();
    leaveAt(memory, rowKeys(20), 300);

    const layout = createLayout(rowKeys(20).map((key) => `other-${key}`));
    mount(memory, layout);

    expect(layout.view.scrollTop).toBe(300);
  });

  it('follows rows that render late until the reader scrolls', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    const before = leaveAt(memory, keys, 300);

    const layout = createLayout(keys.slice(0, 6));
    mount(memory, layout);
    expect(layout.view.scrollTop).toBe(ROW_HEIGHT);

    layout.setRows(keys);
    resize(layout.content);
    expect(layout.offsetOf('row-10')).toBe(before.get('row-10'));

    layout.view.scrollTop = 120;
    layout.setRows(['new-row', ...keys]);
    resize();
    expect(layout.view.scrollTop).toBe(120);
    expect(observers.size).toBe(0);
  });

  it('follows its rows while they move together', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    const before = leaveAt(memory, keys, 300);

    const layout = createLayout(keys);
    mount(memory, layout);
    layout.setRows(['new-row-1', 'new-row-2', ...keys]);
    resize(layout.content);

    expect(layout.offsetOf('row-10')).toBe(before.get('row-10'));
    expect(observers.size).toBe(1);
  });

  it('stops following once rows already in the list change order', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    leaveAt(memory, keys, 300);

    const layout = createLayout(keys);
    mount(memory, layout);
    // A thread below the view gets a reply and sorts first while the reader
    // looks on; a later resize must not move the rows back up.
    layout.setRows(['row-19', ...keys.filter((key) => key !== 'row-19')]);
    resize(layout.content);

    expect(layout.view.scrollTop).toBe(300);
    expect(observers.size).toBe(0);
  });

  it('stops following once the reader scrolls, even back to the same place', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    leaveAt(memory, keys, 300);

    const layout = createLayout(keys);
    mount(memory, layout);
    scrollReaderTo(layout, 340);
    scrollReaderTo(layout, 300);
    layout.setRows(['new-row', ...keys]);
    resize(layout.content);

    expect(layout.view.scrollTop).toBe(300);
    expect(observers.size).toBe(0);
  });

  it('stops following once rows in view move apart', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    leaveAt(memory, keys, 300);

    const layout = createLayout(keys);
    mount(memory, layout);
    // row-8 was in view and leaves in place, as a resolved card does under
    // the unresolved filter; the rows below it close the gap.
    layout.setRows(keys.filter((key) => key !== 'row-8'));
    resize();
    expect(layout.view.scrollTop).toBe(300);

    layout.setRows(['new-row', ...keys.filter((key) => key !== 'row-8')]);
    resize();
    expect(layout.view.scrollTop).toBe(300);
    expect(observers.size).toBe(0);
  });

  it('waits for its rows before restoring', () => {
    const memory: ScrollAnchorMemory = new Map();
    const keys = rowKeys(20);
    const before = leaveAt(memory, keys, 300);

    const layout = createLayout([]);
    const list = mount(memory, layout, false);
    layout.setRows(keys);
    list.setReady(true);

    expect(layout.offsetOf('row-10')).toBe(before.get('row-10'));
  });

  it('keeps the previous position when it unmounts before its rows render', () => {
    const memory: ScrollAnchorMemory = new Map();
    leaveAt(memory, rowKeys(20), 300);
    const saved = memory.get('list');

    mount(memory, createLayout([]), false);
    unmount();

    expect(memory.get('list')).toBe(saved);
  });

  it('keeps the previous position when its rows are gone by the time it unmounts', () => {
    const memory: ScrollAnchorMemory = new Map();
    leaveAt(memory, rowKeys(20), 300);
    const saved = memory.get('list');

    const layout = createLayout(rowKeys(20));
    const list = mount(memory, layout);
    layout.setRows([]);
    list.setReady(false);
    unmount();

    expect(memory.get('list')).toBe(saved);
  });

  it('keeps each key separate', () => {
    const memory: ScrollAnchorMemory = new Map();
    leaveAt(memory, rowKeys(20), 300);

    const other = createLayout(rowKeys(20));
    mount(memory, other, true, 'other-list');
    expect(other.view.scrollTop).toBe(0);
    unmount();

    const layout = createLayout(rowKeys(20));
    mount(memory, layout);
    expect(layout.view.scrollTop).toBe(300);
  });
});
