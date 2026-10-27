import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { subscribeDeepTraceStatus } from '../diagnostics/deepTrace';
import { logTimelineDebug } from './timelineDebug';
import { getThreadReplyEventsForRoot } from './threadUtils';
import { observeThreadRenderScheduler } from './threadRenderSchedulerProbe';

type Options = {
  traceId?: string;
  threadId?: string;
  events: readonly MatrixEvent[];
  readModel: () => {
    eventCount: number | null;
    replyCount: number | null;
    expectedReplyCount: number | null;
  };
  getElement: () => HTMLElement | null;
  getVirtualItemCount: () => number;
  isRenderableReply?: (event: MatrixEvent) => boolean;
  cacheHydrated: boolean;
  sdkReady?: boolean;
  loading: boolean;
  loadError: boolean;
};

/** Opt-in, at most once per second; reads mounted IDs but exports only counts. */
export const useThreadDiagnosticSnapshot = (options: Options): void => {
  const latest = useRef(options);
  // Diagnostic-only observations: an interrupted render must not replace the
  // committed snapshot, but its progress is useful when a view stays empty.
  const renderAttemptCount = useRef(0);
  const commitCount = useRef(0);
  const attempted = useRef(options);
  renderAttemptCount.current += 1;
  attempted.current = options;
  useLayoutEffect(() => {
    latest.current = options;
    commitCount.current += 1;
  });
  const { traceId, threadId } = options;
  useEffect(() => {
    if (!traceId || !threadId) return undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopSchedulerProbe: (() => void) | undefined;
    let previous: string | undefined;
    const sample = () => {
      const current = latest.current;
      if (current.traceId !== traceId || current.threadId !== threadId) return;
      const pending = attempted.current;
      const sameThread = pending.traceId === traceId && pending.threadId === threadId;
      // Read the SDK model even if React missed its latest update.
      const model = current.readModel();
      const replies = getThreadReplyEventsForRoot(current.events, threadId);
      const element = current.getElement();
      const mounted = new Set(
        Array.from(element?.querySelectorAll('[data-message-id]') ?? [], (node) =>
          node.getAttribute('data-message-id')
        )
      );
      const data = {
        eventCount: current.events.length,
        modelEventCount: model.eventCount,
        modelReplyCount: model.replyCount,
        loadedReplyCount: replies.length,
        renderableReplyCount: replies.filter((event) => current.isRenderableReply?.(event) ?? true)
          .length,
        mountedReplyCount: element
          ? replies.filter((event) => mounted.has(event.getId() ?? null)).length
          : null,
        expectedReplyCount: model.expectedReplyCount,
        rootMounted: element ? mounted.has(threadId) : null,
        virtualItemCount: current.getVirtualItemCount(),
        cacheHydrated: current.cacheHydrated,
        sdkReady: current.sdkReady ?? false,
        loading: current.loading,
        loadError: current.loadError,
        renderAttemptCount: renderAttemptCount.current,
        commitCount: commitCount.current,
        attemptedEventCount: sameThread ? pending.events.length : null,
        attemptedSdkReady: sameThread ? pending.sdkReady ?? false : null,
        attemptedCacheHydrated: sameThread ? pending.cacheHydrated : null,
      };
      const signature = JSON.stringify(data);
      if (signature === previous) return;
      previous = signature;
      logTimelineDebug(traceId, 'thread-render-snapshot', data);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      stopSchedulerProbe?.();
      stopSchedulerProbe = undefined;
    };
    const safeSample = (): boolean => {
      try {
        sample();
        return true;
      } catch {
        // Diagnostic reads must not disrupt the view or repeat a failing poll.
        stop();
        return false;
      }
    };
    const unsubscribe = subscribeDeepTraceStatus((status) => {
      if (status !== 'recording' && status !== 'memory-only' && status !== 'starting') {
        stop();
      } else if (timer === undefined) {
        previous = undefined;
        stopSchedulerProbe = observeThreadRenderScheduler((data) =>
          logTimelineDebug(traceId, 'thread-render-scheduler', data)
        );
        if (safeSample()) timer = setInterval(safeSample, 1000);
      }
    });
    return () => {
      stop();
      unsubscribe();
    };
  }, [traceId, threadId]);
};
