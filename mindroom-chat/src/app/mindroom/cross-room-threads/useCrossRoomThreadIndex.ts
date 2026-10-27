import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import { MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { RoomEvent, RoomStateEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { ThreadEvent, type Thread } from 'matrix-js-sdk/lib/models/thread';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useActiveSession } from '../../hooks/useSessionStore';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { makeRecentThreadsAtom } from '../recent-threads/recentThreads';
import {
  ensureThreadSummaryStateLoaded,
  getThreadSummaryStateSnapshot,
  subscribeToThreadSummaryState,
} from '../threads/threadSummaryState';
import { MINDROOM_THREAD_TAGS_EVENT, parsePerTagStateKey } from '../threads/threadTags';
import { getRoomThreadTagSnapshotMap } from '../threads/threadTagSnapshots';
import { StateEvent } from '../../../types/matrix/room';
import { subscribePendingPins } from '../threads/threadPinning';
import {
  applyCrossRoomThreadIndexBatch,
  buildCrossRoomThreadIndexEntry,
  createCrossRoomThreadDirtyCoalescer,
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadRootsForEvent,
  getCrossRoomThreadIndexKey,
  parseCrossRoomThreadIndexKey,
  removeCrossRoomThreadIndexEntry,
  removeRoomCrossRoomThreadIndexEntries,
  type CrossRoomThreadIndexBatchRemoval,
  type CrossRoomThreadIndexEntry,
} from './crossRoomThreadIndex';

const BOOTSTRAP_ROOM_CHUNK_SIZE = 5;

type RoomListenerDisposer = () => void;

type CrossRoomThreadIndexController = {
  syncJoinedRooms: (roomIds: string[]) => void;
};

const requestIdle = (callback: () => void): number => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout: 1500 });
  }

  return globalThis.setTimeout(callback, 0) as unknown as number;
};

const cancelIdle = (handle: number) => {
  if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(handle);
    return;
  }

  globalThis.clearTimeout(handle);
};

const getRoomThreads = (room: Room): Thread[] => {
  const threads = (room as unknown as { getThreads?: () => unknown }).getThreads?.();
  if (!threads) return [];
  if (Array.isArray(threads)) return threads as Thread[];
  if (threads instanceof Map) return Array.from(threads.values()) as Thread[];
  return Array.from(threads as Iterable<Thread>);
};

const getThreadRootId = (thread: Thread): string | undefined =>
  thread.rootEvent?.getId?.() ?? (thread as unknown as { id?: string }).id;

const getThreadRelationRootId = (event: MatrixEvent | undefined): string | undefined => {
  if (!event) return undefined;
  const eventId = event.getId?.();
  const threadRootId = event.threadRootId;
  if (threadRootId && threadRootId !== eventId) return threadRootId;

  const relation = event.getRelation?.();
  const relatedRootId =
    relation?.rel_type === RelationType.Thread && typeof relation.event_id === 'string'
      ? relation.event_id
      : undefined;
  return relatedRootId && relatedRootId !== eventId ? relatedRootId : undefined;
};

const getReplaceRelationTargetId = (event: MatrixEvent | undefined): string | undefined => {
  if (!event) return undefined;

  const relation = event.getRelation?.();
  if (relation?.rel_type === RelationType.Replace && typeof relation.event_id === 'string') {
    return relation.event_id;
  }

  const content = event.getContent?.();
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;

  const contentRelation = (content as Record<string, unknown>)['m.relates_to'];
  if (!contentRelation || typeof contentRelation !== 'object' || Array.isArray(contentRelation)) {
    return undefined;
  }

  const relationRecord = contentRelation as Record<string, unknown>;
  return relationRecord.rel_type === RelationType.Replace &&
    typeof relationRecord.event_id === 'string'
    ? relationRecord.event_id
    : undefined;
};

const MAIN_TIMELINE_RECEIPT_THREAD_ID = 'main';

type OwnReceiptTargets = {
  threadRootIds: string[];
  hasUnthreadedReceipt: boolean;
};

