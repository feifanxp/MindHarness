import { describe, expect, it } from 'vitest';
import { PAGE_ZOOM_DEFAULT, PAGE_ZOOM_MAX, PAGE_ZOOM_MIN } from '../state/settings';
import { getTouchDistance, sanitizePageZoom } from './pageZoom';

describe('sanitizePageZoom', () => {
  it('returns the default zoom for non-finite values', () => {
    expect(sanitizePageZoom(Number.NaN)).toBe(PAGE_ZOOM_DEFAULT);
    expect(sanitizePageZoom(Number.POSITIVE_INFINITY)).toBe(PAGE_ZOOM_DEFAULT);
    expect(sanitizePageZoom(Number.NEGATIVE_INFINITY)).toBe(PAGE_ZOOM_DEFAULT);
  });

  it('rounds and clamps finite values to the supported zoom range', () => {
    expect(sanitizePageZoom(PAGE_ZOOM_MIN - 10)).toBe(PAGE_ZOOM_MIN);
    expect(sanitizePageZoom(99.6)).toBe(100);
    expect(sanitizePageZoom(100.4)).toBe(100);
    expect(sanitizePageZoom(PAGE_ZOOM_MAX + 10)).toBe(PAGE_ZOOM_MAX);
  });
});

describe('getTouchDistance', () => {
  it('returns the euclidean distance between two touches', () => {
    const touchA = { clientX: 10, clientY: 20 } as Touch;
    const touchB = { clientX: 13, clientY: 24 } as Touch;

    expect(getTouchDistance(touchA, touchB)).toBe(5);
  });
});
