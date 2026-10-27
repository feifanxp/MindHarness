import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CompactThreadCard } from './CompactThreadCard';
import type { CompactThreadCardViewModel } from './types';

vi.mock('./CompactRoomView.css', () => ({
  Card: 'Card',
  CardResolved: 'CardResolved',
  CardUnread: 'CardUnread',
  MessagePreview: 'MessagePreview',
  MessageText: 'MessageText',
  MetadataRow: 'MetadataRow',
  ParticipantAvatar: 'ParticipantAvatar',
  Participants: 'Participants',
  ReplyCount: 'ReplyCount',
  ResolutionByline: 'ResolutionByline',
  ResolutionBylineLabel: 'ResolutionBylineLabel',
  ScheduledIndicator: 'ScheduledIndicator',
  Stats: 'Stats',
  StreamingStatus: 'StreamingStatus',
  TimeText: 'TimeText',
  TimeTextUnread: 'TimeTextUnread',
  TitleRow: 'TitleRow',
  TitleText: 'TitleText',
}));

vi.mock('./ThreadIndicator.css', () => ({
  ThreadParticipant: 'ThreadParticipant',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
  ThreadScheduledIndicator: 'ThreadScheduledIndicator',
  ThreadStreamingDot: 'ThreadStreamingDot',
}));

vi.mock('../messages/PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

const relativeTime = vi.hoisted(() => ({ value: '', format: undefined as string | undefined }));

vi.mock('../../hooks/useRelativeTime', () => ({
  useRelativeTime: (_ts: number | undefined, format?: string) => {
    relativeTime.format = format;
    return relativeTime.value;
  },
}));

vi.mock('./ThreadTagPill', () => ({
  ThreadTagPill: ({ name }: { name: string }) =>
    React.createElement('span', { 'data-tag-pill': name }, name),
}));

vi.mock('../../components/user-avatar', () => ({
  UserAvatar: ({ renderFallback }: { renderFallback?: () => React.ReactNode }) =>
    renderFallback?.() ?? null,
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        key === 'thread.aria.messageFailed'
          ? 'Localized message failure'
          : translateFromEn(key, options),
    }),
  };
});

const makeViewModel = (
  overrides: Partial<CompactThreadCardViewModel> = {}
): CompactThreadCardViewModel => ({
  id: {
    roomId: '!room:server',
    threadRootId: '$thread',
  },
  titleText: 'Thread title',
  displayTitleText: 'Thread title',
  previewText: 'Me: Pending reply body',
  messageCount: 1,
  messageCountLabel: '1 msg',
  messageCountText: '1',
  attentionState: 'waiting',
  attentionStatusText: 'Waiting on response',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  ...overrides,
});