/**
 * Thread unread state derives only from the current user's thread and
 * unthreaded receipts (see getThreadUnread), so receipts from other users
 * and main-timeline receipts never change an index entry. Own receipts with
 * a thread_id affect only that thread; own unthreaded receipts can affect
 * any thread in the room.
 */
const getOwnReceiptTargets = (event: MatrixEvent, userId: string): OwnReceiptTargets => {
  const targets: OwnReceiptTargets = { threadRootIds: [], hasUnthreadedReceipt: false };
  const content = event.getContent?.();
  if (!content || typeof content !== 'object' || Array.isArray(content)) return targets;

  const threadRootIds = new Set<string>();
  Object.values(content as Record<string, unknown>).forEach((receiptsByType) => {
    if (!receiptsByType || typeof receiptsByType !== 'object' || Array.isArray(receiptsByType)) {
      return;
    }
    Object.values(receiptsByType as Record<string, unknown>).forEach((receiptsByUser) => {
      if (!receiptsByUser || typeof receiptsByUser !== 'object' || Array.isArray(receiptsByUser)) {
        return;
      }
      if (!(userId in (receiptsByUser as Record<string, unknown>))) return;

      const ownReceipt = (receiptsByUser as Record<string, unknown>)[userId];
      const threadId =
        ownReceipt && typeof ownReceipt === 'object' && !Array.isArray(ownReceipt)
          ? (ownReceipt as { thread_id?: unknown }).thread_id
          : undefined;
      if (threadId === MAIN_TIMELINE_RECEIPT_THREAD_ID) return;
      if (typeof threadId === 'string') {
        threadRootIds.add(threadId);
        return;
      }

      targets.hasUnthreadedReceipt = true;
    });
  });

  targets.threadRootIds = Array.from(threadRootIds);
  return targets;
};

const isPendingThreadRootEvent = (event: MatrixEvent | undefined): boolean => {
  if (!event) return false;

  const eventId = event.getId?.();
  if (typeof eventId === 'string' && eventId.startsWith('~')) return true;
  if (event.isSending?.() === true) return true;

  const status = (event as unknown as { status?: unknown }).status;
  return status !== undefined && status !== null;
};

const isJoinedTimelineRoom = (room: Room | null | undefined): room is Room =>
  !!room && room.getMyMembership?.() === 'join' && !room.isSpaceRoom?.();

