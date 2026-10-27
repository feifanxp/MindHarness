import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ThreadSortFreezeState } from './roomThreadOverviewModel';

export const resolveThreadSortFreezeUpdate = ({
  activeLiveOverviewThreadRootIds,
  currentState,
  threadSortControlSignature,
}: {
  activeLiveOverviewThreadRootIds: string[];
  currentState: ThreadSortFreezeState | null;
  threadSortControlSignature: string;
}): ThreadSortFreezeState | null => {
  if (!currentState) return currentState;
  if (currentState.controlSignature === threadSortControlSignature) {
    return currentState;
  }

  return {
    controlSignature: threadSortControlSignature,
    orderedRootIds: activeLiveOverviewThreadRootIds,
  };
};

export const useThreadSortFreezeController = ({
  activeLiveOverviewThreadRootIds,
  setThreadSortFreezeState,
  threadId,
  threadSortControlSignature,
  threadSortFreezeState,
}: {
  activeLiveOverviewThreadRootIds: string[];
  setThreadSortFreezeState: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  threadId: string | undefined;
  threadSortControlSignature: string;
  threadSortFreezeState: ThreadSortFreezeState | null;
}) => {
  useEffect(() => {
    if (threadId || !threadSortFreezeState) return;
    if (threadSortFreezeState.controlSignature === threadSortControlSignature) return;

    setThreadSortFreezeState((currentState) =>
      resolveThreadSortFreezeUpdate({
        activeLiveOverviewThreadRootIds,
        currentState,
        threadSortControlSignature,
      })
    );
  }, [
    activeLiveOverviewThreadRootIds,
    setThreadSortFreezeState,
    threadId,
    threadSortControlSignature,
    threadSortFreezeState,
  ]);
};
