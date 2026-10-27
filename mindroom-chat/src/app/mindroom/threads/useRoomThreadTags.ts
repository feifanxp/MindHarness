import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useEffect, useMemo } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useStateEvents } from './useStateEvents';
import {
  type TagMetadata,
  isThreadResolved,
  MINDROOM_THREAD_TAGS_EVENT,
  type ThreadTagsContent,
} from './threadTags';
import { buildThreadTagSnapshotMap, type ThreadTagSnapshot } from './threadTagSnapshots';
import {
  clearPendingThreadTagsContent,
  getPendingThreadTagsContentMap,
  sameThreadTagsContent,
  usePendingThreadTagsVersion,
} from './threadTagPending';
import { useMutateThreadTags } from './useMutateThreadTags';
import { usePinnedEventIds } from './useThreadPinning';

// ─── Resolution state types ─────────────────────────────────────────────────

export type ThreadResolutionState = {
  event?: MatrixEvent;
  tags: Record<string, TagMetadata> | null;
  isResolved: boolean;
  isPending: boolean;
};

const unresolvedState: ThreadResolutionState = {
  tags: null,
  isResolved: false,
  isPending: false,
};
const baseResolutionMapCache = new WeakMap<MatrixEvent[], Map<string, ThreadResolutionState>>();

// ─── Internal helpers ────────────────────────────────────────────────────────

const getThreadResolutionState = (snapshot?: ThreadTagSnapshot): ThreadResolutionState => {
  if (snapshot && Object.keys(snapshot.content.tags).length > 0) {
    return {
      event: undefined,
      tags: snapshot.content.tags,
      isResolved: snapshot.isResolved,
      isPending: false,
    };
  }

  return unresolvedState;
};

const getBaseResolutionMap = (events: MatrixEvent[]): Map<string, ThreadResolutionState> => {
  const cached = baseResolutionMapCache.get(events);
  if (cached) {
    return cached;
  }

  const snapshots = buildThreadTagSnapshotMap(events);
  const map = new Map<string, ThreadResolutionState>();
  snapshots.forEach((snapshot, threadRootId) => {
    map.set(threadRootId, getThreadResolutionState(snapshot));
  });

  baseResolutionMapCache.set(events, map);
  return map;
};

const applyPending = (
  state: ThreadResolutionState,
  pending?: ThreadTagsContent
): ThreadResolutionState => {
  if (!pending) return state;
  const tags = Object.keys(pending.tags).length > 0 ? pending.tags : null;
  return {
    ...state,
    tags,
    isResolved: isThreadResolved(pending),
    isPending: true,
  };
};

// ─── Hooks (pending version) ────────────────────────────────────────────────

const usePendingVersion = usePendingThreadTagsVersion;

// ─── Public hooks ───────────────────────────────────────────────────────────

export const useThreadResolution = (room: Room, threadRootId?: string): ThreadResolutionState => {
  const resolutionMap = useRoomThreadResolutionMap(room);

  return useMemo(
    () => (threadRootId ? resolutionMap.get(threadRootId) ?? unresolvedState : unresolvedState),
    [resolutionMap, threadRootId]
  );
};

export const useRoomThreadResolutionMap = (room: Room): Map<string, ThreadResolutionState> => {
  const events = useStateEvents(room, MINDROOM_THREAD_TAGS_EVENT);
  const pinnedEventIds = usePinnedEventIds(room);
  const pVersion = usePendingVersion();
  const pendingMap = useMemo(
    () => getPendingThreadTagsContentMap(room.roomId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.roomId, pVersion]
  );

  const resolutionMap = useMemo(() => {
    return getBaseResolutionMap(events);
  }, [events]);

  useEffect(() => {
    pendingMap.forEach((pend, threadRootId) => {
      const actual = resolutionMap.get(threadRootId);
      const actualContent = { tags: actual?.tags ?? {} };
      if (sameThreadTagsContent(actualContent, pend)) {
        clearPendingThreadTagsContent(room.roomId, threadRootId);
      }
    });
  }, [pendingMap, resolutionMap, room.roomId]);

  return useMemo(() => {
    if (pendingMap.size === 0 && pinnedEventIds.length === 0) return resolutionMap;

    const next = new Map<string, ThreadResolutionState>(resolutionMap);
    pendingMap.forEach((pend, threadRootId) => {
      const current = next.get(threadRootId) ?? unresolvedState;
      next.set(threadRootId, applyPending(current, pend));
    });
    pinnedEventIds.forEach((threadRootId) => {
      const current = next.get(threadRootId);
      if (current?.isResolved) next.set(threadRootId, { ...current, isResolved: false });
    });
    return next;
  }, [pendingMap, resolutionMap, pinnedEventIds]);
};

export const useToggleThreadResolution = (room: Room) => {
  const { setResolved, updating, updatingThreadRootIds, error } = useMutateThreadTags(room);
  const mx = useMatrixClient();
  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const canToggle = permissions.stateEvent(MINDROOM_THREAD_TAGS_EVENT, mx.getSafeUserId());

  return {
    canToggle,
    setResolved,
    updating,
    updatingThreadRootIds,
    error: error ?? undefined,
  };
};
