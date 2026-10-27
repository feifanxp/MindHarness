import React, { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import { EDGE_START_MAX_X } from '../native/useEdgeSwipe';
import * as css from './CompactCardSwipe.css';

// How far a touch moves before it counts as a swipe or a scroll.
const AXIS_LOCK_DISTANCE = 10;
// Longer than the settle transition. `transitionend` never comes when the
// transition is cancelled, as when a live re-sort moves the row mid-settle.
const SETTLE_FALLBACK_MS = 500;

export const getSwipeThreshold = (cardWidth: number): number =>
  Math.min(160, Math.max(72, cardWidth * 0.35));

type Swipe = {
  // Where the touch was when it locked sideways, so the card does not jump.
  originX: number;
  // The state the strip shows; letting go acts on it even if the thread
  // toggled elsewhere mid-swipe.
  resolved: boolean;
  // 1 when the inline start is on the left, -1 in right-to-left layouts.
  towardStart: 1 | -1;
  width: number;
  threshold: number;
  offset: number;
  armed: boolean;
};

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  swipe?: Swipe;
};

type Strip = { resolved: boolean; label: string };

export type CompactCardSwipeProps = {
  enabled: boolean;
  resolved: boolean;
  label: string;
  /** Receives whether the thread was resolved when the swipe started. */
  onSwipe: (wasResolved: boolean) => void;
  children: ReactNode;
};

/**
 * Lets a touch swipe a compact card toward the inline start to run its
 * resolve (or reopen) action, revealing the action under the card. Mouse and
 * keyboard users keep the hover buttons and the actions menu.
 */
export function CompactCardSwipe({
  enabled,
  resolved,
  label,
  onSwipe,
  children,
}: CompactCardSwipeProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture>();
  const swipedRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  // Taken when the swipe starts, so the strip keeps naming the action it ran
  // while the card settles over a thread that has already toggled.
  const [strip, setStrip] = useState<Strip>();
  const [settling, setSettling] = useState(false);
  const [armed, setArmed] = useState(false);

  const settle = useCallback(() => {
    clearTimeout(settleTimerRef.current);
    setStrip(undefined);
    setSettling(false);
    setArmed(false);
  }, []);

  useEffect(() => () => clearTimeout(settleTimerRef.current), []);

  // `touch-action: pan-y` alone may let iOS start a vertical pan once a
  // sideways swipe drifts; keep the scroller out of a touch the swipe owns.
  // React registers touchmove passively, so this listener is native.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const handleTouchMove = (event: TouchEvent) => {
      if (gestureRef.current?.swipe && event.cancelable) event.preventDefault();
    };
    track.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => track.removeEventListener('touchmove', handleTouchMove);
  }, []);

  const finish = (commit: boolean) => {
    const swipe = gestureRef.current?.swipe;
    gestureRef.current = undefined;
    if (!swipe) return;
    swipedRef.current = true;
    if (trackRef.current) trackRef.current.style.transform = '';
    if (commit && swipe.armed && enabled) onSwipe(swipe.resolved);
    else setArmed(false);
    // A card already at rest has no transition to wait for.
    if (swipe.offset === 0) {
      settle();
      return;
    }
    setSettling(true);
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(settle, SETTLE_FALLBACK_MS);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    swipedRef.current = false;
    if (!enabled || event.pointerType !== 'touch' || !event.isPrimary) return;
    // Edge swipes navigate back and forward; leave those touches to them.
    if (
      event.clientX <= EDGE_START_MAX_X ||
      event.clientX >= window.innerWidth - EDGE_START_MAX_X
    ) {
      return;
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!gesture.swipe) {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.abs(dx) < AXIS_LOCK_DISTANCE && Math.abs(dy) < AXIS_LOCK_DISTANCE) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        gestureRef.current = undefined;
        return;
      }
      const track = event.currentTarget;
      const { width } = track.getBoundingClientRect();
      gesture.swipe = {
        originX: event.clientX,
        resolved,
        towardStart: getComputedStyle(track).direction === 'rtl' ? -1 : 1,
        width,
        threshold: getSwipeThreshold(width),
        offset: 0,
        armed: false,
      };
      track.setPointerCapture(event.pointerId);
      clearTimeout(settleTimerRef.current);
      setSettling(false);
      setArmed(false);
      setStrip({ resolved, label });
    }
    const { swipe } = gesture;
    swipe.offset = Math.min(
      swipe.width,
      Math.max(0, (swipe.originX - event.clientX) * swipe.towardStart)
    );
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${-swipe.offset * swipe.towardStart}px)`;
    }
    const nextArmed = swipe.offset >= swipe.threshold;
    if (nextArmed !== swipe.armed) {
      swipe.armed = nextArmed;
      setArmed(nextArmed);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (event.pointerId !== gestureRef.current?.pointerId) return;
    finish(commit);
  };

  const trackClassName = [
    css.SwipeTrack,
    enabled && css.SwipeTrackEnabled,
    settling && css.SwipeTrackSettling,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {strip && (
        <div
          className={css.SwipeAction}
          data-compact-card-swipe="action"
          data-armed={armed ? 'true' : undefined}
          data-resolved={strip.resolved ? 'true' : undefined}
          aria-hidden
        >
          <Icon size="200" src={strip.resolved ? Icons.Reload : Icons.Check} />
          <Text size="B300">{strip.label}</Text>
        </div>
      )}
      <div
        ref={trackRef}
        className={trackClassName}
        data-compact-card-swipe="track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => handlePointerEnd(event, true)}
        onPointerCancel={(event) => handlePointerEnd(event, false)}
        // A live re-sort can move the row out from under the finger, which
        // drops the capture; later events then go to another card. The card
        // button losing the touch's implicit capture to the track also
        // bubbles here, and is not an end.
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) handlePointerEnd(event, false);
        }}
        onClickCapture={(event) => {
          // Keyboard clicks (detail 0) never come from the swipe.
          if (!swipedRef.current || event.detail === 0) return;
          // The touch that swiped the card must not also open it.
          swipedRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onTransitionEnd={(event) => {
          if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
          settle();
        }}
      >
        {children}
      </div>
    </>
  );
}
