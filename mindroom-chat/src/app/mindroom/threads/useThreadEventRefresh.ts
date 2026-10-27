import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { useEffect } from 'react';
import { type Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';

export const useThreadEventRefresh = (
  thread: Thread | undefined,
  trackedEvents: readonly (MatrixEvent | null | undefined)[],
  refresh: () => void,
  onNewReply?: (event: MatrixEvent) => void
): void => {
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!thread) return undefined;

    const handleNewReply = (_thread: Thread, event: MatrixEvent) => {
      onNewReply?.(event);
      refresh();
    };

    thread.on(ThreadEvent.Update, refresh);
    thread.on(ThreadEvent.NewReply, handleNewReply);

    return () => {
      thread.removeListener(ThreadEvent.Update, refresh);
      thread.removeListener(ThreadEvent.NewReply, handleNewReply);
    };
  }, [onNewReply, refresh, thread]);

  useEffect(() => {
    const uniqueEvents = trackedEvents.reduce<MatrixEvent[]>((events, event) => {
      if (!event || events.includes(event)) return events;
      events.push(event);
      return events;
    }, []);

    uniqueEvents.forEach((event) => {
      event.on(MatrixEventEvent.Replaced, refresh);
    });

    return () => {
      uniqueEvents.forEach((event) => {
        event.removeListener(MatrixEventEvent.Replaced, refresh);
      });
    };
  }, [refresh, trackedEvents]);
};
