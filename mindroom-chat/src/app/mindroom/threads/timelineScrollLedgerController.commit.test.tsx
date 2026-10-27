// @vitest-environment jsdom
import React, { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {},
  setOptions: () => {},
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItems: () => [],
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizer,
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => new Promise<void>(() => {}),
}));

it('renders the rows an applied correction moved before the browser paints', async () => {
  // Outside act(), React schedules ordinary updates the way a browser does.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const scrollElement = { scrollTop: 3400, addEventListener() {}, removeEventListener() {} };
  let commits = 0;
  function Harness() {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 100,
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement as unknown as HTMLDivElement,
      itemCount: 40,
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 100),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadInitialRenderMode: 'live',
    });
    useLayoutEffect(() => {
      commits += 1;
    });
    return <div ref={controller.virtualInnerRef} />;
  }
  const root = createRoot(document.createElement('div'));
  flushSync(() => root.render(<Harness />));
  const correction = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as (
    item: { end: number },
    delta: number,
    instance: { scrollOffset: number; scrollDirection: null; scrollElement: { scrollTop: number } }
  ) => boolean;
  const resize = (end: number) => {
    const scrollOffset = scrollElement.scrollTop;
    const apply = correction({ end }, -200, { scrollOffset, scrollDirection: null, scrollElement });
    // virtual-core writes an applied correction at once.
    if (apply) scrollElement.scrollTop -= 200;
    return apply;
  };
  const committed = commits;

  // The second row of the batch is reported where the unmoved layout puts
  // it, which is still above the reader.
  expect(resize(3300)).toBe(true);
  expect(resize(3350)).toBe(true);
  expect(scrollElement.scrollTop).toBe(3000);
  expect(commits).toBe(committed);

  // One microtask later, before a scheduled render could run after the
  // paint, React has rendered the moved rows, and judges in them again.
  await Promise.resolve();
  expect(commits).toBe(committed + 1);
  expect(resize(3050)).toBe(false);
  flushSync(() => root.unmount());
});
