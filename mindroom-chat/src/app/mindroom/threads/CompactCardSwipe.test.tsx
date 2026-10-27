import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactCardSwipe } from './CompactCardSwipe';

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return { ...actual, Icon: () => null, Text: 'span' };
});

vi.mock('./CompactCardSwipe.css', () => ({
  SwipeAction: 'SwipeAction',
  SwipeTrack: 'SwipeTrack',
  SwipeTrackEnabled: 'SwipeTrackEnabled',
  SwipeTrackSettling: 'SwipeTrackSettling',
}));

const CARD_WIDTH = 300;
const VIEWPORT_WIDTH = 400;

type FakeTrack = {
  style: { transform: string };
  getBoundingClientRect: () => { width: number };
  setPointerCapture: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: () => void;
  touchMoveListener?: (event: unknown) => void;
};

let track: FakeTrack;
let direction: 'ltr' | 'rtl';
let renderers: ReactTestRenderer[];

beforeEach(() => {
  track = {
    style: { transform: '' },
    getBoundingClientRect: () => ({ width: CARD_WIDTH }),
    setPointerCapture: vi.fn(),
    addEventListener: (type, listener) => {
      if (type === 'touchmove') track.touchMoveListener = listener;
    },
    removeEventListener: () => undefined,
  };
  direction = 'ltr';
  renderers = [];
  vi.stubGlobal('window', { innerWidth: VIEWPORT_WIDTH });
  vi.stubGlobal('getComputedStyle', () => ({ direction }));
});

afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Props = React.ComponentProps<typeof CompactCardSwipe>;

const render = (props: Partial<Props> = {}) => {
  const onSwipe = vi.fn();
  const element = (next: Partial<Props>) => (
    <CompactCardSwipe enabled resolved={false} label="Resolve" onSwipe={onSwipe} {...next}>
      <button type="button">card</button>
    </CompactCardSwipe>
  );
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element(props), { createNodeMock: () => track });
  });
  renderers.push(renderer);
  const rerender = (next: Partial<Props>) => act(() => renderer.update(element(next)));
  const trackElement = () => renderer.root.findByProps({ 'data-compact-card-swipe': 'track' });
  const pointer = (
    type:
      | 'onPointerDown'
      | 'onPointerMove'
      | 'onPointerUp'
      | 'onPointerCancel'
      | 'onLostPointerCapture',
    clientX: number,
    clientY = 100,
    overrides: Record<string, unknown> = {}
  ) => {
    act(() => {
      trackElement().props[type]({
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX,
        clientY,
        target: track,
        currentTarget: track,
        ...overrides,
      });
    });
  };
  // Starts the swipe 10px along (where it locks sideways), then moves to `toX`.
  const swipe = (fromX: number, toX: number, overrides: Record<string, unknown> = {}) => {
    pointer('onPointerDown', fromX, 100, overrides);
    pointer('onPointerMove', fromX + Math.sign(toX - fromX) * 10, 100, overrides);
    pointer('onPointerMove', toX, 100, overrides);
    pointer('onPointerUp', toX, 100, overrides);
  };
  const actionStrip = () => renderer.root.findAllByProps({ 'data-compact-card-swipe': 'action' });
  const transitionEnd = (target: unknown = track) =>
    act(() => {
      trackElement().props.onTransitionEnd({
        target,
        currentTarget: track,
        propertyName: 'transform',
      });
    });
  return { onSwipe, rerender, pointer, swipe, trackElement, actionStrip, transitionEnd };
};

