import { describe, expect, it } from 'vitest';
import { MessageEvent } from '../../../types/matrix/room';
import { resolveThreadOverviewRefreshTargets } from './threadOverviewRefreshTargets';
import type { TimelineEventEntry } from './roomTimelineEvents';

const makeEvent = (eventId: string, isThreadRoot = true, msgtype = 'm.text') =>
  ({
    getId: () => eventId,
    getContent: () => ({ body: eventId, msgtype }),
    getRelation: () => undefined,
    getTs: () => 1,
    getType: () => MessageEvent.RoomMessage,
    isRedacted: () => false,
    isThreadRoot,
    threadRootId: undefined,
  }) as never;

const makeEntry = (
  eventId: string,
  absoluteIndex: number,
  isThreadRoot = true,
  msgtype = 'm.text'
): TimelineEventEntry => ({
  absoluteIndex,
  event: makeEvent(eventId, isThreadRoot, msgtype),
});

const room = {
  getThread: () => null,
} as never;

describe('resolveThreadOverviewRefreshTargets', () => {
  it('combines visible range roots with overview roots and preserves order', () => {
    const targets = resolveThreadOverviewRefreshTargets({
      activeTimelineRange: { start: 1, end: 3 },
      compactFilteredThreadRootIds: ['$compact'],
      filteredThreadRootIds: ['$older', '$visible', '$newer'],
      limit: 4,
      room,
      showCompactRoomView: false,
      threadFilteredEventEntries: [
        makeEntry('$before', 0),
        makeEntry('$visible', 1),
        makeEntry('$notice', 2, false, 'm.notice'),
        makeEntry('$after', 3),
      ],
      threadId: undefined,
      threadReplyCountMap: new Map([['$message', 0]]),
      threadResolutionMap: new Map(),
    });

    expect(targets.visibleThreadSummaryRefreshIds).toEqual(['$visible']);
    expect(targets.overviewResumeRefreshIds).toEqual(['$visible', '$older', '$newer']);
  });

  it('uses compact ordering when compact view is active', () => {
    const targets = resolveThreadOverviewRefreshTargets({
      activeTimelineRange: { start: 0, end: 1 },
      compactFilteredThreadRootIds: ['$compact-a', '$compact-b'],
      filteredThreadRootIds: ['$normal'],
      limit: 3,
      room,
      showCompactRoomView: true,
      threadFilteredEventEntries: [makeEntry('$visible', 0)],
      threadId: undefined,
      threadReplyCountMap: new Map(),
      threadResolutionMap: new Map(),
    });

    expect(targets.overviewResumeRefreshIds).toEqual([
      '$visible',
      '$compact-a',
      '$compact-b',
    ]);
  });

  it('returns no room-overview refresh targets while inside a thread', () => {
    const targets = resolveThreadOverviewRefreshTargets({
      activeTimelineRange: { start: 0, end: 1 },
      compactFilteredThreadRootIds: ['$compact'],
      filteredThreadRootIds: ['$normal'],
      limit: 3,
      room,
      showCompactRoomView: true,
      threadFilteredEventEntries: [makeEntry('$visible', 0)],
      threadId: '$thread',
      threadReplyCountMap: new Map(),
      threadResolutionMap: new Map(),
    });

    expect(targets).toEqual({
      visibleThreadSummaryRefreshIds: [],
      overviewResumeRefreshIds: [],
    });
  });
});
