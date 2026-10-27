import { describe, expect, it } from 'vitest';
import { buildCommandPaletteThreadViewModelFromRecord } from './commandPaletteThreadViewModel';
import type { ThreadRecord } from './types';

const makeRecord = (overrides: Partial<ThreadRecord> = {}): ThreadRecord => ({
  roomId: '!room:example.org',
  threadRootId: '$thread',
  rootEventId: '$thread',
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
    lastActivityTs: undefined,
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

describe('buildCommandPaletteThreadViewModelFromRecord', () => {
  it('projects command-palette thread facts from a ThreadRecord', () => {
    const viewModel = buildCommandPaletteThreadViewModelFromRecord({
      record: makeRecord({
        presentation: {
          ...makeRecord().presentation,
          recentThreadSummaryText: 'Record summary',
          messageCount: 4,
          participantIds: ['@alice:example.org', '@bob:example.org'],
        },
        status: {
          ...makeRecord().status,
          isResolved: true,
          tags: ['urgent'],
          lastActivityTs: 456,
        },
      }),
      roomName: 'General',
      getParticipantName: (userId) => userId.split(':')[0].slice(1),
      boost: 10,
    });

    expect(viewModel).toEqual({
      id: {
        roomId: '!room:example.org',
        threadRootId: '$thread',
      },
      summaryText: 'Record summary',
      isFallbackSummary: false,
      roomName: 'General',
      participantNames: ['alice', 'bob'],
      tags: ['urgent'],
      isResolved: true,
      messageCount: 4,
      sortRank: 456,
      boost: 10,
    });
  });

  it('uses the stored fallback only when the ThreadRecord has no presentation text', () => {
    const viewModel = buildCommandPaletteThreadViewModelFromRecord({
      record: makeRecord(),
      roomName: 'General',
      getParticipantName: (userId) => userId,
      fallbackSummaryText: 'Stored summary',
    });

    expect(viewModel.summaryText).toBe('Stored summary');
    expect(viewModel.isFallbackSummary).toBe(false);
  });

  it('falls back to the generic Thread label as a last resort', () => {
    const viewModel = buildCommandPaletteThreadViewModelFromRecord({
      record: makeRecord(),
      roomName: 'General',
      getParticipantName: (userId) => userId,
    });

    expect(viewModel.summaryText).toBe('Thread');
    expect(viewModel.isFallbackSummary).toBe(true);
  });
});
