import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MindroomReplyThreadIndicator } from './replyExtensions';

vi.mock('../threads/ThreadIndicator', () => ({
  ThreadIndicator: () => React.createElement('span', { 'data-renderer': 'thread-indicator' }),
}));

vi.mock('../threads/useRoomEvent', () => ({
  useRoomEvent: () => undefined,
}));

describe('replyExtensions', () => {
  it('renders reply thread indicators only when a visible thread root is provided', () => {
    expect(
      MindroomReplyThreadIndicator({
        room: {} as never,
        threadRootId: undefined,
      })
    ).toBeNull();

    expect(
      MindroomReplyThreadIndicator({
        room: {} as never,
        threadRootId: '$thread',
        hide: true,
      })
    ).toBeNull();

    expect(
      MindroomReplyThreadIndicator({
        room: {} as never,
        threadRootId: '$thread',
      })
    ).not.toBeNull();
  });
});