describe('CompactThreadCard', () => {
  it('renders the pending send indicator beside compact preview text', () => {
    const renderer = create(
      <CompactThreadCard viewModel={makeViewModel({ hasPendingSend: true })} onClick={vi.fn()} />
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Me: Pending reply body');
    expect(rendered).toContain('Message sending');
    expect(rendered).toContain('Waiting for server');
    expect(rendered).toContain('data-pending-send-icon');

    renderer.unmount();
  });

  it('renders terminal failure instead of pending state beside compact preview text', () => {
    const renderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({ hasPendingSend: true, hasFailedSend: true })}
        onClick={vi.fn()}
      />
    );

    const rendered = JSON.stringify(renderer.toJSON());
    const ariaLabel = renderer.root.findByType('button').props['aria-label'];

    expect(rendered).toContain('Me: Pending reply body');
    expect(rendered).toContain('Message failed to send');
    expect(rendered).toContain('Not sent');
    expect(rendered).toContain('data-failed-send-icon');
    expect(rendered).not.toContain('data-pending-send-icon');
    expect(ariaLabel).toContain('Localized message failure');
    expect(ariaLabel).not.toContain('Message failed to send');

    renderer.unmount();
  });

  it('marks unread threads with an accent edge and accented time instead of a dot', () => {
    relativeTime.value = '2d';
    const readRenderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({
          attentionState: 'needs-attention',
          attentionStatusText: 'Needs attention',
        })}
        onClick={vi.fn()}
      />
    );
    const readButton = readRenderer.root.findByType('button');
    expect(readButton.props.className).toBe('Card');
    expect(readButton.props['data-thread-unread']).toBeUndefined();
    expect(readRenderer.root.findByProps({ className: 'TimeText' }).props.children).toBe('2d');
    readRenderer.unmount();

    const unreadRenderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({ isUnread: true, isResolved: true })}
        onClick={vi.fn()}
      />
    );
    const button = unreadRenderer.root.findByType('button');

    expect(button.props.className).toBe('Card CardResolved CardUnread');
    expect(button.props['data-thread-unread']).toBe('true');
    expect(
      unreadRenderer.root.findByProps({ className: 'TimeText TimeTextUnread' }).props.children
    ).toBe('2d');
    expect(JSON.stringify(unreadRenderer.toJSON())).not.toContain('UnreadDot');
    expect(button.props['aria-label']).toContain('Unread messages');
    unreadRenderer.unmount();
    relativeTime.value = '';
  });

  it('asks for the compact time and reads the full timestamp to assistive technology', () => {
    relativeTime.value = '2d';
    const renderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({
          lastActivityTs: 1,
          lastActivityTitle: 'Oct 2, 2026, 14:00',
        })}
        onClick={vi.fn()}
      />
    );

    expect(relativeTime.format).toBe('compact');
    expect(renderer.root.findByProps({ className: 'TimeText' }).props.title).toBe(
      'Oct 2, 2026, 14:00'
    );
    expect(renderer.root.findByType('button').props['aria-label']).toContain(
      'Last activity Oct 2, 2026, 14:00'
    );
    renderer.unmount();
    relativeTime.value = '';
  });

  it('leaves the preview row to the preview and counts replies in the metadata row', () => {
    const renderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({
          messageCount: 1234,
          messageCountLabel: '1,234 msgs',
          messageCountText: '1,234',
          tags: ['blog'],
        })}
        onClick={vi.fn()}
      />
    );
    const preview = renderer.root.findByProps({ className: 'MessagePreview' });
    const metadata = renderer.root.findByProps({ className: 'MetadataRow' });
    const replyCount = metadata.findByProps({ 'data-compact-card-reply-count': 'true' });

    expect(JSON.stringify(preview.findByProps({ className: 'MessageText' }).props.children)).toBe(
      JSON.stringify('Me: Pending reply body')
    );
    expect(preview.findAllByProps({ 'data-compact-card-reply-count': 'true' })).toHaveLength(0);
    expect(replyCount.props.title).toBe('1,234 msgs');
    expect(replyCount.props.children).toContain('1,234');
    expect(metadata.findByProps({ 'data-tag-pill': 'blog' })).toBeTruthy();
    expect(renderer.root.findByType('button').props['aria-label']).toContain('1,234 msgs');
    renderer.unmount();
  });

  it('keeps the attention state on the card for the accessible label and test hooks', () => {
    const viewModel = makeViewModel({
      attentionState: 'resolved',
      attentionStatusText: 'Resolved',
      isResolved: true,
      resolvedByDisplayName: 'Alice',
    } as Partial<CompactThreadCardViewModel> & { resolvedByDisplayName: string });
    const renderer = create(<CompactThreadCard viewModel={viewModel} onClick={vi.fn()} />);
    const button = renderer.root.findByType('button');

    expect(button.props['data-attention-state']).toBe('resolved');
    expect(button.props['aria-label']).toContain('Resolved by Alice');

    renderer.unmount();
  });

  it('renders an explicit resolver byline for resolved cards', () => {
    const viewModel = makeViewModel({
      attentionState: 'resolved',
      attentionStatusText: 'Resolved',
      isResolved: true,
      resolvedByDisplayName: 'Alice',
    } as Partial<CompactThreadCardViewModel> & { resolvedByDisplayName: string });
    const renderer = create(<CompactThreadCard viewModel={viewModel} onClick={vi.fn()} />);
    const metadata = renderer.root.findByProps({ className: 'MetadataRow' });
    const resolverByline = metadata.findByProps({
      'data-compact-card-resolution-byline': 'true',
    });

    expect(
      resolverByline.findAll(
        (node) => node.type === 'span' && node.children.includes('Resolved by Alice')
      )
    ).toHaveLength(1);

    renderer.unmount();
  });
});
