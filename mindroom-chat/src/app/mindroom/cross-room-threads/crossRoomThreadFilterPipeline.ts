import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';
import { normalizeThreadSearchText } from './crossRoomThreadIndex';
import type {
  CrossRoomThreadActivityWindow,
  CrossRoomThreadFilters,
} from './crossRoomThreadFilters';

export type ApplyCrossRoomThreadFiltersOptions = {
  now?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const getActivityCutoff = (
  activityWindow: CrossRoomThreadActivityWindow,
  now: number
): number | undefined => {
  if (activityWindow === 'all') return undefined;
  if (activityWindow === 'today') {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return today.getTime();
  }
  if (activityWindow === '7d') return now - 7 * DAY_MS;
  return now - 30 * DAY_MS;
};

const hasAny = (left: string[], right: string[]): boolean =>
  left.some((item) => right.includes(item));

const getEntryTags = (entry: CrossRoomThreadIndexEntry): string[] =>
  entry.tagSnapshot?.displayTags ?? entry.tags;

const compareBooleanDesc = (left: boolean, right: boolean): number =>
  left === right ? 0 : left ? -1 : 1;

export const isCrossRoomThreadEntryEligible = (entry: CrossRoomThreadIndexEntry): boolean =>
  entry.threadRecord.status.replyCount > 0 || entry.threadRecord.status.hasPendingSend === true;

export const compareCrossRoomThreadEntries = (
  left: CrossRoomThreadIndexEntry,
  right: CrossRoomThreadIndexEntry
): number => {
  const activityDiff = right.lastActivityTs - left.lastActivityTs;
  if (activityDiff !== 0) return activityDiff;

  const unreadDiff = compareBooleanDesc(left.isUnread, right.isUnread);
  if (unreadDiff !== 0) return unreadDiff;

  const attentionDiff = compareBooleanDesc(left.hasAttention, right.hasAttention);
  if (attentionDiff !== 0) return attentionDiff;

  const resolvedDiff = compareBooleanDesc(!left.isResolved, !right.isResolved);
  if (resolvedDiff !== 0) return resolvedDiff;

  const roomDiff = left.roomName.localeCompare(right.roomName);
  if (roomDiff !== 0) return roomDiff;

  return left.threadRootId.localeCompare(right.threadRootId);
};

export const applyCrossRoomThreadFilters = (
  entries: Iterable<CrossRoomThreadIndexEntry>,
  filters: CrossRoomThreadFilters,
  { now = Date.now() }: ApplyCrossRoomThreadFiltersOptions = {}
): CrossRoomThreadIndexEntry[] => {
  const activityCutoff = getActivityCutoff(filters.activityWindow, now);
  const normalizedQuery = normalizeThreadSearchText(filters.query);
  const includeTags = filters.tag.include;
  const excludeTags = filters.tag.exclude;

  return Array.from(entries)
    .filter((entry) => filters.scope === 'all' || entry.isInvolved)
    .filter((entry) => activityCutoff === undefined || entry.lastActivityTs >= activityCutoff)
    .filter((entry) => filters.roomIds.length === 0 || filters.roomIds.includes(entry.roomId))
    .filter(
      (entry) => filters.spaceIds.length === 0 || hasAny(entry.parentSpaceIds, filters.spaceIds)
    )
    .filter((entry) => {
      const entryTags = getEntryTags(entry);
      return (
        includeTags.every((tag) => entryTags.includes(tag)) &&
        excludeTags.every((tag) => !entryTags.includes(tag))
      );
    })
    .filter((entry) => !filters.unreadOnly || entry.isUnread)
    .filter((entry) => {
      if (filters.resolved === 'all') return true;
      return filters.resolved === 'resolved' ? entry.isResolved : !entry.isResolved;
    })
    .filter((entry) => !filters.hasAttention || entry.hasAttention)
    .filter((entry) => !normalizedQuery || entry.searchableText.includes(normalizedQuery))
    .sort(compareCrossRoomThreadEntries);
};
