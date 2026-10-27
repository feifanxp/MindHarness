// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { Virtualizer, type VirtualizerOptions } from '@tanstack/react-virtual';
import { describe, expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
  return {
    ...actual,
    useVirtualizer: (options: VirtualizerOptions<HTMLDivElement, Element>) =>
      actual.useVirtualizer({
        ...options,
        initialRect: { width: 390, height: 600 },
        initialOffset: 6000,
      }),
  };
});

vi.mock('./rideTraceRecorder', () => ({
  installRideTraceRecorder: vi.fn(),
  isRideTraceEnabled: () => false,
}));

const measureCoverage = (
  sizes: number[],
  threadId: string | null = '$thread',
  steps = [{ offset: 6000, height: 600, margin: 0 }]
) => {
  let instance: Virtualizer<HTMLDivElement, Element>;
  const Harness = () => {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: (index = 0) => sizes[index],
      getItemKey: (index) => index,
      getScrollElement: () => null,
      itemCount: sizes.length,
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 0),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadId: threadId ?? undefined,
      threadInitialRenderMode: 'live',
    });
    instance = controller.virtualizer;
    return null;
  };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(React.createElement(Harness));
  });
  const coverages = steps.map(({ offset, height, margin }) => {
    act(() => renderer.update(React.createElement(Harness)));
    instance!.scrollOffset = offset;
    instance!.scrollRect = { width: 390, height };
    instance!.setOptions({ ...instance!.options, scrollMargin: margin });
    const items = instance!.getVirtualItems();
    return {
      before: offset - items[0].start,
      after: items[items.length - 1].end - (offset + height),
      indexes: items.map((item) => item.index),
    };
  });
  act(() => renderer!.unmount());
  return coverages;
};

