import { ClientEvent, SyncState, ThreadEvent, type MatrixClient, type Thread } from 'matrix-js-sdk';
import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';

/** Cards scrolled past within this time do not load their thread. */
export const SHOWN_THREAD_DWELL_MS = 500;

type LiveSync = { count: number; listeners: Set<() => void> };

const liveSyncs = new WeakMap<MatrixClient, LiveSync>();

/** Counts the client's returns to live sync: the first `/sync` response and each reconnect. */
const getLiveSync = (mx: MatrixClient): LiveSync => {
  let liveSync = liveSyncs.get(mx);
  if (!liveSync) {
    const created: LiveSync = {
      count: mx.getSyncState() === SyncState.Syncing ? 1 : 0,
      listeners: new Set(),
    };
    mx.on(ClientEvent.Sync, (state, previous) => {
      if (state !== SyncState.Syncing || previous === SyncState.Syncing) return;
      created.count += 1;
      created.listeners.forEach((listener) => listener());
    });
    liveSyncs.set(mx, created);
    liveSync = created;
  }
  return liveSync;
};

// Thread lists render every card, so one shared observer reports which are on screen.
const visibilityListeners = new Map<Element, (visible: boolean) => void>();
let viewportObserver: IntersectionObserver | undefined;

const observeVisibility = (element: Element, onChange: (visible: boolean) => void) => {
  if (typeof IntersectionObserver === 'undefined') {
    onChange(true);
    return () => undefined;
  }
  viewportObserver ??= new IntersectionObserver((entries) =>
    entries.forEach((entry) => visibilityListeners.get(entry.target)?.(entry.isIntersecting))
  );
  visibilityListeners.set(element, onChange);
  viewportObserver.observe(element);
  return () => {
    visibilityListeners.delete(element);
    viewportObserver?.unobserve(element);
  };
};

/**
 * The SDK leaves listed threads summary-only until they are opened or shown.
 * A card on screen needs the thread's latest page, edits and counts, so load it once the client is live,
 * which keeps `/sync` ahead of it, and again after a reconnect if that attempt failed.
 * Returns the ref for an element of the card.
 */
export const useInitializeShownThread = (roomId: string, threadRootId: string | undefined) => {
  const mx = useMatrixClient();
  const liveSync = getLiveSync(mx);
  const liveSyncCount = useSyncExternalStore(
    (onChange) => {
      liveSync.listeners.add(onChange);
      return () => {
        liveSync.listeners.delete(onChange);
      };
    },
    () => liveSync.count
  );
  const [element, setElement] = useState<Element | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => (element ? observeVisibility(element, setVisible) : undefined), [element]);
  const room = mx.getRoom(roomId);
  const thread = threadRootId ? room?.getThread(threadRootId) : undefined;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  // A card can render before the SDK creates its thread.
  useEffect(() => {
    if (thread || !room || !threadRootId) return undefined;
    const onNewThread = (created: Thread) => {
      if (created.id === threadRootId) rerender();
    };
    room.on(ThreadEvent.New, onNewThread);
    if (room.getThread(threadRootId)) rerender();
    return () => {
      room.removeListener(ThreadEvent.New, onNewThread);
    };
  }, [room, thread, threadRootId]);

  useEffect(() => {
    if (!thread || !visible || liveSyncCount === 0) return undefined;
    const timer = setTimeout(() => {
      void thread.initialize();
    }, SHOWN_THREAD_DWELL_MS);
    return () => clearTimeout(timer);
  }, [thread, visible, liveSyncCount]);

  return setElement;
};
