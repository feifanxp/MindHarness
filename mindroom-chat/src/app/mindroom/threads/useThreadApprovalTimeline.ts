import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import { Virtualizer } from '@tanstack/react-virtual';
import { useThreadApprovals } from '../messages/ThreadApprovalProvider';
import { planThreadApprovalTimeline } from './threadApprovalTimeline';

export const useThreadApprovalTimeline = (
  events: readonly MatrixEvent[],
  ignored: ReadonlySet<string>,
  threadId?: string,
  routeId?: string,
  focusId?: string
) => {
  const context = useThreadApprovals();
  const ingest = context?.ingestTimeline;
  const revealed = useRef(new Set<string>());
  // Keep the directly inspected original visible after the temporary highlight ends.
  useEffect(() => {
    ingest?.(events);
  }, [ingest, events]);
  return useMemo(() => {
    if (routeId) revealed.current.add(routeId);
    if (focusId) revealed.current.add(focusId);
    return planThreadApprovalTimeline(
      context?.records,
      events,
      revealed.current,
      ignored,
      threadId,
      context?.now,
      context?.pendingEventIds
    );
  }, [
    context?.records,
    context?.now,
    context?.pendingEventIds,
    events,
    ignored,
    threadId,
    routeId,
    focusId,
  ]);
};

export const useThreadApprovalRowMeasurements = (
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  events: readonly MatrixEvent[],
  hidden: ReadonlySet<string>,
  estimate: (index: number) => number
) => {
  const previous = useRef<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    events.forEach((event, index) => {
      const id = event.getId();
      if (!id) return;
      if (hidden.has(id)) virtualizer.resizeItem(index, 0);
      else if (previous.current.has(id)) virtualizer.resizeItem(index, estimate(index));
    });
    previous.current = hidden;
  }, [virtualizer, events, hidden, estimate]);
};
