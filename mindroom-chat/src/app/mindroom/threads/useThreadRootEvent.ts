import { useEffect, useReducer, useRef } from 'react';
import { Room, RoomEvent, RoomEventHandlerMap, ThreadEvent } from 'matrix-js-sdk';
import { isThreadRouteReady, resolveCanonicalThreadRootId } from './threadRouteUtils';

/**
 * Resolve the canonical thread root event ID from a threadId.
 *
 * The threadId passed via URL may be a reply event ID rather than the actual
 * thread root. This hook resolves to the canonical root by checking the SDK
 * thread model and event metadata.
 *
 * Returns undefined only when threadId is undefined.
 * When threadId is defined, always returns a string (falls back to threadId itself).
 */
export const useThreadRootEvent = (
  room: Room,
  threadId: string | undefined
): string | undefined => {
  const [, bumpRootIdVersion] = useReducer((version: number) => version + 1, 0);
  const rootId = resolveCanonicalThreadRootId(room, threadId);
  const rootIdRef = useRef(rootId);
  rootIdRef.current = rootId;
  const routeKnown = isThreadRouteReady(room, threadId);
  const routeKnownRef = useRef(routeKnown);
  routeKnownRef.current = routeKnown;

  useEffect(() => {
    if (!threadId) return undefined;

    const refreshRootId = () => {
      const nextRootId = resolveCanonicalThreadRootId(room, threadId);
      const nextRouteKnown = isThreadRouteReady(room, threadId);
      if (rootIdRef.current === nextRootId && routeKnownRef.current === nextRouteKnown) return;

      // Consumers can safely enable thread actions when a previously unknown
      // route arrives, even when its canonical ID is unchanged.
      routeKnownRef.current = nextRouteKnown;
      rootIdRef.current = nextRootId;
      bumpRootIdVersion();
    };

    const handleTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (
      _event,
      eventRoom,
      _toStartOfTimeline,
      removed
    ) => {
      if (removed || eventRoom?.roomId !== room.roomId) return;
      refreshRootId();
    };
    const handleLocalEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (
      event,
      eventRoom,
      oldEventId
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      // This hook only canonicalizes the currently open thread route.
      // RoomEvent.LocalEchoUpdated fires for every local echo in the room; if we
      // react to unrelated reply sends, we can retarget the open thread URL from
      // the real root to a reply event and blank the thread view.
      if (!oldEventId || oldEventId !== threadId) return;

      const canonicalEventId = event.getId();
      const nextRootId =
        resolveCanonicalThreadRootId(room, canonicalEventId ?? undefined) ??
        resolveCanonicalThreadRootId(room, oldEventId) ??
        canonicalEventId ??
        threadId;
      if (rootIdRef.current === nextRootId) return;

      rootIdRef.current = nextRootId;
      bumpRootIdVersion();
    };

    room.on(RoomEvent.Timeline, handleTimeline);
    room.on(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    room.on(ThreadEvent.New, refreshRootId);
    room.on(ThreadEvent.Update, refreshRootId);
    room.on(ThreadEvent.NewReply, refreshRootId);
    room.on(ThreadEvent.Delete, refreshRootId);

    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimeline);
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEcho);
      room.removeListener(ThreadEvent.New, refreshRootId);
      room.removeListener(ThreadEvent.Update, refreshRootId);
      room.removeListener(ThreadEvent.NewReply, refreshRootId);
      room.removeListener(ThreadEvent.Delete, refreshRootId);
    };
  }, [room, threadId]);

  return rootId;
};