describe('CompactCardSwipe', () => {
  it('fires the swipe action when a touch swipe toward the start passes the threshold', () => {
    const { onSwipe, swipe } = render();

    swipe(300, 150);

    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(onSwipe).toHaveBeenCalledWith(false);
    expect(track.style.transform).toBe('');
  });

  it('snaps back without the action when the swipe stops short of the threshold', () => {
    const { onSwipe, swipe, trackElement } = render();

    swipe(300, 240);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
    expect(trackElement().props.className).toContain('SwipeTrackSettling');
  });

  it('moves the card from where the swipe locks and arms the strip past the threshold', () => {
    const { pointer, actionStrip } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    expect(track.style.transform).toBe('translateX(0px)');
    pointer('onPointerMove', 250);
    expect(track.style.transform).toBe('translateX(-40px)');
    expect(actionStrip()).toHaveLength(1);
    expect(actionStrip()[0].props['data-armed']).toBeUndefined();

    pointer('onPointerMove', 170);
    expect(track.style.transform).toBe('translateX(-120px)');
    expect(actionStrip()[0].props['data-armed']).toBe('true');
  });

  it('hides the strip once the card itself has settled back', () => {
    const { swipe, trackElement, actionStrip, transitionEnd } = render();

    swipe(300, 240);
    transitionEnd({ nodeName: 'BUTTON' });
    expect(actionStrip()).toHaveLength(1);

    transitionEnd();

    expect(actionStrip()).toHaveLength(0);
    expect(trackElement().props.className).not.toContain('SwipeTrackSettling');
  });

  it('hides the strip when the settle transition never ends', () => {
    vi.useFakeTimers();
    const { swipe, actionStrip } = render();

    swipe(300, 240);
    expect(actionStrip()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(actionStrip()).toHaveLength(0);
  });

  it('keeps naming the action it ran while the card settles', () => {
    const { swipe, rerender, actionStrip } = render();

    swipe(300, 150);
    rerender({ resolved: true, label: 'Reopen thread' });

    expect(actionStrip()[0].props['data-armed']).toBe('true');
    expect(actionStrip()[0].props['data-resolved']).toBeUndefined();
    expect(actionStrip()[0].findByType('span').props.children).toBe('Resolve');
  });

  it('runs the action the strip showed when the thread toggles mid-swipe', () => {
    const { onSwipe, pointer, rerender } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    rerender({ resolved: true, label: 'Reopen thread' });
    pointer('onPointerMove', 150);
    pointer('onPointerUp', 150);

    expect(onSwipe).toHaveBeenCalledWith(false);
  });

  it('leaves a vertical drag to the scroller', () => {
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300, 100);
    pointer('onPointerMove', 296, 130);
    pointer('onPointerMove', 150, 140);
    pointer('onPointerUp', 150, 140);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
    expect(track.setPointerCapture).not.toHaveBeenCalled();
  });

  it('keeps the scroller out of a touch only once it is a sideways swipe', () => {
    const { pointer } = render();
    const touchMove = (cancelable = true) => {
      const event = { cancelable, preventDefault: vi.fn() };
      track.touchMoveListener!(event);
      return event.preventDefault;
    };

    pointer('onPointerDown', 300);
    expect(touchMove()).not.toHaveBeenCalled();
    pointer('onPointerMove', 280);
    expect(touchMove()).toHaveBeenCalled();
    // A scroll already under way cannot be cancelled; trying only logs a warning.
    expect(touchMove(false)).not.toHaveBeenCalled();
    pointer('onPointerUp', 280);
    expect(touchMove()).not.toHaveBeenCalled();
  });

  it('ignores a swipe toward the end', () => {
    const { onSwipe, swipe } = render();

    swipe(100, 290);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('leaves touches that start at a screen edge to the edge swipes', () => {
    const { onSwipe, swipe } = render();

    swipe(VIEWPORT_WIDTH - 10, 150);
    direction = 'rtl';
    swipe(10, 250);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.setPointerCapture).not.toHaveBeenCalled();
  });

  it('ignores mouse drags, which have the hover actions', () => {
    const { onSwipe, swipe } = render();

    swipe(300, 150, { pointerType: 'mouse' });

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('follows only the first finger', () => {
    const { onSwipe, pointer, swipe } = render();

    swipe(300, 150, { isPrimary: false });
    expect(onSwipe).not.toHaveBeenCalled();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 100, 100, { pointerId: 2 });
    pointer('onPointerUp', 100, 100, { pointerId: 2 });
    expect(track.style.transform).toBe('translateX(0px)');
    pointer('onPointerMove', 150);
    pointer('onPointerUp', 150);
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('ignores swipes while disabled', () => {
    const { onSwipe, pointer, trackElement, actionStrip } = render({ enabled: false });

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 150);
    expect(track.style.transform).toBe('');
    expect(actionStrip()).toHaveLength(0);
    pointer('onPointerUp', 150);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(trackElement().props.className).not.toContain('SwipeTrackEnabled');
  });

  it('drops the action when the card is disabled mid-swipe', () => {
    const { onSwipe, pointer, rerender, actionStrip } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    rerender({ enabled: false });
    pointer('onPointerUp', 150);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
    expect(actionStrip()[0].props['data-armed']).toBeUndefined();
  });

  it('snaps back without the action when the browser cancels the touch', () => {
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    pointer('onPointerCancel', 150);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('snaps back when the card loses the touch, but not when the card button does', () => {
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onLostPointerCapture', 290, 100, { target: { nodeName: 'BUTTON' } });
    pointer('onPointerMove', 250);
    expect(track.style.transform).toBe('translateX(-40px)');

    pointer('onLostPointerCapture', 250);
    expect(track.style.transform).toBe('');
    pointer('onPointerMove', 100);
    pointer('onPointerUp', 100);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('swallows the click that ends a swipe but not a keyboard click or a later tap', () => {
    const { swipe, pointer, trackElement } = render();
    const click = (detail = 1) => {
      const event = { detail, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      act(() => trackElement().props.onClickCapture(event));
      return event.stopPropagation;
    };

    swipe(300, 240);
    expect(click(0)).not.toHaveBeenCalled();
    expect(click()).toHaveBeenCalled();
    expect(click()).not.toHaveBeenCalled();

    swipe(300, 240);
    pointer('onPointerDown', 300);
    pointer('onPointerUp', 300);
    expect(click()).not.toHaveBeenCalled();
  });

  it('swipes toward the inline start in right-to-left layouts', () => {
    direction = 'rtl';
    const { onSwipe, swipe } = render();

    swipe(300, 150);
    expect(onSwipe).not.toHaveBeenCalled();

    swipe(100, 250);
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(track.style.transform).toBe('');
  });

  it('labels the strip for the action the swipe takes', () => {
    const { pointer, actionStrip } = render({ resolved: true, label: 'Reopen thread' });

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 260);

    expect(actionStrip()[0].props['data-resolved']).toBe('true');
    expect(actionStrip()[0].findByType('span').props.children).toBe('Reopen thread');
    expect(actionStrip()[0].props['aria-hidden']).toBe(true);
  });
});
