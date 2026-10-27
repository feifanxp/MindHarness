import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePinchToZoom } from './usePinchToZoom';

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
  cancelAnimationFrame: ReturnType<typeof vi.fn>;
  requestAnimationFrame: ReturnType<typeof vi.fn>;
};

type MockDocument = MockEventTarget & {
  querySelector: ReturnType<typeof vi.fn>;
};

function HookHarness({
  pageZoom,
  setPageZoom,
}: {
  pageZoom: number;
  setPageZoom: (zoom: number) => void;
}) {
  usePinchToZoom(pageZoom, setPageZoom);
  return null;
}

const createTouchList = (touches: Array<{ clientX: number; clientY: number }>) =>
  touches as unknown as TouchList;

describe('usePinchToZoom', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  let renderer: ReactTestRenderer | undefined;
  let mockWindow: MockWindow;
  let mockDocument: MockDocument;
  let animationFrameId = 0;
  let queuedFrame: FrameRequestCallback | undefined;
  let imageViewerOpen = false;

  beforeEach(() => {
    const eventTarget = new MockEventTarget();
    mockWindow = Object.assign(eventTarget, {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        animationFrameId += 1;
        queuedFrame = callback;
        return animationFrameId;
      }),
      cancelAnimationFrame: vi.fn((id: number) => {
        if (id === animationFrameId) {
          queuedFrame = undefined;
        }
      }),
    });

    mockDocument = Object.assign(new MockEventTarget(), {
      querySelector: vi.fn((selector: string) =>
        selector === '[data-image-viewer="true"]' && imageViewerOpen
          ? ({} as Element)
          : null
      ),
    });

    imageViewerOpen = false;
    queuedFrame = undefined;

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: mockWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: mockDocument,
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;

    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }

    if (originalDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    }

    vi.restoreAllMocks();
  });

  it('updates page zoom for ctrl-wheel pinch when no image viewer is open', () => {
    const setPageZoom = vi.fn();

    act(() => {
      renderer = create(React.createElement(HookHarness, { pageZoom: 100, setPageZoom }));
    });

    const preventDefault = vi.fn();

    act(() => {
      mockWindow.dispatch(
        'wheel',
        {
          cancelable: true,
          ctrlKey: true,
          deltaY: -50,
          preventDefault,
        } as unknown as WheelEvent
      );
      queuedFrame?.(0);
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(setPageZoom).toHaveBeenCalledWith(101);
  });

  it('does not intercept touch pinch gestures while the image viewer overlay is open', () => {
    const setPageZoom = vi.fn();

    act(() => {
      renderer = create(React.createElement(HookHarness, { pageZoom: 100, setPageZoom }));
    });

    imageViewerOpen = true;
    const preventDefault = vi.fn();

    act(() => {
      mockWindow.dispatch(
        'touchstart',
        {
          touches: createTouchList([
            { clientX: 0, clientY: 0 },
            { clientX: 0, clientY: 100 },
          ]),
        } as unknown as TouchEvent
      );
      mockWindow.dispatch(
        'touchmove',
        {
          cancelable: true,
          preventDefault,
          touches: createTouchList([
            { clientX: 0, clientY: 0 },
            { clientX: 0, clientY: 150 },
          ]),
        } as unknown as TouchEvent
      );
      queuedFrame?.(0);
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(setPageZoom).not.toHaveBeenCalled();
  });
});
