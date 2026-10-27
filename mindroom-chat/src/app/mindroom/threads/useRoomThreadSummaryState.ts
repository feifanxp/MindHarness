import { useCallback } from 'react';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { storeThreadSummaryInState, useThreadSummaryStateMap } from './threadSummaryState';

type UseRoomThreadSummaryStateOptions = {
  roomId: string;
  sessionId: string;
};

export const useRoomThreadSummaryState = ({
  roomId,
  sessionId,
}: UseRoomThreadSummaryStateOptions) => {
  const summaryMap = useThreadSummaryStateMap({ roomId, sessionId });

  const storeThreadSummary = useCallback(
    (threadRootId: string, ...infos: Array<MindroomThreadSummaryInfo | undefined>) => {
      storeThreadSummaryInState(sessionId, roomId, threadRootId, ...infos);
    },
    [roomId, sessionId]
  );

  return {
    summaryMap,
    storeThreadSummary,
  };
};
