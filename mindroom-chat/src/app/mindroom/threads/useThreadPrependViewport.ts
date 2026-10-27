import { useMemo, type RefObject } from 'react';
import type { ThreadBackPaginationController } from './threadBackPaginationController';
import type { ThreadPrependViewportPort } from './session/threadSessionTypes';
import { waitForScrollQuiescence } from './scrollQuiescence';

/**
 * Backward requests hand the reader over from the opening pin and commit at
 * scroll rest. The scroll ledger keeps the reader's rows in place for every
 * page that lands above them, so requests no longer capture an anchor.
 */
export const useThreadPrependViewport = ({
  controller,
  scrollRef,
}: {
  controller: ThreadBackPaginationController;
  scrollRef: RefObject<HTMLDivElement>;
}): ThreadPrependViewportPort =>
  useMemo(
    () => ({
      begin: (request) => controller.begin(request),
      waitForQuiescence: async (request) => {
        if (controller.owns(request)) await waitForScrollQuiescence(scrollRef.current);
      },
      finish: (request) => controller.finish(request),
    }),
    [controller, scrollRef]
  );
