import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { loadCanvasEvent } from './canvasIndex';

// Long enough for a room to load, short enough that a later visit does not open it unasked.
const REQUEST_TTL_MS = 30_000;

type OpenRequest = { roomId: string; canvasId: string; at: number };
let request: OpenRequest | undefined;

/** Asks the room the app shows next to open this canvas (the Canvases page does, then navigates). */
export const requestCanvasOpen = (roomId: string, canvasId: string): void => {
  request = { roomId, canvasId, at: Date.now() };
};

export const cancelCanvasOpen = (): void => {
  request = undefined;
};

/**
 * Opens the canvas requested for this room once the room is ready and the canvas has loaded.
 * The room can remount while it settles its thread route, so the request is kept outside it
 * until a mounted room has opened it.
 */
export function useCanvasOpenRequest(
  mx: MatrixClient,
  room: Room,
  enabled: boolean,
  open: (event: MatrixEvent) => void
): void {
  const latestOpen = useRef(open);
  useLayoutEffect(() => {
    latestOpen.current = open;
  }, [open]);
  useEffect(() => {
    const asked = request;
    if (!enabled || asked?.roomId !== room.roomId) return undefined;
    if (Date.now() - asked.at > REQUEST_TTL_MS) {
      request = undefined;
      return undefined;
    }
    let alive = true;
    loadCanvasEvent(mx, room, asked.canvasId).then((event) => {
      if (!alive || request !== asked) return;
      request = undefined;
      if (event) latestOpen.current(event);
    });
    return () => {
      alive = false;
    };
  }, [mx, room, enabled]);
}
