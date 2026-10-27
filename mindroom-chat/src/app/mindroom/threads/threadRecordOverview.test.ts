import { describe, expect, it } from 'vitest';
import type { ThreadFilterState, ThreadSortFreezeState } from './roomThreadOverviewModel';
import type { ThreadRecord } from './types';
import {
  computeThreadRecordStatusCounts,
  computeThreadRecordTagCounts,
  matchesThreadRecordFilterState,
  resolveThreadRecordOverviewRootIds,
} from './threadRecordOverview';

describe('pinned announcement ordering', () => {
  it('keeps pins above filtered threads in pin order without duplicates', () => {
    const recordMap = new Map([
      ['$old', makeRecord('$old')],
      ['$new', makeRecord('$new')],
      ['$normal', makeRecord('$normal')],
    ]);
    const result = resolveThreadRecordOverviewRootIds({
      threadRootIds: ['$normal', '$old', '$new'],
      pinnedThreadRootIds: ['$new', '$old', '$missing', '$new'],
      threadFilterState: makeDefaultState({ resolved: 'include' }),
      searchQuery: '',
      recordMap,
      threadSortFreezeState: { controlSignature: 'frozen', orderedRootIds: ['$old', '$new'] },
      threadSortControlSignature: 'frozen',
    });
    expect(result.filteredIds).toEqual(['$new', '$old']);
    expect(result.displayOrderedIds).toEqual(['$new', '$old']);
  });
});

const makeDefaultState = (overrides: Partial<ThreadFilterState> = {}): ThreadFilterState => ({
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'natural',
  sortDirection: 'desc',
  tags: new Map(),
  freeText: '',
  unsupportedQuery: '',
  statusMode: 'and',
  ...overrides,
});

const makeRecord = (threadRootId: string, overrides: Partial<ThreadRecord> = {}): ThreadRecord => ({
  roomId: '!room:server',
  threadRootId,
  rootEventId: threadRootId,
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: undefined,
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 0,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: undefined,
    recentThreadSummaryText: undefined,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 0,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    lastActivityTs: 0,
    tags: [],
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  absoluteIndex: 0,
  ...overrides,
});

const records = new Map<string, ThreadRecord>([
  [
    '$resolved-idle',
    makeRecord('$resolved-idle', {
      status: {
        isKnownThreadRoot: true,
        replyCount: 0,
        isResolved: true,
        isUnread: false,
        isStreaming: false,
        scheduledTaskCount: 0,
        lastActivityTs: 100,
        tags: ['resolved', 'priority'],
      },
      absoluteIndex: 0,
      presentation: {
        ...makeRecord('$resolved-idle').presentation,
        summaryText: 'Done summary',
        rootPreviewText: 'Original question',
      },
    }),
  ],
  [
    '$unresolved-unread',
    makeRecord('$unresolved-unread', {
      status: {
        isKnownThreadRoot: true,
        replyCount: 2,
        isResolved: false,
        isUnread: true,
        isStreaming: false,
        scheduledTaskCount: 0,
        lastActivityTs: 200,
        tags: ['blocked'],
      },
      absoluteIndex: 1,
      presentation: {
        ...makeRecord('$unresolved-unread').presentation,
        summaryText: 'Deploy pipeline',
        rootPreviewText: 'Build failed',
      },
    }),
  ],
  [
    '$streaming',
    makeRecord('$streaming', {
      status: {
        isKnownThreadRoot: true,
        replyCount: 1,
        isResolved: false,
        isUnread: false,
        isStreaming: true,
        scheduledTaskCount: 0,
        lastActivityTs: 300,
        tags: [],
      },
      absoluteIndex: 2,
      presentation: {
        ...makeRecord('$streaming').presentation,
        summaryText: 'Agent is working',
      },
    }),
  ],
  [
    '$scheduled',
    makeRecord('$scheduled', {
      status: {
        isKnownThreadRoot: true,
        replyCount: 1,
        isResolved: false,
        isUnread: false,
        isStreaming: false,
        scheduledTaskCount: 2,
        lastActivityTs: 150,
        tags: ['priority'],
      },
      absoluteIndex: 3,
    }),
  ],
]);

