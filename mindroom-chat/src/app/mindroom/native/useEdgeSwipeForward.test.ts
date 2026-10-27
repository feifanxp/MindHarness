import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageViewerOpenAtom } from '../../state/imageViewer';
import { useEdgeSwipeForward } from './useEdgeSwipeForward';

const portal = vi.hoisted(() => {
  const container: { children: unknown[] } = { children: [] };
  // portalOverlay looks the container up once, when it is imported.
  vi.stubGlobal('document', { getElementById: () => container });
  return container;
});

type Listener = (event: Event) => void;

class MockEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: AddEventListenerOptions | boolean
  ) {
    if (!listener) return;

    const fn =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<Listener>();
    current.add(fn);
    this.listeners.set(type, current);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: EventListenerOptions | boolean
  ) {
    if (!listener) return;

    const current = this.listeners.get(type);
    if (!current) return;

    for (const candidate of current) {
      if (candidate === listener) {
        current.delete(candidate);
      }
    }
  }

  dispatch(type: string, event: Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

type MockWindow = MockEventTarget & {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  innerWidth: number;
};

const createTouchList = (touches: Array<{ clientX: number; clientY: number }>) =>
  touches as unknown as TouchList;

function HookHarness({ enabled, onForward }: { enabled?: boolean; onForward: () => void }) {
  useEdgeSwipeForward(onForward, enabled);
  return null;
}

describe('useEdgeSwipeForward', () => {
  const originalWindow = globalThis.window;

  let renderer: ReactTestRenderer | undefined;
  let mockWindow: MockWindow;

  const renderHook = (onForward: () => void, enabled?: boolean, imageViewerOpen = false) => {
    const store = createStore();
    store.set(imageViewerOpenAtom, imageViewerOpen);

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(HookHarness, { enabled, onForward })
        )
      );
    });
  };

  const swipeFromRightEdge = (
    preventDefault = vi.fn(),
    start = { clientX: 395, clientY: 100 },
    move = { clientX: 315, clientY: 104 }
  ) => {
    act(() => {
      mockWindow.dispatch('touchstart', {
        touches: createTouchList([start]),
      } as unknown as TouchEvent);
      mockWindow.dispatch('touchmove', {
        preventDefault,
        touches: createTouchList([move]),
      } as unknown as TouchEvent);
    });

    return preventDefault;
  };

  beforeEach(() => {
    const eventTarget = new MockEventTarget();
    mockWindow = Object.assign(eventTarget, {
      addEventListener: vi.fn(eventTarget.addEventListener.bind(eventTarget)),
      removeEventListener: vi.fn(eventTarget.removeEventListener.bind(eventTarget)),
      innerWidth: 400,
    });

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: mockWindow,
    });
    portal.children = [];
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fires on a right-edge leftward swipe past the threshold', () => {
    const onForward = vi.fn();
    renderHook(onForward);

    const preventDefault = swipeFromRightEdge();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onForward).toHaveBeenCalledOnce();
  });

  it('ignores gestures that do not start at the right edge', () => {
    const onForward = vi.fn();
    renderHook(onForward);

    swipeFromRightEdge(vi.fn(), { clientX: 200, clientY: 100 }, { clientX: 100, clientY: 100 });

    expect(onForward).not.toHaveBeenCalled();
  });

  it('ignores swipes in the wrong direction', () => {
    const onForward = vi.fn();
    renderHook(onForward);

    swipeFromRightEdge(vi.fn(), { clientX: 395, clientY: 100 }, { clientX: 405, clientY: 100 });

    expect(onForward).not.toHaveBeenCalled();
  });

  it('cancels when vertical drift dominates', () => {
    const onForward = vi.fn();
    renderHook(onForward);

    swipeFromRightEdge(vi.fn(), { clientX: 395, clientY: 100 }, { clientX: 345, clientY: 190 });

    expect(onForward).not.toHaveBeenCalled();
  });

  it('does not attach listeners when disabled', () => {
    const onForward = vi.fn();
    renderHook(onForward, false);

    expect(mockWindow.addEventListener).not.toHaveBeenCalled();

    swipeFromRightEdge();

    expect(onForward).not.toHaveBeenCalled();
  });

  it('does not call onForward while the image viewer atom is true', () => {
    const onForward = vi.fn();
    renderHook(onForward, true, true);

    const preventDefault = swipeFromRightEdge();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onForward).not.toHaveBeenCalled();
  });

  it('does not navigate behind an open portal overlay', () => {
    const onForward = vi.fn();
    portal.children = [{ getAttribute: () => null }];
    renderHook(onForward);

    const preventDefault = swipeFromRightEdge();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onForward).not.toHaveBeenCalled();
  });

  it('ignores events already handled cooperatively', () => {
    const onForward = vi.fn();
    renderHook(onForward);

    act(() => {
      mockWindow.dispatch('touchstart', {
        __mindroomEdgeSwipeHandled: true,
        touches: createTouchList([{ clientX: 395, clientY: 100 }]),
      } as unknown as TouchEvent);
      mockWindow.dispatch('touchmove', {
        preventDefault: vi.fn(),
        touches: createTouchList([{ clientX: 315, clientY: 100 }]),
      } as unknown as TouchEvent);
    });

    expect(onForward).not.toHaveBeenCalled();
  });
});
