import { useEffect, useRef } from 'react';
import { sanitizePageZoom, getTouchDistance } from '../utils/pageZoom';

const WHEEL_ZOOM_SENSITIVITY = 0.02;
const OPEN_IMAGE_VIEWER_SELECTOR = '[data-image-viewer="true"]';

type GestureEventWithScale = Event & {
  scale: number;
};

export const usePinchToZoom = (
  pageZoom: number,
  setPageZoom: (zoom: number) => void
): void => {
  const pageZoomRef = useRef(pageZoom);
  const setPageZoomRef = useRef(setPageZoom);
  const pendingZoomRef = useRef<number | null>(null);
  const rafIdRef = useRef<number>();
  const wheelDeltaRef = useRef(0);
  const touchStartDistanceRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef(pageZoom);
  const gestureStartZoomRef = useRef<number | null>(null);

  useEffect(() => {
    pageZoomRef.current = pageZoom;
    pendingZoomRef.current = null;
  }, [pageZoom]);

  useEffect(() => {
    setPageZoomRef.current = setPageZoom;
  }, [setPageZoom]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const resetGestureState = () => {
      wheelDeltaRef.current = 0;
      touchStartDistanceRef.current = null;
      gestureStartZoomRef.current = null;
    };

    const shouldIgnorePinch = () => {
      const imageViewerOpen = document.querySelector(OPEN_IMAGE_VIEWER_SELECTOR) !== null;

      if (imageViewerOpen) {
        resetGestureState();
      }

      return imageViewerOpen;
    };

    const flushPendingZoom = () => {
      rafIdRef.current = undefined;

      const pendingZoom = pendingZoomRef.current;
      pendingZoomRef.current = null;

      if (pendingZoom === null || pendingZoom === pageZoomRef.current) return;

      pageZoomRef.current = pendingZoom;
      setPageZoomRef.current(pendingZoom);
    };

    const queueZoom = (nextZoom: number) => {
      const safeZoom = sanitizePageZoom(nextZoom);
      const currentZoom = pendingZoomRef.current ?? pageZoomRef.current;

      if (safeZoom === currentZoom) return;

      pendingZoomRef.current = safeZoom;
      if (rafIdRef.current !== undefined) return;

      rafIdRef.current = window.requestAnimationFrame(flushPendingZoom);
    };

    const startTouchPinch = (touches: TouchList) => {
      if (touches.length < 2) {
        touchStartDistanceRef.current = null;
        return;
      }

      touchStartDistanceRef.current = getTouchDistance(touches[0], touches[1]);
      touchStartZoomRef.current = pendingZoomRef.current ?? pageZoomRef.current;
    };

    const handleWheel = (evt: WheelEvent) => {
      if (!evt.ctrlKey || !Number.isFinite(evt.deltaY)) return;
      if (shouldIgnorePinch()) return;
      if (evt.cancelable) evt.preventDefault();

      wheelDeltaRef.current += -evt.deltaY * WHEEL_ZOOM_SENSITIVITY;

      const wholeDelta =
        wheelDeltaRef.current > 0
          ? Math.floor(wheelDeltaRef.current)
          : Math.ceil(wheelDeltaRef.current);
      if (wholeDelta === 0) return;

      const baseZoom = pendingZoomRef.current ?? pageZoomRef.current;
      const nextZoom = sanitizePageZoom(baseZoom + wholeDelta);
      const consumedDelta = nextZoom - baseZoom;

      if (consumedDelta === 0) {
        wheelDeltaRef.current = 0;
        return;
      }

      wheelDeltaRef.current -= consumedDelta;
      queueZoom(nextZoom);
    };

    const handleTouchStart = (evt: TouchEvent) => {
      if (shouldIgnorePinch()) return;
      startTouchPinch(evt.touches);
    };

    const handleTouchMove = (evt: TouchEvent) => {
      if (shouldIgnorePinch()) return;

      const startDistance = touchStartDistanceRef.current;
      if (evt.touches.length < 2 || startDistance === null || startDistance <= 0) {
        touchStartDistanceRef.current = null;
        return;
      }

      const currentDistance = getTouchDistance(evt.touches[0], evt.touches[1]);
      if (!Number.isFinite(currentDistance) || currentDistance <= 0) return;

      if (evt.cancelable) evt.preventDefault();
      queueZoom(touchStartZoomRef.current * (currentDistance / startDistance));
    };

    const handleTouchEnd = (evt: TouchEvent) => {
      if (shouldIgnorePinch()) return;

      if (evt.touches.length >= 2) {
        startTouchPinch(evt.touches);
        return;
      }

      touchStartDistanceRef.current = null;
    };

    const handleGestureStart = (evt: Event) => {
      const gestureEvent = evt as GestureEventWithScale;

      if (shouldIgnorePinch()) return;
      if (gestureEvent.cancelable) gestureEvent.preventDefault();
      gestureStartZoomRef.current = pendingZoomRef.current ?? pageZoomRef.current;
    };

    const handleGestureChange = (evt: Event) => {
      const gestureEvent = evt as GestureEventWithScale;
      if (!Number.isFinite(gestureEvent.scale) || gestureEvent.scale <= 0) return;
      if (shouldIgnorePinch()) return;

      if (gestureStartZoomRef.current === null) {
        gestureStartZoomRef.current = pendingZoomRef.current ?? pageZoomRef.current;
      }
      if (gestureEvent.cancelable) gestureEvent.preventDefault();

      queueZoom(gestureStartZoomRef.current * gestureEvent.scale);
    };

    const handleGestureEnd = () => {
      gestureStartZoomRef.current = null;
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    document.addEventListener('gesturestart', handleGestureStart as EventListener, {
      passive: false,
    });
    document.addEventListener('gesturechange', handleGestureChange as EventListener, {
      passive: false,
    });
    document.addEventListener('gestureend', handleGestureEnd as EventListener, { passive: true });

    return () => {
      if (rafIdRef.current !== undefined) {
        window.cancelAnimationFrame(rafIdRef.current);
      }

      resetGestureState();
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      document.removeEventListener('gesturestart', handleGestureStart as EventListener);
      document.removeEventListener('gesturechange', handleGestureChange as EventListener);
      document.removeEventListener('gestureend', handleGestureEnd as EventListener);
    };
  }, []);
};
