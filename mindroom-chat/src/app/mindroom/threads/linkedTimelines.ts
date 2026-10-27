import { Direction, type EventTimeline, type MatrixEvent, type Thread } from 'matrix-js-sdk';

export const getFirstLinkedTimeline = (
  timeline: EventTimeline,
  direction: Direction
): EventTimeline => {
  const visitedTimelines = new Set<EventTimeline>([timeline]);
  let currentTimeline = timeline;
  let linkedTimeline = currentTimeline.getNeighbouringTimeline(direction);

  while (linkedTimeline) {
    if (visitedTimelines.has(linkedTimeline)) return timeline;

    visitedTimelines.add(linkedTimeline);
    currentTimeline = linkedTimeline;
    linkedTimeline = currentTimeline.getNeighbouringTimeline(direction);
  }

  return currentTimeline;
};

export const getLinkedTimelines = (timeline: EventTimeline): EventTimeline[] => {
  const firstTimeline = getFirstLinkedTimeline(timeline, Direction.Backward);
  const timelines: EventTimeline[] = [];
  const visitedTimelines = new Set<EventTimeline>();

  for (
    let nextTimeline: EventTimeline | null = firstTimeline;
    nextTimeline && !visitedTimelines.has(nextTimeline);
    nextTimeline = nextTimeline.getNeighbouringTimeline(Direction.Forward)
  ) {
    visitedTimelines.add(nextTimeline);
    timelines.push(nextTimeline);
  }

  return timelines;
};

/** Read only history connected to the live segment; disconnected context windows may have gaps. */
export const getThreadTimelineEvents = (thread: Thread): MatrixEvent[] => {
  const timelines = getLinkedTimelines(thread.getUnfilteredTimelineSet().getLiveTimeline());
  return timelines.length === 1
    ? thread.events
    : timelines.flatMap((timeline) => timeline.getEvents());
};
