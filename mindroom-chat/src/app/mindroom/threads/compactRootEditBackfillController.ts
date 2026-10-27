import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  Direction,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import type { PersistRoomEventCache } from '../engine/enginePersistFacade';
import { getLatestEdit } from '../../utils/room';
import { logMindroomEditDebug as logEditDebug } from '../messages/editDebug';
import { markThreadEditBackfillAttempted } from './threadEditBackfill';
import { getCompactRootEventsNeedingBackfill } from './threadBootstrap';

export const useCompactRootEditBackfillController = ({
  enabled,
  mx,
  overviewThreadRootIds,
  beginRoomCacheWrite,
  room,
  roomSurfaceEventEntries,
  roomThreadListThreads,
  setOverviewRefreshCounter,
}: {
  enabled: boolean;
  mx: MatrixClient;
  overviewThreadRootIds: string[];
  beginRoomCacheWrite: () => PersistRoomEventCache;
  room: Room;
  roomSurfaceEventEntries: Array<{ event: MatrixEvent }>;
  roomThreadListThreads: Array<{ id?: string; rootEvent?: MatrixEvent }>;
  setOverviewRefreshCounter: Dispatch<SetStateAction<number>>;
}): void => {
  const compactRootEditFetchAttemptedRef = useRef<WeakMap<MatrixEvent, number>>(
    new WeakMap<MatrixEvent, number>()
  );

  useEffect(() => {
    compactRootEditFetchAttemptedRef.current = new WeakMap<MatrixEvent, number>();
  }, [room.roomId]);

  useEffect(() => {
    if (!enabled) return undefined;

    const compactRootEvents = getCompactRootEventsNeedingBackfill({
      room,
      roomSurfaceEventEntries,
      threadRootIds: overviewThreadRootIds,
      roomThreadListThreads,
      attemptedEvents: compactRootEditFetchAttemptedRef.current,
    });

    if (compactRootEvents.length === 0) {
      logEditDebug('compactRootBackfill:noneMissing', {
        compactRootCount: overviewThreadRootIds.length,
        roomId: room.roomId,
      });
      return undefined;
    }

    logEditDebug('compactRootBackfill:start', {
      compactRootCount: overviewThreadRootIds.length,
      missingRootCount: compactRootEvents.length,
      roomId: room.roomId,
    });

    compactRootEvents.forEach(({ events }) => {
      events.forEach((event) => {
        markThreadEditBackfillAttempted(event, compactRootEditFetchAttemptedRef.current, true);
      });
    });

    let cancelled = false;
    const loadMissingCompactRootEdits = async () => {
      const persistRoomEventCache = beginRoomCacheWrite();
      const updatedEvents: MatrixEvent[] = [];
      const concurrency = 4;
      let cursor = 0;

      const worker = async () => {
        while (!cancelled && cursor < compactRootEvents.length) {
          const currentIndex = cursor;
          cursor += 1;

          const { threadRootId, events } = compactRootEvents[currentIndex];
          const targetEvent = events[0];
          const eventId = targetEvent?.getId();
          if (!eventId) continue;

          const [relErr, relData] = await to(
            mx.relations(room.roomId, eventId, RelationType.Replace, targetEvent.getType(), {
              dir: Direction.Backward,
              limit: 100,
            })
          );
          if (cancelled) continue;
          if (relErr) {
            logEditDebug('compactRootBackfill:fetchError', {
              eventId,
              roomId: room.roomId,
              error: String(relErr),
            });
            continue;
          }

          const currentReplacement = targetEvent.replacingEvent() ?? undefined;
          const relationEvents = relData?.events ?? [];
          if (relationEvents.length === 0 && !currentReplacement) {
            logEditDebug('compactRootBackfill:noRelations', {
              eventId,
              roomId: room.roomId,
            });
            continue;
          }

          const latestEdit = getLatestEdit(
            targetEvent,
            currentReplacement ? [currentReplacement, ...relationEvents] : relationEvents
          );
          if (!latestEdit) continue;
          if (latestEdit.getSender() !== targetEvent.getSender()) {
            logEditDebug('compactRootBackfill:senderMismatch', {
              eventId,
              roomId: room.roomId,
              editEventId: latestEdit.getId(),
              editSender: latestEdit.getSender(),
              targetSender: targetEvent.getSender(),
            });
            continue;
          }

          let didUpdateEvent = false;
          events.forEach((event) => {
            if (event.replacingEvent() === latestEdit) return;
            event.makeReplaced(latestEdit);
            updatedEvents.push(event);
            didUpdateEvent = true;
          });
          if (!didUpdateEvent) {
            logEditDebug('compactRootBackfill:alreadyLatest', {
              eventId,
              roomId: room.roomId,
              editEventId: latestEdit.getId(),
            });
            continue;
          }
          logEditDebug('compactRootBackfill:applied', {
            eventId,
            roomId: room.roomId,
            threadRootId,
            editEventId: latestEdit.getId(),
            relationCount: relationEvents.length,
            updatedCopies: events.length,
          });
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (updatedEvents.length > 0 && !cancelled) {
        persistRoomEventCache(updatedEvents);
        setOverviewRefreshCounter((value) => value + 1);
        logEditDebug('compactRootBackfill:updated', {
          roomId: room.roomId,
          updatedCount: updatedEvents.length,
        });
        return;
      }

      logEditDebug('compactRootBackfill:noUpdate', {
        roomId: room.roomId,
      });
    };

    loadMissingCompactRootEdits();

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    mx,
    overviewThreadRootIds,
    beginRoomCacheWrite,
    room,
    roomSurfaceEventEntries,
    roomThreadListThreads,
    setOverviewRefreshCounter,
  ]);
};
