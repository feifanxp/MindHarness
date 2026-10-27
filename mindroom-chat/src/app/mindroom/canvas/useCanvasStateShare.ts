import { useCallback, useEffect, useRef } from 'react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { uploadMindroomLongTextSidecar } from '../messages/longTextSidecarUpload';
import { discardFailedLocalEcho } from '../messages/pendingLocalEcho';
import type { CanvasSaved } from './canvasDocument';
import { contentBytes, MAX_EVENT_CONTENT_BYTES } from '../messages/longText';

/** A copy of a canvas's saved state for its agent, a reference to the canvas, read by `read_canvas_state`. */
export const CANVAS_STATE_EVENT_TYPE = 'io.mindroom.canvas_state';

// Shared once the user pauses, so a drag or a typed sentence is one event, not one per change.
const SHARE_AFTER_MS = 2000;

// One queue per canvas, kept across panels, so a copy sent after the panel reopened can never land
// before a slower one sent before it closed.
const queues = new Map<string, Promise<void>>();

/**
 * Keeps a copy of what a canvas keeps in its room, for a canvas whose request shares its state; the
 * returned call takes each save the user made. The copy never starts a turn; the agent reads it when it wants.
 */
export function useCanvasStateShare(
  mx: MatrixClient,
  room: Room,
  canvasId: string,
  enabled: boolean
): (saved: CanvasSaved) => void {
  const latest = useRef<CanvasSaved>();
  const timer = useRef<number>();
  const shareNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    latest.current = undefined;
    let shared: string | undefined;
    const publish = async () => {
      const saved = latest.current;
      const text = JSON.stringify([saved?.json, saved?.inputs]);
      if (!saved || text === shared) return;
      const relation = { rel_type: 'm.reference', event_id: canvasId };
      // A notice, so the standard push rule keeps every copy from notifying the room, even under
      // a room's "All messages" setting.
      const content = {
        msgtype: 'm.notice',
        version: 1,
        ...(saved.json === undefined ? {} : { json: saved.json }),
        ...(saved.inputs === undefined ? {} : { inputs: saved.inputs }),
        'm.relates_to': relation,
      };
      // State too large for one event goes as a long-text sidecar, as large canvas answers do.
      const event =
        contentBytes(content) <= MAX_EVENT_CONTENT_BYTES
          ? content
          : await uploadMindroomLongTextSidecar(mx, room, content, {
              msgtype: 'm.notice',
              body: 'Canvas state',
              'm.relates_to': relation,
            });
      const txnId = mx.makeTxnId();
      try {
        await mx.sendEvent(room.roomId, CANVAS_STATE_EVENT_TYPE as never, event as never, txnId);
      } catch (error) {
        discardFailedLocalEcho(mx, room.getEventForTxnId(txnId));
        throw error;
      }
      shared = text;
    };
    const share = () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      // One copy at a time; a copy that failed is sent again with the next save.
      const queued = (queues.get(canvasId) ?? Promise.resolve())
        .then(publish)
        .catch(() => undefined);
      queues.set(canvasId, queued);
      queued.then(() => {
        if (queues.get(canvasId) === queued) queues.delete(canvasId);
      });
    };
    shareNow.current = share;
    // Hiding or leaving the page shares what is still waiting, since a closing tab never unmounts.
    const shareWaiting = () => {
      if (timer.current !== undefined) share();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') shareWaiting();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', shareWaiting);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', shareWaiting);
      shareWaiting();
    };
  }, [mx, room, canvasId]);

  return useCallback(
    (saved: CanvasSaved) => {
      if (!enabled) return;
      latest.current = saved;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => shareNow.current(), SHARE_AFTER_MS);
    },
    [enabled]
  );
}
