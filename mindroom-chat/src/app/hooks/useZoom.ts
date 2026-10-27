import {
  RefCallback,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { getTouchDistance } from '../utils/pageZoom';

export const useZoom = (step: number, min = 0.1, max = 5) => {
  const [zoom, setZoom] = useState<number>(1);
  const [zoomTarget, setZoomTarget] = useState<HTMLElement | null>(null);
  const [isZooming, setIsZooming] = useState(false);
  const zoomRef = useRef(1);
  const touchStartDistanceRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef(1);
  const gestureStartZoomRef = useRef<number | null>(null);

  const clampZoom = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max]);

  const setClampedZoom = useCallback(
    (value: SetStateAction<number>) => {
      setZoom((currentZoom) => {
        const nextZoom = typeof value === 'function' ? value(currentZoom) : value;
        const safeZoom = clampZoom(nextZoom);
        zoomRef.current = safeZoom;
        return safeZoom;
      });
    },
    [clampZoom]
  );

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const zoomIn = () => {
    setClampedZoom((z) => {
      const newZ = z + step;
      return newZ > max ? z : newZ;
    });
  };

  const zoomOut = () => {
    setClampedZoom((z) => {
      const newZ = z - step;
      return newZ < min ? z : newZ;
    });
  };

  const zoomTargetRef = useCallback<RefCallback<HTMLElement>>((node) => {
    setZoomTarget(node);
  }, []);

  useEffect(() => {
    if (!zoomTarget) return undefined;

    const stopZoomGesture = () => {
      touchStartDistanceRef.current = null;
      gestureStartZoomRef.current = null;
      setIsZooming(false);
    };

    const startTouchPinch = (touches: TouchList) => {
      if (touches.length < 2) {
        touchStartDistanceRef.current = null;
        setIsZooming(false);
        return;
      }

      touchStartDistanceRef.current = getTouchDistance(touches[0], touches[1]);
      touchStartZoomRef.current = zoomRef.current;
      setIsZooming(true);
    };

    const handleTouchStart = (evt: TouchEvent) => {
      startTouchPinch(evt.touches);
    };

    const handleTouchMove = (evt: TouchEvent) => {
      const startDistance = touchStartDistanceRef.current;
      if (evt.touches.length < 2 || startDistance === null || startDistance <= 0) {
        touchStartDistanceRef.current = null;
        setIsZooming(false);
        return;
      }

      const currentDistance = getTouchDistance(evt.touches[0], evt.touches[1]);
      if (!Number.isFinite(currentDistance) || currentDistance <= 0) return;

      if (evt.cancelable) evt.preventDefault();
      setClampedZoom(touchStartZoomRef.current * (currentDistance / startDistance));
    };

    const handleTouchEnd = (evt: TouchEvent) => {
      if (evt.touches.length >= 2) {
        startTouchPinch(evt.touches);
        return;
      }

      touchStartDistanceRef.current = null;
      setIsZooming(false);
    };

    const handleGestureStart = (evt: Event) => {
      const gestureEvent = evt as Event & { scale?: number };
      if (gestureEvent.cancelable) gestureEvent.preventDefault();
      gestureStartZoomRef.current = zoomRef.current;
      setIsZooming(true);
    };

    const handleGestureChange = (evt: Event) => {
      const gestureEvent = evt as Event & { scale?: number };
      if (!Number.isFinite(gestureEvent.scale) || !gestureEvent.scale || gestureEvent.scale <= 0) {
        return;
      }

      if (gestureStartZoomRef.current === null) {
        gestureStartZoomRef.current = zoomRef.current;
      }
      if (gestureEvent.cancelable) gestureEvent.preventDefault();

      setClampedZoom(gestureStartZoomRef.current * gestureEvent.scale);
    };

    const handleGestureEnd = () => {
      gestureStartZoomRef.current = null;
      setIsZooming(false);
    };

    zoomTarget.addEventListener('touchstart', handleTouchStart, { passive: true });
    zoomTarget.addEventListener('touchmove', handleTouchMove, { passive: false });
    zoomTarget.addEventListener('touchend', handleTouchEnd, { passive: true });
    zoomTarget.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    zoomTarget.addEventListener('gesturestart', handleGestureStart as EventListener, {
      passive: false,
    });
    zoomTarget.addEventListener('gesturechange', handleGestureChange as EventListener, {
      passive: false,
    });
    zoomTarget.addEventListener('gestureend', handleGestureEnd as EventListener, { passive: true });

    return () => {
      stopZoomGesture();
      zoomTarget.removeEventListener('touchstart', handleTouchStart);
      zoomTarget.removeEventListener('touchmove', handleTouchMove);
      zoomTarget.removeEventListener('touchend', handleTouchEnd);
      zoomTarget.removeEventListener('touchcancel', handleTouchEnd);
      zoomTarget.removeEventListener('gesturestart', handleGestureStart as EventListener);
      zoomTarget.removeEventListener('gesturechange', handleGestureChange as EventListener);
      zoomTarget.removeEventListener('gestureend', handleGestureEnd as EventListener);
    };
  }, [setClampedZoom, zoomTarget]);

  return {
    zoom,
    setZoom: setClampedZoom,
    zoomIn,
    zoomOut,
    zoomTargetRef,
    isZooming,
  };
};
