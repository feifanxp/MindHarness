import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  getActiveThreadSummaryInfo,
  useThreadSummaryPublishController,
} from './threadSummaryPublishController';

const makeSummaryEvent = (summaryText: string, generatedAt: string, messageCount: number) =>
  ({
    getContent: () => ({
      msgtype: 'm.notice',
      body: summaryText,
      'io.mindroom.thread_summary': {
        version: 1,
        summary: summaryText,
        generated_at: generatedAt,
        message_count: messageCount,
      },
    }),
  } as never);

const SummaryPublishHarness = ({
  onStoreThreadSummary,
  threadId,
}: {
  onStoreThreadSummary: ReturnType<typeof vi.fn>;
  threadId: string;
}) => {
  useThreadSummaryPublishController({
    onStoreThreadSummary,
    room: { getThread: () => null },
    thread: null,
    threadEvents: [makeSummaryEvent('Summary', '2026-01-01T00:00:00Z', 1)],
    threadId,
    threadSummaryInfoMap: new Map(),
  });
  return null;
};

describe('getActiveThreadSummaryInfo', () => {
  it('returns undefined outside a thread route', () => {
    expect(
      getActiveThreadSummaryInfo({
        thread: null,
        threadEvents: [makeSummaryEvent('Summary', '2026-01-01T00:00:00Z', 1)],
        threadId: undefined,
      })
    ).toBeUndefined();
  });

  it('does not publish summaries under a local-echo route id', () => {
    const onStoreThreadSummary = vi.fn();

    act(() => {
      create(
        React.createElement(SummaryPublishHarness, {
          onStoreThreadSummary,
          threadId: '~!room:example.org:txn-root',
        })
      );
    });

    expect(onStoreThreadSummary).not.toHaveBeenCalled();
  });

  it('selects the newest summary from active thread sources', () => {
    const older = makeSummaryEvent('Older summary', '2026-01-01T00:00:00Z', 1);
    const newer = makeSummaryEvent('Newer summary', '2026-01-02T00:00:00Z', 2);

    expect(
      getActiveThreadSummaryInfo({
        thread: {
          events: [older],
          timeline: [],
        } as never,
        threadEvents: [newer],
        threadId: '$thread',
      })
    ).toEqual({
      generatedTs: Date.parse('2026-01-02T00:00:00Z'),
      messageCount: 2,
      summaryText: 'Newer summary',
    });
  });
});
