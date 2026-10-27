import { describe, expect, it } from 'vitest';
import { getMessageSearchRenderState } from './messageSearchRenderState';

describe('getMessageSearchRenderState', () => {
  it('shows loading skeletons while the initial search page is pending', () => {
    expect(
      getMessageSearchRenderState({
        hasTerm: true,
        status: 'pending',
        groupsCount: 0,
        virtualItemCount: 0,
      })
    ).toEqual({
      showLoadingSkeletons: true,
      showVirtualizerFallback: false,
      showVirtualizedResults: false,
    });
  });

  it('shows a direct fallback when groups exist but the virtualizer has not yielded items yet', () => {
    expect(
      getMessageSearchRenderState({
        hasTerm: true,
        status: 'success',
        groupsCount: 3,
        virtualItemCount: 0,
      })
    ).toEqual({
      showLoadingSkeletons: false,
      showVirtualizerFallback: true,
      showVirtualizedResults: false,
    });
  });

  it('prefers virtualized results once virtual items exist', () => {
    expect(
      getMessageSearchRenderState({
        hasTerm: true,
        status: 'success',
        groupsCount: 3,
        virtualItemCount: 2,
      })
    ).toEqual({
      showLoadingSkeletons: false,
      showVirtualizerFallback: false,
      showVirtualizedResults: true,
    });
  });
});
