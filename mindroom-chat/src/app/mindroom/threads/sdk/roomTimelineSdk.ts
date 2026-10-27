import {
  Direction,
  THREAD_RELATION_TYPE,
  type EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import { decryptAllTimelineEvent } from '../../../utils/room';
import {
  hydrateCachedEvents,
  reconcileRelationEventsWithAggregation,
} from '../eventCacheEditUtils';
import { resolveHydratedRoomBeforeToken } from '../eventCacheTokenUtils';
import { getLiveTimeline } from '../timelinePagination';

/** Restore the thread catalogue without implying contiguous room history. */
export function restoreCachedRoomThreads(
  room: Room,
  roots: { rootEvent: MatrixEvent; latestReply?: MatrixEvent }[]
): void {
  const missingRoots = roots.filter(({ rootEvent }) => !room.getThread(rootEvent.getId()!));
  const missing = missingRoots.map(({ rootEvent }) => rootEvent);
  hydrateCachedEvents({ room, events: missing });
  room.processThreadRoots(missing, true);
  missingRoots.forEach(({ rootEvent, latestReply }) => {
    const thread = room.getThread(rootEvent.getId()!);
    if (!thread || !latestReply || thread.replyToEvent || thread.events.length || thread.length)
      return;
    const events = [latestReply];
    hydrateCachedEvents({ room, events });
    // Old roots may predate their server bundle. Actual cached replies make
    // them visible while discovery is pending; SDK initialization stays intact.
    thread.timelineSet.addEventsToTimeline(events, true, false, thread.liveTimeline);
  });
}

/** Hydrate before SDK insertion so timeline listeners see cached edits and redactions immediately. */
export async function insertCachedRoomTimeline({
  mx,
  room,
  events,
}: {
  mx: MatrixClient;
  room: Room;
  events: MatrixEvent[];
}): Promise<{ timeline: EventTimeline; timelineWasEmpty: boolean }> {
  hydrateCachedEvents({ room, events });

  const timeline = getLiveTimeline(room);
  const timelineWasEmpty = timeline.getEvents().length === 0;
  await room.addLiveEvents(events, {
    fromCache: true,
    timelineWasEmpty,
    addToState: false,
  });
  mx.processAggregatedTimelineEvents(room, events);

  if (room.hasEncryptionStateEvent()) {
    await to(decryptAllTimelineEvent(mx, timeline));
  }
  return { timeline, timelineWasEmpty };
}

/** SDK prepend takes newest-first events and can join an existing backward timeline on overlap. */
export async function prependCachedRoomTimeline({
  mx,
  room,
  events,
  firstTimeline,
  beforeToken,
  showThreadRepliesInRoom,
}: {
  mx: MatrixClient;
  room: Room;
  events: MatrixEvent[];
  firstTimeline: EventTimeline;
  beforeToken: string | null | undefined;
  showThreadRepliesInRoom: boolean;
}): Promise<EventTimeline> {
  const redactedRelationTargets = hydrateCachedEvents({ room, events });
  const paginationToken = firstTimeline.getPaginationToken(Direction.Backward);
  const [timelineEvents, , unknownRelations] = showThreadRepliesInRoom
    ? [events, [], []]
    : room.partitionThreadedEvents(events);

  // Room's declaration omits null, but EventTimelineSet accepts it as room-start proof.
  (
    room.addEventsToTimeline as (
      events: MatrixEvent[],
      toStartOfTimeline: boolean,
      addToState: boolean,
      timeline: EventTimeline,
      paginationToken?: string | null
    ) => void
  )(
    timelineEvents,
    true,
    false,
    firstTimeline,
    resolveHydratedRoomBeforeToken(beforeToken, paginationToken)
  );
  mx.processAggregatedTimelineEvents(room, timelineEvents);
  room.processThreadRoots(
    timelineEvents.filter((mEvent) =>
      mEvent.getServerAggregatedRelation(THREAD_RELATION_TYPE.name)
    ),
    false
  );
  reconcileRelationEventsWithAggregation(
    unknownRelations,
    [{ relations: room.relations }],
    undefined,
    redactedRelationTargets
  );

  const fetchedTimeline =
    firstTimeline.getNeighbouringTimeline(Direction.Backward) ?? firstTimeline;
  if (room.hasEncryptionStateEvent()) {
    await to(decryptAllTimelineEvent(mx, fetchedTimeline));
  }
  return fetchedTimeline;
}
