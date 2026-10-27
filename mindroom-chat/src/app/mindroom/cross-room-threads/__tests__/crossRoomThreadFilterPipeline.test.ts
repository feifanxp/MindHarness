import { describe, expect, it } from 'vitest';
import type { CrossRoomThreadIndexEntry } from '../crossRoomThreadIndex';
import {
  applyCrossRoomThreadFilters,
  isCrossRoomThreadEntryEligible,
} from '../crossRoomThreadFilterPipeline';
import { DEFAULT_CROSS_ROOM_THREAD_FILTERS } from '../crossRoomThreadFilters';

const now = Date.UTC(2026, 4, 6, 12, 0, 0);

const makeEntry = (
  threadRootId: string,
  overrides: Partial<CrossRoomThreadIndexEntry> = {}
): CrossRoomThreadIndexEntry =>
  ({
    key: `!room:example.org\u0000${threadRootId}`,
    roomId: '!room:example.org',
    roomName: 'Room',
    parentSpaceIds: [],
    threadRootId,
    threadRecord: {
      status: {
        hasPendingSend: false,
        replyCount: 1,
      },
    } as CrossRoomThreadIndexEntry['threadRecord'],
    lastActivityTs: now,
    isUnread: false,
    isResolved: false,
    hasAttention: false,
    isInvolved: true,
    summaryText: 'summary',
    rootPreviewText: 'root',
    searchableText: 'root summary',
    tags: [],
    generation: 0,
    ...overrides,
  } as CrossRoomThreadIndexEntry);

describe('crossRoomThreadFilterPipeline', () => {
  it('excludes viewed zero-reply roots while retaining replied and pending threads', () => {
    const entries = [
      makeEntry('$viewed-root', {
        threadRecord: {
          status: { hasPendingSend: false, replyCount: 0 },
        } as CrossRoomThreadIndexEntry['threadRecord'],
      }),
      makeEntry('$replied'),
      makeEntry('$pending', {
        threadRecord: {
          status: { hasPendingSend: true, replyCount: 0 },
        } as CrossRoomThreadIndexEntry['threadRecord'],
      }),
    ];

    expect(
      entries.filter(isCrossRoomThreadEntryEligible).map((entry) => entry.threadRootId)
    ).toEqual(['$replied', '$pending']);
  });

  it('applies each structured filter axis', () => {
    const entries = [
      makeEntry('$a', {
        roomId: '!a:example.org',
        parentSpaceIds: ['!space:example.org'],
        tags: ['urgent'],
        isUnread: true,
        hasAttention: true,
      }),
      makeEntry('$b', {
        roomId: '!b:example.org',
        parentSpaceIds: ['!other:example.org'],
        tags: ['done'],
        isUnread: false,
        isResolved: true,
        isInvolved: false,
      }),
    ];

    const result = applyCrossRoomThreadFilters(
      entries,
      {
        ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
        scope: 'all',
        roomIds: ['!a:example.org'],
        spaceIds: ['!space:example.org'],
        tag: { include: ['urgent'], exclude: ['done'] },
        unreadOnly: true,
        resolved: 'unresolved',
        hasAttention: true,
      },
      { now }
    );

    expect(result.map((entry) => entry.threadRootId)).toEqual(['$a']);
  });

  it('defaults to involved threads and the 7d activity window', () => {
    const old = now - 8 * 24 * 60 * 60 * 1000;
    const entries = [
      makeEntry('$active-involved'),
      makeEntry('$not-involved', { isInvolved: false }),
      makeEntry('$old', { lastActivityTs: old }),
    ];

    expect(
      applyCrossRoomThreadFilters(entries, DEFAULT_CROSS_ROOM_THREAD_FILTERS, { now }).map(
        (entry) => entry.threadRootId
      )
    ).toEqual(['$active-involved']);
  });

  it('searches only the precomputed root and summary haystack', () => {
    const entries = [
      makeEntry('$root-match', {
        searchableText: 'root-token summary',
      }),
      makeEntry('$reply-only', {
        searchableText: 'root summary',
        rootPreviewText: 'root',
        summaryText: 'summary',
      }),
    ];

    expect(
      applyCrossRoomThreadFilters(
        entries,
        { ...DEFAULT_CROSS_ROOM_THREAD_FILTERS, query: 'root-token' },
        { now }
      ).map((entry) => entry.threadRootId)
    ).toEqual(['$root-match']);

    expect(
      applyCrossRoomThreadFilters(
        entries,
        { ...DEFAULT_CROSS_ROOM_THREAD_FILTERS, query: 'reply-only-secret-token' },
        { now }
      )
    ).toEqual([]);
  });

  it('sorts by activity first, then unread attention and stable ties', () => {
    const entries = [
      makeEntry('$c', { roomName: 'Beta', lastActivityTs: now, isUnread: false }),
      makeEntry('$a', { roomName: 'Alpha', lastActivityTs: now, isUnread: false }),
      makeEntry('$old-unread', {
        roomName: 'Alpha',
        lastActivityTs: now - 1,
        isUnread: true,
        hasAttention: true,
      }),
      makeEntry('$unread', { roomName: 'Alpha', lastActivityTs: now, isUnread: true }),
    ];

    expect(
      applyCrossRoomThreadFilters(
        entries,
        { ...DEFAULT_CROSS_ROOM_THREAD_FILTERS, activityWindow: 'all' },
        { now }
      ).map((entry) => entry.threadRootId)
    ).toEqual(['$unread', '$a', '$c', '$old-unread']);
  });
});
