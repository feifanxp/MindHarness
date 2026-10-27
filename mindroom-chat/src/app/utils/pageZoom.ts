import { PAGE_ZOOM_DEFAULT, PAGE_ZOOM_MAX, PAGE_ZOOM_MIN } from '../state/settings';

export const sanitizePageZoom = (value: number): number => {
  if (!Number.isFinite(value)) return PAGE_ZOOM_DEFAULT;

  return Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, Math.round(value)));
};

export const getTouchDistance = (t1: Touch, t2: Touch): number =>
  Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
