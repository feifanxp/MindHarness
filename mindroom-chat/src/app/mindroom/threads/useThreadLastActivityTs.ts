import { useCallback, useState } from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { DEFAULT_THREAD_TAIL_EVENT_COUNT, getThreadTailEvents } from '../../utils/thread';
import {
  isVisibleThreadReplyEvent,
  isVisibleThreadReplyEventType,
} from './threadUtils';
import { useThreadEventRefresh } from './useThreadEventRefresh';

type BundledThreadLatestEvent = {
  origin_server_ts?: unknown;
  type?: unknown;
  unsigned?: {
    ['m.relations']?: {
      ['m.replace']?: {
        origin_server_ts?: unknown;
      };
    };
  };
};

const getEventActivityTs = (mEvent: MatrixEvent | null | undefined): number | undefined => {
  if (!mEvent) return undefined;

  const replacingEvent = mEvent.replacingEvent();
  const replacingTs =
    replacingEvent && replacingEvent.getSender() === mEvent.getSender()
      ? replacingEvent.getTs()
      : undefined;

  return Math.max(mEvent.getTs(), replacingTs ?? 0);
};

const getPositiveTs = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const getBundledThreadLatestEventTs = (rootEvent: MatrixEvent | undefined): number | undefined => {
  const latestEvent = rootEvent?.getUnsigned()?.['m.relations']?.['m.thread']?.latest_event as
    | BundledThreadLatestEvent
    | undefined;

  if (!latestEvent || typeof latestEvent !== 'object') return undefined;
  if (!isVisibleThreadReplyEventType(typeof latestEvent.type === 'string' ? latestEvent.type : undefined)) {
    return undefined;
  }

  const latestEventTs = getPositiveTs(latestEvent.origin_server_ts);
  const latestEditTs = getPositiveTs(
    latestEvent.unsigned?.['m.relations']?.['m.replace']?.origin_server_ts
  );

  if (latestEventTs === undefined) return latestEditTs;
  if (latestEditTs === undefined) return latestEventTs;
  return Math.max(latestEventTs, latestEditTs);
};

const getThreadActivityEvents = (
  room: Room | undefined,
  threadRootId: string | undefined
): { rootEvent: MatrixEvent | undefined; trackedEvents: MatrixEvent[] } => {
  if (!room || !threadRootId) {
    return {
      rootEvent: undefined,
      trackedEvents: [],
    };
  }

  const thread = room.getThread(threadRootId);
  const rootEvent = thread?.rootEvent ?? room.findEventById(threadRootId);
  const trackedEvents: MatrixEvent[] = [];
  const trackedEventIds = new Set<string>();

  const addTrackedEvent = (mEvent: MatrixEvent | null | undefined) => {
    if (!mEvent) return;

    const eventId = mEvent.getId();
    if (eventId) {
      if (trackedEventIds.has(eventId)) return;
      trackedEventIds.add(eventId);
    } else if (trackedEvents.includes(mEvent)) {
      return;
    }

    trackedEvents.push(mEvent);
  };

  getThreadTailEvents(thread, DEFAULT_THREAD_TAIL_EVENT_COUNT)
    .filter(isVisibleThreadReplyEvent)
    .forEach(addTrackedEvent);
  const lastReply = thread?.lastReply?.() ?? null;
  if (lastReply && isVisibleThreadReplyEvent(lastReply)) {
    addTrackedEvent(lastReply);
  }
  if (thread?.replyToEvent && isVisibleThreadReplyEvent(thread.replyToEvent)) {
    addTrackedEvent(thread.replyToEvent);
  }
  addTrackedEvent(rootEvent);

  return {
    rootEvent,
    trackedEvents,
  };
};

type ThreadLastActivitySnapshot = {
  activityTs: number | undefined;
  trackedEvents: MatrixEvent[];
};

const getThreadLastActivitySnapshot = (
  room: Room | undefined,
  threadRootId: string | undefined
): ThreadLastActivitySnapshot => {
  const { rootEvent, trackedEvents } = getThreadActivityEvents(room, threadRootId);
  const liveActivityTs = trackedEvents
    .map((mEvent) => getEventActivityTs(mEvent))
    .reduce<number | undefined>((latestTs, candidateTs) => {
      if (candidateTs === undefined) return latestTs;
      if (latestTs === undefined) return candidateTs;
      return candidateTs > latestTs ? candidateTs : latestTs;
    }, undefined);
  const bundledActivityTs = getBundledThreadLatestEventTs(rootEvent);
  const activityTs =
    liveActivityTs === undefined
      ? bundledActivityTs
      : bundledActivityTs === undefined
        ? liveActivityTs
        : Math.max(liveActivityTs, bundledActivityTs);

  return {
    activityTs,
    trackedEvents,
  };
};

export const getThreadLastActivityTs = (
  room: Room | undefined,
  threadRootId: string | undefined
): number | undefined =>
  getThreadLastActivitySnapshot(room, threadRootId).activityTs;

export const useThreadLastActivityTs = (
  room: Room | undefined,
  threadRootId: string | undefined
): number | undefined => {
  const thread = room && threadRootId ? room.getThread(threadRootId) ?? undefined : undefined;
  const [snapshot, setSnapshot] = useState(() => getThreadLastActivitySnapshot(room, threadRootId));
  const refresh = useCallback(() => {
    setSnapshot(getThreadLastActivitySnapshot(room, threadRootId));
  }, [room, threadRootId]);

  useThreadEventRefresh(thread, snapshot.trackedEvents, refresh);

  return snapshot.activityTs;
};
