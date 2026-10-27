import { describe, expect, it } from 'vitest';
import { createDefaultThreadFilterState, type ThreadFilterState } from './roomThreadOverviewModel';
import type { ThreadRecord } from './types';
import { resolveMindroomThreadIndexSnapshot } from './useMindroomThreadIndex';

const makeFilterState = (overrides: Partial<ThreadFilterState> = {}): ThreadFilterState => ({
  ...createDefaultThreadFilterState(),
  sortBy: 'natural',
  tags: new Map(),
  ...overrides,
});

const makeRecord = (threadRootId: string, overrides: Partial<ThreadRecord> = {}): ThreadRecord => ({
  roomId: '!room:example.org',
  threadRootId,
  rootEventId: threadRootId,
  absoluteIndex: 0,
  presentation: {
    summaryInfo: undefined,
    summaryText: threadRootId,
    rootPreviewText: undefined,
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 0,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: threadRootId,
    recentThreadSummaryText: threadRootId,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 0,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    lastActivityTs: undefined,
    tags: [],
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  ...overrides,
});

describe('resolveMindroomThreadIndexSnapshot', () => {
  it('selects the compact record map and derives counts from the active root set', () => {
    const normalRecord = makeRecord('$normal', {
      status: {
        ...makeRecord('$normal').status,
        isResolved: true,
        tags: ['normal'],
      },
    });
    const compactRecord = makeRecord('$compact', {
      status: {
        ...makeRecord('$compact').status,
        isUnread: true,
        tags: ['compact'],
      },
    });

    const snapshot = resolveMindroomThreadIndexSnapshot({
      threadId: undefined,
      compactViewRequested: true,
      visibleThreadRootIds: ['$normal'],
      compactThreadRootIds: ['$compact'],
      pinnedThreadRootIds: ['$compact'],
      normalThreadRecordMap: new Map([['$normal', normalRecord]]),
      compactThreadRecordMap: new Map([['$compact', compactRecord]]),
      threadFilterState: makeFilterState({ resolved: 'include' }),
      liveThreadFilterState: makeFilterState(),
      fallbackThreadFilterState: makeFilterState(),
      searchQuery: '',
      threadSortFreezeState: null,
      threadSortControlSignature: 'normal',
      focusedRoomOverviewRequested: false,
      focusedRoomOverviewRootId: undefined,
    });

    expect(snapshot.showCompactRoomView).toBe(true);
    expect(snapshot.threadRecordMap.get('$compact')).toBe(compactRecord);
    expect(snapshot.overviewThreadRootIds).toEqual(['$compact']);
    expect(snapshot.statusCounts).toMatchObject({ unread: 1, resolved: 0 });
    expect(snapshot.tagCounts).toEqual({ compact: 1 });
  });

  it('bypasses filtered overview state for a focused room route that is filtered out', () => {
    const fallbackThreadFilterState = makeFilterState();
    const filteredState = makeFilterState({ resolved: 'include' });

    const snapshot = resolveMindroomThreadIndexSnapshot({
      threadId: undefined,
      compactViewRequested: false,
      visibleThreadRootIds: ['$root'],
      compactThreadRootIds: [],
      normalThreadRecordMap: new Map([['$root', makeRecord('$root')]]),
      compactThreadRecordMap: new Map(),
      threadFilterState: filteredState,
      liveThreadFilterState: filteredState,
      fallbackThreadFilterState,
      searchQuery: '',
      threadSortFreezeState: null,
      threadSortControlSignature: 'filtered',
      focusedRoomOverviewRequested: true,
      focusedRoomOverviewRootId: '$root',
    });

    expect(snapshot.normalOverviewOrdering.filteredIds).toEqual([]);
    expect(snapshot.focusedRoomOverviewBypass).toBe(true);
    expect(snapshot.effectiveThreadFilterState).toBe(fallbackThreadFilterState);
    expect(snapshot.roomThreadFilterRequested).toBe(true);
    expect(snapshot.roomThreadFilterActive).toBe(false);
    expect(snapshot.overviewThreadRootIds).toEqual([]);
  });
});