export const useCrossRoomThreadIndex = () => {
  const mx = useMatrixClient();
  const activeSession = useActiveSession();
  const userId = mx.getUserId() ?? activeSession?.userId;
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const recentThreads = useAtomValue(useMemo(() => makeRecentThreadsAtom(userId ?? ''), [userId]));
  const snapshot = useAtomValue(crossRoomThreadIndexAtom);
  const setSnapshot = useSetAtom(crossRoomThreadIndexAtom);
  const parentMapRef = useRef(roomToParents);
  const recentThreadsRef = useRef(recentThreads);
  const sessionIdRef = useRef(activeSession?.sessionId);
  const userIdRef = useRef(userId);
  const joinedRoomIdsRef = useRef(joinedRoomIds);
  const snapshotRef = useRef(snapshot);
  const roomDisposersRef = useRef(new Map<string, RoomListenerDisposer>());
  const controllerRef = useRef<CrossRoomThreadIndexController | undefined>();

  parentMapRef.current = roomToParents;
  recentThreadsRef.current = recentThreads;
  sessionIdRef.current = activeSession?.sessionId;
  userIdRef.current = userId;
  joinedRoomIdsRef.current = joinedRoomIds;
  snapshotRef.current = snapshot;

  useLayoutEffect(() => {
    const emptySnapshot = emptyCrossRoomThreadIndexSnapshot();
    snapshotRef.current = emptySnapshot;
    setSnapshot(emptySnapshot);
  }, [activeSession?.sessionId, mx, setSnapshot, userId]);

  useEffect(() => {
    if (!userId) return undefined;

    let disposed = false;
    let idleHandle: number | undefined;
    const effectSessionId = activeSession?.sessionId;
    const effectUserId = userId;
    const isEffectCurrent = () =>
      !disposed &&
      userIdRef.current === effectUserId &&
      sessionIdRef.current === effectSessionId &&
      (mx.getUserId() ?? effectUserId) === effectUserId;
    const roomDisposers = roomDisposersRef.current;
    const recentRoomOrder = new Map<string, number>();
    recentThreadsRef.current.forEach((entry, index) => {
      if (!recentRoomOrder.has(entry.roomId)) recentRoomOrder.set(entry.roomId, index);
    });

    const buildEntry = (
      roomId: string,
      threadRootId: string,
      roomTagSnapshots: Map<string, ReturnType<typeof getRoomThreadTagSnapshotMap>>
    ) => {
      if (!roomDisposers.has(roomId)) return undefined;

      const room = mx.getRoom(roomId);
      if (!isJoinedTimelineRoom(room)) return undefined;

      const thread = room.getThread(threadRootId);
      if (isPendingThreadRootEvent(thread?.rootEvent ?? room.findEventById(threadRootId))) {
        return undefined;
      }

      const sessionId = sessionIdRef.current;
      const summaryMap = getThreadSummaryStateSnapshot(sessionId, roomId);
      const parents = Array.from(parentMapRef.current.get(roomId) ?? []);
      let tagSnapshots = roomTagSnapshots.get(roomId);
      if (!tagSnapshots) {
        tagSnapshots = getRoomThreadTagSnapshotMap(room);
        roomTagSnapshots.set(roomId, tagSnapshots);
      }

      return buildCrossRoomThreadIndexEntry({
        room,
        threadRootId,
        summaryInfo: summaryMap.get(threadRootId),
        currentUserId: userIdRef.current,
        parentSpaceIds: parents,
        tagSnapshot: tagSnapshots.get(threadRootId) ?? null,
      });
    };

    const flushDirtyKeys = (keys: string[]) => {
      if (!isEffectCurrent()) return;

      setSnapshot((current) => {
        if (!isEffectCurrent()) return current;

        const upserts: CrossRoomThreadIndexEntry[] = [];
        const removals: CrossRoomThreadIndexBatchRemoval[] = [];
        // Scope reuse to this synchronous flush so later state events always win.
        const roomTagSnapshots = new Map<string, ReturnType<typeof getRoomThreadTagSnapshotMap>>();

        keys.forEach((key) => {
          const parsed = parseCrossRoomThreadIndexKey(key);
          if (!parsed) return;

          const entry = buildEntry(parsed.roomId, parsed.threadRootId, roomTagSnapshots);
          if (!entry) {
            removals.push(parsed);
            return;
          }

          upserts.push(entry);
        });

        return applyCrossRoomThreadIndexBatch(current, { upserts, removals });
      });
    };
    const coalescer = createCrossRoomThreadDirtyCoalescer(flushDirtyKeys);

    const enqueueThread = (roomId: string, threadRootId: string | undefined) => {
      if (!isEffectCurrent()) return;
      if (!threadRootId) return;
      if (!roomDisposers.has(roomId)) return;

      const room = mx.getRoom(roomId);
      if (!isJoinedTimelineRoom(room)) return;

      const thread = room.getThread(threadRootId);
      if (isPendingThreadRootEvent(thread?.rootEvent ?? room.findEventById(threadRootId))) {
        return;
      }

      coalescer.enqueueDirty(getCrossRoomThreadIndexKey(roomId, threadRootId));
    };

    const enqueueRoomThreads = (room: Room) => {
      getRoomThreads(room).forEach((thread) => enqueueThread(room.roomId, getThreadRootId(thread)));
    };

    const enqueueTrackedEntriesContainingEventId = (room: Room, eventId: string | undefined) => {
      getCrossRoomThreadRootsForEvent(snapshotRef.current, room.roomId, eventId).forEach(
        (threadRootId) => enqueueThread(room.roomId, threadRootId)
      );
    };

    const enqueueTrackedEntriesContainingEvent = (room: Room, event: MatrixEvent) => {
      enqueueTrackedEntriesContainingEventId(room, event.getId?.());
    };

    const sortRoomsForBootstrap = (rooms: Room[]) =>
      rooms.sort((left, right) => {
        const leftRecent = recentRoomOrder.get(left.roomId) ?? Number.MAX_SAFE_INTEGER;
        const rightRecent = recentRoomOrder.get(right.roomId) ?? Number.MAX_SAFE_INTEGER;
        if (leftRecent !== rightRecent) return leftRecent - rightRecent;
        return (right.getLastActiveTimestamp?.() ?? 0) - (left.getLastActiveTimestamp?.() ?? 0);
      });

    const bootstrapRooms: Room[] = [];
    const bootstrapQueuedRoomIds = new Set<string>();

    const scanRoom = (room: Room) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        ensureThreadSummaryStateLoaded(sessionId, room.roomId).catch(() => {});
      }

      enqueueRoomThreads(room);
    };

    const drainBootstrapQueue = () => {
      if (disposed) return;

      const chunk = bootstrapRooms.splice(0, BOOTSTRAP_ROOM_CHUNK_SIZE);
      chunk.forEach((room) => bootstrapQueuedRoomIds.delete(room.roomId));
      chunk.forEach(scanRoom);

      if (bootstrapRooms.length > 0) {
        idleHandle = requestIdle(drainBootstrapQueue);
        return;
      }

      idleHandle = undefined;
      if (!isEffectCurrent()) return;
      // Land throttled rebuilds first, so views that trust the flag never
      // see the index as complete while scanned threads are still pending.
      coalescer.flushNow();
      setSnapshot((current) =>
        current.bootstrapped ? current : { ...current, bootstrapped: true }
      );
    };

    const scheduleRoomBootstrap = (rooms: Room[]) => {
      const newRooms = rooms.filter((room) => {
        if (bootstrapQueuedRoomIds.has(room.roomId)) return false;
        bootstrapQueuedRoomIds.add(room.roomId);
        return true;
      });
      if (newRooms.length === 0) return;

      bootstrapRooms.push(...sortRoomsForBootstrap(newRooms));
      if (idleHandle === undefined) {
        idleHandle = requestIdle(drainBootstrapQueue);
      }
    };

    const addRoomListeners = (room: Room) => {
      if (roomDisposers.has(room.roomId)) return;

      const handleThread = (thread: Thread, ...args: unknown[]) => {
        const event = args.find(
          (candidate): candidate is MatrixEvent =>
            !!candidate && typeof candidate === 'object' && 'getId' in candidate
        );
        enqueueThread(room.roomId, getThreadRootId(thread) ?? getThreadRelationRootId(event));
      };
      const handleThreadDelete = (thread: Thread, ...args: unknown[]) => {
        const event = args.find(
          (candidate): candidate is MatrixEvent =>
            !!candidate && typeof candidate === 'object' && 'getId' in candidate
        );
        const threadRootId = getThreadRootId(thread) ?? getThreadRelationRootId(event);
        if (!threadRootId || !isEffectCurrent()) return;
        // Drop the rebuild queued before the delete; a later update still re-adds it.
        coalescer.discardDirty(getCrossRoomThreadIndexKey(room.roomId, threadRootId));

        setSnapshot((current) => {
          if (!isEffectCurrent()) return current;
          return removeCrossRoomThreadIndexEntry(current, room.roomId, threadRootId);
        });
      };
      const handleReceipt = (event: MatrixEvent) => {
        const currentUserId = userIdRef.current;
        if (!currentUserId) return;

        const { threadRootIds, hasUnthreadedReceipt } = getOwnReceiptTargets(event, currentUserId);
        if (hasUnthreadedReceipt) {
          enqueueRoomThreads(room);
          return;
        }

        threadRootIds.forEach((threadRootId) => enqueueThread(room.roomId, threadRootId));
      };
      const handleTimeline = (event: MatrixEvent) => {
        const threadRootId = getThreadRelationRootId(event);
        if (threadRootId) {
          enqueueThread(room.roomId, threadRootId);
          return;
        }

        const relation = event.getRelation?.();
        const editedThreadRootId =
          relation?.rel_type === RelationType.Replace && typeof relation.event_id === 'string'
            ? relation.event_id
            : undefined;
        if (editedThreadRootId) {
          if (
            snapshotRef.current.entries.has(
              getCrossRoomThreadIndexKey(room.roomId, editedThreadRootId)
            )
          ) {
            enqueueThread(room.roomId, editedThreadRootId);
            return;
          }

          enqueueTrackedEntriesContainingEventId(room, editedThreadRootId);
        }
      };

      room.on(RoomEvent.Receipt, handleReceipt);
      room.on(RoomEvent.Timeline, handleTimeline);
      room.on(RoomEvent.LocalEchoUpdated, handleTimeline);
      room.on(ThreadEvent.New, handleThread);
      room.on(ThreadEvent.Update, handleThread);
      room.on(ThreadEvent.NewReply, handleThread);
      room.on(ThreadEvent.Delete, handleThreadDelete);

      const sessionId = sessionIdRef.current;
      let lastSummaryMap = getThreadSummaryStateSnapshot(sessionId, room.roomId);
      const handleSummaryStateChange = () => {
        const previousSummaryMap = lastSummaryMap;
        const nextSummaryMap = getThreadSummaryStateSnapshot(sessionId, room.roomId);
        lastSummaryMap = nextSummaryMap;
        if (nextSummaryMap === previousSummaryMap) return;

        nextSummaryMap.forEach((info, threadRootId) => {
          const previousInfo = previousSummaryMap.get(threadRootId);
          if (
            previousInfo &&
            previousInfo.summaryText === info?.summaryText &&
            previousInfo.generatedTs === info?.generatedTs &&
            previousInfo.messageCount === info?.messageCount
          ) {
            return;
          }

          enqueueThread(room.roomId, threadRootId);
        });
        previousSummaryMap.forEach((_info, threadRootId) => {
          if (!nextSummaryMap.has(threadRootId)) enqueueThread(room.roomId, threadRootId);
        });
      };
      const unsubscribeSummaryState = sessionId
        ? subscribeToThreadSummaryState(sessionId, room.roomId, handleSummaryStateChange)
        : undefined;

      roomDisposers.set(room.roomId, () => {
        room.removeListener(RoomEvent.Receipt, handleReceipt);
        room.removeListener(RoomEvent.Timeline, handleTimeline);
        room.removeListener(RoomEvent.LocalEchoUpdated, handleTimeline);
        room.removeListener(ThreadEvent.New, handleThread);
        room.removeListener(ThreadEvent.Update, handleThread);
        room.removeListener(ThreadEvent.NewReply, handleThread);
        room.removeListener(ThreadEvent.Delete, handleThreadDelete);
        unsubscribeSummaryState?.();
      });
    };

    const removeRoomFromIndex = (roomId: string) => {
      setSnapshot((current) => removeRoomCrossRoomThreadIndexEntries(current, roomId));
    };

    const removeRoomListeners = (roomId: string) => {
      const dispose = roomDisposers.get(roomId);
      if (!dispose) return;
      roomDisposers.delete(roomId);
      dispose();
    };

    const syncJoinedRooms = (roomIds: string[]) => {
      if (!isEffectCurrent()) return;

      const nextRoomIds = new Set(
        roomIds
          .map((roomId) => mx.getRoom(roomId))
          .filter(isJoinedTimelineRoom)
          .map((room) => room.roomId)
      );

      Array.from(roomDisposers.keys()).forEach((roomId) => {
        if (nextRoomIds.has(roomId)) return;
        removeRoomListeners(roomId);
        bootstrapQueuedRoomIds.delete(roomId);
        for (let index = bootstrapRooms.length - 1; index >= 0; index -= 1) {
          if (bootstrapRooms[index].roomId === roomId) bootstrapRooms.splice(index, 1);
        }
        removeRoomFromIndex(roomId);
      });

      const addedRooms = roomIds
        .map((roomId) => mx.getRoom(roomId))
        .filter(isJoinedTimelineRoom)
        .filter((room) => !roomDisposers.has(room.roomId));
      addedRooms.forEach(addRoomListeners);
      const shouldScanAddedRoomsImmediately = snapshotRef.current.bootstrapped;
      if (shouldScanAddedRoomsImmediately) {
        addedRooms.forEach(scanRoom);
      } else {
        scheduleRoomBootstrap(addedRooms);
      }
      if (nextRoomIds.size === 0 && bootstrapRooms.length === 0 && idleHandle === undefined) {
        setSnapshot((current) =>
          current.bootstrapped ? current : { ...current, bootstrapped: true }
        );
      }
    };

    controllerRef.current = { syncJoinedRooms };
    syncJoinedRooms(joinedRoomIdsRef.current);

    const handleMembership = (room: Room) => {
      if (room.getMyMembership?.() === 'join') {
        syncJoinedRooms(joinedRoomIdsRef.current);
        enqueueRoomThreads(room);
        return;
      }

      removeRoomListeners(room.roomId);
      removeRoomFromIndex(room.roomId);
    };

    const handlePinChange = (room: Room) => {
      if (mx.getRoom(room.roomId) !== room || !roomDisposers.has(room.roomId)) return;
      enqueueRoomThreads(room);
      snapshotRef.current.entries.forEach((entry) => {
        if (entry.roomId === room.roomId) enqueueThread(room.roomId, entry.threadRootId);
      });
    };
    const unsubscribePendingPins = subscribePendingPins(handlePinChange);

    const handleStateEvent = (event: MatrixEvent, roomState: { roomId?: string }) => {
      const type = event.getType();
      if (type !== MINDROOM_THREAD_TAGS_EVENT && type !== StateEvent.RoomPinnedEvents) return;
      const roomId =
        roomState?.roomId ?? (event as unknown as { getRoomId?: () => string }).getRoomId?.();
      if (!roomId) return;

      const room = mx.getRoom(roomId);
      if (!room) return;
      if (!roomDisposers.has(room.roomId)) return;

      if (type === StateEvent.RoomPinnedEvents) {
        handlePinChange(room);
      } else {
        const stateKey = event.getStateKey();
        if (typeof stateKey !== 'string') return;
        enqueueThread(room.roomId, parsePerTagStateKey(stateKey)?.threadRootId ?? stateKey);
      }
    };

    const handleDecrypted = (event: MatrixEvent) => {
      const roomId = (event as unknown as { getRoomId?: () => string }).getRoomId?.();
      const room = roomId ? mx.getRoom(roomId) : undefined;
      if (!room) return;
      if (!roomDisposers.has(room.roomId)) return;

      enqueueThread(room.roomId, getThreadRelationRootId(event));
      const editedThreadRootId = getReplaceRelationTargetId(event);
      if (
        editedThreadRootId &&
        snapshotRef.current.entries.has(getCrossRoomThreadIndexKey(room.roomId, editedThreadRootId))
      ) {
        enqueueThread(room.roomId, editedThreadRootId);
      } else if (editedThreadRootId) {
        enqueueTrackedEntriesContainingEventId(room, editedThreadRootId);
      }
      enqueueTrackedEntriesContainingEvent(room, event);
    };

    mx.on(RoomEvent.MyMembership, handleMembership);
    mx.on(RoomStateEvent.Events, handleStateEvent);
    mx.on(MatrixEventEvent.Decrypted, handleDecrypted);

    return () => {
      disposed = true;
      if (idleHandle !== undefined) cancelIdle(idleHandle);
      coalescer.clear();
      unsubscribePendingPins();
      if (controllerRef.current?.syncJoinedRooms === syncJoinedRooms) {
        controllerRef.current = undefined;
      }
      Array.from(roomDisposers.keys()).forEach(removeRoomListeners);
      mx.removeListener(RoomEvent.MyMembership, handleMembership);
      mx.removeListener(RoomStateEvent.Events, handleStateEvent);
      mx.removeListener(MatrixEventEvent.Decrypted, handleDecrypted);
    };
  }, [activeSession?.sessionId, mx, setSnapshot, userId]);

  useEffect(() => {
    controllerRef.current?.syncJoinedRooms(joinedRoomIds);
  }, [joinedRoomIds]);

  return snapshot;
};
