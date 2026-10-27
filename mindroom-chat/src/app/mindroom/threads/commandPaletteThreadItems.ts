import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { type MatrixClient, type Room } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { StateEvent } from '../../../types/matrix/room';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import type { CommandPaletteThreadItem } from '../command-palette/commandPaletteTypes';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberDisplayName } from '../../utils/room';
import { makeRecentThreadsAtom, type RecentThreadItem } from '../recent-threads/recentThreads';
import { getResolvedRecentThreadRootId } from '../recent-threads/recentThreadSummaryUtils';
import { buildCommandPaletteThreadViewModelFromRecord } from './commandPaletteThreadViewModel';
import { buildThreadRecord } from './threadRecord';
import { resolveCanonicalThreadRootId } from './threadRouteUtils';
import { getResolvableThreadRootEvent } from './threadResolvableRoot';
import {
  buildPerTagEventContent,
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
  isThreadResolved,
} from './threadTags';
import { getRoomThreadTagSnapshotMap, type ThreadTagSnapshot } from './threadTagSnapshots';
import { getPendingPinsVersion, isThreadPinned, subscribePendingPins } from './threadPinning';

type MindroomCommandPaletteThreadItem = CommandPaletteThreadItem & { onSelect: () => void };

type UseMindroomCommandPaletteThreadItemsOptions = {
  mx: MatrixClient;
  myUserId: string;
  allJoinedRoomIds: readonly string[];
  getRoom: (roomId: string) => Room | undefined;
  selectedRoom?: Room | undefined;
  selectedRoomId?: string | undefined;
  currentThreadId?: string | undefined;
  navigateRoomThread: (roomId: string, threadId: string) => void;
};

const fireAndForget = <T>(promise: Promise<T>) => {
  promise.catch(() => undefined);
};

const mapUserDisplayName = (room: Room, userId: string): string =>
  getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;

export const buildThreadResolutionFromTagSnapshot = (
  tagSnapshot: ThreadTagSnapshot | undefined,
  pinned = false
): { isResolved: boolean; tags: Record<string, unknown> | null } | undefined => {
  if (!tagSnapshot) return undefined;

  return {
    isResolved: isThreadResolved(tagSnapshot.content, pinned),
    tags: Object.fromEntries(tagSnapshot.displayTags.map((tagName) => [tagName, true])),
  };
};

export const resolveCommandPaletteCurrentThreadRootId = (
  selectedRoom: Room | undefined,
  currentThreadId: string | undefined
): string | undefined =>
  selectedRoom && currentThreadId
    ? resolveCanonicalThreadRootId(selectedRoom, currentThreadId) ?? currentThreadId
    : undefined;

export const mergeCommandPaletteThreadItems = (
  left: CommandPaletteThreadItem,
  right: CommandPaletteThreadItem
): CommandPaletteThreadItem => ({
  ...left,
  ...right,
  summaryText:
    left.isFallbackSummary ?? left.summaryText === 'Thread'
      ? right.summaryText
      : right.isFallbackSummary ?? right.summaryText === 'Thread'
      ? left.summaryText
      : right.summaryText,
  isFallbackSummary:
    (left.isFallbackSummary ?? left.summaryText === 'Thread') &&
    (right.isFallbackSummary ?? right.summaryText === 'Thread'),
  participantNames:
    right.participantNames && right.participantNames.length > 0
      ? right.participantNames
      : left.participantNames,
  tags: right.tags && right.tags.length > 0 ? right.tags : left.tags,
  isResolved: right.isResolved ?? left.isResolved,
  messageCount: right.messageCount ?? left.messageCount,
  sortRank: Math.max(left.sortRank ?? 0, right.sortRank ?? 0),
  boost: Math.max(left.boost ?? 0, right.boost ?? 0),
});

const toCommandPaletteThreadItem = (
  viewModel: ReturnType<typeof buildCommandPaletteThreadViewModelFromRecord>,
  onSelect: () => void
): MindroomCommandPaletteThreadItem => ({
  id: `${viewModel.id.roomId}|${viewModel.id.threadRootId}`,
  kind: 'thread',
  roomId: viewModel.id.roomId,
  threadId: viewModel.id.threadRootId,
  summaryText: viewModel.summaryText,
  isFallbackSummary: viewModel.isFallbackSummary,
  roomName: viewModel.roomName,
  participantNames: viewModel.participantNames,
  tags: viewModel.tags,
  isResolved: viewModel.isResolved,
  messageCount: viewModel.messageCount,
  sortRank: viewModel.sortRank,
  boost: viewModel.boost,
  onSelect,
});

