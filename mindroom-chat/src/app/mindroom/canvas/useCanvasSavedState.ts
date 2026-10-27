import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { createSessionId, listSessions } from '../../state/sessions';
import type { CanvasSaved } from './canvasDocument';
import { loadCanvasState, saveCanvasState } from './canvasStateStore';

// A page may save on every keystroke; the store sees at most one write per interval.
const SAVE_INTERVAL_MS = 500;

export type CanvasSavedState = {
  /** False until the saved state is read or fails to be, so the page starts from any state there is. */
  ready: boolean;
  /** The latest saved state, including saves not yet written. */
  read: () => CanvasSaved;
  /** Replaces the parts of the saved state the change holds. */
  save: (change: CanvasSaved) => void;
};

/** The state a canvas's pages save on this device, shared by all versions of the canvas. */
export function useCanvasSavedState(mx: MatrixClient, canvasId: string): CanvasSavedState {
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  const [ready, setReady] = useState(false);
  const latest = useRef<CanvasSaved>({});
  // Saves stay in memory when the saved state could not be read, so they cannot overwrite it.
  const writable = useRef(false);
  const timer = useRef<number>();
  const flushNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true;
    latest.current = {};
    writable.current = false;
    setReady(false);
    // Without IndexedDB (private browsing in some browsers) the read fails and pages start without state.
    loadCanvasState(sessionId, canvasId).then(
      (saved) => {
        if (!alive) return;
        latest.current = saved ?? {};
        writable.current = true;
        setReady(true);
      },
      () => {
        if (alive) setReady(true);
      }
    );
    const flush = () => {
      if (timer.current === undefined) return;
      window.clearTimeout(timer.current);
      timer.current = undefined;
      // Removing an account deletes its saved state before the panel unmounts; a write now would restore it.
      if (!listSessions().some((session) => session.sessionId === sessionId)) return;
      saveCanvasState(sessionId, canvasId, latest.current).catch(() => undefined);
    };
    flushNow.current = flush;
    return () => {
      alive = false;
      flush();
    };
  }, [sessionId, canvasId]);

  const save = useCallback((change: CanvasSaved) => {
    latest.current = { ...latest.current, ...change };
    if (!writable.current || timer.current !== undefined) return;
    timer.current = window.setTimeout(() => flushNow.current(), SAVE_INTERVAL_MS);
  }, []);
  const read = useCallback(() => latest.current, []);

  return { ready, read, save };
}
