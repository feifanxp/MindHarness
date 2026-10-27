// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeNavScrollMemoryKey, useNavVirtualizer } from './navScrollMemory';

const ROW_HEIGHT = 40;
const ROW_COUNT = 50;

// jsdom has no layout, so the viewport clamps scrollTop to its declared height.
const createViewport = (scrollHeight: number, clientHeight = 400): HTMLDivElement => {
  const element = document.createElement('div');
  let scrollTop = 0;
  const maxScrollTop = () => Math.max(0, scrollHeight - clientHeight);
  Object.defineProperties(element, {
    clientHeight: { get: () => clientHeight },
    offsetHeight: { get: () => clientHeight },
    offsetWidth: { get: () => 300 },
    scrollHeight: { get: () => scrollHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.min(Math.max(0, value), maxScrollTop());
      },
    },
  });
  element.scrollTo = ((options: ScrollToOptions) => {
    element.scrollTop = options.top ?? scrollTop;
  }) as typeof element.scrollTo;
  return element;
};

const scrollViewportTo = (viewport: HTMLElement, scrollTop: number) => {
  act(() => {
    viewport.scrollTop = scrollTop;
    viewport.dispatchEvent(new Event('scroll'));
  });
};

type NavListHandle = { firstIndex: () => number | undefined; scrollOffset: () => number | null };

function NavList({
  memoryKey,
  viewport,
  handle,
}: {
  memoryKey: string;
  viewport: HTMLElement;
  handle: { current?: NavListHandle };
}) {
  const virtualizer = useNavVirtualizer(memoryKey, {
    count: ROW_COUNT,
    getScrollElement: () => viewport,
    estimateSize: () => ROW_HEIGHT,
    overscan: 0,
  });
  // eslint-disable-next-line no-param-reassign
  handle.current = {
    firstIndex: () => virtualizer.getVirtualItems()[0]?.index,
    scrollOffset: () => virtualizer.scrollOffset,
  };
  return null;
}

describe('useNavVirtualizer', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}

        unobserve() {}

        disconnect() {}
      }
    );
  });

  const mount = (memoryKey: string, viewport: HTMLElement) => {
    const handle: { current?: NavListHandle } = {};
    act(() => {
      renderer = create(React.createElement(NavList, { memoryKey, viewport, handle }));
    });
    return handle.current!;
  };

  const unmount = () => {
    act(() => renderer?.unmount());
    renderer = undefined;
  };

  afterEach(unmount);

  it('reopens a remounted panel at its last offset', () => {
    const memoryKey = makeNavScrollMemoryKey('@alice:example.org', 'remount');
    const firstViewport = createViewport(ROW_COUNT * ROW_HEIGHT);
    mount(memoryKey, firstViewport);
    scrollViewportTo(firstViewport, 800);
    unmount();

    const viewport = createViewport(ROW_COUNT * ROW_HEIGHT);
    const list = mount(memoryKey, viewport);

    expect(viewport.scrollTop).toBe(800);
    expect(list.scrollOffset()).toBe(800);
    expect(list.firstIndex()).toBe(800 / ROW_HEIGHT);
  });

  it('keeps each panel and account separate', () => {
    const homeKey = makeNavScrollMemoryKey('@alice:example.org', 'separate-home');
    const homeViewport = createViewport(ROW_COUNT * ROW_HEIGHT);
    mount(homeKey, homeViewport);
    scrollViewportTo(homeViewport, 600);
    unmount();

    const spaceViewport = createViewport(ROW_COUNT * ROW_HEIGHT);
    mount(makeNavScrollMemoryKey('@alice:example.org', 'separate-space'), spaceViewport);
    expect(spaceViewport.scrollTop).toBe(0);
    unmount();

    const otherAccountViewport = createViewport(ROW_COUNT * ROW_HEIGHT);
    mount(makeNavScrollMemoryKey('@bob:example.org', 'separate-home'), otherAccountViewport);
    expect(otherAccountViewport.scrollTop).toBe(0);
    unmount();

    const returningViewport = createViewport(ROW_COUNT * ROW_HEIGHT);
    mount(homeKey, returningViewport);
    expect(returningViewport.scrollTop).toBe(600);
  });

  it('renders from the top when the remembered offset no longer fits', () => {
    const memoryKey = makeNavScrollMemoryKey('@alice:example.org', 'clamped');
    const firstViewport = createViewport(ROW_COUNT * ROW_HEIGHT);
    mount(memoryKey, firstViewport);
    scrollViewportTo(firstViewport, 1200);
    unmount();

    // The panel's other content collapsed, so the rows now fit the viewport.
    const viewport = createViewport(400);
    const list = mount(memoryKey, viewport);

    expect(viewport.scrollTop).toBe(0);
    expect(list.scrollOffset()).toBe(0);
    expect(list.firstIndex()).toBe(0);
  });
});
