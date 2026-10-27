import React, { createRef, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  useRoomFocusScrollController,
  type RoomFocusScrollControllerOptions,
} from './roomFocusScrollController';
import { useThreadBackPaginationController } from './threadBackPaginationController';

type Listener = () => void;

const makeScrollElement = (): HTMLDivElement & {
  dispatchScroll: () => void;
  dispatch: (type: string) => void;
  listeners: Map<string, Set<Listener>>;
  scrollTo: ReturnType<typeof vi.fn>;
} => {
  const listeners = new Map<string, Set<Listener>>();
  const scrollEl = {
    addEventListener: (type: string, listener: Listener) => {
      const nextListeners = listeners.get(type) ?? new Set<Listener>();
      nextListeners.add(listener);
      listeners.set(type, nextListeners);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    },
    dispatchScroll: () => {
      listeners.get('scroll')?.forEach((listener) => listener());
    },
    dispatch: (type: string) => {
      listeners.get(type)?.forEach((listener) => listener());
    },
    getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    querySelectorAll: () => [],
    scrollHeight: 1000,
    clientHeight: 400,
    scrollTop: 0,
    offsetHeight: 400,
    scrollTo: vi.fn(),
  } as unknown as HTMLDivElement & {
    dispatchScroll: () => void;
    dispatch: (type: string) => void;
    listeners: Map<string, Set<Listener>>;
    scrollTo: ReturnType<typeof vi.fn>;
  };
  scrollEl.listeners = listeners;
  return scrollEl;
};

type HarnessProps = Partial<RoomFocusScrollControllerOptions> & {
  onSuppressRef: (ref: React.MutableRefObject<boolean>) => void;
  scrollEl: HTMLDivElement;
};

function Harness({ onSuppressRef, scrollEl, ...overrides }: HarnessProps) {
  const suppressThreadOpenBottomPinRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(scrollEl);
  const defaultScrollToBottomRef = useRef({ count: 0, smooth: false });
  const scrollToBottomRef = overrides.scrollToBottomRef ?? defaultScrollToBottomRef;
  const threadBackViewport = useThreadBackPaginationController();
  scrollRef.current = scrollEl;
  onSuppressRef(suppressThreadOpenBottomPinRef);

  useRoomFocusScrollController({
    alive: () => true,
    atBottomAnchorRef: createRef(),
    focusScrollResetToken: 'test',
    threadTargets: { getPending: () => undefined } as never,
    pendingThreadOpenTick: 0,
    restorePendingThreadBackPaginationAnchor: vi.fn(() => false),
    retryPagination: vi.fn(),
    roomId: '!room:test',
    scrollRef,
    scrollToBottomRef,
    scrollToElement: vi.fn(),
    scrollToItem: vi.fn(),
    setAtBottom: vi.fn(),
    setFocusItem: vi.fn(),
    suppressFocusPaginationRef: { current: false },
    isThreadOpenBottomPinSuppressed: () => suppressThreadOpenBottomPinRef.current,
    requestThreadOpenBottomPin: () => threadBackViewport.requestOpenBottomPin(scrollToBottomRef),
    cancelThreadOpenBottomPin: () => {
      threadBackViewport.cancelOpenBottomPin(scrollToBottomRef.current.count);
      suppressThreadOpenBottomPinRef.current = true;
    },
    shouldApplyThreadBottomPin: threadBackViewport.shouldApplyBottomPin,
    threadEventIndexMapRef: { current: new Map() },
    threadEventsLength: 0,
    threadFilteredEvents: [],
    threadFilteredEventsRef: { current: [] },
    threadId: '$thread',
    threadInitialRenderMode: 'live',
    threadLatestOpenPending: true,
    threadTimelineTick: 0,
    timelineAtLiveEnd: true,
    ...overrides,
  });

  return null;
}

