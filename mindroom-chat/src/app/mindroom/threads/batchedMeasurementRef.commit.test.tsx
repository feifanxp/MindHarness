// @vitest-environment jsdom
import React, { useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBatchedMeasurementRef, createScrollMountMeasurement } from './batchedMeasurementRef';

type Harness = {
  virtualizer?: Virtualizer<HTMLDivElement, HTMLDivElement>;
  setCount?: (count: number) => void;
};

const ROW_HEIGHT = 80;
const ESTIMATE = 50;

function List({ harness }: { harness: Harness }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(1);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    estimateSize: () => ESTIMATE,
    getScrollElement: () => scrollRef.current,
    observeElementRect: (_instance, callback) => callback({ width: 390, height: 844 }),
    observeElementOffset: (_instance, callback) => callback(0, false),
    scrollToFn: () => undefined,
  });
  const measureRef = useMemo(
    () => createBatchedMeasurementRef(createScrollMountMeasurement(virtualizer)),
    [virtualizer]
  );
  harness.virtualizer = virtualizer;
  harness.setCount = setCount;
  return (
    <div ref={scrollRef}>
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          ref={measureRef}
          data-index={item.index}
          data-testid={`row-${item.index}`}
          style={{ position: 'absolute', top: item.start }}
        />
      ))}
    </div>
  );
}

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  // Outside act(), React schedules ordinary updates the way a browser does.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      unobserve() {}

      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ROW_HEIGHT);
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  flushSync(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('commits corrected offsets for rows mounted during a scroll before the next task', async () => {
  const harness: Harness = {};
  root = createRoot(container);
  flushSync(() => root?.render(<List harness={harness} />));
  // The first row mounted at rest, where virtual-core measures it itself.
  expect(harness.virtualizer?.itemSizeCache.get(0)).toBe(ROW_HEIGHT);

  harness.virtualizer!.isScrolling = true;
  flushSync(() => harness.setCount?.(3));
  const row = (index: number) =>
    container.querySelector<HTMLElement>(`[data-testid="row-${index}"]`);
  // Rows attached during the scroll still sit at their estimates.
  expect(row(2)?.style.top).toBe(`${ROW_HEIGHT + ESTIMATE}px`);

  // One microtask later the measured offsets are already in the DOM, before
  // a scheduled render (which runs after the browser paints) could commit them.
  await Promise.resolve();
  expect(row(2)?.style.top).toBe(`${ROW_HEIGHT * 2}px`);
});
