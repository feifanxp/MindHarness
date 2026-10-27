import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageViewerOpenAtom } from '../../state/imageViewer';
import { isIOSStandaloneWebApp, isNativeIOS } from './nativeSso';
import { useEdgeSwipeBack } from './useEdgeSwipeBack';

vi.mock('./nativeSso', () => ({
  isIOSStandaloneWebApp: vi.fn(() => false),
  isNativeIOS: vi.fn(() => false),
}));

type Listener = (event: Event) => void;

class MockEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;

    const fn =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<Listener>();
    current.add(fn);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
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

type MockWindow = MockEventTarget;

const createTouchList = (touches: Array<{ clientX: number; clientY: number }>) =>
  touches as unknown as TouchList;

function HookHarness({
  onBack,
  options,
}: {
  onBack: () => void;
  options?: { blockStandaloneWebApp?: boolean };
}) {
  useEdgeSwipeBack(onBack, true, options);
  return null;
}

describe('useEdgeSwipeBack', () => {
  const originalWindow = globalThis.window;

  let mockWindow: MockWindow;
  let renderer: ReactTestRenderer | undefined;

  const swipeFromLeftEdge = (preventDefault = vi.fn()) => {
    act(() => {
      mockWindow.dispatch('touchstart', {
        touches: createTouchList([{ clientX: 12, clientY: 20 }]),
      } as unknown as TouchEvent);
      mockWindow.dispatch('touchmove', {
        preventDefault,
        touches: createTouchList([{ clientX: 96, clientY: 24 }]),
      } as unknown as TouchEvent);
    });

    return preventDefault;
  };

  beforeEach(() => {
    mockWindow = new MockEventTarget();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: mockWindow,
    });
    vi.mocked(isIOSStandaloneWebApp).mockReturnValue(false);
    vi.mocked(isNativeIOS).mockReturnValue(false);
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

    vi.restoreAllMocks();
  });

  it('does not call onBack while the image viewer atom is true', () => {
    const onBack = vi.fn();
    const store = createStore();
    store.set(imageViewerOpenAtom, true);

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(HookHarness, {
            onBack,
          })
        )
      );
    });

    const preventDefault = swipeFromLeftEdge();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('keeps edge-swipe back enabled for standalone iOS web apps by default', () => {
    vi.mocked(isIOSStandaloneWebApp).mockReturnValue(true);

    const onBack = vi.fn();
    const store = createStore();

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(HookHarness, {
            onBack,
          })
        )
      );
    });

    const preventDefault = swipeFromLeftEdge();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('keeps edge-swipe back enabled for native iOS wrappers', () => {
    vi.mocked(isNativeIOS).mockReturnValue(true);

    const onBack = vi.fn();
    const store = createStore();

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(HookHarness, {
            onBack,
          })
        )
      );
    });

    const preventDefault = swipeFromLeftEdge();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('does not call onBack for standalone iOS web apps when standalone blocking is enabled', () => {
    vi.mocked(isIOSStandaloneWebApp).mockReturnValue(true);

    const onBack = vi.fn();
    const store = createStore();

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(HookHarness, {
            onBack,
            options: { blockStandaloneWebApp: true },
          })
        )
      );
    });

    const preventDefault = swipeFromLeftEdge();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('preserves edge-swipe back in regular iOS Safari tabs', () => {
    const onBack = vi.fn();
    const store = createStore();

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(HookHarness, {
            onBack,
          })
        )
      );
    });

    const preventDefault = swipeFromLeftEdge();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
