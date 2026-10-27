export type MessageSearchPaginationState = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  thresholdPx?: number;
};

export const DEFAULT_MESSAGE_SEARCH_FETCH_THRESHOLD_PX = 600;

export const shouldFetchNextMessageSearchPage = ({
  hasNextPage,
  isFetchingNextPage,
  scrollTop,
  clientHeight,
  scrollHeight,
  thresholdPx = DEFAULT_MESSAGE_SEARCH_FETCH_THRESHOLD_PX,
}: MessageSearchPaginationState): boolean => {
  if (!hasNextPage || isFetchingNextPage) return false;
  if (clientHeight <= 0 || scrollHeight <= 0) return false;

  const remainingPx = scrollHeight - (scrollTop + clientHeight);
  return remainingPx <= thresholdPx;
};
