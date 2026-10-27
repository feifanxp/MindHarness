import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { Direction, EventTimeline } from 'matrix-js-sdk/lib/models/event-timeline';
import { Thread } from 'matrix-js-sdk/lib/models/thread';

export const DEFAULT_THREAD_TAIL_EVENT_COUNT = 10;

const isThreadTailMessageEvent = (event: MatrixEvent): boolean => event.isRelation('m.thread');

export const getThreadTailEvents = (
  thread: Thread | null | undefined,
  count = DEFAULT_THREAD_TAIL_EVENT_COUNT
): MatrixEvent[] => {
  if (!thread || count <= 0) return [];

  const tailEvents: MatrixEvent[] = [];
  const seenEventIds = new Set<string>();

  const addEvent = (mEvent: MatrixEvent | null | undefined) => {
    if (!mEvent) return;

    const eventId = mEvent.getId();
    if (eventId) {
      if (seenEventIds.has(eventId)) return;
      seenEventIds.add(eventId);
    } else if (tailEvents.includes(mEvent)) {
      return;
    }

    tailEvents.push(mEvent);
  };

  const liveTimeline = thread.getUnfilteredTimelineSet().getLiveTimeline();
  // SDK segment links can form a cycle; walking one would never end.
  const visitedTimelines = new Set<EventTimeline>();

  for (
    let timeline: EventTimeline | undefined = liveTimeline;
    timeline && !visitedTimelines.has(timeline) && tailEvents.length < count;
    timeline = timeline.getNeighbouringTimeline(Direction.Backward) ?? undefined
  ) {
    visitedTimelines.add(timeline);
    const timelineEvents = timeline.getEvents();
    for (
      let eventIndex = timelineEvents.length - 1;
      eventIndex >= 0 && tailEvents.length < count;
      eventIndex -= 1
    ) {
      const event = timelineEvents[eventIndex];
      if (!isThreadTailMessageEvent(event)) continue;

      addEvent(event);
    }
  }

  if (tailEvents.length === 0) {
    addEvent(thread.lastReply());
    addEvent(thread.replyToEvent);
  }

  if (tailEvents.length < count) {
    addEvent(thread.rootEvent);
  }

  return tailEvents.reverse();
};
