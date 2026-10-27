import { MatrixEvent, Room, ThreadEvent } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRoomThreadsUnread,
  loadRoomThreads,
  roomThreadListIsComplete,
  sortThreadsByActivity,
} from './roomThreadList';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMindroomSyncEngine } from '../engine/engineContext';
import {
  createPreferLiveEventMapper,
  loadCachedThreadRootsForRoom,
  serializeThreadCacheEvents,
} from './eventRepository';
import { restoreCachedRoomThreads } from './sdk/roomTimelineSdk';

/**
 * Per page, not per mount: returning to a room's overview must not read every
 * cached root again or rewrite every unchanged one. In a room with hundreds of
 * threads each mount cost hundreds of IndexedDB transactions and megabytes of
 * reads, all through WebKit's networking process.
 */
const restoredRooms = new WeakSet<Room>();
const savedRootRevisions = new WeakMap<
  Room,
  { isCurrent: () => boolean; revisions: Map<string, number> }
>();

/** Root revisions saved under the room's cache write lease; a cleared room cache starts over. */
const getSavedRootRevisions = (room: Room, isCurrent: () => boolean): Map<string, number> => {
  const saved = savedRootRevisions.get(room);
  if (saved?.isCurrent()) return saved.revisions;
  const revisions = new Map<string, number>();
  savedRootRevisions.set(room, { isCurrent, revisions });
  return revisions;
};

/** 53-bit string hash (cyrb53): the page keeps a number per root, not its JSON. */
const hashRevision = (value: string): number => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

const getRootRevision = (room: Room, rootEvent: MatrixEvent): number => {
  const edit = rootEvent.replacingEvent();
  return hashRevision(
    JSON.stringify([
      // Encrypted events serialize as their ciphertext; decrypting one is a new revision.
      rootEvent.getType(),
      rootEvent.isDecryptionFailure(),
      edit?.getType(),
      edit?.isDecryptionFailure(),
      serializeThreadCacheEvents(room, [], rootEvent),
    ])
  );
};

export const useRoomThreadList = (room: Room, enabled = true) => {
  const mx = useMatrixClient();
  const engine = useMindroomSyncEngine();
  const [loading, setLoading] = useState(enabled);
  const [loadedSuccessfully, setLoadedSuccessfully] = useState(false);
  const [error, setError] = useState<Error>();
  const [version, setVersion] = useState(0);
  const lifecycleAbortControllerRef = useRef<AbortController>();

  useEffect(() => {
    // The SDK keeps the threads restored by the first mount; later ones come from the server list.
    if (!enabled || restoredRooms.has(room)) return undefined;
    let cancelled = false;
    loadCachedThreadRootsForRoom(engine.sessionId, room.roomId)
      .then((roots) => {
        if (cancelled) return;
        restoredRooms.add(room);
        const mapper = createPreferLiveEventMapper(room, mx.getEventMapper());
        restoreCachedRoomThreads(
          room,
          roots.map(({ rootEvent, latestReply }) => ({
            rootEvent: mapper(rootEvent),
            latestReply: latestReply && mapper(latestReply),
          }))
        );
        setVersion((current) => current + 1);
      })
      .catch(() => {
        // A cache miss/failure must not interrupt the independent server load.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, engine.sessionId, mx, room]);

  const handleThreadListProgress = useCallback(() => {
    setLoadedSuccessfully(true);
    setVersion((current) => current + 1);
  }, []);

  const loadThreads = useCallback(
    (signal: AbortSignal) => {
      const persist = engine.persist.forRoom(room);
      const saved = getSavedRootRevisions(room, persist.isCurrent);
      const saveRoot = (threadId: string, rootEvent: MatrixEvent) => {
        if (signal.aborted) return;
        // Later pages can update the same SDK object, including its edits.
        const revision = getRootRevision(room, rootEvent);
        if (saved.get(threadId) === revision) return;
        saved.set(threadId, revision);
        // A listed root is enough for the overview, not proof of cached replies.
        persist.persistThreadEventCache(threadId, [], rootEvent);
      };
      return loadRoomThreads(
        room,
        () => {
          if (signal.aborted) return;
          room.getThreads().forEach(({ id, rootEvent }) => {
            if (!rootEvent) return;
            // Save a root that is being decrypted with its clear content and attachments.
            const decryption = rootEvent.isBeingDecrypted() && rootEvent.getDecryptionPromise();
            const save = () => saveRoot(id, rootEvent);
            if (!decryption) {
              save();
              return;
            }
            decryption.then(save, save).catch((err: unknown) => {
              // eslint-disable-next-line no-console
              console.warn('[threadList] saving a decrypted root failed:', err);
            });
          });
          handleThreadListProgress();
        },
        signal
      );
    },
    [engine.persist, handleThreadListProgress, room]
  );

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      setLoadedSuccessfully(false);
      return;
    }
    const signal = lifecycleAbortControllerRef.current?.signal;
    if (!signal || signal.aborted) return;

    setLoading(true);
    setLoadedSuccessfully(false);
    setError(undefined);

    try {
      await loadThreads(signal);
    } catch (err) {
      if (signal.aborted) return;
      setError(err as Error);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [enabled, loadThreads]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setLoadedSuccessfully(false);
      setError(undefined);
      return undefined;
    }

    const abortController = new AbortController();
    lifecycleAbortControllerRef.current = abortController;

    setLoading(true);
    setLoadedSuccessfully(false);
    setError(undefined);

    loadThreads(abortController.signal)
      .catch((err: unknown) => {
        if (abortController.signal.aborted) return;
        setError(err as Error);
      })
      .finally(() => {
        if (abortController.signal.aborted) return;
        setLoading(false);
      });

    return () => {
      abortController.abort();
      if (lifecycleAbortControllerRef.current === abortController) {
        lifecycleAbortControllerRef.current = undefined;
      }
    };
  }, [enabled, loadThreads]);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleThreadUpdate = () => {
      setVersion((current) => current + 1);
    };

    room.on(ThreadEvent.New, handleThreadUpdate);
    room.on(ThreadEvent.Update, handleThreadUpdate);
    room.on(ThreadEvent.NewReply, handleThreadUpdate);
    room.on(ThreadEvent.Delete, handleThreadUpdate);

    return () => {
      room.removeListener(ThreadEvent.New, handleThreadUpdate);
      room.removeListener(ThreadEvent.Update, handleThreadUpdate);
      room.removeListener(ThreadEvent.NewReply, handleThreadUpdate);
      room.removeListener(ThreadEvent.Delete, handleThreadUpdate);
    };
  }, [enabled, room]);

  const rawThreads = useMemo(() => {
    void version;
    return room.getThreads();
  }, [room, version]);
  const userId = mx.getUserId() ?? '';
  const threadUnreads = useMemo(
    () => (enabled ? getRoomThreadsUnread(rawThreads, userId) : new Map<string, boolean>()),
    [enabled, rawThreads, userId]
  );
  const threads = useMemo(
    // Non-compact surfaces still use known roots for deep links, but not this ordering.
    () => (enabled ? sortThreadsByActivity(rawThreads, threadUnreads) : rawThreads),
    [enabled, rawThreads, threadUnreads]
  );
  const fullyLoaded = useMemo(() => {
    void version;
    return roomThreadListIsComplete(room);
  }, [room, version]);

  return {
    threads,
    threadUnreads,
    loading,
    loadedSuccessfully,
    fullyLoaded,
    error,
    retry: refresh,
  };
};
