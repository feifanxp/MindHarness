import type { EventTimelineSet, MatrixClient, Room } from 'matrix-js-sdk';
import to from 'await-to-js';
import type { ThreadTargetCommands } from './session/threadSessionTypes';

type RunThreadOpenTargetEventOptions = {
  eventId?: string;
  notifyEventsChanged: () => void;
  isCurrentThreadOpen: () => boolean;
  mx: MatrixClient;
  room: Room;
  targets: ThreadTargetCommands;
  shouldScrollToLatestOnOpen: boolean;
  threadId: string;
};

export const runThreadOpenTargetEvent = async ({
  eventId,
  notifyEventsChanged,
  isCurrentThreadOpen,
  mx,
  room,
  targets,
  shouldScrollToLatestOnOpen,
  threadId,
}: RunThreadOpenTargetEventOptions): Promise<boolean> => {
  if (shouldScrollToLatestOnOpen || !eventId || eventId === threadId) {
    return true;
  }

  const evtThreadTimelineSet = room.getThread(threadId)?.getUnfilteredTimelineSet() as
    | EventTimelineSet
    | undefined;
  if (evtThreadTimelineSet) {
    const [evtErr] = await to(mx.getEventTimeline(evtThreadTimelineSet, eventId));
    if (!isCurrentThreadOpen()) return false;
    if (!evtErr) {
      notifyEventsChanged();
    }
  }

  targets.queue({
    threadId,
    eventId,
    highlight: true,
    onScroll: undefined,
  });
  return true;
};
