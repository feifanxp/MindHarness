import { useState, type MutableRefObject } from 'react';
import type { ThreadPaginationRequest } from './session/threadSessionTypes';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

/** Owns the backward request lock plus opening-pin suppression and provenance. */
export const useThreadBackPaginationController = () => {
  const [controller] = useState(() => {
    let owner: ThreadPaginationRequest | undefined;
    let suppressed = false;
    let pendingOpenBottomPinCount: number | undefined;
    let canceledOpenBottomPinCount: number | undefined;
    return {
      reset: () => {
        owner = undefined;
        suppressed = false;
        pendingOpenBottomPinCount = undefined;
        canceledOpenBottomPinCount = undefined;
      },
      // A reader who asks for older history takes over from the opening pin.
      begin: (request: ThreadPaginationRequest) => {
        if (owner) return false;
        owner = request;
        suppressed = true;
        return true;
      },
      owns: (request: ThreadPaginationRequest) => owner === request,
      finish: (request: ThreadPaginationRequest) => {
        if (owner === request) owner = undefined;
      },
      isOpenBottomPinSuppressed: () => suppressed,
      suppressOpenBottomPin: () => {
        suppressed = true;
      },
      requestOpenBottomPin: (scrollToBottomRef: MutableRefObject<ScrollToBottomState>) => {
        if (suppressed) return false;
        const nextCount = scrollToBottomRef.current.count + 1;
        scrollToBottomRef.current = {
          count: nextCount,
          smooth: false,
        };
        // Both the focus-band producer and the session completion adapter
        // register here, so a gesture can distinguish either opening request
        // from a later explicit jump or live-send count.
        pendingOpenBottomPinCount = nextCount;
        return true;
      },
      cancelOpenBottomPin: (currentCount: number) => {
        suppressed = true;
        if (pendingOpenBottomPinCount === currentCount) {
          canceledOpenBottomPinCount = currentCount;
        }
        pendingOpenBottomPinCount = undefined;
      },
      // Keep the shared command count monotonic. Both consumers consult this
      // exact generation; a newer explicit count remains applicable.
      shouldApplyBottomPin: (count: number) => canceledOpenBottomPinCount !== count,
    };
  });
  return controller;
};
export type ThreadBackPaginationController = ReturnType<typeof useThreadBackPaginationController>;
