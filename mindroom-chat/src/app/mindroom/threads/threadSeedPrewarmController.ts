import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { logTimelineDebug } from './timelineDebug';
import { createPreferLiveEventMapper, loadThreadCachedSnapshot } from './eventRepository';
import { mergeThreadBackfillEvents } from './threadCacheSnapshot';
import { getThreadOpenSeedSnapshot, saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { MAX_THREAD_FETCH_ITERATIONS } from './threadBootstrap';
import { useMindroomSyncEngine } from '../engine';

import type { ThreadSeedOpenPort } from './session/threadSessionTypes';

type ThreadSeedPrewarmTarget = {
  threadId: string;
};

type EnsureThreadSeedPrewarmOptions = {
  allowWhileThreadOpen?: boolean;
  generation?: number;
  logPrefix?: string;
  traceId?: string;
};

export type ThreadSeedPrewarmController = ThreadSeedOpenPort;

export const useThreadSeedPrewarmController = ({
  room,
  mx,
  sessionId,
  prefetchDepthRef,
  activeThreadId,
  priorityTargets,
  loadThreadOpenSeedSnapshotFromCache: loadThreadOpenSeedSnapshotFromCacheProp,
  debugTraceId,
}: {
  room: Room;
  mx: MatrixClient;
  sessionId: string;
  prefetchDepthRef: MutableRefObject<number>;
  activeThreadId: string | undefined;
  priorityTargets: ThreadSeedPrewarmTarget[];
  loadThreadOpenSeedSnapshotFromCache?: (expectedThreadId: string) => Promise<MatrixEvent[]>;
  debugTraceId: string;
}): ThreadSeedPrewarmController => {
  const syncEngine = useMindroomSyncEngine();
  const activeThreadIdRef = useRef(activeThreadId);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const prewarmedThreadSeedIdsRef = useRef<Set<string>>(new Set());
  const prewarmingThreadSeedIdsRef = useRef<Set<string>>(new Set());
  const prewarmingThreadSeedPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const queuedThreadSeedIdsRef = useRef<Set<string>>(new Set());
  const threadSeedPrewarmQueueRef = useRef<string[]>([]);
  const threadSeedPrewarmRunningRef = useRef(false);
  const threadSeedPrewarmGenerationRef = useRef(0);

  useEffect(() => {
    threadSeedPrewarmGenerationRef.current += 1;
    prewarmedThreadSeedIdsRef.current.clear();
    prewarmingThreadSeedIdsRef.current.clear();
    prewarmingThreadSeedPromisesRef.current.clear();
    queuedThreadSeedIdsRef.current.clear();
    threadSeedPrewarmQueueRef.current = [];
    threadSeedPrewarmRunningRef.current = false;
  }, [room.roomId]);

  const loadThreadOpenSeedSnapshotFromCache = useCallback(
    async (expectedThreadId: string): Promise<MatrixEvent[]> => {
      if (loadThreadOpenSeedSnapshotFromCacheProp) {
        return loadThreadOpenSeedSnapshotFromCacheProp(expectedThreadId);
      }

      const mapper = mx.getEventMapper();
      const cachedSnapshot = await loadThreadCachedSnapshot({
        sessionId,
        roomId: room.roomId,
        threadId: expectedThreadId,
        limit: prefetchDepthRef.current,
        maxPages: MAX_THREAD_FETCH_ITERATIONS,
        mapEvent: createPreferLiveEventMapper(room, mapper),
      });
      return cachedSnapshot?.events ?? [];
    },
    [loadThreadOpenSeedSnapshotFromCacheProp, mx, room, prefetchDepthRef, sessionId]
  );

  // CINNY-207 P4.4: dedup migrated onto the engine's BackfillScheduler.
  // The per-controller `prewarmingThreadSeedPromisesRef` map used to be
  // the F9 dedup point — but it only deduped WITHIN a single
  // MindroomRoomTimeline mount. Routing the actual work through
  // `syncEngine.scheduler.enqueue({kind: 'thread-seed', ...})` gives us
  // client-scoped dedup: concurrent seeds for the same (room, thread)
  // from any producer (remount, sibling controller, priority target
  // drain below) share the same in-flight promise. The controller-
  // local refs are still populated so downstream consumers
  // (threadOpenSeedController's untargeted-seed wait) continue to work
  // unchanged — the refs mirror scheduler state, they no longer own
  // dedup.
  const ensureThreadSeedPrewarm = useCallback(
    (expectedThreadId: string, opts?: EnsureThreadSeedPrewarmOptions): Promise<void> => {
      const existingPromise = prewarmingThreadSeedPromisesRef.current.get(expectedThreadId);
      if (existingPromise) return existingPromise;
      if (prewarmedThreadSeedIdsRef.current.has(expectedThreadId)) {
        return Promise.resolve();
      }

      const generation = opts?.generation ?? threadSeedPrewarmGenerationRef.current;
      const traceId = opts?.traceId ?? debugTraceId;
      const logPrefix = opts?.logPrefix ?? 'room-thread-seed-prewarm';
      prewarmingThreadSeedIdsRef.current.add(expectedThreadId);
      logTimelineDebug(traceId, `${logPrefix}-start`, {
        threadId: expectedThreadId,
      });

      const operation = syncEngine.persist.forRoom(room);
      const prewarmPromise = syncEngine.scheduler.enqueue<void>({
        roomId: room.roomId,
        threadId: expectedThreadId,
        kind: 'thread-seed',
        // Priority 3 = thread inventory prewarm band; deep-history
        // band-4 jobs yield to us so a room-open makes thread-open
        // fast even if a room-deep-history sweep is running.
        priority: 3,
        execute: async (signal) => {
          try {
            const cachedSeedEvents = await loadThreadOpenSeedSnapshotFromCache(expectedThreadId);
            if (
              signal.aborted ||
              !operation.isCurrent() ||
              generation !== threadSeedPrewarmGenerationRef.current
            )
              return;
            if (!opts?.allowWhileThreadOpen && activeThreadIdRef.current) return;

            if (cachedSeedEvents.length > 0) {
              const nextSeedEvents = mergeThreadBackfillEvents(
                getThreadOpenSeedSnapshot(room, expectedThreadId),
                cachedSeedEvents
              );
              saveThreadOpenSeedSnapshot(room, expectedThreadId, nextSeedEvents);
              logTimelineDebug(traceId, `${logPrefix}-complete`, {
                cachedCount: cachedSeedEvents.length,
                seedCount: nextSeedEvents.length,
                threadId: expectedThreadId,
              });
            } else {
              logTimelineDebug(traceId, `${logPrefix}-empty`, {
                threadId: expectedThreadId,
              });
            }

            prewarmedThreadSeedIdsRef.current.add(expectedThreadId);
          } catch (error) {
            logTimelineDebug(traceId, `${logPrefix}-error`, {
              error: error instanceof Error ? error.message : String(error),
              threadId: expectedThreadId,
            });
          }
        },
      });

      prewarmingThreadSeedPromisesRef.current.set(expectedThreadId, prewarmPromise);
      // CINNY-207 P7.2 audit finding #2: `void p.finally(cb)` returns a
      // NEW promise that re-rejects with the original reason and is
      // unhandled. The 'thread-seed' executor swallows its own errors,
      // so the promise only ever rejects via the scheduler's queued-abort
      // path (`abortAll` at engine teardown / logout). Route cleanup
      // through `.then(cb, cb)` so cleanup fires on both fulfil and
      // reject without producing a further unhandled rejection.
      const cleanupPrewarmRefs = () => {
        prewarmingThreadSeedIdsRef.current.delete(expectedThreadId);
        if (prewarmingThreadSeedPromisesRef.current.get(expectedThreadId) === prewarmPromise) {
          prewarmingThreadSeedPromisesRef.current.delete(expectedThreadId);
        }
      };
      void prewarmPromise.then(cleanupPrewarmRefs, cleanupPrewarmRefs);

      return prewarmPromise;
    },
    [debugTraceId, loadThreadOpenSeedSnapshotFromCache, room, syncEngine]
  );

  // Seed prewarming reads committed cache only. Engine owns proactive networking.
  useEffect(() => {
    if (activeThreadId || priorityTargets.length === 0) return undefined;

    priorityTargets.forEach(({ threadId: expectedThreadId }) => {
      if (prewarmedThreadSeedIdsRef.current.has(expectedThreadId)) return;
      if (prewarmingThreadSeedIdsRef.current.has(expectedThreadId)) return;
      if (queuedThreadSeedIdsRef.current.has(expectedThreadId)) return;
      queuedThreadSeedIdsRef.current.add(expectedThreadId);
      threadSeedPrewarmQueueRef.current.push(expectedThreadId);
    });

    if (threadSeedPrewarmRunningRef.current) return undefined;
    threadSeedPrewarmRunningRef.current = true;
    const generation = threadSeedPrewarmGenerationRef.current;
    const operation = syncEngine.persist.forRoom(room);

    const prewarmThreadSeeds = async () => {
      try {
        while (threadSeedPrewarmQueueRef.current.length > 0) {
          if (!operation.isCurrent() || generation !== threadSeedPrewarmGenerationRef.current)
            return;
          if (activeThreadIdRef.current) return;

          const expectedThreadId = threadSeedPrewarmQueueRef.current.shift();
          if (!expectedThreadId) continue;
          queuedThreadSeedIdsRef.current.delete(expectedThreadId);
          if (prewarmedThreadSeedIdsRef.current.has(expectedThreadId)) continue;
          if (prewarmingThreadSeedIdsRef.current.has(expectedThreadId)) continue;

          // CINNY-207 P7.2 audit finding #2: ensureThreadSeedPrewarm
          // returns the scheduler promise verbatim; that promise
          // rejects with the abort reason when the scheduler drains
          // a queued 'thread-seed' job at engine.stop(). Swallow the
          // rejection so the drain loop keeps going (the aborted job
          // is discarded, the next queued id gets a fresh enqueue) and
          // the outer `void prewarmThreadSeeds()` never sees an unhandled
          // rejection. Non-abort errors in the executor are already
          // logged via the try/catch inside execute() and never
          // surface here.
          await ensureThreadSeedPrewarm(expectedThreadId, {
            generation,
            logPrefix: 'room-thread-seed-prewarm',
            traceId: debugTraceId,
          }).catch(() => undefined);

          if (generation !== threadSeedPrewarmGenerationRef.current) return;
          if (activeThreadIdRef.current) return;
        }
      } finally {
        if (generation === threadSeedPrewarmGenerationRef.current) {
          threadSeedPrewarmRunningRef.current = false;
        }
        if (
          operation.isCurrent() &&
          generation === threadSeedPrewarmGenerationRef.current &&
          !activeThreadIdRef.current &&
          threadSeedPrewarmQueueRef.current.length > 0
        ) {
          queueMicrotask(() => {
            if (threadSeedPrewarmRunningRef.current) return;
            threadSeedPrewarmRunningRef.current = true;
            void prewarmThreadSeeds().catch(() => undefined);
          });
        }
      }
    };

    void prewarmThreadSeeds().catch(() => undefined);

    return undefined;
  }, [activeThreadId, debugTraceId, ensureThreadSeedPrewarm, priorityTargets, room, syncEngine]);

  const waitForExistingOrQueued = useCallback<ThreadSeedOpenPort['waitForExistingOrQueued']>(
    (threadId, options) => {
      const known =
        prewarmedThreadSeedIdsRef.current.has(threadId) ||
        prewarmingThreadSeedIdsRef.current.has(threadId) ||
        queuedThreadSeedIdsRef.current.has(threadId);
      if (!known) return undefined;
      return (
        prewarmingThreadSeedPromisesRef.current.get(threadId) ??
        ensureThreadSeedPrewarm(threadId, {
          allowWhileThreadOpen: true,
          logPrefix: 'thread-open-room-prewarm',
          traceId: options.traceId,
        })
      );
    },
    [ensureThreadSeedPrewarm]
  );
  return { waitForExistingOrQueued };
};
