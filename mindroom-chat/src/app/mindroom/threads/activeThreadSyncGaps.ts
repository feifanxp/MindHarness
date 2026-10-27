import { RoomEvent, type Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';

/** Explicit open boundary: conversions must finish before callers capture the live chain. */
export const flushThreadSyncGap = (
  thread: Thread | null | undefined,
  isCurrent: () => boolean = () => true
): Promise<void> | undefined => {
  if (!isCurrent()) return undefined;
  const pending = thread?.flushPendingTimelineReset?.();
  // Retain synchronous cache hydration when there is no gap. Recheck after waiting,
  // since another room sync may have queued a newer boundary during conversion.
  return pending?.then(
    () => flushThreadSyncGap(thread, isCurrent),
    (error: unknown) => {
      if (isCurrent()) {
        // eslint-disable-next-line no-console
        console.warn('[thread-sync-gap] token conversion failed', error);
      }
      throw error;
    }
  );
};

/** Subscribe only for the selected thread; room reset events precede the SDK's thread loop. */
export const observeActiveThreadSyncGaps = (
  room: Room,
  thread: Thread,
  onChanged: () => void
): (() => void) => {
  let alive = true;
  let queued = false;
  const refresh = () => {
    if (queued || !alive) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!alive) return;
      const pending = flushThreadSyncGap(thread, () => alive);
      if (!pending) return;
      void pending.then(
        () => {
          if (alive) onChanged();
        },
        () => {
          if (alive) onChanged();
        }
      );
    });
  };
  const onReset = (
    _room: Room | undefined,
    timelineSet: ReturnType<Room['getUnfilteredTimelineSet']>
  ) => {
    if (!timelineSet.thread) refresh();
  };
  room.on(RoomEvent.TimelineReset, onReset);
  refresh();
  return () => {
    alive = false;
    room.removeListener(RoomEvent.TimelineReset, onReset);
  };
};
