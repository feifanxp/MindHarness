import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export type TimelineBulkExpansionAnchor =
  | {
      kind: 'bottom';
      generation: number;
    }
  | {
      kind: 'message';
      generation: number;
      messageId: string;
      top: number;
    };

const BOTTOM_THRESHOLD_PX = 24;
const STABILIZATION_FRAMES = 30;

const findVisibleMessageAnchor = (
  scrollElement: HTMLDivElement
): { messageId: string; top: number } | undefined => {
  const viewport = scrollElement.getBoundingClientRect();
  // The reader's view starts below the sticky headers (scroll-padding-top), as for explicit jumps.
  const readerTop =
    viewport.top + (Number.parseFloat(getComputedStyle(scrollElement).scrollPaddingTop) || 0) + 8;
  const center = viewport.top + viewport.height / 2;
  let best: { messageId: string; top: number; distance: number } | undefined;
  let partialBest: { messageId: string; top: number; distance: number } | undefined;

  scrollElement.querySelectorAll<HTMLElement>('[data-message-id]').forEach((candidate) => {
    const messageId = candidate.dataset.messageId;
    if (!messageId) return;
    const rect = candidate.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, readerTop);
    const visibleBottom = Math.min(rect.bottom, viewport.bottom - 8);
    if (visibleTop >= visibleBottom) return;
    const distance = Math.abs((rect.top + rect.bottom) / 2 - center);
    if (rect.top >= readerTop && rect.bottom <= viewport.bottom - 8) {
      if (!best || distance < best.distance) {
        best = { messageId, top: rect.top, distance };
      }
    } else {
      const visibleDistance = Math.abs((visibleTop + visibleBottom) / 2 - center);
      if (!partialBest || visibleDistance < partialBest.distance) {
        partialBest = { messageId, top: visibleTop, distance: visibleDistance };
      }
    }
  });

  const anchor = best ?? partialBest;
  return anchor && { messageId: anchor.messageId, top: anchor.top };
};

const findMessage = (scrollElement: HTMLDivElement, messageId: string): HTMLElement | undefined =>
  Array.from(scrollElement.querySelectorAll<HTMLElement>('[data-message-id]')).find(
    (candidate) => candidate.dataset.messageId === messageId
  );

export const captureTimelineBulkExpansionAnchor = (
  scrollElement: HTMLDivElement,
  generation: number
): TimelineBulkExpansionAnchor | undefined => {
  const distanceFromBottom =
    scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
  if (distanceFromBottom <= BOTTOM_THRESHOLD_PX) {
    return { kind: 'bottom', generation };
  }

  const messageAnchor = findVisibleMessageAnchor(scrollElement);
  return messageAnchor
    ? {
        kind: 'message',
        generation,
        ...messageAnchor,
      }
    : undefined;
};

export const restoreTimelineBulkExpansionAnchor = (
  scrollElement: HTMLDivElement,
  anchor: TimelineBulkExpansionAnchor
): void => {
  if (anchor.kind === 'bottom') {
    const targetScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
    if (Math.abs(scrollElement.scrollTop - targetScrollTop) >= 0.5) {
      scrollElement.scrollTop = targetScrollTop;
    }
    return;
  }

  const message = findMessage(scrollElement, anchor.messageId);
  if (!message) return;
  const drift = message.getBoundingClientRect().top - anchor.top;
  if (Math.abs(drift) >= 0.5) scrollElement.scrollTop += drift;
};

/**
 * Keeps a reader's viewport anchored while every mounted long message changes
 * height in one baseline update. The first restore runs in the rows' layout
 * effects (before paint); a short frame loop absorbs the virtualizer's later
 * ResizeObserver measurements without leaving a permanent correction active.
 */
export const useTimelineBulkExpansionAnchor = (
  baseline: boolean,
  scrollRef: RefObject<HTMLDivElement>
): (() => void) => {
  const previousBaselineRef = useRef(baseline);
  const generationRef = useRef(0);
  const anchorRef = useRef<TimelineBulkExpansionAnchor>();

  const restoreAnchor = useCallback(() => {
    const scrollElement = scrollRef.current;
    const anchor = anchorRef.current;
    if (!scrollElement || !anchor) return;

    restoreTimelineBulkExpansionAnchor(scrollElement, anchor);
  }, [scrollRef]);

  useLayoutEffect(() => {
    if (previousBaselineRef.current === baseline) return;
    previousBaselineRef.current = baseline;
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    anchorRef.current = captureTimelineBulkExpansionAnchor(scrollElement, generation);
  }, [baseline, scrollRef]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof requestAnimationFrame === 'undefined') return undefined;
    const generation = anchor.generation;
    const scrollElement = scrollRef.current;
    let frame = 0;
    let frameId = 0;
    const cancelForUserIntent = () => {
      if (anchorRef.current?.generation !== generation) return;
      anchorRef.current = undefined;
      cancelAnimationFrame(frameId);
    };
    const stabilize = () => {
      if (anchorRef.current?.generation !== generation) return;
      restoreAnchor();
      frame += 1;
      if (frame < STABILIZATION_FRAMES) {
        frameId = requestAnimationFrame(stabilize);
      } else {
        anchorRef.current = undefined;
      }
    };
    scrollElement?.addEventListener('wheel', cancelForUserIntent, { passive: true });
    scrollElement?.addEventListener('touchstart', cancelForUserIntent, { passive: true });
    scrollElement?.addEventListener('pointerdown', cancelForUserIntent, { passive: true });
    frameId = requestAnimationFrame(stabilize);
    return () => {
      cancelAnimationFrame(frameId);
      scrollElement?.removeEventListener('wheel', cancelForUserIntent);
      scrollElement?.removeEventListener('touchstart', cancelForUserIntent);
      scrollElement?.removeEventListener('pointerdown', cancelForUserIntent);
    };
  }, [baseline, restoreAnchor, scrollRef]);

  return restoreAnchor;
};
