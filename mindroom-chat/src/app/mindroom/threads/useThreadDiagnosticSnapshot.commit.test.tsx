// @vitest-environment jsdom
import React, { startTransition, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MatrixEvent } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import { useThreadDiagnosticSnapshot } from './useThreadDiagnosticSnapshot';

const mocks = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('../diagnostics/deepTrace', () => ({
  subscribeDeepTraceStatus: (listener: (status: string) => void) => {
    listener('memory-only');
    return () => undefined;
  },
}));
vi.mock('./timelineDebug', () => ({ logTimelineDebug: mocks.log }));
vi.mock('./threadRenderSchedulerProbe', () => ({
  observeThreadRenderScheduler: () => () => undefined,
}));

it('distinguishes an attempted reply render from the last committed empty view', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const reply = new MatrixEvent({
    event_id: '$reply',
    type: 'm.room.message',
    content: { body: 'Reply', 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } },
  });
  const pending = new Promise<void>(() => {});
  function Harness({ loaded, suspend }: { loaded: boolean; suspend: boolean }) {
    useThreadDiagnosticSnapshot({
      traceId: 'thread-open#1#synthetic',
      threadId: '$root',
      events: loaded ? [reply] : [],
      readModel: () => ({ eventCount: 1, replyCount: 1, expectedReplyCount: 1 }),
      getElement: () => container,
      getVirtualItemCount: () => (loaded ? 1 : 0),
      cacheHydrated: false,
      sdkReady: loaded,
      loading: !loaded,
      loadError: false,
    });
    if (suspend) throw pending;
    return loaded ? <span data-message-id="$reply">Reply</span> : <span>Empty</span>;
  }
  const render = (loaded: boolean, suspend: boolean) =>
    root.render(
      <Suspense fallback="Waiting">
        <Harness loaded={loaded} suspend={suspend} />
      </Suspense>
    );
  try {
    await act(async () => render(false, false));
    const initial = mocks.log.mock.calls.at(-1)![2];
    await act(async () => {
      startTransition(() => render(true, true));
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(container.textContent).toBe('Empty');
    const attempted = mocks.log.mock.calls.at(-1)![2];
    expect(attempted).toMatchObject({
      eventCount: 0,
      mountedReplyCount: 0,
      attemptedEventCount: 1,
      sdkReady: false,
      attemptedSdkReady: true,
      commitCount: initial.commitCount,
    });
    expect(attempted.renderAttemptCount).toBeGreaterThan(initial.renderAttemptCount);

    await act(async () => render(true, false));
    act(() => vi.advanceTimersByTime(1000));
    expect(container.textContent).toBe('Reply');
    const committed = mocks.log.mock.calls.at(-1)![2];
    expect(committed).toMatchObject({
      eventCount: 1,
      mountedReplyCount: 1,
      attemptedEventCount: 1,
    });
    expect(committed.commitCount).toBeGreaterThan(initial.commitCount);
  } finally {
    act(() => root.unmount());
    container.remove();
    mocks.log.mockClear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
