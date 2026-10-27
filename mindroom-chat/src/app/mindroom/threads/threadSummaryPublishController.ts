import { useEffect, useMemo } from 'react';
import type { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import {
  getLatestThreadSummaryInfoFromEventSources,
  getThreadSummaryInfosFromEventSources,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import type { ThreadSummaryWriter } from './threadSummaryState';

export const getActiveThreadSummaryInfo = ({
  thread,
  threadEvents,
  threadId,
}: {
  thread: Pick<Thread, 'events' | 'timeline'> | null;
  threadEvents: MatrixEvent[];
  threadId: string | undefined;
}): MindroomThreadSummaryInfo | undefined =>
  threadId
    ? getLatestThreadSummaryInfoFromEventSources(threadEvents, thread?.events, thread?.timeline)
    : undefined;

export const useThreadSummaryPublishController = ({
  onStoreThreadSummary,
  room,
  thread,
  threadEvents,
  threadId,
  threadSummaryInfoMap,
}: {
  onStoreThreadSummary: ThreadSummaryWriter;
  room: Pick<Room, 'getThread'>;
  thread: Pick<Thread, 'events' | 'timeline'> | null;
  threadEvents: MatrixEvent[];
  threadId: string | undefined;
  threadSummaryInfoMap: Map<string, MindroomThreadSummaryInfo>;
}) => {
  const activeThreadSummaryInfo = useMemo(
    () =>
      getActiveThreadSummaryInfo({
        thread,
        threadEvents,
        threadId,
      }),
    [thread, threadEvents, threadId]
  );

  useEffect(() => {
    if (threadId) return;
    threadSummaryInfoMap.forEach((info, threadRootId) => {
      const knownThread = room.getThread(threadRootId);
      onStoreThreadSummary(
        threadRootId,
        info,
        ...getThreadSummaryInfosFromEventSources(knownThread?.events, knownThread?.timeline)
      );
    });
  }, [onStoreThreadSummary, room, threadId, threadSummaryInfoMap]);

  useEffect(() => {
    if (!isConfirmedMatrixEventId(threadId)) return;
    onStoreThreadSummary(
      threadId,
      ...getThreadSummaryInfosFromEventSources(threadEvents, thread?.events, thread?.timeline)
    );
  }, [onStoreThreadSummary, thread, threadEvents, threadId]);

  return activeThreadSummaryInfo;
};
