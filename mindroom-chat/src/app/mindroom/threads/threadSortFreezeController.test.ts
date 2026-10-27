import { describe, expect, it } from 'vitest';
import { resolveThreadSortFreezeUpdate } from './threadSortFreezeController';

describe('resolveThreadSortFreezeUpdate', () => {
  it('leaves inactive freeze state unchanged', () => {
    expect(
      resolveThreadSortFreezeUpdate({
        activeLiveOverviewThreadRootIds: ['$a'],
        currentState: null,
        threadSortControlSignature: 'next',
      })
    ).toBeNull();
  });

  it('keeps an already-current frozen snapshot', () => {
    const currentState = {
      controlSignature: 'current',
      orderedRootIds: ['$old'],
    };

    expect(
      resolveThreadSortFreezeUpdate({
        activeLiveOverviewThreadRootIds: ['$new'],
        currentState,
        threadSortControlSignature: 'current',
      })
    ).toBe(currentState);
  });

  it('resnapshots active overview ids when controls change', () => {
    expect(
      resolveThreadSortFreezeUpdate({
        activeLiveOverviewThreadRootIds: ['$new-a', '$new-b'],
        currentState: {
          controlSignature: 'old',
          orderedRootIds: ['$old'],
        },
        threadSortControlSignature: 'new',
      })
    ).toEqual({
      controlSignature: 'new',
      orderedRootIds: ['$new-a', '$new-b'],
    });
  });
});
