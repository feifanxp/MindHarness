import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ThreadsView } from '../ThreadsView';
import { DEFAULT_CROSS_ROOM_THREAD_FILTERS } from '../../../../mindroom/cross-room-threads/crossRoomThreadFilters';
import type { CrossRoomThreadIndexSnapshot } from '../../../../mindroom/cross-room-threads/crossRoomThreadIndex';

vi.mock('../ThreadsView.css', () => ({
  View: 'view',
  Scroll: 'scroll',
  Count: 'count',
  List: 'list',
  Row: 'row',
  RowChrome: 'row-chrome',
  Chip: 'chip',
  Empty: 'empty',
}));

vi.mock('../../../../components/virtualizer', () => ({
  VirtualTile: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../ThreadsViewRow', () => ({
  ThreadsViewRow: () => React.createElement('div', null, 'row'),
}));

vi.mock('folds', () => ({
  Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('div', props, children),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', { type: 'button', ...props }, children),
  Icon: () => React.createElement('span', null),
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) =>
    React.createElement('span', props, children),
  Icons: {
    Filter: 'Filter',
    Thread: 'Thread',
  },
}));

const makeSnapshot = (
  overrides: Partial<CrossRoomThreadIndexSnapshot>
): CrossRoomThreadIndexSnapshot => ({
  entries: new Map(),
  eventIdToThreadRoots: new Map(),
  version: 0,
  bootstrapped: false,
  ...overrides,
});

const hasText = (renderer: ReturnType<typeof create>, text: string): boolean =>
  renderer.root.findAll((node) => node.children.includes(text)).length > 0;

describe('ThreadsView', () => {
  it('renders the bootstrapping state before the lazy index has populated', () => {
    const renderer = create(
      React.createElement(ThreadsView, {
        indexSnapshot: makeSnapshot({}),
        filters: DEFAULT_CROSS_ROOM_THREAD_FILTERS,
        setFilters: vi.fn(),
      })
    );

    expect(hasText(renderer, 'Loading threads')).toBe(true);
  });

  it('keeps showing the bootstrapping state when dirty rows arrive before bootstrap drains', () => {
    const renderer = create(
      React.createElement(ThreadsView, {
        indexSnapshot: makeSnapshot({
          entries: new Map([
            [
              'entry',
              {
                key: 'entry',
                roomId: '!room:example.org',
                roomName: 'Room',
                parentSpaceIds: [],
                threadRootId: '$root',
                threadRecord: {
                  status: { hasPendingSend: false, replyCount: 1 },
                },
                lastActivityTs: Date.now(),
                isUnread: false,
                isResolved: false,
                hasAttention: false,
                isInvolved: true,
                summaryText: 'summary',
                rootPreviewText: 'root',
                searchableText: 'root summary',
                tags: [],
                generation: 0,
              },
            ],
          ]) as CrossRoomThreadIndexSnapshot['entries'],
        }),
        filters: DEFAULT_CROSS_ROOM_THREAD_FILTERS,
        setFilters: vi.fn(),
      })
    );

    expect(hasText(renderer, 'Loading threads')).toBe(true);
    expect(hasText(renderer, 'row')).toBe(false);
    expect(hasText(renderer, 'No threads match your filters')).toBe(false);
  });

  it('distinguishes no indexed threads from no filter matches', () => {
    const empty = create(
      React.createElement(ThreadsView, {
        indexSnapshot: makeSnapshot({ bootstrapped: true }),
        filters: DEFAULT_CROSS_ROOM_THREAD_FILTERS,
        setFilters: vi.fn(),
      })
    );
    expect(hasText(empty, 'You have not been involved in any threads yet')).toBe(true);

    const filteredOut = create(
      React.createElement(ThreadsView, {
        indexSnapshot: makeSnapshot({
          bootstrapped: true,
          entries: new Map([
            [
              'entry',
              {
                key: 'entry',
                roomId: '!room:example.org',
                roomName: 'Room',
                parentSpaceIds: [],
                threadRootId: '$root',
                threadRecord: {
                  status: { hasPendingSend: false, replyCount: 1 },
                },
                lastActivityTs: Date.now(),
                isUnread: false,
                isResolved: false,
                hasAttention: false,
                isInvolved: false,
                summaryText: 'summary',
                rootPreviewText: 'root',
                searchableText: 'root summary',
                tags: [],
                generation: 0,
              },
            ],
          ]) as CrossRoomThreadIndexSnapshot['entries'],
        }),
        filters: DEFAULT_CROSS_ROOM_THREAD_FILTERS,
        setFilters: vi.fn(),
      })
    );
    expect(hasText(filteredOut, 'No threads match your filters')).toBe(true);
  });

  it('shows the base empty state when the index only contains viewed zero-reply roots', () => {
    const renderer = create(
      React.createElement(ThreadsView, {
        indexSnapshot: makeSnapshot({
          bootstrapped: true,
          entries: new Map([
            [
              'entry',
              {
                key: 'entry',
                roomId: '!room:example.org',
                roomName: 'Room',
                parentSpaceIds: [],
                threadRootId: '$root',
                threadRecord: {
                  status: { hasPendingSend: false, replyCount: 0 },
                },
                lastActivityTs: Date.now(),
                isUnread: false,
                isResolved: false,
                hasAttention: false,
                isInvolved: true,
                summaryText: 'summary',
                rootPreviewText: 'root',
                searchableText: 'root summary',
                tags: [],
                generation: 0,
              },
            ],
          ]) as CrossRoomThreadIndexSnapshot['entries'],
        }),
        filters: DEFAULT_CROSS_ROOM_THREAD_FILTERS,
        setFilters: vi.fn(),
      })
    );

    expect(hasText(renderer, 'You have not been involved in any threads yet')).toBe(true);
    expect(hasText(renderer, 'No threads match your filters')).toBe(false);
    expect(hasText(renderer, 'Clear filters')).toBe(false);
  });
});