describe('thread scroll coverage with real virtual-core ranges', () => {
  it.each([undefined, '$thread'])(
    'refreshes same-row resize coverage across room/thread navigation (initial thread: %s)',
    (initialThreadId) => {
      const root = document.createElement('div');
      Object.defineProperties(root, {
        offsetWidth: { value: 390 },
        offsetHeight: { value: 600 },
      });
      const observers = new Map<Element, ResizeObserverCallback>();
      class ControlledResizeObserver {
        constructor(private readonly callback: ResizeObserverCallback) {}

        observe(element: Element) {
          observers.set(element, this.callback);
        }

        unobserve(element: Element) {
          observers.delete(element);
        }

        disconnect() {
          observers.clear();
        }
      }
      vi.stubGlobal('ResizeObserver', ControlledResizeObserver);
      const resize = (height: number) => {
        act(() => {
          observers.get(root)!(
            [
              {
                target: root,
                borderBoxSize: [{ inlineSize: 390, blockSize: height }],
              } as unknown as ResizeObserverEntry,
            ],
            {} as ResizeObserver
          );
        });
      };
      const sizes = [...Array<number>(60).fill(100), 3000, ...Array<number>(60).fill(100)];
      const getScrollElement = () => root;
      let renderedBefore = 0;
      let renders = 0;
      let instance: Virtualizer<HTMLDivElement, Element>;
      const Harness = ({ threadId }: { threadId?: string }) => {
        renders += 1;
        const controller = useTimelineScrollLedgerController({
          alive: () => true,
          estimateSize: (index = 0) => sizes[index],
          getItemKey: (index) => index,
          getScrollElement,
          itemCount: sizes.length,
          pendingRoomFoldPxRef: useRef(0),
          roomFoldPriceRef: useRef(() => 0),
          roomId: '!room:example.org',
          threadEventIndexMap: new Map(),
          threadEvents: [],
          threadId,
          threadInitialRenderMode: 'live',
        });
        instance = controller.virtualizer;
        renderedBefore = 6000 - instance.getVirtualItems()[0].start;
        return null;
      };
      let renderer: ReturnType<typeof create> | undefined;
      try {
        act(() => {
          renderer = create(React.createElement(Harness, { threadId: initialThreadId }));
        });
        if (!initialThreadId) {
          expect(renderedBefore).toBe(1000);
          act(() => renderer!.update(React.createElement(Harness, { threadId: '$thread' })));
        }
        expect(instance!.range).toEqual({ startIndex: 60, endIndex: 60 });
        expect(renderedBefore).toBe(1200);
        resize(1000);
        expect(instance!.range).toEqual({ startIndex: 60, endIndex: 60 });
        expect(renderedBefore).toBeGreaterThanOrEqual(2000);

        act(() => renderer!.update(React.createElement(Harness, {})));
        expect(renderedBefore).toBe(1000);
        const roomRenders = renders;
        resize(600);
        expect(renders).toBe(roomRenders);
        expect(renderedBefore).toBe(1000);

        act(() => renderer!.update(React.createElement(Harness, { threadId: '$other-thread' })));
        expect(renderedBefore).toBe(1200);
        resize(1000);
        expect(renderedBefore).toBeGreaterThanOrEqual(2000);
      } finally {
        act(() => renderer?.unmount());
        vi.unstubAllGlobals();
      }
      expect(observers.size).toBe(0);
    }
  );

  it('keeps two screens of messages ready across dense invisible streaming edits', () => {
    const sizes = Array.from({ length: 200 }, () => [100, ...Array<number>(80).fill(0)]).flat();
    const [coverage] = measureCoverage(sizes);
    expect(coverage.before).toBeGreaterThanOrEqual(1200);
    expect(coverage.after).toBeGreaterThanOrEqual(1200);
    expect(coverage.before).toBeLessThanOrEqual(1400);
    expect(coverage.after).toBeLessThanOrEqual(1400);
    // Preserve sequential render context and the original event indices.
    expect(
      coverage.indexes.every((index, i) => i === 0 || index === coverage.indexes[i - 1] + 1)
    ).toBe(true);
  });

  it('keeps short messages buffered by distance instead of ten row indices', () => {
    const [coverage] = measureCoverage(Array<number>(1000).fill(24));
    expect(coverage.before).toBeGreaterThanOrEqual(1200);
    expect(coverage.after).toBeGreaterThanOrEqual(1200);
  });

  it('preserves the existing room timeline range', () => {
    const [coverage] = measureCoverage(Array<number>(1000).fill(24), null);
    expect(coverage.before).toBe(240);
    expect(coverage.after).toBeLessThanOrEqual(264);
  });

  it('tracks rapid reverse scrolling, viewport resize, and a shifted ledger', () => {
    const sizes = Array.from({ length: 400 }, (_, i) => [
      i % 2 ? 24 : 180,
      ...Array<number>(50).fill(0),
    ]).flat();
    const steps = [
      { offset: 20000, height: 600, margin: 0 },
      { offset: 16000, height: 600, margin: 0 },
      { offset: 18000, height: 600, margin: 0 },
      { offset: 18000, height: 400, margin: 0 },
      { offset: 16000, height: 800, margin: -3400 },
    ];
    measureCoverage(sizes, '$thread', steps).forEach((coverage, index) => {
      expect(coverage.before).toBeGreaterThanOrEqual(steps[index].height * 2);
      expect(coverage.after).toBeGreaterThanOrEqual(steps[index].height * 2);
      expect(coverage.before).toBeLessThan(steps[index].height * 2 + 360);
      expect(coverage.after).toBeLessThan(steps[index].height * 2 + 360);
    });
  });

  it('clamps to loaded content at either edge without inventing rows', () => {
    const sizes = Array.from({ length: 40 }, () => [100, ...Array<number>(20).fill(0)]).flat();
    const [start, end] = measureCoverage(sizes, '$thread', [
      { offset: 0, height: 600, margin: 0 },
      { offset: 3400, height: 600, margin: 0 },
    ]);
    expect(start.indexes[0]).toBe(0);
    expect(start.before).toBe(0);
    expect(end.indexes.at(-1)).toBe(sizes.length - 1);
    expect(end.after).toBe(0);
  });
});
