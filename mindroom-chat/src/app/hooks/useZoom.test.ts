import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useZoom } from './useZoom';

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

function HookHarness({
  onUpdate,
}: {
  onUpdate: (state: ReturnType<typeof useZoom>) => void;
}) {
  onUpdate(useZoom(0.2));
  return null;
}

const createTouchList = (touches: Array<{ clientX: number; clientY: number }>) =>
  touches as unknown as TouchList;

describe('useZoom', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    vi.restoreAllMocks();
  });

  it('updates zoom from touch pinch gestures on the attached surface', () => {
    const zoomSurface = new MockEventTarget();
    let zoomState!: ReturnType<typeof useZoom>;

    act(() => {
      renderer = create(
        React.createElement(HookHarness, {
          onUpdate: (state) => {
            zoomState = state;
          },
        })
      );
    });

    act(() => {
      zoomState.zoomTargetRef(zoomSurface as unknown as HTMLElement);
    });

    const preventDefault = vi.fn();

    act(() => {
      zoomSurface.dispatch(
        'touchstart',
        {
          touches: createTouchList([
            { clientX: 0, clientY: 0 },
            { clientX: 0, clientY: 100 },
          ]),
        } as unknown as TouchEvent
      );
      zoomSurface.dispatch(
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
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(zoomState.isZooming).toBe(true);
    expect(zoomState.zoom).toBeCloseTo(1.5);

    act(() => {
      zoomSurface.dispatch(
        'touchend',
        {
          touches: createTouchList([{ clientX: 0, clientY: 0 }]),
        } as unknown as TouchEvent
      );
    });

    expect(zoomState.isZooming).toBe(false);
  });

  it('clamps touch pinch zoom to the configured maximum', () => {
    const zoomSurface = new MockEventTarget();
    let zoomState!: ReturnType<typeof useZoom>;

    act(() => {
      renderer = create(
        React.createElement(HookHarness, {
          onUpdate: (state) => {
            zoomState = state;
          },
        })
      );
    });

    act(() => {
      zoomState.zoomTargetRef(zoomSurface as unknown as HTMLElement);
    });

    act(() => {
      zoomSurface.dispatch(
        'touchstart',
        {
          touches: createTouchList([
            { clientX: 0, clientY: 0 },
            { clientX: 0, clientY: 100 },
          ]),
        } as unknown as TouchEvent
      );
      zoomSurface.dispatch(
        'touchmove',
        {
          cancelable: true,
          preventDefault: vi.fn(),
          touches: createTouchList([
            { clientX: 0, clientY: 0 },
            { clientX: 0, clientY: 600 },
          ]),
        } as unknown as TouchEvent
      );
    });

    expect(zoomState.zoom).toBe(5);
  });
});
