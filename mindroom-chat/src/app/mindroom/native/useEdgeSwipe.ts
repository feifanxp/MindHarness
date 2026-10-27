import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';
import { imageViewerOpenAtom } from '../../state/imageViewer';
import { hasBlockingPortalOverlay } from '../../utils/portalOverlay';
import { isIOSStandaloneWebApp } from './nativeSso';

export const EDGE_START_MAX_X = 28;
const MIN_SWIPE_DISTANCE_X = 72;
const MAX_VERTICAL_DRIFT = 64;
const HANDLED_EVENT_FLAG = '__mindroomEdgeSwipeHandled';

type TouchEventWithFlag = TouchEvent & {
  [HANDLED_EVENT_FLAG]?: boolean;
};

export type EdgeSwipeDirection = 'back' | 'forward';

export const useEdgeSwipe = ({
  blockStandaloneWebApp = false,
  direction,
  enabled = true,
  onSwipe,
}: {
  blockStandaloneWebApp?: boolean;
  direction: EdgeSwipeDirection;
  enabled?: boolean;
  onSwipe: () => void;
}): void => {
  const onSwipeRef = useRef(onSwipe);
  const imageViewerOpen = useAtomValue(imageViewerOpenAtom);
  const standaloneBlocked = blockStandaloneWebApp && isIOSStandaloneWebApp();

  useEffect(() => {
    onSwipeRef.current = onSwipe;
  }, [onSwipe]);

  useEffect(() => {
    if (!enabled || standaloneBlocked || imageViewerOpen || typeof window === 'undefined') return;

    let tracking = false;
    let startX = 0;
    let startY = 0;
    const reset = () => {
      tracking = false;
      startX = 0;
      startY = 0;
    };

    const handleTouchStart = (event: TouchEventWithFlag) => {
      if (event[HANDLED_EVENT_FLAG] || hasBlockingPortalOverlay() || event.touches.length !== 1) {
        reset();
        return;
      }

      const touch = event.touches[0];
      const startsAtEdge =
        direction === 'back'
          ? touch.clientX <= EDGE_START_MAX_X
          : touch.clientX >= window.innerWidth - EDGE_START_MAX_X;
      if (!startsAtEdge) {
        reset();
        return;
      }

      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const handleTouchMove = (event: TouchEventWithFlag) => {
      if (!tracking || event[HANDLED_EVENT_FLAG]) return;
      if (hasBlockingPortalOverlay() || event.touches.length !== 1) {
        reset();
        return;
      }

      const touch = event.touches[0];
      const directionMultiplier = direction === 'back' ? 1 : -1;
      const distanceX = (touch.clientX - startX) * directionMultiplier;
      const driftY = Math.abs(touch.clientY - startY);
      if (driftY > MAX_VERTICAL_DRIFT && driftY > Math.abs(distanceX)) {
        reset();
        return;
      }

      if (distanceX > 8 && driftY <= MAX_VERTICAL_DRIFT) event.preventDefault();
      if (distanceX < MIN_SWIPE_DISTANCE_X || driftY > MAX_VERTICAL_DRIFT) return;

      event[HANDLED_EVENT_FLAG] = true;
      reset();
      onSwipeRef.current();
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', reset, { passive: true });
    window.addEventListener('touchcancel', reset, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', reset);
      window.removeEventListener('touchcancel', reset);
    };
  }, [direction, enabled, imageViewerOpen, standaloneBlocked]);
};
