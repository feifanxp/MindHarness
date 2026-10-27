import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVirtualPaginator } from './useVirtualPaginator';
import { createRoomAutomaticFill } from '../mindroom/threads/roomAutomaticFill';

const intersectionState = vi.hoisted(() => ({
  callback: undefined as ((entries: IntersectionObserverEntry[]) => void) | undefined,
}));

vi.mock('./useIntersectionObserver', () => ({
  useIntersectionObserver: (callback: (entries: IntersectionObserverEntry[]) => void) => {
    intersectionState.callback = callback;
    return {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };
  },
}));

type PaginatorHarnessProps = {
  count?: number;
  limit?: number;
  initialRange?: { start: number; end: number };
  getScrollElement: () => HTMLElement | null;
  getItemElement?: (
    index: number,
    range: {
      start: number;
      end: number;
    }
  ) => HTMLElement | undefined;
  onApi: (paginator: ReturnType<typeof useVirtualPaginator>) => void;
  onRangeChange?: (range: { start: number; end: number }) => void;
  shouldSuppressPagination?: () => boolean;
  deferAutomaticPagination?: (retry: () => boolean) => boolean;
  onEnd?: (back: boolean) => void;
};

function PaginatorHarness({
  count = 100,
  limit = 10,
  initialRange = { start: 10, end: 20 },
  getScrollElement,
  getItemElement,
  onApi,
  onRangeChange,
  shouldSuppressPagination,
  deferAutomaticPagination,
  onEnd,
}: PaginatorHarnessProps) {
  const [range, setRange] = React.useState(initialRange);
  const paginator = useVirtualPaginator({
    count,
    limit,
    range,
    onRangeChange: (nextRange) => {
      onRangeChange?.(nextRange);
      setRange(nextRange);
    },
    getScrollElement,
    getItemElement: (index: number) => getItemElement?.(index, range),
    shouldSuppressPagination,
    ...{ deferAutomaticPagination },
    onEnd,
  });

  React.useLayoutEffect(() => {
    onApi(paginator);
  }, [onApi, paginator]);

  return null;
}

const makeRect = (top: number, height: number) => ({
  top,
  bottom: top + height,
  height,
});

