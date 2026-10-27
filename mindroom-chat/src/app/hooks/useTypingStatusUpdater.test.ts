import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TYPING_TIMEOUT_MS } from '../state/typingMembers';
import { useTypingStatusUpdater } from './useTypingStatusUpdater';

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

describe('useTypingStatusUpdater', () => {
  it('keeps failed typing notices from surfacing as unhandled rejections', async () => {
    vi.useFakeTimers();
    // A plain function: Vitest mocks observe returned promises, which would handle the rejection.
    const calls: unknown[][] = [];
    const sendTyping = (...args: unknown[]) => {
      calls.push(args);
      return Promise.reject(new TypeError('Load failed'));
    };
    let sendTypingStatus!: (typing: boolean) => void;
    const Harness = () => {
      sendTypingStatus = useTypingStatusUpdater({ sendTyping } as never, '!room:example.org');
      return null;
    };
    const unhandled: unknown[] = [];
    const trackUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', trackUnhandled);

    try {
      act(() => {
        renderer = create(React.createElement(Harness));
      });
      // Start typing, let the stale notice expire, then start and stop again.
      sendTypingStatus(true);
      await vi.advanceTimersByTimeAsync(TYPING_TIMEOUT_MS);
      sendTypingStatus(true);
      sendTypingStatus(false);
      vi.useRealTimers();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(calls).toEqual([
        ['!room:example.org', true, TYPING_TIMEOUT_MS],
        ['!room:example.org', false, TYPING_TIMEOUT_MS],
        ['!room:example.org', true, TYPING_TIMEOUT_MS],
        ['!room:example.org', false, TYPING_TIMEOUT_MS],
      ]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', trackUnhandled);
    }
  });
});
