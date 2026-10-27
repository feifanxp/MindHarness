import type { ReactElement, ReactNode } from 'react';
import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ThreadBadgeRenderer } from './ThreadBadgeRenderer';
import type { ThreadBadgeViewModel } from './types';

vi.mock('./ThreadIndicator', () => ({
  ThreadIndicator: 'thread-indicator',
}));

vi.mock('../messages/MindroomThreadSummaryCard', () => ({
  MindroomThreadSummaryCard: 'mindroom-thread-summary-card',
}));

const findElementInNode = (
  node: ReactNode,
  predicate: (element: ReactElement) => boolean
): ReactElement | undefined => {
  if (!React.isValidElement(node)) return undefined;
  if (predicate(node)) return node;

  return React.Children.toArray(node.props.children)
    .map((child) => findElementInNode(child, predicate))
    .find((child): child is ReactElement => child !== undefined);
};

describe('ThreadBadgeRenderer', () => {
  it('renders nothing without a badge model', () => {
    expect(
      ThreadBadgeRenderer({
        model: undefined,
        room: {} as Room,
        onClick: vi.fn(),
      })
    ).toBeNull();
  });

  it('renders the summary card and thread indicator from the badge model', () => {
    const model: ThreadBadgeViewModel = {
      id: {
        roomId: '!room:example.org',
        threadRootId: '$root',
      },
      summaryInfo: {
        summaryText: 'Cached thread summary',
        generatedTs: 10,
        messageCount: 4,
      },
      recentThreadSummaryText: 'Recent summary',
      replyCount: 4,
      participantIds: ['@alice:example.org'],
      isResolved: true,
    };

    const rendered = ThreadBadgeRenderer({
      model,
      room: {} as Room,
      onClick: vi.fn(),
      includeRecentSummaryData: true,
    });
    const summaryCard = findElementInNode(
      rendered,
      (element) => element.props.summaryInfo === model.summaryInfo
    );
    const threadIndicator = findElementInNode(
      rendered,
      (element) => element.props.threadRootId === '$root'
    );

    expect(summaryCard).toBeDefined();
    expect(threadIndicator).toBeDefined();
    expect(threadIndicator?.props.threadReplyCount).toBe(4);
    expect(threadIndicator?.props.threadParticipantIds).toEqual(['@alice:example.org']);
    expect(threadIndicator?.props.isResolved).toBe(true);
    expect(threadIndicator?.props['data-thread-summary']).toBe('Recent summary');
  });
});
