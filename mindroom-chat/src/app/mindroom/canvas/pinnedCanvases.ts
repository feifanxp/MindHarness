import type { MatrixClient } from 'matrix-js-sdk';
import { isRecord } from '../../utils/isRecord';

/** Account data, so pins follow the user to every device. */
export const PINNED_CANVASES_TYPE = 'io.mindroom.pinned_canvases';

export type PinnedCanvas = { roomId: string; canvasId: string };

/** Pins hold IDs only: account data is not encrypted, and a canvas's title is. */
export const readPinnedCanvases = (content: unknown): PinnedCanvas[] => {
  const canvases = isRecord(content) && Array.isArray(content.canvases) ? content.canvases : [];
  const seen = new Set<string>();
  return canvases.flatMap((pin) => {
    if (
      !isRecord(pin) ||
      typeof pin.room_id !== 'string' ||
      !pin.room_id.startsWith('!') ||
      typeof pin.event_id !== 'string' ||
      !pin.event_id.startsWith('$') ||
      seen.has(pin.event_id)
    ) {
      return [];
    }
    seen.add(pin.event_id);
    return [{ roomId: pin.room_id, canvasId: pin.event_id }];
  });
};

const writes = new WeakMap<MatrixClient, Promise<void>>();

/**
 * Pins or unpins a canvas. Changes run one at a time per client, each from the pins the client
 * holds then: the SDK settles a write only once it has echoed back, and skips one equal to what
 * it holds, so overlapping writes would undo each other.
 */
export const setCanvasPinned = (
  mx: MatrixClient,
  pin: PinnedCanvas,
  pinned: boolean
): Promise<void> => {
  const task = (writes.get(mx) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const pins = readPinnedCanvases(
        mx.getAccountData(PINNED_CANVASES_TYPE as never)?.getContent()
      );
      const listed = pins.some((known) => known.canvasId === pin.canvasId);
      const next = pinned
        ? [...pins, ...(listed ? [] : [pin])]
        : pins.filter((known) => known.canvasId !== pin.canvasId);
      await mx.setAccountData(
        PINNED_CANVASES_TYPE as never,
        {
          canvases: next.map((known) => ({ room_id: known.roomId, event_id: known.canvasId })),
        } as never
      );
    });
  writes.set(mx, task);
  return task;
};