describe('useVirtualPaginator', () => {
  it.each(['disabled', 'cancelled', 'completed', 'absent', 'active'])(
    'dispatches a forward-only intersection with both sentinels visible (%s owner)',
    (state) => {
      const checks: (() => void)[] = [];
      const owner = createRoomAutomaticFill({
        readGeometry: () => 'settled',
        schedule: (check) => checks.push(check),
      });
      if (state === 'disabled') owner.cancel();
      const onEnd = vi.fn();
      const anchor = (direction: string) => ({
        getAttribute: () => direction,
        getBoundingClientRect: () => makeRect(20, 10),
      });
      const back = anchor('B');
      const forward = anchor('F');
      const root = {
        getBoundingClientRect: () => makeRect(0, 100),
        querySelector: (selector: string) => (selector.includes('"B"') ? back : forward),
      } as unknown as HTMLElement;
      let renderer: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          React.createElement(PaginatorHarness, {
            count: 2,
            initialRange: { start: 0, end: 2 },
            getScrollElement: () => root,
            onApi: () => {},
            onEnd,
            deferAutomaticPagination: state === 'absent' ? undefined : owner.defer,
          })
        );
      });
      const callback = intersectionState.callback;
      if (state === 'cancelled') owner.cancel();
      if (state === 'completed') {
        owner.defer(() => false);
        checks.shift()?.();
        checks.shift()?.();
        expect(owner.isActive()).toBe(false);
      }
      act(() => {
        callback?.([
          { target: forward, isIntersecting: true } as unknown as IntersectionObserverEntry,
        ]);
      });
      if (state === 'active') {
        expect(onEnd).not.toHaveBeenCalled();
        act(() => {
          checks.shift()?.();
          checks.shift()?.();
        });
        expect(onEnd.mock.calls).toEqual([[true]]);
      } else expect(onEnd.mock.calls).toEqual([[false]]);
      act(() => renderer.unmount());
    }
  );

  it.each([false, true])(
    'rechecks settled backfill geometry (short history: %s)',
    (shortHistory) => {
      let visible = true;
      let retry: (() => boolean) | undefined;
      let paginator: ReturnType<typeof useVirtualPaginator> | undefined;
      const onEnd = vi.fn();
      const root = {
        offsetTop: 0,
        offsetHeight: 600,
        scrollHeight: 30000,
        scrollTop: 0,
        scrollBy: () => {},
        getBoundingClientRect: () => makeRect(0, 600),
        querySelector: (selector: string) =>
          selector.includes('"B"')
            ? {
                getBoundingClientRect: () => makeRect(visible ? 250 : -30000, 50),
              }
            : null,
      } as unknown as HTMLElement;
      act(() => {
        create(
          React.createElement(PaginatorHarness, {
            count: 208,
            limit: 200,
            initialRange: { start: 200, end: 208 },
            getScrollElement: () => root,
            onEnd,
            getItemElement: () =>
              ({
                offsetTop: 0,
                clientHeight: 50,
                getBoundingClientRect: () => makeRect(0, 50),
              } as HTMLElement),
            onApi: (api) => {
              paginator = api;
            },
            deferAutomaticPagination: (next) => {
              retry = next;
              return true;
            },
          })
        );
      });
      act(() => {
        paginator?.retryPagination();
      });
      expect(paginator?.getItems()).toHaveLength(208);
      expect(onEnd).not.toHaveBeenCalled();
      visible = shortHistory;
      act(() => {
        retry?.();
      });
      expect(onEnd).toHaveBeenCalledTimes(shortHistory ? 1 : 0);
      // A deliberate retry still paginates, without waiting for automatic fill.
      visible = true;
      act(() => {
        paginator?.retryPagination();
      });
      expect(onEnd).toHaveBeenCalledTimes(shortHistory ? 2 : 1);
    }
  );

  beforeEach(() => {
    intersectionState.callback = undefined;
    vi.unstubAllGlobals();
    vi.stubGlobal('getComputedStyle', () => ({
      scrollPaddingTop: 'auto',
      scrollPaddingBottom: 'auto',
    }));
  });

  it.each([
    { name: 'start below the header', align: 'start', expectedTop: 180 },
    { name: 'center within the usable viewport', align: 'center', expectedTop: 300 },
    { name: 'end above the footer', align: 'end', expectedTop: 420 },
    { name: 'start with an additional offset', align: 'start', offset: 12, expectedTop: 192 },
    { name: 'oversized centered message', align: 'center', height: 320, expectedTop: 180 },
    { name: 'oversized end-aligned message', align: 'end', height: 300, expectedTop: 180 },
    {
      name: 'message covered by the header',
      align: 'center',
      top: 120,
      stopInView: true,
      expectedTop: 300,
    },
    {
      name: 'message covered by the footer',
      align: 'center',
      top: 450,
      stopInView: true,
      expectedTop: 300,
    },
    {
      name: 'visible message at the top edge',
      align: 'center',
      top: 180,
      stopInView: true,
      expectedTop: 180,
      expectedScroll: false,
    },
    {
      name: 'visible message at the bottom edge',
      align: 'center',
      top: 420,
      stopInView: true,
      expectedTop: 420,
      expectedScroll: false,
    },
    {
      name: 'default automatic padding',
      align: 'center',
      paddingTop: 'auto',
      paddingBottom: 'auto',
      expectedTop: 280,
    },
  ])(
    'honors scroll padding for $name',
    ({
      align,
      expectedTop,
      offset,
      height = 40,
      top = 350,
      stopInView = false,
      expectedScroll = true,
      paddingTop = '80px',
      paddingBottom = '40px',
    }) => {
      vi.stubGlobal('getComputedStyle', () => ({
        scrollPaddingTop: paddingTop,
        scrollPaddingBottom: paddingBottom,
      }));
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
      let elementTop = top;
      const scrollElement = {
        getBoundingClientRect: () => makeRect(100, 400),
        querySelector: () => null,
        scrollBy: ({ top: delta }: { top: number }) => {
          elementTop -= delta;
        },
      } as unknown as HTMLElement;
      const targetElement = {
        getBoundingClientRect: () => makeRect(elementTop, height),
      } as unknown as HTMLElement;
      let paginator: ReturnType<typeof useVirtualPaginator> | undefined;
      let renderer: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          React.createElement(PaginatorHarness, {
            getScrollElement: () => scrollElement,
            onApi: (api) => {
              paginator = api;
            },
          })
        );
      });

      act(() => {
        expect(
          paginator?.scrollToElement(targetElement, {
            align: align as 'start' | 'center' | 'end',
            offset,
            stopInView,
          })
        ).toBe(expectedScroll);
      });

      expect(elementTop).toBe(expectedTop);
      act(() => renderer.unmount());
    }
  );

  it('retries visible-anchor pagination after suppression is cleared without needing a rerender', () => {
    const suppressRef = { current: true };
    const onRangeChange = vi.fn();
    const scrollElement = {
      offsetTop: 0,
      offsetHeight: 100,
      scrollHeight: 1000,
      scrollTop: 0,
      getBoundingClientRect: () => makeRect(0, 100),
      querySelector: (selector: string) =>
        selector.includes('"F"')
          ? ({
              getBoundingClientRect: () => makeRect(90, 10),
            } as HTMLElement)
          : null,
    } as unknown as HTMLElement;
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          onApi: (api) => {
            paginator = api;
          },
          onRangeChange,
          shouldSuppressPagination: () => suppressRef.current,
        })
      );
    });

    act(() => {
      paginator?.retryPagination();
    });

    expect(onRangeChange).not.toHaveBeenCalled();

    suppressRef.current = false;

    act(() => {
      paginator?.retryPagination();
    });

    expect(onRangeChange).toHaveBeenCalledWith({
      start: 10,
      end: 30,
    });
  });

  it('uses getBoundingClientRect deltas and a RAF correction in scrollToElement', () => {
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    let elementTop = 250;
    let scrollCalls = 0;
    const scrollElement = {
      getBoundingClientRect: () => ({
        ...makeRect(100, 200),
      }),
      scrollBy: vi.fn(({ top }: { top: number }) => {
        scrollCalls += 1;
        if (scrollCalls === 1) {
          elementTop -= top - 10;
          return;
        }
        elementTop -= top;
      }),
    } as unknown as HTMLElement;
    const targetElement = {
      getBoundingClientRect: () => ({
        ...makeRect(elementTop, 20),
      }),
    } as unknown as HTMLElement;
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          onApi: (api) => {
            paginator = api;
          },
        })
      );
    });

    act(() => {
      expect(
        paginator?.scrollToElement(targetElement, {
          align: 'center',
          behavior: 'instant',
        })
      ).toBe(true);
    });

    expect(scrollElement.scrollBy).toHaveBeenNthCalledWith(1, {
      top: 60,
      behavior: 'instant',
    });
    expect(scrollElement.scrollBy).toHaveBeenNthCalledWith(2, {
      top: 10,
      behavior: 'instant',
    });
  });

  it('skips RAF correction when scrolled to the top boundary', () => {
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    // Element is near the top and can't be centered because scrollTop is 0
    const scrollElement = {
      scrollTop: 0,
      scrollHeight: 300,
      clientHeight: 200,
      getBoundingClientRect: () => ({
        ...makeRect(100, 200),
      }),
      scrollBy: vi.fn(),
    } as unknown as HTMLElement;
    const targetElement = {
      getBoundingClientRect: () => ({
        // Element is at top of container — error would be negative (wants to scroll up)
        ...makeRect(110, 20),
      }),
    } as unknown as HTMLElement;
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          onApi: (api) => {
            paginator = api;
          },
        })
      );
    });

    act(() => {
      paginator?.scrollToElement(targetElement, {
        align: 'center',
        behavior: 'instant',
      });
    });

    // First scrollBy fires with a negative delta (wants to scroll up to center)
    expect(scrollElement.scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollElement.scrollBy).toHaveBeenNthCalledWith(1, {
      top: -80,
      behavior: 'instant',
    });
    // RAF correction should NOT fire because scrollTop=0 and error<0
  });

  it('skips RAF correction when scrolled to the bottom boundary', () => {
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    // Element is near the bottom and can't be centered because scrollTop is at max
    const scrollElement = {
      scrollTop: 100,
      scrollHeight: 300,
      clientHeight: 200,
      getBoundingClientRect: () => ({
        ...makeRect(100, 200),
      }),
      scrollBy: vi.fn(),
    } as unknown as HTMLElement;
    const targetElement = {
      getBoundingClientRect: () => ({
        // Element is at bottom of container — error would be positive (wants to scroll down)
        ...makeRect(280, 20),
      }),
    } as unknown as HTMLElement;
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          onApi: (api) => {
            paginator = api;
          },
        })
      );
    });

    act(() => {
      paginator?.scrollToElement(targetElement, {
        align: 'center',
        behavior: 'instant',
      });
    });

    // First scrollBy fires with a positive delta (wants to scroll down to center)
    expect(scrollElement.scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollElement.scrollBy).toHaveBeenNthCalledWith(1, {
      top: 90,
      behavior: 'instant',
    });
    // RAF correction should NOT fire because scrollTop=max and error>0
  });

  it('preserves the requested focus anchor when retrying pagination after suppression', () => {
    const rangeRef = {
      current: {
        start: 10,
        end: 20,
      },
    };
    const onRangeChange = vi.fn((nextRange: { start: number; end: number }) => {
      rangeRef.current = nextRange;
    });
    const scrollElement = {
      offsetTop: 0,
      offsetHeight: 100,
      scrollHeight: 1000,
      scrollTop: 300,
      getBoundingClientRect: () => makeRect(0, 100),
      querySelector: (selector: string) =>
        rangeRef.current.end === 20 && selector.includes('"F"')
          ? ({
              getBoundingClientRect: () => makeRect(90, 10),
            } as HTMLElement)
          : null,
      scrollBy: vi.fn(),
    } as unknown as HTMLElement;
    const getItemElement = (index: number, range: { start: number; end: number }) => {
      if (index < range.start || index >= range.end) return undefined;

      const offsetTop = (index - range.start) * 20;
      const topBefore = index === 15 ? 200 : 260 + (index - 19) * 20;
      const topAfter = index === 15 ? 120 : 310 + (index - 19) * 20;

      return {
        offsetTop,
        clientHeight: 20,
        getBoundingClientRect: () => makeRect(range.start === 10 ? topBefore : topAfter, 20),
      } as HTMLElement;
    };
    let paginator: ReturnType<typeof useVirtualPaginator> | undefined;

    act(() => {
      create(
        React.createElement(PaginatorHarness, {
          getScrollElement: () => scrollElement,
          getItemElement,
          onApi: (api) => {
            paginator = api;
          },
          onRangeChange,
        })
      );
    });

    act(() => {
      paginator?.retryPagination({
        preserveAnchorIndex: 15,
      });
    });

    expect(onRangeChange).toHaveBeenCalledWith({
      start: 14,
      end: 30,
    });
    expect(scrollElement.scrollBy).toHaveBeenCalledWith({
      top: -80,
      behavior: 'instant',
    });
  });
});
