import { describe, expect, it } from 'vitest';
import { buildThreadHeaderViewModelFromRecord } from './threadHeaderViewModel';
import type { ThreadRecord } from './types';

const basePresentation: ThreadRecord['presentation'] = {
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
};

const baseStatus: ThreadRecord['status'] = {
  isKnownThreadRoot: true,
  replyCount: 0,
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  scheduledTaskCount: 0,
  nextScheduledTs: undefined,
  lastActivityTs: undefined,
  tags: [],
};

const makeRecord = (overrides: Partial<ThreadRecord> = {}): ThreadRecord => ({
  roomId: '!room:example.org',
  threadRootId: '$thread',
  rootEventId: '$thread',
  absoluteIndex: 0,
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  ...overrides,
  presentation: {
    ...basePresentation,
    ...overrides.presentation,
  },
  status: {
    ...baseStatus,
    ...overrides.status,
  },
});

describe('buildThreadHeaderViewModelFromRecord', () => {
  it('uses the ThreadRecord presentation and status snapshots for banner copy', () => {
    const record = makeRecord({
      presentation: {
        summaryText: 'Live summary',
      },
      status: {
        isResolved: true,
        scheduledTaskCount: 1,
        nextScheduledTs: Date.parse('2026-04-04T18:03:00.000Z'),
        tags: ['bug', 'triage'],
      },
    });

    expect(
      buildThreadHeaderViewModelFromRecord({
        record,
        scheduledDisplayText: 'in 3m',
        canEdit: true,
        availableTags: ['feature'],
        pickerDisabled: false,
      })
    ).toEqual({
      summaryText: 'Live summary',
      displayTags: ['bug', 'triage'],
      isResolved: true,
      canEdit: true,
      availableTags: ['feature'],
      pickerDisabled: false,
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:03:00.000Z'),
      scheduledDisplayText: 'in 3m',
      scheduledLabel: '1 pending scheduled task, in 3m',
      bannerScheduledText: 'in 3m',
    });
  });

  it('uses scheduled fallback copy when no next scheduled timestamp exists', () => {
    const record = makeRecord({
      status: {
        scheduledTaskCount: 2,
      },
    });

    const model = buildThreadHeaderViewModelFromRecord({
      record,
      scheduledDisplayText: '2 scheduled tasks',
      canEdit: false,
      availableTags: [],
      pickerDisabled: true,
    });

    expect(model.scheduledLabel).toBe('2 pending scheduled tasks');
    expect(model.bannerScheduledText).toBe('2 scheduled tasks');
  });

  it('uses one recurring schedule description as display detail', () => {
    const record = makeRecord({
      status: {
        scheduledTaskCount: 1,
        cronDescription: 'At 09:00',
      },
    });

    const model = buildThreadHeaderViewModelFromRecord({
      record,
      scheduledDisplayText: 'At 09:00',
      canEdit: false,
      availableTags: [],
      pickerDisabled: true,
    });

    expect(model.scheduledLabel).toBe('1 pending scheduled task, At 09:00');
    expect(model.bannerScheduledText).toBe('At 09:00');
  });

  it('prefixes scheduled-only countdown copy with Next task', () => {
    const record = makeRecord({
      status: {
        scheduledTaskCount: 2,
        nextScheduledTs: Date.parse('2026-04-04T18:12:00.000Z'),
      },
    });

    const model = buildThreadHeaderViewModelFromRecord({
      record,
      scheduledDisplayText: 'in 12m',
      canEdit: false,
      availableTags: [],
      pickerDisabled: true,
    });

    expect(model.scheduledLabel).toBe('2 pending scheduled tasks, in 12m');
    expect(model.bannerScheduledText).toBe('Next task in 12m');
  });
});
