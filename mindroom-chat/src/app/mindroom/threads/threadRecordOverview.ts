import {
  applyFrozenThreadOrder,
  matchesTagFilters,
  matchesTriState,
  THREAD_FILTER_KEYS,
  type StatusCounts,
  type ThreadFilterKey,
  type ThreadFilterState,
  type ThreadSortFreezeState,
} from './roomThreadOverviewModel';
import type { ThreadRecord } from './types';

const getThreadRecordDimension = (record: ThreadRecord, key: ThreadFilterKey): boolean => {
  switch (key) {
    case 'resolved':
      return record.status.isResolved;
    case 'streaming':
      return record.status.isStreaming;
    case 'scheduled':
      return record.status.scheduledTaskCount > 0;
    case 'unread':
      return record.status.isUnread;
    case 'idle':
      return (
        !record.status.isStreaming &&
        record.status.scheduledTaskCount === 0 &&
        record.status.isResolved
      );
    default:
      return false;
  }
};

const hasStatusOrTagFilters = (state: ThreadFilterState): boolean =>
  THREAD_FILTER_KEYS.some((key) => state[key] !== 'any') || state.tags.size > 0;

export const matchesThreadRecordFilterState = (
  record: ThreadRecord,
  state: ThreadFilterState
): boolean => {
  if (state.statusMode === 'or') {
    for (const key of THREAD_FILTER_KEYS) {
      if (state[key] === 'exclude' && getThreadRecordDimension(record, key)) return false;
    }

    const includeKeys = THREAD_FILTER_KEYS.filter((key) => state[key] === 'include');
    if (includeKeys.length > 0) {
      return (
        includeKeys.some((key) => getThreadRecordDimension(record, key)) &&
        matchesTagFilters(record.status.tags, state.tags)
      );
    }

    return matchesTagFilters(record.status.tags, state.tags);
  }

  for (const key of THREAD_FILTER_KEYS) {
    if (!matchesTriState(getThreadRecordDimension(record, key), state[key])) return false;
  }

  return matchesTagFilters(record.status.tags, state.tags);
};

export const filterThreadRecordRootIds = (
  threadRootIds: string[],
  state: ThreadFilterState,
  recordMap: ReadonlyMap<string, ThreadRecord>
): string[] => {
  if (!hasStatusOrTagFilters(state)) return threadRootIds;

  return threadRootIds.filter((threadRootId) => {
    const record = recordMap.get(threadRootId);
    if (!record) return false;
    return matchesThreadRecordFilterState(record, state);
  });
};

export const filterThreadRecordsBySearch = (
  threadRootIds: string[],
  searchQuery: string | undefined,
  recordMap: ReadonlyMap<string, ThreadRecord>
): string[] => {
  const query = (searchQuery ?? '').trim().toLowerCase();
  if (!query) return threadRootIds;

  return threadRootIds.filter((threadRootId) => {
    const record = recordMap.get(threadRootId);
    if (!record) return false;

    return (
      record.presentation.summaryText?.toLowerCase().includes(query) ||
      record.presentation.rootPreviewText?.toLowerCase().includes(query)
    );
  });
};

export const sortThreadRecordRootIds = (
  threadRootIds: string[],
  sortBy: 'natural' | 'lastReply',
  sortDirection: 'asc' | 'desc',
  recordMap: ReadonlyMap<string, ThreadRecord>
): string[] => {
  if (sortBy === 'natural') return threadRootIds;

  return [...threadRootIds].sort((aId, bId) => {
    const a = recordMap.get(aId);
    const b = recordMap.get(bId);
    if (!a || !b) return 0;

    const aLastActivityTs = a.status.lastActivityTs ?? 0;
    const bLastActivityTs = b.status.lastActivityTs ?? 0;
    const diff =
      sortDirection === 'asc'
        ? aLastActivityTs - bLastActivityTs
        : bLastActivityTs - aLastActivityTs;

    return diff !== 0 ? diff : a.absoluteIndex - b.absoluteIndex;
  });
};

export const resolveThreadRecordOverviewRootIds = ({
  threadRootIds,
  pinnedThreadRootIds = [],
  threadFilterState,
  searchQuery,
  recordMap,
  threadSortFreezeState,
  threadSortControlSignature,
}: {
  threadRootIds: string[];
  pinnedThreadRootIds?: string[];
  threadFilterState: ThreadFilterState;
  searchQuery: string;
  recordMap: ReadonlyMap<string, ThreadRecord>;
  threadSortFreezeState: ThreadSortFreezeState | null;
  threadSortControlSignature: string;
}): {
  filteredIds: string[];
  liveOrderedIds: string[];
  displayOrderedIds: string[];
} => {
  const pins = [...new Set(pinnedThreadRootIds)].filter((id) => threadRootIds.includes(id));
  const prependPins = (ids: string[]) => [...pins, ...ids.filter((id) => !pins.includes(id))];
  const filteredIds = prependPins(
    filterThreadRecordsBySearch(
      filterThreadRecordRootIds(threadRootIds, threadFilterState, recordMap),
      searchQuery,
      recordMap
    )
  );
  const liveOrderedIds = prependPins(
    sortThreadRecordRootIds(
      filteredIds,
      threadFilterState.sortBy,
      threadFilterState.sortDirection,
      recordMap
    )
  );
  const displayOrderedIds =
    threadSortFreezeState && threadSortFreezeState.controlSignature === threadSortControlSignature
      ? prependPins(applyFrozenThreadOrder(threadSortFreezeState.orderedRootIds, liveOrderedIds))
      : liveOrderedIds;

  return {
    filteredIds,
    liveOrderedIds,
    displayOrderedIds,
  };
};

export const computeThreadRecordStatusCounts = (
  threadRootIds: string[],
  recordMap: ReadonlyMap<string, ThreadRecord>
): StatusCounts => {
  const counts: StatusCounts = { resolved: 0, streaming: 0, scheduled: 0, unread: 0, idle: 0 };

  threadRootIds.forEach((threadRootId) => {
    const record = recordMap.get(threadRootId);
    if (!record) return;

    THREAD_FILTER_KEYS.forEach((key) => {
      if (getThreadRecordDimension(record, key)) counts[key]++;
    });
  });

  return counts;
};

export const computeThreadRecordTagCounts = (
  threadRootIds: string[],
  recordMap: ReadonlyMap<string, ThreadRecord>
): Record<string, number> => {
  const counts: Record<string, number> = {};

  threadRootIds.forEach((threadRootId) => {
    const record = recordMap.get(threadRootId);
    if (!record) return;

    record.status.tags.forEach((tag) => {
      counts[tag] = (counts[tag] ?? 0) + 1;
    });
  });

  return counts;
};
