import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ThreadRecord } from './types';
import { buildThreadBadgeViewModelFromRecord } from './threadBadgeViewModel';

const makeRecord = (overrides: Partial<ThreadRecord> = {}): ThreadRecord => ({
  roomId: '!room:server',
  threadRootId: '$root',
  rootEventId: '$root',
  absoluteIndex: 0,
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: 'Root body',
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 3,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: undefined,
    recentThreadSummaryText: 'Root body',
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 3,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    tags: [],
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  ...overrides,
});

describe('buildThreadBadgeViewModelFromRecord', () => {
  it('does not build thread records inside badge view-model helpers', () => {
    const source = readFileSync(new URL('./threadBadgeViewModel.ts', import.meta.url), 'utf8');
    const recordBuilderName = ['build', 'Thread', 'Record'].join('');

    expect(source).not.toContain(recordBuilderName);
  });

  it('maps canonical record presentation and status into the badge model', () => {
    const summaryInfo: MindroomThreadSummaryInfo = {
      summaryText: 'Newer cached summary',
      messageCount: 4,
      generatedTs: 2000,
    };

    const model = buildThreadBadgeViewModelFromRecord({
      record: makeRecord({
        presentation: {
          ...makeRecord().presentation,
          summaryInfo,
          recentThreadSummaryText: 'Newer cached summary',
          replyParticipantIds: ['@agent:server'],
        },
        status: {
          ...makeRecord().status,
          isResolved: true,
        },
      }),
    });

    expect(model).toEqual({
      id: {
        roomId: '!room:server',
        threadRootId: '$root',
      },
      summaryInfo,
      recentThreadSummaryText: 'Newer cached summary',
      replyCount: 3,
      participantIds: ['@agent:server'],
      isResolved: true,
    });
  });

  it('keeps canonical zero-reply roots renderable', () => {
    const model = buildThreadBadgeViewModelFromRecord({
      record: makeRecord({
        status: {
          ...makeRecord().status,
          replyCount: 0,
        },
        presentation: {
          ...makeRecord().presentation,
          recentThreadSummaryText: 'Standalone root body',
        },
      }),
    });

    expect(model?.replyCount).toBe(0);
    expect(model?.recentThreadSummaryText).toBe('Standalone root body');
  });

  it('does not build a badge for unknown thread roots', () => {
    expect(
      buildThreadBadgeViewModelFromRecord({
        record: makeRecord({
          status: {
            ...makeRecord().status,
            isKnownThreadRoot: false,
          },
        }),
      })
    ).toBeUndefined();
  });

  it('does not build a badge while already rendering a thread view', () => {
    expect(
      buildThreadBadgeViewModelFromRecord({
        record: makeRecord(),
        activeThreadId: '$root',
      })
    ).toBeUndefined();
  });

  it('does not build a badge for events that are already thread replies', () => {
    expect(
      buildThreadBadgeViewModelFromRecord({
        record: makeRecord({ threadRootId: '$reply' }),
        eventThreadRootId: '$root',
      })
    ).toBeUndefined();
  });
});
