import { useCallback, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export const createRoomAutomaticFill = ({
  readGeometry,
  schedule,
  onInitialGeometryReady,
  isPaginationPending,
}: {
  readGeometry: () => string | undefined;
  schedule: (check: () => void) => void;
  onInitialGeometryReady?: () => void;
  isPaginationPending?: () => boolean;
}) => {
  let active = true;
  let queued = false;
  let paused = false;
  let generation = 0;
  let retry: (() => boolean) | undefined;
  let previousGeometry: string | undefined;
  let attemptedGeometry: string | undefined;
  let initialGeometryReady = false;
  const queue = () => {
    if (queued || paused || !active || !retry) return;
    queued = true;
    const scheduledGeneration = generation;
    schedule(() => {
      if (scheduledGeneration === generation) check();
    });
  };
  const check = () => {
    queued = false;
    if (!active || !retry) return;
    if ((initialGeometryReady || !onInitialGeometryReady) && isPaginationPending?.()) {
      previousGeometry = undefined;
      queue();
      return;
    }
    const geometry = readGeometry();
    if (geometry !== undefined && geometry === previousGeometry) {
      if (!initialGeometryReady && onInitialGeometryReady) {
        initialGeometryReady = true;
        onInitialGeometryReady();
        previousGeometry = undefined;
        queue();
        return;
      }
      if (geometry === attemptedGeometry) {
        active = false;
        retry = undefined;
        return;
      }
      attemptedGeometry = geometry;
      if (!retry()) {
        active = false;
        retry = undefined;
        return;
      }
      previousGeometry = undefined;
    } else previousGeometry = geometry;
    queue();
  };
  return {
    isActive: () => active,
    start: () => {
      retry ??= () => false;
      queue();
    },
    defer: (nextRetry: () => boolean) => {
      // Return whether this phase owns the callback now, without executing
      // inactive work whose original direction belongs to the caller.
      if (!active) return false;
      retry = nextRetry;
      queue();
      return true;
    },
    cancel: (resumePagination = false) => {
      active = false;
      const pending = retry;
      retry = undefined;
      if (resumePagination) pending?.();
    },
    pause: () => {
      paused = true;
      generation += 1;
      queued = false;
      previousGeometry = undefined;
    },
    resume: () => {
      paused = false;
      queue();
    },
  };
};

// A task after rAF observes that frame's ResizeObserver/React work. Two
// matching ready snapshots are needed: clearing prepend debt can mount a
// fresh measured band in the following frame. No time-based expiry owns this
// phase; settled invisible geometry, exhausted fill, or real intent ends it.
export const useRoomAutomaticFill = ({
  viewKey,
  enabled,
  latestEventId,
  contentKey,
  getScrollElement,
  isPaginating,
}: {
  viewKey: string;
  enabled: boolean;
  latestEventId?: string;
  contentKey: string;
  getScrollElement: () => HTMLElement | null;
  isPaginating: () => boolean;
}) => {
  const geometryReader = useRef<() => string | undefined>(() => undefined);
  const view = useMemo(() => ({ viewKey }), [viewKey]);
  const [revealedView, setRevealedView] = useState<object>();
  const context = useRef({ isPaginating, contentKey });
  useInsertionEffect(() => {
    context.current = { isPaginating, contentKey };
  }, [contentKey, isPaginating]);
  const owner = useMemo(
    () =>
      createRoomAutomaticFill({
        onInitialGeometryReady: () => setRevealedView(view),
        isPaginationPending: () => context.current.isPaginating(),
        readGeometry: () => {
          const geometry = geometryReader.current();
          return geometry === undefined ? undefined : `${context.current.contentKey}|${geometry}`;
        },
        schedule: (check) => {
          requestAnimationFrame(() => {
            setTimeout(check, 0);
          });
        },
      }),
    [view]
  );
  const retainedLatest = useRef({ owner, eventId: latestEventId });
  useInsertionEffect(() => {
    if (retainedLatest.current.owner !== owner)
      retainedLatest.current = { owner, eventId: latestEventId };
    else if (retainedLatest.current.eventId === undefined)
      retainedLatest.current.eventId = latestEventId;
    if (!enabled || retainedLatest.current.eventId !== latestEventId) owner.cancel();
  }, [enabled, latestEventId, owner]);
  const cancel = useCallback(
    (resumePagination = false) => {
      owner.cancel(resumePagination);
      setRevealedView(view);
    },
    [owner, view]
  );
  useLayoutEffect(() => {
    // Navigation can cancel in insertion phase, before callback measurements.
    // Reveal in layout phase so cancellation never leaves mounted content hidden.
    if (!owner.isActive()) setRevealedView(view);
  }, [enabled, latestEventId, owner, view]);
  useLayoutEffect(() => {
    owner.resume();
    if (!enabled || !owner.isActive()) return () => owner.pause();
    owner.start();
    const root = getScrollElement();
    const cancelOnIntent = () => cancel(true);
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    events.forEach((event) => root?.addEventListener(event, cancelOnIntent, { passive: true }));
    return () => {
      owner.pause();
      events.forEach((event) => root?.removeEventListener(event, cancelOnIntent));
    };
  }, [cancel, enabled, getScrollElement, owner]);
  return {
    ...owner,
    cancel,
    geometryReader,
    hideInitialRows: enabled && owner.isActive() && revealedView !== view,
  };
};