const buildRecentThreadItem = ({
  entry,
  room,
  threadTagSnapshots,
  selectedRoomId,
  canonicalSelectedThreadId,
  navigateRoomThread,
  t,
}: {
  entry: RecentThreadItem;
  room: Room;
  threadTagSnapshots: Map<string, ReadonlyMap<string, ThreadTagSnapshot>>;
  selectedRoomId?: string | undefined;
  canonicalSelectedThreadId?: string | undefined;
  navigateRoomThread: (roomId: string, threadId: string) => void;
  t: TFunction;
}): MindroomCommandPaletteThreadItem => {
  const threadRootId = getResolvedRecentThreadRootId(room, entry.threadId);
  const rootEvent = room.findEventById(threadRootId) ?? room.getThread(threadRootId)?.rootEvent;
  const tagSnapshot = threadTagSnapshots.get(room.roomId)?.get(threadRootId);
  const record = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent: rootEvent,
    threadResolution: buildThreadResolutionFromTagSnapshot(
      tagSnapshot,
      isThreadPinned(room, threadRootId)
    ),
  });
  const viewModel = buildCommandPaletteThreadViewModelFromRecord({
    t,
    record,
    roomName: room.name,
    getParticipantName: (userId) => mapUserDisplayName(room, userId),
    fallbackSummaryText: entry.summaryText,
    sortRank: entry.openedAt,
    boost:
      (room.roomId === selectedRoomId ? 10 : 0) +
      (threadRootId === canonicalSelectedThreadId ? 30 : 0) +
      (tagSnapshot && !record.status.isResolved ? 10 : 0),
  });

  return toCommandPaletteThreadItem(viewModel, () => navigateRoomThread(room.roomId, threadRootId));
};

const buildSdkThreadItem = ({
  room,
  threadId,
  threadTagSnapshots,
  selectedRoomId,
  canonicalSelectedThreadId,
  navigateRoomThread,
  t,
}: {
  room: Room;
  threadId: string;
  threadTagSnapshots: Map<string, ReadonlyMap<string, ThreadTagSnapshot>>;
  selectedRoomId?: string | undefined;
  canonicalSelectedThreadId?: string | undefined;
  navigateRoomThread: (roomId: string, threadId: string) => void;
  t: TFunction;
}): MindroomCommandPaletteThreadItem => {
  const threadRootId = resolveCanonicalThreadRootId(room, threadId) ?? threadId;
  const rootEvent = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadRootId);
  const tagSnapshot = threadTagSnapshots.get(room.roomId)?.get(threadRootId);
  const record = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent: rootEvent,
    threadResolution: buildThreadResolutionFromTagSnapshot(
      tagSnapshot,
      isThreadPinned(room, threadRootId)
    ),
  });
  const viewModel = buildCommandPaletteThreadViewModelFromRecord({
    t,
    record,
    roomName: room.name,
    getParticipantName: (userId) => mapUserDisplayName(room, userId),
    boost:
      (room.roomId === selectedRoomId ? 10 : 0) +
      (threadRootId === canonicalSelectedThreadId ? 30 : 0) +
      (tagSnapshot && !record.status.isResolved ? 10 : 0),
  });

  return toCommandPaletteThreadItem(viewModel, () => navigateRoomThread(room.roomId, threadRootId));
};

