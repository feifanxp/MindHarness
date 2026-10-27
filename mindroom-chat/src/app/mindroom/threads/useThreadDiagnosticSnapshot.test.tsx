// @vitest-environment jsdom
import React from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThreadDiagnosticSnapshot } from './useThreadDiagnosticSnapshot';

const mocks = vi.hoisted(() => ({
  status: 'disabled',
  listener: undefined as undefined | ((status: string) => void),
  log: vi.fn(),
}));
vi.mock('../diagnostics/deepTrace', () => ({
  subscribeDeepTraceStatus: (listener: (status: string) => void) => {
    mocks.listener = listener;
    listener(mocks.status);
    return () => {
      mocks.listener = undefined;
    };
  },
}));
vi.mock('./timelineDebug', () => ({ logTimelineDebug: mocks.log }));
vi.mock('./threadRenderSchedulerProbe', () => ({
  observeThreadRenderScheduler: () => () => undefined,
}));

const reply = (id: string) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    content: { body: 'private reply', 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } },
  });

afterEach(() => {
  vi.useRealTimers();
  mocks.log.mockClear();
  mocks.status = 'disabled';
});

describe('thread diagnostic render sampling', () => {
  it.each(['initial', 'interval'])(
    'contains diagnostic read failures during %s sampling',
    (stage) => {
      vi.useFakeTimers();
      mocks.status = 'recording';
      const readModel = vi.fn(() => ({ eventCount: 1, replyCount: 0, expectedReplyCount: 0 }));
      const fail = () => {
        throw new Error('diagnostic model read failed');
      };
      if (stage === 'initial') readModel.mockImplementation(fail);
      function Harness() {
        useThreadDiagnosticSnapshot({
          traceId: 'thread-open#1#private',
          threadId: '$root',
          events: [],
          readModel,
          getElement: () => null,
          getVirtualItemCount: () => 0,
          cacheHydrated: false,
          loading: false,
          loadError: false,
        });
        return null;
      }
      let renderer!: ReactTestRenderer;
      expect(() =>
        act(() => {
          renderer = create(<Harness />);
        })
      ).not.toThrow();
      readModel.mockImplementation(fail);
      expect(() =>
        act(() => {
          vi.advanceTimersByTime(1000);
        })
      ).not.toThrow();
      const calls = readModel.mock.calls.length;
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(readModel).toHaveBeenCalledTimes(calls);
      expect(vi.getTimerCount()).toBe(0);
      act(() => {
        renderer.unmount();
      });
      expect(mocks.listener).toBeUndefined();
    }
  );

  it('distinguishes loaded replies from mounted replies, suppresses repeats, and stops on opt-out', () => {
    vi.useFakeTimers();
    const element = document.createElement('div');
    element.innerHTML = '<div data-message-id="$root"></div>';
    const query = vi.spyOn(element, 'querySelectorAll');
    let modelCount = 0;
    let props: Parameters<typeof useThreadDiagnosticSnapshot>[0] = {
      traceId: 'thread-open#1#private',
      threadId: '$root',
      events: [],
      readModel: () => ({ eventCount: modelCount, replyCount: modelCount, expectedReplyCount: 2 }),
      getElement: () => element,
      getVirtualItemCount: () => 1,
      cacheHydrated: false,
      loading: true,
      loadError: false,
    };
    function Harness() {
      useThreadDiagnosticSnapshot(props);
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Harness />);
    });
    expect(query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      mocks.listener?.('memory-only');
    });
    expect(mocks.log).toHaveBeenLastCalledWith(
      props.traceId,
      'thread-render-snapshot',
      expect.objectContaining({
        loadedReplyCount: 0,
        mountedReplyCount: 0,
        rootMounted: true,
        expectedReplyCount: 2,
        loading: true,
      })
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mocks.log).toHaveBeenCalledTimes(1);
    modelCount = 2;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mocks.log).toHaveBeenLastCalledWith(
      props.traceId,
      'thread-render-snapshot',
      expect.objectContaining({
        modelReplyCount: 2,
        loadedReplyCount: 0,
        mountedReplyCount: 0,
      })
    );
    props = {
      ...props,
      events: [
        reply('$one'),
        reply('$one'),
        reply('$two'),
        new MatrixEvent({
          event_id: '$foreign',
          type: 'm.room.message',
          content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$other-root' } },
        }),
      ],
      cacheHydrated: true,
      loading: false,
    };
    act(() => {
      renderer.update(<Harness />);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mocks.log).toHaveBeenLastCalledWith(
      props.traceId,
      'thread-render-snapshot',
      expect.objectContaining({
        loadedReplyCount: 2,
        mountedReplyCount: 0,
        loading: false,
      })
    );
    element.innerHTML +=
      '<div data-message-id="$one"><div data-message-id="$one"></div></div><div data-message-id="$unrelated"></div>';
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mocks.log).toHaveBeenLastCalledWith(
      props.traceId,
      'thread-render-snapshot',
      expect.objectContaining({
        loadedReplyCount: 2,
        mountedReplyCount: 1,
      })
    );
    expect(JSON.stringify(mocks.log.mock.calls.map((call) => call[2]))).not.toContain('$');
    expect(JSON.stringify(mocks.log.mock.calls.map((call) => call[2]))).not.toContain('private');
    act(() => {
      mocks.listener?.('disabled');
    });
    const queryCount = query.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(query).toHaveBeenCalledTimes(queryCount);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      renderer.unmount();
    });
    expect(mocks.listener).toBeUndefined();
  });

  it('starts a new sampling lifetime on close/reopen and uses null for an unmounted timeline', () => {
    vi.useFakeTimers();
    mocks.status = 'starting';
    const props: Parameters<typeof useThreadDiagnosticSnapshot>[0] = {
      traceId: 'thread-open#1#private',
      threadId: '$root',
      events: [reply('$one')],
      readModel: () => ({ eventCount: null, replyCount: null, expectedReplyCount: null }),
      getElement: () => null,
      getVirtualItemCount: () => 0,
      cacheHydrated: false,
      loading: true,
      loadError: false,
    };
    function Harness({ traceId, threadId }: { traceId?: string; threadId?: string }) {
      useThreadDiagnosticSnapshot({ ...props, traceId, threadId });
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Harness traceId={props.traceId} threadId={props.threadId} />);
    });
    expect(mocks.log).toHaveBeenLastCalledWith(
      props.traceId,
      'thread-render-snapshot',
      expect.objectContaining({ mountedReplyCount: null, rootMounted: null })
    );
    act(() => {
      renderer.update(<Harness />);
    });
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      renderer.update(<Harness traceId="thread-open#2#private" threadId="$root" />);
    });
    expect(mocks.log).toHaveBeenCalledTimes(2);
    expect(mocks.log.mock.calls[1][0]).toBe('thread-open#2#private');
    act(() => {
      renderer.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
