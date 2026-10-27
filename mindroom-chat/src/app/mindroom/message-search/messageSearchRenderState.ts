export type MessageSearchRenderStateParams = {
  hasTerm: boolean;
  status: 'pending' | 'success' | 'error';
  groupsCount: number;
  virtualItemCount: number;
};

export type MessageSearchRenderState = {
  showLoadingSkeletons: boolean;
  showVirtualizerFallback: boolean;
  showVirtualizedResults: boolean;
};

export const getMessageSearchRenderState = ({
  hasTerm,
  status,
  groupsCount,
  virtualItemCount,
}: MessageSearchRenderStateParams): MessageSearchRenderState => {
  const showVirtualizedResults = virtualItemCount > 0;
  const showVirtualizerFallback = groupsCount > 0 && virtualItemCount === 0 && status !== 'pending';
  const showLoadingSkeletons =
    (hasTerm && status === 'pending' && groupsCount === 0) ||
    (!showVirtualizedResults && !showVirtualizerFallback && hasTerm && status === 'pending');

  return {
    showLoadingSkeletons,
    showVirtualizerFallback,
    showVirtualizedResults,
  };
};