export const useMindroomCommandPaletteThreadItems = ({
  mx,
  myUserId,
  allJoinedRoomIds,
  getRoom,
  selectedRoom,
  selectedRoomId,
  currentThreadId,
  navigateRoomThread,
}: UseMindroomCommandPaletteThreadItemsOptions): {
  currentThreadRootId: string | undefined;
  currentThreadResolved: boolean;
  currentThreadPinned: boolean;
  setCurrentThreadResolved: (resolved: boolean) => void;
  threadItems: readonly MindroomCommandPaletteThreadItem[];
} => {
  const { t } = useTranslation();
  const recentThreadsAtom = useMemo(() => makeRecentThreadsAtom(myUserId), [myUserId]);
  const recentThreads = useAtomValue(recentThreadsAtom);
  const [resolutionVersion, refreshResolution] = useForceUpdate();
  useStateEventCallback(
    mx,
    useCallback(
      (event) => {
        if (
          event.getType() === MINDROOM_THREAD_TAGS_EVENT ||
          event.getType() === StateEvent.RoomPinnedEvents
        )
          refreshResolution();
      },
      [refreshResolution]
    )
  );
  const pendingPinsVersion = useSyncExternalStore(
    subscribePendingPins,
    getPendingPinsVersion,
    getPendingPinsVersion
  );
  const currentThreadRootId = useMemo(
    () => resolveCommandPaletteCurrentThreadRootId(selectedRoom, currentThreadId),
    [currentThreadId, selectedRoom]
  );

  const threadTagSnapshots = useMemo(() => {
    void resolutionVersion;
    void pendingPinsVersion;
    const snapshots = new Map<string, ReadonlyMap<string, ThreadTagSnapshot>>();

    allJoinedRoomIds.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room) return;
      snapshots.set(room.roomId, getRoomThreadTagSnapshotMap(room));
    });

    return snapshots;
  }, [allJoinedRoomIds, getRoom, resolutionVersion, pendingPinsVersion]);

  const currentThreadPinned =
    !!selectedRoom && !!currentThreadRootId && isThreadPinned(selectedRoom, currentThreadRootId);
  const currentThreadResolved = useMemo(() => {
    if (!selectedRoom || !currentThreadRootId || currentThreadPinned) return false;

    return (
      threadTagSnapshots.get(selectedRoom.roomId)?.get(currentThreadRootId)?.isResolved ?? false
    );
  }, [currentThreadRootId, currentThreadPinned, selectedRoom, threadTagSnapshots]);

  const setCurrentThreadResolved = useCallback(
    (resolved: boolean) => {
      if (!selectedRoom || !currentThreadRootId) return;

      const rootEvent = getResolvableThreadRootEvent(selectedRoom, currentThreadRootId);
      const threadRootId = rootEvent?.getId();
      if (!threadRootId || isThreadPinned(selectedRoom, threadRootId)) return;

      fireAndForget(
        mx.sendStateEvent(
          selectedRoom.roomId,
          MINDROOM_THREAD_TAGS_EVENT as any,
          resolved ? buildPerTagEventContent(myUserId) : {},
          buildPerTagStateKey(threadRootId, RESOLVED_TAG)
        )
      );
    },
    [currentThreadRootId, mx, myUserId, selectedRoom]
  );

  const threadItems = useMemo(() => {
    const items = new Map<string, MindroomCommandPaletteThreadItem>();

    const upsert = (item: MindroomCommandPaletteThreadItem) => {
      const existing = items.get(item.id);
      if (!existing) {
        items.set(item.id, item);
        return;
      }

      items.set(item.id, {
        ...mergeCommandPaletteThreadItems(existing, item),
        onSelect: item.onSelect,
      });
    };

    recentThreads.forEach((entry) => {
      const room = getRoom(entry.roomId);
      if (!room) return;

      upsert(
        buildRecentThreadItem({
          entry,
          room,
          threadTagSnapshots,
          selectedRoomId,
          canonicalSelectedThreadId: currentThreadRootId,
          navigateRoomThread,
          t,
        })
      );
    });

    allJoinedRoomIds.forEach((roomId) => {
      const room = getRoom(roomId);
      if (!room || typeof room.getThreads !== 'function') return;

      room.getThreads().forEach((thread) => {
        upsert(
          buildSdkThreadItem({
            room,
            threadId: thread.id,
            threadTagSnapshots,
            selectedRoomId,
            canonicalSelectedThreadId: currentThreadRootId,
            navigateRoomThread,
            t,
          })
        );
      });
    });

    return Array.from(items.values());
  }, [
    allJoinedRoomIds,
    currentThreadRootId,
    getRoom,
    navigateRoomThread,
    recentThreads,
    selectedRoomId,
    threadTagSnapshots,
    t,
  ]);

  return {
    currentThreadRootId,
    currentThreadResolved,
    currentThreadPinned,
    setCurrentThreadResolved,
    threadItems,
  };
};
