import {
  ClientEvent,
  EventType,
  RoomStateEvent,
  SyncState,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { getRoomCreators } from '../../hooks/useRoomCreators';
import {
  getPowersLevelFromMatrixEvent,
  readPowerLevel,
  type IPowerLevels,
} from '../../hooks/usePowerLevels';
import { getRoomPermissionsAPI } from '../../hooks/useRoomPermissions';
import { getStateEvent } from '../../utils/room';
import { isConfirmedMatrixEventId } from './threadRouteUtils';

export const canPinRoomEvents = (
  creators: Set<string>,
  powerLevels: IPowerLevels,
  userId: string
): boolean =>
  (creators.has(userId) || readPowerLevel.user(powerLevels, userId) >= 100) &&
  getRoomPermissionsAPI(creators, powerLevels).stateEvent(StateEvent.RoomPinnedEvents, userId);

export const getPinnedEventIds = (content: unknown): string[] => {
  const pinned = (content as { pinned?: unknown } | undefined)?.pinned;
  return Array.isArray(pinned)
    ? [
        ...new Set(
          pinned.filter(
            (id): id is string => typeof id === 'string' && isConfirmedMatrixEventId(id)
          )
        ),
      ]
    : [];
};

type PendingPins = {
  ids: string[];
  expectedEchoIds?: string[];
  accepted: boolean;
  eventId?: string;
  earlierEventIds: Set<string>;
  unsubscribe: () => void;
};

const pendingPins = new WeakMap<Room, PendingPins>();
const queuedPinAdds = new WeakMap<Room, Map<string, number>>();
const pinListeners = new Set<(room: Room) => void>();
let pinVersion = 0;
const emitPinChange = (room: Room) => {
  pinVersion += 1;
  pinListeners.forEach((listener) => listener(room));
};
export const subscribePendingPins = (listener: (room: Room) => void) => {
  pinListeners.add(listener);
  return () => {
    pinListeners.delete(listener);
  };
};
export const getPendingPinsVersion = () => pinVersion;
const livePinnedIds = (room: Room) =>
  getPinnedEventIds(getStateEvent(room, StateEvent.RoomPinnedEvents)?.getContent());
export const getPendingPinnedEventIds = (room: Room) => {
  const accepted = pendingPins.get(room)?.ids;
  const queued = queuedPinAdds.get(room);
  return queued?.size
    ? [...new Set([...(accepted ?? livePinnedIds(room)), ...queued.keys()])]
    : accepted;
};

const trackQueuedPin = (room: Room, eventId: string, delta: number) => {
  const queued = queuedPinAdds.get(room) ?? new Map<string, number>();
  const count = (queued.get(eventId) ?? 0) + delta;
  if (count > 0) queued.set(eventId, count);
  else queued.delete(eventId);
  if (queued.size) queuedPinAdds.set(room, queued);
  else queuedPinAdds.delete(room);
  emitPinChange(room);
};

const readPinContent = async (mx: MatrixClient, room: Room) => {
  try {
    return await mx.getStateEvent(room.roomId, EventType.RoomPinnedEvents, '');
  } catch (error) {
    if ((error as { errcode?: string })?.errcode !== 'M_NOT_FOUND') throw error;
    return { pinned: [] };
  }
};

const samePins = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const publishPendingPins = (
  mx: MatrixClient,
  room: Room,
  next?: Omit<PendingPins, 'unsubscribe'>
) => {
  pendingPins.get(room)?.unsubscribe();
  pendingPins.delete(room);
  if (next) {
    let reconciliation = 0;
    const verifyPending = () => {
      const pending = pendingPins.get(room);
      if (!pending?.accepted) return;
      const revision = ++reconciliation;
      void readPinContent(mx, room)
        .then((content) => {
          if (pendingPins.get(room) !== pending || reconciliation !== revision) return;
          const ids = getPinnedEventIds(content);
          const live = getPinnedEventIds(
            getStateEvent(room, StateEvent.RoomPinnedEvents)?.getContent()
          );
          if (samePins(ids, live)) {
            publishPendingPins(mx, room);
          } else {
            pending.ids = ids;
            pending.expectedEchoIds = undefined;
            emitPinChange(room);
          }
        })
        .catch(() => {
          // Keep the last accepted state until sync or a later successful read.
        });
    };
    const handler = (event: MatrixEvent) => {
      if (event.getType() !== StateEvent.RoomPinnedEvents || event.getStateKey() !== '') return;
      // Keep the latest save visible through older echoes from this client's queue.
      const pending = pendingPins.get(room);
      if (!pending?.accepted || pending.earlierEventIds.has(event.getId() ?? '')) return;
      const eventPins = getPinnedEventIds(event.getContent());
      const expectedUncertainEcho =
        pending.expectedEchoIds && samePins(eventPins, pending.expectedEchoIds);
      if (samePins(eventPins, pending.ids) || expectedUncertainEcho) {
        publishPendingPins(mx, room);
        return;
      }
      // An unknown sync event may itself be delayed. Confirm conflicting state
      // with the server before replacing an accepted local pin.
      verifyPending();
    };
    const handleSync = (state: SyncState, previous: SyncState | null) => {
      if (state !== SyncState.Syncing && state !== SyncState.Prepared) return;
      if (
        pendingPins.get(room)?.expectedEchoIds ||
        previous === SyncState.Error ||
        previous === SyncState.Reconnecting
      )
        verifyPending();
    };
    room.on(RoomStateEvent.Events, handler);
    mx.on(ClientEvent.Sync, handleSync);
    pendingPins.set(room, {
      ...next,
      unsubscribe: () => {
        room.removeListener(RoomStateEvent.Events, handler);
        mx.removeListener(ClientEvent.Sync, handleSync);
      },
    });
    const current = getStateEvent(room, StateEvent.RoomPinnedEvents);
    if (current) handler(current);
  }
  emitPinChange(room);
};

export const isThreadPinned = (room: Room, threadRootId: string): boolean =>
  (getPendingPinnedEventIds(room) ?? livePinnedIds(room)).includes(threadRootId);

const pendingPinWrites = new WeakMap<Room, Promise<void>>();

export const setRoomEventPinned = async (
  mx: MatrixClient,
  room: Room,
  eventId: string,
  pinned: boolean
): Promise<void> => {
  if (!isConfirmedMatrixEventId(eventId)) throw new Error('Only sent messages can be pinned.');
  const assertCanPin = () => {
    const createEvent = getStateEvent(room, StateEvent.RoomCreate);
    const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
    const powerLevels = getPowersLevelFromMatrixEvent(
      getStateEvent(room, StateEvent.RoomPowerLevels)
    );
    if (!canPinRoomEvents(creators, powerLevels, mx.getSafeUserId())) {
      throw new Error('Only room admins can pin or unpin messages.');
    }
  };
  assertCanPin();
  if (pinned) trackQueuedPin(room, eventId, 1);
  // Room pins are one state event. Serialize this client's writes and read the
  // server copy so a successful write is retained even before its sync echo.
  const previous = pendingPinWrites.get(room) ?? Promise.resolve();
  const update = previous
    .catch(() => {})
    .then(async () => {
      const content = await readPinContent(mx, room);
      assertCanPin();
      const current = getPinnedEventIds(content);
      const previousPins = pendingPins.get(room);
      const earlierEventIds = new Set(previousPins?.earlierEventIds);
      if (previousPins?.eventId) earlierEventIds.add(previousPins.eventId);
      const priorLiveId = getStateEvent(room, StateEvent.RoomPinnedEvents)?.getId();
      if (priorLiveId) earlierEventIds.add(priorLiveId);
      if (current.includes(eventId) === pinned) {
        if (previousPins && samePins(current, previousPins.ids)) return;
        publishPendingPins(
          mx,
          room,
          samePins(current, livePinnedIds(room))
            ? undefined
            : {
                ids: current,
                accepted: true,
                earlierEventIds,
              }
        );
        return;
      }
      const next = current.filter((id) => id !== eventId);
      if (pinned) next.push(eventId);
      // A pending unpin must continue blocking resolution until the server accepts it.
      publishPendingPins(mx, room, {
        ids: pinned ? next : current,
        accepted: false,
        earlierEventIds,
      });
      try {
        const result = await mx.sendStateEvent(
          room.roomId,
          EventType.RoomPinnedEvents,
          { ...content, pinned: next },
          ''
        );
        publishPendingPins(mx, room, {
          ids: next,
          accepted: true,
          eventId: result.event_id,
          earlierEventIds,
        });
      } catch (error) {
        // A lost HTTP response can hide a successful save. Verify before rolling
        // back, and retain protection if neither transport can confirm the result.
        let verified: string[] | undefined;
        try {
          verified = getPinnedEventIds(await readPinContent(mx, room));
        } catch {
          // Sync or a later pin attempt will reconcile the uncertain outcome.
        }
        publishPendingPins(mx, room, {
          ids: verified ?? (pinned ? next : current),
          expectedEchoIds: verified ? undefined : next,
          accepted: true,
          earlierEventIds,
        });
        if (verified?.includes(eventId) === pinned) return;
        throw error;
      }
    });
  pendingPinWrites.set(room, update);
  try {
    await update;
  } finally {
    if (pendingPinWrites.get(room) === update) pendingPinWrites.delete(room);
    if (pinned) trackQueuedPin(room, eventId, -1);
  }
};