describe('threadRecordOverview selectors', () => {
  it('filters, searches, sorts, and applies frozen order from ThreadRecord', () => {
    const threadRootIds = ['$resolved-idle', '$unresolved-unread', '$streaming', '$scheduled'];
    const frozenState: ThreadSortFreezeState = {
      controlSignature: 'same-controls',
      orderedRootIds: ['$streaming', '$unresolved-unread'],
    };

    expect(
      resolveThreadRecordOverviewRootIds({
        threadRootIds,
        threadFilterState: makeDefaultState({
          resolved: 'exclude',
          streaming: 'include',
          scheduled: 'include',
          unread: 'include',
          statusMode: 'or',
          sortBy: 'lastReply',
        }),
        searchQuery: '',
        recordMap: records,
        threadSortFreezeState: frozenState,
        threadSortControlSignature: 'same-controls',
      })
    ).toEqual({
      filteredIds: ['$unresolved-unread', '$streaming', '$scheduled'],
      liveOrderedIds: ['$streaming', '$unresolved-unread', '$scheduled'],
      displayOrderedIds: ['$streaming', '$unresolved-unread', '$scheduled'],
    });

    expect(
      resolveThreadRecordOverviewRootIds({
        threadRootIds,
        threadFilterState: makeDefaultState({ tags: new Map([['priority', 'include']]) }),
        searchQuery: 'question',
        recordMap: records,
        threadSortFreezeState: null,
        threadSortControlSignature: 'changed',
      }).filteredIds
    ).toEqual(['$resolved-idle']);
  });

  it('computes status and tag counts from ThreadRecord status snapshots', () => {
    const threadRootIds = ['$resolved-idle', '$unresolved-unread', '$streaming', '$scheduled'];

    expect(computeThreadRecordStatusCounts(threadRootIds, records)).toEqual({
      resolved: 1,
      streaming: 1,
      scheduled: 1,
      unread: 1,
      idle: 1,
    });
    expect(computeThreadRecordTagCounts(threadRootIds, records)).toEqual({
      resolved: 1,
      priority: 2,
      blocked: 1,
    });
  });

  it('applies OR status filters, hard exclusions, and tag filters from ThreadRecord', () => {
    expect(
      matchesThreadRecordFilterState(
        makeRecord('$streaming-priority', {
          status: {
            isKnownThreadRoot: true,
            replyCount: 1,
            isResolved: false,
            isUnread: false,
            isStreaming: true,
            scheduledTaskCount: 0,
            tags: ['priority'],
          },
        }),
        makeDefaultState({
          streaming: 'include',
          scheduled: 'include',
          resolved: 'exclude',
          tags: new Map([['priority', 'include']]),
          statusMode: 'or',
        })
      )
    ).toBe(true);

    expect(
      matchesThreadRecordFilterState(
        makeRecord('$resolved-streaming-priority', {
          status: {
            isKnownThreadRoot: true,
            replyCount: 1,
            isResolved: true,
            isUnread: false,
            isStreaming: true,
            scheduledTaskCount: 0,
            tags: ['priority'],
          },
        }),
        makeDefaultState({
          streaming: 'include',
          scheduled: 'include',
          resolved: 'exclude',
          tags: new Map([['priority', 'include']]),
          statusMode: 'or',
        })
      )
    ).toBe(false);

    expect(
      matchesThreadRecordFilterState(
        makeRecord('$streaming-no-tag', {
          status: {
            isKnownThreadRoot: true,
            replyCount: 1,
            isResolved: false,
            isUnread: false,
            isStreaming: true,
            scheduledTaskCount: 0,
            tags: [],
          },
        }),
        makeDefaultState({
          streaming: 'include',
          scheduled: 'include',
          tags: new Map([['priority', 'include']]),
          statusMode: 'or',
        })
      )
    ).toBe(false);
  });
});