describe('useRoomFocusScrollController', () => {
  it('cancels a pending thread-open bottom pin when the user scrolls before events render', () => {
    const scrollEl = makeScrollElement();
    const scrollToBottomRef = { current: { count: 0, smooth: false } };
    let renderer: ReactTestRenderer;
    let suppressRef: React.MutableRefObject<boolean> | undefined;

    act(() => {
      renderer = create(
        React.createElement(Harness, {
          scrollEl,
          scrollToBottomRef,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    scrollEl.scrollTo.mockClear();
    act(() => {
      scrollEl.dispatch('wheel');
      scrollEl.dispatchScroll();
    });

    expect(suppressRef?.current).toBe(true);

    act(() => {
      renderer.update(
        React.createElement(Harness, {
          scrollEl,
          scrollToBottomRef,
          threadEventsLength: 20,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    expect(scrollEl.scrollTo).not.toHaveBeenCalled();
  });

  it('cancels a queued opening pin after several counts and the pending flag clear', () => {
    const scrollEl = makeScrollElement();
    const scrollToBottomRef = { current: { count: 0, smooth: false } };
    let renderer: ReactTestRenderer;
    let suppressRef: React.MutableRefObject<boolean> | undefined;

    act(() => {
      renderer = create(
        React.createElement(Harness, {
          scrollEl,
          scrollToBottomRef,
          threadEventsLength: 20,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    act(() => {
      renderer.update(
        React.createElement(Harness, {
          scrollEl,
          scrollToBottomRef,
          threadEventsLength: 21,
          threadLatestOpenPending: false,
          threadOpenedAtLatest: true,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    act(() => {
      renderer.update(
        React.createElement(Harness, {
          scrollEl,
          scrollToBottomRef,
          threadEventsLength: 22,
          threadLatestOpenPending: false,
          threadOpenedAtLatest: true,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    scrollEl.scrollTo.mockClear();
    act(() => {
      scrollEl.dispatch('wheel');
      renderer.update(
        React.createElement(Harness, {
          scrollEl,
          scrollToBottomRef,
          threadEventsLength: 23,
          threadLatestOpenPending: false,
          threadOpenedAtLatest: true,
          threadUserScrolled: true,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    expect(scrollToBottomRef.current.count).toBe(3);
    expect(scrollEl.scrollTo).not.toHaveBeenCalled();

    act(() => {
      scrollEl.dispatchScroll();
    });

    expect(suppressRef?.current).toBe(true);
  });

  it.each([
    ['user-requested jump-to-latest', false],
    ['live-send', true],
  ])('preserves a newer %s bottom pin when cancelling the opening pin', (_label, smooth) => {
    const scrollEl = makeScrollElement();
    const scrollToBottomRef = { current: { count: 0, smooth: false } };
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        React.createElement(Harness, {
          scrollEl,
          scrollToBottomRef,
          threadEventsLength: 20,
          onSuppressRef: () => undefined,
        })
      );
    });

    scrollEl.scrollTo.mockClear();
    scrollToBottomRef.current.count += 1;
    scrollToBottomRef.current.smooth = smooth;

    act(() => {
      scrollEl.dispatch('wheel');
      renderer.update(
        React.createElement(Harness, {
          scrollEl,
          scrollToBottomRef,
          threadEventsLength: 21,
          threadUserScrolled: true,
          onSuppressRef: () => undefined,
        })
      );
    });

    act(() => {
      scrollEl.dispatchScroll();
    });

    expect(scrollToBottomRef.current.count).toBe(2);
    expect(scrollEl.scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: smooth ? 'smooth' : 'instant',
    });
  });

  it('does not cancel the open bottom pin on programmatic scrolls without user intent', () => {
    // Virtualized timelines adjust the scroll offset programmatically when
    // rows above the viewport re-measure; those scroll events must not be
    // mistaken for the user scrolling away during a pending open.
    const scrollEl = makeScrollElement();
    let suppressRef: React.MutableRefObject<boolean> | undefined;

    act(() => {
      create(
        React.createElement(Harness, {
          scrollEl,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    act(() => {
      scrollEl.dispatchScroll();
      scrollEl.dispatchScroll();
    });

    expect(suppressRef?.current).toBe(false);
  });

  it('falls back to virtualizer index scrolling when a pending thread-open target row is unmounted', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    try {
      const scrollEl = makeScrollElement();
      const pendingThreadOpenRef = {
        current: {
          threadId: '$thread',
          eventId: '$target',
          highlight: false,
          attempts: 2,
        },
      };
      const scrollThreadEventIntoView = vi.fn(() => true);
      const setPendingThreadOpenTick = vi.fn();
      const advanceAttempt = vi.fn();

      act(() => {
        create(
          React.createElement(Harness, {
            scrollEl,
            onSuppressRef: () => undefined,
            threadTargets: {
              getPending: () => ({ ...pendingThreadOpenRef.current, requestId: 1 }),
              advanceAttempt,
              wakeRetry: setPendingThreadOpenTick,
            } as never,
            scrollThreadEventIntoView,
            threadEventIndexMapRef: { current: new Map([['$target', 42]]) },
            threadLatestOpenPending: false,
          })
        );
      });

      expect(scrollThreadEventIntoView).toHaveBeenCalledWith('$target');
      expect(advanceAttempt).toHaveBeenCalledWith(1);

      expect(setPendingThreadOpenTick).toHaveBeenCalledWith(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives up a pending thread open after three attempts without invoking the fallback', () => {
    const scrollEl = makeScrollElement();
    const onScroll = vi.fn();
    const pendingThreadOpenRef = {
      current: {
        threadId: '$thread',
        eventId: '$target',
        highlight: false,
        attempts: 3,
        onScroll,
      } as
        | {
            threadId: string;
            eventId: string;
            highlight: boolean;
            attempts: number;
            onScroll?: (success: boolean) => void;
          }
        | undefined,
    };
    const scrollThreadEventIntoView = vi.fn(() => true);

    act(() => {
      create(
        React.createElement(Harness, {
          scrollEl,
          onSuppressRef: () => undefined,
          threadTargets: {
            getPending: () => ({ ...pendingThreadOpenRef.current, requestId: 1 }),
            complete: onScroll,
          } as never,
          scrollThreadEventIntoView,
          threadLatestOpenPending: false,
        })
      );
    });

    expect(scrollThreadEventIntoView).not.toHaveBeenCalled();
    expect(onScroll).toHaveBeenCalledWith(1, false);
  });
});
