import { describe, expect, it } from 'vitest';
import { shouldUseSurfacePreloadTarget } from './roomPreloadTarget';

describe('shouldUseSurfacePreloadTarget', () => {
  it('uses the surface target for compact room view', () => {
    expect(
      shouldUseSurfacePreloadTarget({
        threadId: undefined,
        roomThreadFilterActive: false,
        viewMode: 'compact',
      })
    ).toBe(true);
  });

  it('uses the surface target for filtered room overview', () => {
    expect(
      shouldUseSurfacePreloadTarget({
        threadId: undefined,
        roomThreadFilterActive: true,
        viewMode: 'threaded',
      })
    ).toBe(true);
  });

  it('does not use the surface target inside a thread', () => {
    expect(
      shouldUseSurfacePreloadTarget({
        threadId: '$thread',
        roomThreadFilterActive: true,
        viewMode: 'compact',
      })
    ).toBe(false);
  });
});
